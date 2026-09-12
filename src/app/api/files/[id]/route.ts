import { requireParam } from "@/app/api/_lib/route-params";
import { withErrorHandling } from "@/app/api/_lib/with-error-handling";
import { PDF_MEDIA_TYPE } from "@/lib/files/media-types";
import { requireActor } from "@/server/auth/actor";
import {
  deleteFile,
  type FileRecord,
  readFileForActor,
} from "@/server/files/file.service";

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

function contentHeaders(file: FileRecord): Headers {
  const inline =
    file.mediaType.startsWith("image/") || file.mediaType === PDF_MEDIA_TYPE;
  const headers = new Headers();
  headers.set("Content-Type", file.mediaType);
  headers.set("Content-Length", String(file.sizeBytes));
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", contentDisposition(file.filename, inline));
  return headers;
}

export const GET = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  const { file, data } = await readFileForActor(await fileId(context), actor);
  return new Response(new Uint8Array(data), { headers: contentHeaders(file) });
});

export const DELETE = withErrorHandling(async (request, context) => {
  const actor = await requireActor(request.headers);
  await deleteFile(await fileId(context), actor);
  return new Response(null, { status: 204 });
});
