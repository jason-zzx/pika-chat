import { flattenError, ZodError } from "zod";

import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";

type RouteContext = {
  params: Promise<Record<string, string>>;
};

type Handler = (
  request: Request,
  context?: RouteContext,
) => Promise<Response> | Response;

export function withErrorHandling(handler: Handler): Handler {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ZodError) {
        return Response.json(
          {
            error: {
              code: "VALIDATION_FAILED",
              message: "Invalid request",
              details: flattenError(error).fieldErrors,
            },
          },
          { status: 400 },
        );
      }

      if (error instanceof AppError) {
        return Response.json(
          {
            error: {
              code: error.code,
              message: error.message,
              details: error.details,
            },
          },
          { status: error.status },
        );
      }

      const requestId = crypto.randomUUID();
      logger.error({ err: error, requestId }, "unhandled error");
      return Response.json(
        {
          error: {
            code: "INTERNAL",
            message: "An unexpected error occurred",
            details: { requestId },
          },
        },
        { status: 500 },
      );
    }
  };
}
