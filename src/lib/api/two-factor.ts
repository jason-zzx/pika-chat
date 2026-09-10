import { parseJson } from "@/lib/api/parse";
import {
  qrCodeResponseSchema,
  type QrCodeRequest,
  type QrCodeResponse,
} from "@/lib/schemas/two-factor";

/**
 * Renders an enrollment `otpauth://` URI into an image data URL.
 *
 * better-auth's `/two-factor/enable` returns the URI to the browser only, so
 * this is the single part of enrollment a Server Component cannot produce.
 */
export async function fetchTotpQrCode(
  input: QrCodeRequest,
): Promise<QrCodeResponse> {
  const response = await fetch("/api/account/2fa/qrcode", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson(response, (data) => qrCodeResponseSchema.parse(data));
}
