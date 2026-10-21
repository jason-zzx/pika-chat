"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Returns a referentially stable function that always invokes the latest
 * render's `fn`. Lets memoized children receive event callbacks that close
 * over fresh state without breaking `React.memo`'s shallow prop compare.
 * The ref updates in an effect, so this suits event handlers (which run
 * after commit) — do not invoke the result during render.
 */
export function useStableCallback<A extends unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
