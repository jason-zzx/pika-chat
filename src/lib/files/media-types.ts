/**
 * Attachment media-type classification. Isomorphic on purpose: the server uses
 * it to route extraction and native transmission, the client uses the same
 * table to filter the file picker and label attachment cards.
 */

export const IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

export const PDF_MEDIA_TYPE = "application/pdf";

export const DOCX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const OFFICE_MEDIA_TYPES = [DOCX_MEDIA_TYPE, XLSX_MEDIA_TYPE] as const;

/**
 * How an attachment reaches the model:
 * - `image` / `pdf`: natively when the model advertises the modality, else
 *   extracted text (pdf only — images require a vision model).
 * - `office` / `text`: always server-side text extraction.
 */
export type FileCategory = "image" | "pdf" | "office" | "text";

const IMAGE_MEDIA_TYPE_SET = new Set<string>(IMAGE_MEDIA_TYPES);
const OFFICE_MEDIA_TYPE_SET = new Set<string>(OFFICE_MEDIA_TYPES);

/** Text formats accepted by extension even when the browser sends an odd type. */
const TEXT_EXTENSIONS = new Set<string>([
  // prose / data
  "txt",
  "text",
  "md",
  "markdown",
  "mdx",
  "csv",
  "tsv",
  "json",
  "jsonc",
  "json5",
  "yaml",
  "yml",
  "toml",
  "xml",
  "ini",
  "cfg",
  "conf",
  "env",
  "log",
  "diff",
  "patch",
  // markup / style
  "html",
  "htm",
  "css",
  "scss",
  "less",
  // code
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "swift",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hh",
  "cs",
  "php",
  "lua",
  "r",
  "dart",
  "sh",
  "bash",
  "zsh",
  "fish",
  "ps1",
  "bat",
  "cmd",
  "sql",
  "graphql",
  "gql",
  "proto",
]);

/** Well-known extensionless text files. */
const TEXT_FILENAMES = new Set<string>([
  "dockerfile",
  "makefile",
  "procfile",
  "license",
  "licence",
  "readme",
  "changelog",
  ".gitignore",
  ".env",
]);

/** Non-canonical types clients occasionally send for a supported format. */
const MEDIA_TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "application/x-pdf": PDF_MEDIA_TYPE,
  "application/acrobat": PDF_MEDIA_TYPE,
};

/** Lowercases and folds known client aliases onto the canonical media type. */
export function normalizeMediaType(mediaType: string): string {
  const lower = mediaType.trim().toLowerCase();
  return MEDIA_TYPE_ALIASES[lower] ?? lower;
}

/** Basename of a path-ish filename (`a/b/c.txt` → `c.txt`). */
function basename(filename: string): string {
  const slash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  return filename.slice(slash + 1);
}

/** Lowercased extension without the dot; empty when there is none. */
export function fileExtension(filename: string): string {
  const base = basename(filename);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Classifies an attachment, or returns `null` when the format is not
 * supported. Classification is driven by the declared media type first so a
 * renamed file cannot smuggle itself into a category the model would then be
 * asked to natively consume.
 */
export function classifyFile(input: {
  mediaType: string;
  filename: string;
}): FileCategory | null {
  const mediaType = normalizeMediaType(input.mediaType);
  if (IMAGE_MEDIA_TYPE_SET.has(mediaType)) {
    return "image";
  }
  if (mediaType === PDF_MEDIA_TYPE) {
    return "pdf";
  }
  if (OFFICE_MEDIA_TYPE_SET.has(mediaType)) {
    return "office";
  }
  const base = basename(input.filename).toLowerCase();
  if (
    TEXT_EXTENSIONS.has(fileExtension(input.filename)) ||
    TEXT_FILENAMES.has(base) ||
    mediaType.startsWith("text/")
  ) {
    return "text";
  }
  return null;
}

/**
 * `accept` attribute for the attachment file picker, derived from the same
 * whitelist `classifyFile` enforces so the two cannot drift. Text formats are
 * offered by extension (browsers report inconsistent media types for them).
 */
export const SUPPORTED_FILE_ACCEPT: string = [
  ...IMAGE_MEDIA_TYPES,
  PDF_MEDIA_TYPE,
  ...OFFICE_MEDIA_TYPES,
  ...[...TEXT_EXTENSIONS].map((extension) => `.${extension}`),
].join(",");

/** Canonical `/api/files/<id>` prefix used by stored attachment parts. */
export const FILE_URL_PREFIX = "/api/files/";

/** File id from a canonical attachment url, or null when it is not one. */
export function fileIdFromUrl(url: string): string | null {
  if (!url.startsWith(FILE_URL_PREFIX)) {
    return null;
  }
  const id = url.slice(FILE_URL_PREFIX.length);
  return id.length > 0 ? id : null;
}
