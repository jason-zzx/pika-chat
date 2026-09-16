"use client";

import { useTranslations } from "next-intl";
import {
  Fragment,
  useContext,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Components, ExtraProps } from "streamdown";

import ExternalLinkDialog from "./ExternalLinkDialog";
import {
  CITATION_TEXT_PATTERN,
  CitationSourcesContext,
  type CitationSource,
} from "./citations";

type SupProps = ComponentProps<"sup"> & ExtraProps;

/** Num tokens inside a matched group body (`"3, 5"` → `[3, 5]`). */
const CITATION_NUM_PATTERN = /\d+/g;

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
 * remark plugin (`remarkCitations`) produced from `[n]` / `[n, m]` text
 * tokens: resolvable nums render as numbered chips, unresolvable ones (out of
 * range, stale num, model noise) fall back to the literal text the model
 * wrote. A group renders its chips back to back — no separator text, so
 * `[3, 5]` is two chips and nothing else. A genuine `<sup>` (raw HTML in the
 * source) keeps default rendering.
 */
export default function CitationSup(props: SupProps) {
  const { children, ...rest } = props;
  // `node` (the hast element) is a Streamdown render detail, not a valid DOM
  // attribute — strip it before spreading onto <sup>.
  delete rest.node;
  const sources = useContext(CitationSourcesContext);
  const text = textOf(children);
  if (text === undefined || !CITATION_TEXT_PATTERN.test(text)) {
    return <sup {...rest}>{children}</sup>;
  }
  const nums = (text.match(CITATION_NUM_PATTERN) ?? []).map(Number);
  const resolved = nums.map((num) =>
    sources.find((candidate) => candidate.num === num),
  );
  return (
    <>
      {nums.map((num, index) => {
        const source = resolved[index];
        const key = `${num}-${index}`;
        return source === undefined ? (
          <Fragment key={key}>{`[${num}]`}</Fragment>
        ) : (
          <CitationChip key={key} source={source} />
        );
      })}
    </>
  );
}

/** Superscript numbered pill (ChatGPT-style); taps open the external-link
 * confirmation dialog for the source URL. */
function CitationChip({ source }: { source: CitationSource }) {
  const t = useTranslations("Chat.MessageItem");
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t("citationSource", {
          num: source.num,
          title: source.title,
        })}
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
