import "server-only";

/**
 * Every ZIP container — and therefore every docx/xlsx/pptx/epub — opens with
 * the local-file-header signature `PK\x03\x04`. Parsers used here accept
 * arbitrary bytes without complaining (SheetJS reads a corrupt file as a CSV
 * sheet, jszip fails late with an opaque message), so each extractor checks the
 * signature first and reports a readable "not a …" failure instead.
 */
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** True when `buffer` begins with the ZIP local-file-header signature. */
export function isZipContainer(buffer: Buffer): boolean {
  return buffer.subarray(0, ZIP_SIGNATURE.length).equals(ZIP_SIGNATURE);
}
