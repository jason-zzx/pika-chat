import { buildZip, type ZipEntry } from "./zip";

const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";
const OPF_NS = "http://www.idpf.org/2007/opf";

export interface EpubChapter {
  id: string;
  /** Href relative to the OPF; defaults to `<id>.xhtml`. */
  href?: string;
  /** XHTML placed inside the chapter `<body>`. */
  body: string;
  /** Declare the chapter but leave the file out of the archive (corrupt epub). */
  omitFile?: boolean;
}

export interface EpubOptions {
  /** OPF path inside the archive; chapter hrefs resolve against its directory. */
  opfPath?: string;
  /** Spine reading order (chapter ids); defaults to the chapter order. */
  spine?: readonly string[];
  /** Drops `META-INF/container.xml` to simulate a corrupt archive. */
  omitContainer?: boolean;
}

function containerXml(fullPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="${CONTAINER_NS}">
<rootfiles><rootfile full-path="${fullPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
}

function chapterXml(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`;
}

function packageXml(
  items: readonly { id: string; href: string }[],
  spine: readonly string[],
): string {
  const manifest = items
    .map(
      (item) =>
        `<item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`,
    )
    .join("");
  const itemrefs = spine.map((id) => `<itemref idref="${id}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="${OPF_NS}" version="3.0" unique-identifier="book-id">
<manifest>${manifest}</manifest>
<spine>${itemrefs}</spine>
</package>`;
}

/**
 * Builds a minimal but structurally real .epub: `META-INF/container.xml`
 * pointing at an OPF whose spine drives the reading order over XHTML chapters.
 */
export function buildEpub(
  chapters: readonly EpubChapter[],
  options: EpubOptions = {},
): Buffer {
  const opfPath = options.opfPath ?? "content.opf";
  const spine = options.spine ?? chapters.map((chapter) => chapter.id);
  const entries: ZipEntry[] = [];
  if (!options.omitContainer) {
    entries.push({
      name: "META-INF/container.xml",
      data: containerXml(opfPath),
    });
  }

  const items = chapters.map((chapter) => ({
    id: chapter.id,
    href: chapter.href ?? `${chapter.id}.xhtml`,
  }));
  entries.push({ name: opfPath, data: packageXml(items, spine) });

  const directory = opfPath.slice(0, Math.max(opfPath.lastIndexOf("/"), 0));
  for (const chapter of chapters) {
    if (chapter.omitFile === true) {
      continue;
    }
    const href = chapter.href ?? `${chapter.id}.xhtml`;
    const prefix = directory.length > 0 ? `${directory}/` : "";
    // Manifest hrefs are URIs while archive entry names are not — a real
    // producer stores the decoded name, so the fixture does the same.
    entries.push({
      name: `${prefix}${decodeURIComponent(href)}`,
      data: chapterXml(chapter.body),
    });
  }

  return buildZip(entries);
}
