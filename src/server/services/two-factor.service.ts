import "server-only";

import QRCode from "qrcode";

import type { QrCodeRequest } from "@/lib/schemas/two-factor";

/**
 * Turns a caller-supplied TOTP URI into an SVG data URL, so the browser can
 * render a QR code without shipping an encoder to the client bundle.
 *
 * The URI arrives from better-auth's `/two-factor/enable` response and only
 * exists client-side at that moment, which is why this is a project-owned
 * Route Handler capability rather than something the settings page can
 * pre-render. The input is validated at the boundary; no stored secret is read
 * and the URI is never logged, so there is no user-scoped data here to filter —
 * caller authentication happens in the Route Handler.
 *
 * `QRCode.toDataURL(uri, { type: "svg" })` is unusable: `qrcode` only registers
 * a data-URL renderer for the canvas/PNG path and throws "renderFunc is not a
 * function" for `svg`. `toString(uri, { type: "svg" })` works and returns raw
 * markup, so the data URL is built here. Verified at runtime against
 * qrcode@1.5.4.
 */
export async function renderTotpQrCode(input: QrCodeRequest): Promise<string> {
  const markup = await QRCode.toString(input.uri, { type: "svg" });
  return `data:image/svg+xml;base64,${Buffer.from(markup, "utf8").toString("base64")}`;
}
