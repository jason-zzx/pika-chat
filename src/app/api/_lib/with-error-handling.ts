import { ZodError } from "zod";
import type { ZodIssue } from "zod";

import type {
  ApiErrorEnvelope,
  ValidationFieldError,
} from "@/lib/api/error-contract";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

type RouteContext = {
  params: Promise<Record<string, string>>;
};

type Handler = (
  request: Request,
  context?: RouteContext,
) => Promise<Response> | Response;

/** Maps a Zod issue onto the `Validation` catalog without leaking its text. */
function fieldErrorFor(issue: ZodIssue): ValidationFieldError {
  switch (issue.code) {
    case "invalid_type":
      // Zod 4 does not expose the offending input here, so "missing" and
      // "wrong type" are indistinguishable — both map to the generic
      // invalid-type message. Throw sites that know a field is required can
      // still emit `{ key: "required" }` explicitly.
      return { key: "invalidType" };
    case "too_small":
      return { key: "tooSmall", params: { minimum: toParam(issue.minimum) } };
    case "too_big":
      return { key: "tooBig", params: { maximum: toParam(issue.maximum) } };
    case "invalid_format":
      return { key: "invalidFormat", params: { format: issue.format } };
    case "invalid_value":
      return { key: "invalidValue" };
    case "unrecognized_keys":
      return { key: "unrecognizedKeys" };
    default:
      return { key: "invalid" };
  }
}

function toParam(value: number | bigint): number | string {
  return typeof value === "bigint" ? value.toString() : value;
}

/** First issue per field wins; path-less (form-level) issues are dropped. */
function fieldErrorsFrom(error: ZodError): Record<string, ValidationFieldError> {
  const fieldErrors: Record<string, ValidationFieldError> = {};
  for (const issue of error.issues) {
    const field = issue.path.map((segment) => String(segment)).join(".");
    if (field.length === 0 || field in fieldErrors) {
      continue;
    }
    fieldErrors[field] = fieldErrorFor(issue);
  }
  return fieldErrors;
}

export function withErrorHandling(handler: Handler): Handler {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ZodError) {
        const body: ApiErrorEnvelope = {
          error: {
            code: "VALIDATION_FAILED",
            messageKey: "validation.failed",
            details: { fieldErrors: fieldErrorsFrom(error) },
          },
        };
        return Response.json(body, { status: 400 });
      }

      if (error instanceof AppError) {
        const body: ApiErrorEnvelope = {
          error: {
            code: error.code,
            messageKey: error.messageKey,
            params: error.params,
            details: error.details,
          },
        };
        return Response.json(body, { status: error.status });
      }

      const requestId = crypto.randomUUID();
      logger.error({ err: error, requestId }, "unhandled error");
      const body: ApiErrorEnvelope = {
        error: {
          code: "INTERNAL",
          messageKey: "unexpected",
          details: { requestId },
        },
      };
      return Response.json(body, { status: 500 });
    }
  };
}
