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
export const PPTX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const OFFICE_MEDIA_TYPES = [
  DOCX_MEDIA_TYPE,
  XLSX_MEDIA_TYPE,
  PPTX_MEDIA_TYPE,
] as const;

export const EPUB_MEDIA_TYPE = "application/epub+zip";

/**
 * Audio/video formats a model may consume natively. Both lists are
 * deliberately small: there is no server-side extraction for either (no
 * transcription service), so a file in one of these categories either reaches
 * the model as bytes or is rejected outright.
 */
export const AUDIO_MEDIA_TYPES = [
  "audio/mpeg", // .mp3, also reported as audio/mp3
  "audio/mp3",
  "audio/wav",
  "audio/mp4", // .m4a
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
] as const;

export const VIDEO_MEDIA_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

/**
 * How an attachment reaches the model:
 * - `image` / `pdf`: natively when the model advertises the modality, else
 *   extracted text (pdf only — images require a vision model).
 * - `audio` / `video`: natively only, and only when both the model advertises
 *   the modality and the endpoint's api format can serialize the media type;
 *   anything else is a hard error. Never extracted.
 * - `office` / `ebook` / `text`: always server-side text extraction.
 */
export type FileCategory =
  | "image"
  | "pdf"
  | "audio"
  | "video"
  | "office"
  | "ebook"
  | "text";

const IMAGE_MEDIA_TYPE_SET = new Set<string>(IMAGE_MEDIA_TYPES);
const AUDIO_MEDIA_TYPE_SET = new Set<string>(AUDIO_MEDIA_TYPES);
const VIDEO_MEDIA_TYPE_SET = new Set<string>(VIDEO_MEDIA_TYPES);
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

/**
 * Canonical media type for an audio/video extension, used when the browser
 * reports nothing usable (empty string or `application/octet-stream`). Browsers
 * are inconsistent here — macOS Finder and several Android pickers hand over an
 * empty type for `.m4a`/`.mov` — so the extension carries the classification.
 */
const AV_EXTENSION_MEDIA_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  wav: "audio/wav",
  weba: "audio/webm",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  qt: "video/quicktime",
};

/** Canonical audio/video media type for a filename, or `null` when unknown. */
export function avMediaTypeForExtension(filename: string): string | null {
  return AV_EXTENSION_MEDIA_TYPES[fileExtension(filename)] ?? null;
}

/** Non-canonical types clients occasionally send for a supported format. */
const MEDIA_TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "application/x-pdf": PDF_MEDIA_TYPE,
  "application/acrobat": PDF_MEDIA_TYPE,
  "audio/x-m4a": "audio/mp4",
  "audio/mp4a-latm": "audio/mp4",
  // x-wav folds onto wav: the openai-compatible wire format (`input_audio`)
  // only knows the canonical spelling, and the router's serialization gate
  // runs on the normalized type.
  "audio/x-wav": "audio/wav",
  "audio/x-flac": "audio/flac",
  "audio/x-aac": "audio/aac",
  "video/x-m4v": "video/mp4",
  "video/x-quicktime": "video/quicktime",
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
  if (mediaType === EPUB_MEDIA_TYPE) {
    return "ebook";
  }
  if (AUDIO_MEDIA_TYPE_SET.has(mediaType)) {
    return "audio";
  }
  if (VIDEO_MEDIA_TYPE_SET.has(mediaType)) {
    return "video";
  }
  const extension = fileExtension(input.filename);
  // Browsers hand us an empty or generic media type for pptx/epub often enough
  // that the extension has to carry the classification. Both formats are always
  // extracted and never handed to a model natively, so accepting them by name
  // cannot smuggle anything into a native path.
  if (extension === "pptx") {
    return "office";
  }
  if (extension === "epub") {
    return "ebook";
  }
  // Same story for audio/video, only these *do* reach a model natively — so
  // the extension is only trusted to pick the category, never to override a
  // media type we already recognized above.
  const avMediaType = avMediaTypeForExtension(input.filename);
  if (avMediaType !== null) {
    return AUDIO_MEDIA_TYPE_SET.has(avMediaType) ? "audio" : "video";
  }
  const base = basename(input.filename).toLowerCase();
  if (
    TEXT_EXTENSIONS.has(extension) ||
    TEXT_FILENAMES.has(base) ||
    mediaType.startsWith("text/")
  ) {
    return "text";
  }
  return null;
}

/**
 * `accept` attribute for the attachment file picker, derived from the same
 * whitelist `classifyFile` enforces so the two cannot drift. Text formats (and
 * pptx/epub, which browsers also report inconsistently) are offered by
 * extension as well as by media type — as are audio/video, whose media types
 * browsers leave blank often enough that a type-only list would hide them.
 */
export const SUPPORTED_FILE_ACCEPT: string = [
  ...IMAGE_MEDIA_TYPES,
  PDF_MEDIA_TYPE,
  ...OFFICE_MEDIA_TYPES,
  EPUB_MEDIA_TYPE,
  ...AUDIO_MEDIA_TYPES,
  ...VIDEO_MEDIA_TYPES,
  ...[...TEXT_EXTENSIONS].map((extension) => `.${extension}`),
  ...Object.keys(AV_EXTENSION_MEDIA_TYPES).map((extension) => `.${extension}`),
  ".pptx",
  ".epub",
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
