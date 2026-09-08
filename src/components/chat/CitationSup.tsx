"use client";

import { useContext, useState, type ComponentProps, type ReactNode } from "react";
import type { Components, ExtraProps } from "streamdown";

import ExternalLinkDialog from "./ExternalLinkDialog";
import { CitationSourcesContext, type CitationSource } from "./citations";

type SupProps = ComponentProps<"sup"> & ExtraProps;

/** The exact marker text the remark plugin wraps: `[n]`. */
const CITATION_TEXT_PATTERN = /^\[(\d+)\]$/;

/** Flattens rendered children to plain text; undefined when the children are
 * not pure text (e.g. a raw-HTML sup with nested elements). */
function textOf(children: ReactNode): string | undefined {
  if (typeof children === "string") {
    return children;
  }
  if (Array.isArray(children)) {
    const parts = children.map(textOf);
    return parts.every((part) => part !== undefined)
      ? parts.join("")
      : undefined;
  }
  return undefined;
}

/**
 * Renders `<sup>` elements. Two of three cases are citation markers the
 * remark plugin (`remarkCitations`) produced from `[n]` text tokens:
 * resolvable markers render as numbered chips, unresolvable ones (out of
 * range, stale num, model noise) fall back to the literal `[n]` text the
 * model wrote. A genuine `<sup>` (raw HTML in the source) keeps default
 * rendering.
 */
export default function CitationSup(props: SupProps) {
  const { children, ...rest } = props;
  // `node` (the hast element) is a Streamdown render detail, not a valid DOM
  // attribute — strip it before spreading onto <sup>.
  delete rest.node;
  const sources = useContext(CitationSourcesContext);
  const text = textOf(children);
  const match =
    text === undefined ? null : CITATION_TEXT_PATTERN.exec(text);
  if (match === null) {
    return <sup {...rest}>{children}</sup>;
  }
  const num = Number(match[1]);
  const source = sources.find((candidate) => candidate.num === num);
  if (source === undefined) {
    return <>{children}</>;
  }
  return <CitationChip source={source} />;
}

/** Superscript numbered pill (ChatGPT-style); taps open the external-link
 * confirmation dialog for the source URL. */
function CitationChip({ source }: { source: CitationSource }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`Source ${source.num}: ${source.title}`}
        onClick={() => setDialogOpen(true)}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 align-super text-[10px] leading-none font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {source.num}
      </button>
      <ExternalLinkDialog
        url={source.url}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  );
}

/**
 * Components override registered on cited messages. Module-level so the
 * `components` prop identity stays stable across renders; every other tag
 * keeps Streamdown's defaults.
 */
export const CITATION_COMPONENTS: Components = { sup: CitationSup };
