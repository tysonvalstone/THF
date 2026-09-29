"use client";

import { useEffect } from "react";

/** Sets the browser tab title for client-rendered record pages */
export function DocTitle({ title }: { title: string }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · HarvestSignal`;
    return () => {
      document.title = prev;
    };
  }, [title]);
  return null;
}
