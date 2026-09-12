/**
 * Hand-built PDF fixtures. The bytes are constructed with correct xref offsets
 * so pdf.js parses them in its strict path, without committing a binary or
 * adding a PDF writer dependency. ASCII content only (latin1 encoding).
 *
 * pdf.js clips a text run at the page edge, so long text is laid out as short
 * lines across multiple pages — matching a real document's shape.
 */

interface PdfObject {
  id: number;
  body: string;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
/** Characters per line; stays clear of the right page edge at 12pt Helvetica. */
const LINE_CHARS = 72;
const LINES_PER_PAGE = 50;

function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdfBytes(objects: readonly PdfObject[], trailerExtra = ""): Buffer {
  const sorted = [...objects].sort((a, b) => a.id - b.id);
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = new Map<number, number>();

  for (const object of sorted) {
    offsets.set(object.id, Buffer.byteLength(out, "latin1"));
    out += `${object.id} 0 obj\n${object.body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(out, "latin1");
  const maxId = sorted[sorted.length - 1]?.id ?? 0;
  out += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id++) {
    const offset = offsets.get(id) ?? 0;
    out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(out, "latin1");
}

function contentStream(content: string): string {
  return `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
}

function textPageContent(lines: readonly string[]): string {
  const operations = [
    "BT",
    "/F1 12 Tf",
    ...lines.flatMap((line, index) => [
      `1 0 0 1 40 ${PAGE_HEIGHT - 42 - index * 14} Tm`,
      `(${escapePdfString(line)}) Tj`,
    ]),
    "ET",
  ];
  return operations.join("\n");
}

function multiPagePdf(pageContents: readonly string[]): Buffer {
  const pageCount = pageContents.length;
  const fontId = 3 + pageCount * 2;
  const objects: PdfObject[] = [
    { id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    {
      id: 2,
      body: `<< /Type /Pages /Kids [${pageContents
        .map((_, index) => `${3 + index * 2} 0 R`)
        .join(" ")}] /Count ${pageCount} >>`,
    },
  ];
  pageContents.forEach((content, index) => {
    objects.push({
      id: 3 + index * 2,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`,
    });
    objects.push({ id: 4 + index * 2, body: contentStream(content) });
  });
  objects.push({
    id: fontId,
    body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  });
  return buildPdfBytes(objects);
}

function singlePagePdf(
  content: string,
  extra: { objects?: readonly PdfObject[]; trailerExtra?: string } = {},
): Buffer {
  return buildPdfBytes(
    [
      { id: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
      { id: 2, body: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>" },
      {
        id: 3,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
      },
      { id: 4, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
      { id: 5, body: contentStream(content) },
      ...(extra.objects ?? []),
    ],
    extra.trailerExtra,
  );
}

/** A PDF with a real (uncompressed) text layer, paginated like a document. */
export function buildTextPdf(text: string): Buffer {
  const lines = text.match(/[\s\S]{1,72}/g) ?? [""];
  const pages: string[] = [];
  for (let start = 0; start < lines.length; start += LINES_PER_PAGE) {
    pages.push(textPageContent(lines.slice(start, start + LINES_PER_PAGE)));
  }
  return multiPagePdf(pages.length > 0 ? pages : [textPageContent([""])]);
}

/** A page that draws vector content but carries no text layer. */
export function buildScannedPdf(): Buffer {
  return singlePagePdf("q 0.5 0.5 1 rg 100 100 300 400 re f Q");
}

/** A PDF declaring a Standard security handler, so opening it needs a password. */
export function buildEncryptedPdf(): Buffer {
  return singlePagePdf("BT /F1 12 Tf 40 750 Td (secret) Tj ET", {
    objects: [
      {
        id: 6,
        body: `<< /Filter /Standard /V 1 /R 2 /O <${"00".repeat(16)}> /U <${"00".repeat(16)}> /P -4 >>`,
      },
    ],
    trailerExtra: `/Encrypt 6 0 R /ID [<${"00".repeat(16)}><${"00".repeat(16)}>]`,
  });
}

/** Bytes that are not a PDF at all. */
export function buildBrokenPdf(): Buffer {
  return Buffer.from("this is definitely not a pdf document", "latin1");
}
