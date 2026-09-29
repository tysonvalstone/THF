"use client";

/** Lets a page publish what's on screen (e.g. the map's commodity) for the AI chat */
import { useEffect, useSyncExternalStore } from "react";

let commodity: string | undefined;
const listeners = new Set<() => void>();

export function setPageCommodity(c: string | undefined) {
  commodity = c;
  listeners.forEach((fn) => fn());
}

export function usePublishCommodity(c: string | undefined) {
  useEffect(() => {
    setPageCommodity(c);
    return () => setPageCommodity(undefined);
  }, [c]);
}

export function usePageCommodity(): string | undefined {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => commodity,
    () => undefined,
  );
}
