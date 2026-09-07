import { useEffect, useState } from "react";
import type { DiagramPlugin, PluginConfig } from "streamdown";

// Module-level promise caches: every Markdown instance shares one network
// request and one plugin object per plugin kind, so the `plugins` prop
// identity Streamdown's memo compares against stays stable.
let basePluginsPromise: Promise<PluginConfig> | null = null;
let mermaidPluginPromise: Promise<DiagramPlugin> | null = null;

export function loadBasePlugins(): Promise<PluginConfig> {
  basePluginsPromise ??= Promise.all([
    import("@streamdown/code"),
    import("@streamdown/math"),
    import("@streamdown/cjk"),
    // KaTeX styles ride along in the async chunk instead of the entry CSS.
    import("katex/dist/katex.min.css"),
  ]).then(([code, math, cjk]) => ({
    code: code.code,
    math: math.createMathPlugin({ singleDollarTextMath: true }),
    cjk: cjk.cjk,
  }));
  return basePluginsPromise;
}

// Fenced blocks may be indented up to 3 spaces; `\b` keeps ```` ```mermaidfoo ````
// from matching while allowing a trailing info string.
export function textNeedsMermaid(text: string): boolean {
  return /^ {0,3}```mermaid\b/m.test(text);
}

export function loadMermaidPlugin(): Promise<DiagramPlugin> {
  mermaidPluginPromise ??= import("@streamdown/mermaid").then((m) => m.mermaid);
  return mermaidPluginPromise;
}

/**
 * Loads Streamdown plugins after mount. Returns `undefined` until the base
 * plugins are ready so Streamdown falls back to its plain rendering (content
 * stays readable); the reference only changes when the plugin set actually
 * grows (base ready, or a mermaid fence appears in the text).
 */
export function useStreamdownPlugins(text: string): PluginConfig | undefined {
  const needsMermaid = textNeedsMermaid(text);
  const [plugins, setPlugins] = useState<PluginConfig>();

  useEffect(() => {
    let cancelled = false;
    const loading = needsMermaid
      ? Promise.all([loadBasePlugins(), loadMermaidPlugin()]).then(
          ([base, mermaid]) => ({ ...base, mermaid }),
        )
      : loadBasePlugins();
    void loading.then((loaded) => {
      if (!cancelled) {
        setPlugins(loaded);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needsMermaid]);

  return plugins;
}
