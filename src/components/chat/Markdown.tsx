"use client";

import { useSyncExternalStore } from "react";
import { Streamdown } from "streamdown";

import { CITATION_COMPONENTS } from "./CitationSup";
import {
  CitationSourcesContext,
  REMARK_PLUGINS_WITH_CITATIONS,
  type CitationSource,
} from "./citations";
import { textNeedsMermaid, useStreamdownPlugins } from "./markdown-plugins";

type MarkdownProps = {
  text: string;
  /** The turn's numbered tool sources (R14). When present, `[n]` markers in
   * the text that resolve to a source render as citation chips opening the
   * external-link dialog; unresolvable markers stay literal text. When
   * absent, the render path is byte-identical to plain markdown — no extra
   * plugins or component overrides are passed to Streamdown. */
  citations?: readonly CitationSource[];
};

// Mermaid's built-in `dark` theme mixes light and dark node fills that clash
// with the app's dark palette, so dark mode uses `base` with explicit
// variables. Values are hex approximations of the `.dark` oklch tokens in
// globals.css (mermaid derives colors with khroma, which cannot parse oklch):
//   --background oklch(0.145) ≈ #0a0a0a   --card oklch(0.205) ≈ #171717
//   --foreground oklch(0.985) ≈ #fafafa   --muted-foreground oklch(0.708) ≈ #a1a1a1
//   --secondary/--muted oklch(0.269) ≈ #262626
const DARK_THEME_VARIABLES = {
  background: "#0a0a0a",
  primaryColor: "#171717",
  primaryTextColor: "#fafafa",
  primaryBorderColor: "#3f3f46",
  secondaryColor: "#262626",
  secondaryTextColor: "#fafafa",
  secondaryBorderColor: "#3f3f46",
  tertiaryColor: "#262626",
  tertiaryTextColor: "#fafafa",
  tertiaryBorderColor: "#3f3f46",
  lineColor: "#a1a1a1",
  textColor: "#fafafa",
  mainBkg: "#171717",
  nodeBorder: "#3f3f46",
  clusterBkg: "#262626",
  clusterBorder: "#3f3f46",
  edgeLabelBackground: "#0a0a0a",
  titleColor: "#fafafa",
  // Sequence diagrams
  actorBkg: "#171717",
  actorBorder: "#3f3f46",
  actorTextColor: "#fafafa",
  actorLineColor: "#a1a1a1",
  signalColor: "#a1a1a1",
  signalTextColor: "#fafafa",
  labelBoxBkgColor: "#171717",
  labelBoxBorderColor: "#3f3f46",
  labelTextColor: "#fafafa",
  loopTextColor: "#fafafa",
  noteBkgColor: "#262626",
  noteTextColor: "#fafafa",
  noteBorderColor: "#3f3f46",
  activationBkgColor: "#262626",
  activationBorderColor: "#3f3f46",
  // Gantt
  sectionBkgColor: "#262626",
  altSectionBkgColor: "#171717",
  taskBkgColor: "#3f3f46",
  taskTextColor: "#fafafa",
  taskTextLightColor: "#fafafa",
  taskTextOutsideColor: "#fafafa",
  gridColor: "#3f3f46",
};

// The theme lives in a cookie + `dark` class on <html> (see
// layout/use-theme-sync.ts), not in React context, so subscribe to class
// mutations. SSR always reports light; mermaid only renders client-side, so
// there is no hydration mismatch. Shiki needs no such hook: Streamdown emits
// `dark:` classes that follow `.dark` automatically.
function subscribeDarkClass(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getDarkSnapshot() {
  return document.documentElement.classList.contains("dark");
}

export default function Markdown({ text, citations }: MarkdownProps) {
  const plugins = useStreamdownPlugins(text);
  // SSR always reports light; mermaid only renders client-side, so there is
  // no hydration mismatch.
  const isDark = useSyncExternalStore(
    subscribeDarkClass,
    getDarkSnapshot,
    () => false,
  );
  // Streamdown's memo comparator ignores the `mermaid` prop, so a fresh
  // options object per render costs nothing (no reparse).
  const mermaidOptions = {
    config: {
      theme: isDark ? "base" : "default",
      ...(isDark ? { themeVariables: DARK_THEME_VARIABLES } : {}),
    },
  };

  // Streamdown's memo comparator ignores the `mermaid` prop, so an
  // already-rendered diagram would keep its old theme when isDark flips.
  // Remount via key, but only for messages that actually contain a mermaid
  // fence — keying every message would remount the whole subtree (and reparse
  // every block) on each theme toggle for no benefit.
  const keySegments: string[] = [];
  if (textNeedsMermaid(text)) {
    keySegments.push(isDark ? "dark" : "light");
  }

  const hasCitations = citations !== undefined && citations.length > 0;
  // The same comparator also ignores remarkPlugins/components, so a text
  // block that parsed before its sources arrived would keep `[n]` markers
  // literal forever. Fold citation presence into the key: the block remounts
  // and reparses exactly once when sources first appear. The
  // no-citations-ever path keeps `undefined` and never remounts.
  if (hasCitations) {
    keySegments.push("cited");
  }
  const streamdownKey =
    keySegments.length > 0 ? keySegments.join("|") : undefined;

  // Plugin and component identities are module-level constants, and
  // Streamdown's memo comparator ignores remarkPlugins/components, so the
  // cited path reparses only when `children` changes or the citation key
  // segment first appears — during streaming the answer text (and with it
  // the chips) typically arrives after its sources exist, and the key
  // remount covers the reverse order.
  const streamdown = (
    <Streamdown
      key={streamdownKey}
      plugins={plugins}
      mermaid={mermaidOptions}
      {...(hasCitations
        ? {
            remarkPlugins: REMARK_PLUGINS_WITH_CITATIONS,
            components: CITATION_COMPONENTS,
          }
        : {})}
    >
      {text}
    </Streamdown>
  );

  // The sup override reads the source map from context rather than props so
  // an updated source list still reaches already-rendered chips (context
  // updates propagate across Streamdown's memo boundary). The first
  // appearance of sources is covered by the key remount above; context
  // handles subsequent list growth (e.g. a second search adding sources).
  return hasCitations ? (
    <CitationSourcesContext.Provider value={citations ?? []}>
      {streamdown}
    </CitationSourcesContext.Provider>
  ) : (
    streamdown
  );
}
