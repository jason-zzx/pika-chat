import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { PDF_MEDIA_TYPE } from "@/lib/files/media-types";
import { requireActor } from "@/server/auth/actor";
import {
  deleteFile,
  type FileRecord,
  getFileForActor,
} from "@/server/files/file.service";
import { isS3DirectAccessEnabled } from "@/server/files/limits";
import { getFileStorage } from "@/server/files/storage";

function fileId(context: Parameters<typeof requireParam>[0]): Promise<string> {
  return requireParam(context, "id", "file.notFound");
}

/** Quoted-string fallback: printable ASCII only, quotes and slashes stripped. */
function asciiFallback(filename: string): string {
  const cleaned = filename
    .replace(/["\\\r\n]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 255);
  return cleaned.length > 0 ? cleaned : "download";
}

/** RFC 5987 percent-encoding, including the characters `encodeURIComponent`
 * leaves bare (`'`, `(`, `)`, `*`). */
function rfc5987(filename: string): string {
  return encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(filename: string, inline: boolean): string {
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${asciiFallback(filename)}"; filename*=UTF-8''${rfc5987(filename)}`;
}

// Media is served inline so it plays in the message's native
// `<audio>`/`<video>` player; everything else is a download.
function servesInline(file: FileRecord): boolean {
  return (
    file.mediaType.startsWith("image/") ||
    file.mediaType.startsWith("audio/") ||
    file.mediaType.startsWith("video/") ||
    file.mediaType === PDF_MEDIA_TYPE
  );
}

function contentHeaders(file: FileRecord): Headers {
  const headers = new Headers();
  headers.set("Content-Type", file.mediaType);
  headers.set("Content-Length", String(file.sizeBytes));
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set(
    "Content-Disposition",
    contentDisposition(file.filename, servesInline(file)),
  );
  return headers;
}

/** Lifetime of the presigned GET a direct-access download redirects to. */
const PRESIGNED_GET_EXPIRES_SEC = 3600;
/** Redirect caching must expire long before the signed URL does. */
const REDIRECT_CACHE_MAX_AGE_SEC = 300;

export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  // Ownership is checked before anything is signed: a foreign id is a 404 and
  // never produces a presigned URL.
  const file = await getFileForActor(await fileId(context), actor);
  const storage = getFileStorage();

  if (isS3DirectAccessEnabled() && storage.createPresignedGet) {
    // Direct access: the bytes never pass through the app. The signed URL
    // overrides the response headers so the redirected object answers with
    // exactly the Content-Type and inline/attachment disposition the relay
    // path below would have used — and clients (img/audio/video tags, new
    // tabs) follow the 302 without any client-side branch.
    const url = await storage.createPresignedGet(file.storageKey, {
      expiresSec: PRESIGNED_GET_EXPIRES_SEC,
      responseContentType: file.mediaType,
      responseContentDisposition: contentDisposition(
        file.filename,
        servesInline(file),
      ),
    });
    return new Response(null, {
      status: 302,
      headers: {
        Location: url,
        "Cache-Control": `private, max-age=${REDIRECT_CACHE_MAX_AGE_SEC}`,
      },
    });
  }

  const data = await storage.get(file.storageKey);
  return new Response(new Uint8Array(data), { headers: contentHeaders(file) });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  await deleteFile(await fileId(context), actor);
  return new Response(null, { status: 204 });
});
