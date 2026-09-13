import { buildZip, type ZipEntry } from "./zip";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PRESENTATION_NS =
  "http://schemas.openxmlformats.org/presentationml/2006/main";

function paragraphs(values: readonly string[]): string {
  return values
    .map(
      (value) =>
        `<a:p><a:r><a:t xml:space="preserve">${escapeXml(value)}</a:t></a:r></a:p>`,
    )
    .join("");
}

function slideXml(body: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${DRAWING_NS}" xmlns:p="${PRESENTATION_NS}"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs(body)}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
}

function notesXml(body: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="${DRAWING_NS}" xmlns:p="${PRESENTATION_NS}"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphs(body)}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
}

export interface PptxSlide {
  /** Paragraphs of the slide body. */
  body?: readonly string[];
  /** Speaker-notes paragraphs attached to the same page. */
  notes?: readonly string[];
}

/**
 * Builds a minimal but structurally real .pptx. Entries are written to the
 * archive in *reverse* page order on purpose: a parser that trusts the archive
 * order — or sorts slide names as strings — gets the deck wrong.
 */
export function buildPptx(slides: readonly PptxSlide[]): Buffer {
  const entries: ZipEntry[] = [
    { name: "[Content_Types].xml", data: CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
  ];
  for (let index = slides.length - 1; index >= 0; index -= 1) {
    const slide = slides[index];
    if (!slide) {
      continue;
    }
    const page = index + 1;
    entries.push({
      name: `ppt/slides/slide${page}.xml`,
      data: slideXml(slide.body ?? []),
    });
    if (slide.notes && slide.notes.length > 0) {
      entries.push({
        name: `ppt/notesSlides/notesSlide${page}.xml`,
        data: notesXml(slide.notes),
      });
    }
  }
  return buildZip(entries);
}
