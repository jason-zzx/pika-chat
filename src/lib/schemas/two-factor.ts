import { z } from "zod";

/**
 * Longest `otpauth://totp/…` URI the QR endpoint will render. A real URI is
 * label + a base32 secret: ~200 characters; the cap only bounds abuse of an
 * encoder that is O(n²) in module count.
 */
export const TOTP_URI_MAX_LENGTH = 512;

/**
 * Request body of `POST /api/account/2fa/qrcode`.
 *
 * The URI is produced by better-auth's `/two-factor/enable` and only exists
 * client-side at that point, so the server cannot pre-render the image. The
 * handler does not read stored secrets — it renders whatever URI the caller
 * sends, which is why the shape is pinned this tightly.
 */
export const qrCodeSchema = z.object({
  uri: z
    .string()
    .startsWith("otpauth://totp/")
    .max(TOTP_URI_MAX_LENGTH),
});
export type QrCodeRequest = z.infer<typeof qrCodeSchema>;

/** Response body of `POST /api/account/2fa/qrcode`. */
export const qrCodeResponseSchema = z.object({
  dataUrl: z.string(),
});
export type QrCodeResponse = z.infer<typeof qrCodeResponseSchema>;
