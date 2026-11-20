import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) {
        notify();
      }
    }, 60_000);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      current = 0;
    }
  };
}

function getSnapshot(): number {
  current ||= Date.now();
  return current;
}

/** Epoch ms that advances once a minute; one shared interval for all rows. */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
