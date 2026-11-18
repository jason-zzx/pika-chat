import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** The desktop shell bridge, or `null` in a browser and during SSR/hydration. */
export function usePikaNative(): PikaNative | null {
  return useSyncExternalStore(
    subscribe,
    () => window.pikaNative ?? null,
    () => null,
  );
}
