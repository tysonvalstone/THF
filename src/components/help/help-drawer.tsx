"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { HelpArticle, HelpMeta } from "@/lib/help/types";
import { MdxArticle } from "./mdx-article";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

/* Open state lives in a tiny module store so any page can open an article */
let current: string | null = null;
const listeners = new Set<() => void>();
export function openHelp(slug: string | null) {
  current = slug;
  listeners.forEach((fn) => fn());
}
function useHelpSlug() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
    () => null,
  );
}

let indexPromise: Promise<HelpMeta[]> | null = null;
const loadIndex = () =>
  (indexPromise ??= fetch("/api/help")
    .then((r) => (r.ok ? (r.json() as Promise<HelpMeta[]>) : []))
    .catch(() => {
      indexPromise = null;
      return [];
    }));

/** Right-side drawer showing one help article without leaving the page */
export function HelpDrawer() {
  const slug = useHelpSlug();
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [index, setIndex] = useState<HelpMeta[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let live = true;
    Promise.all([fetch(`/api/help/${slug}`).then((r) => (r.ok ? (r.json() as Promise<HelpArticle>) : null)), loadIndex()])
      .then(([a, idx]) => {
        if (!live) return;
        setArticle(a);
        setIndex(idx);
        setFailed(!a);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [slug]);

  const shown = article && article.slug === slug ? article : null;
  const related = shown ? shown.related.map((s) => index.find((m) => m.slug === s)).filter((m): m is HelpMeta => !!m) : [];

  return (
    <Sheet open={!!slug} onOpenChange={(o) => !o && openHelp(null)}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[520px]">
        <SheetTitle className="sr-only">{shown?.title ?? "Help"}</SheetTitle>
        <SheetDescription className="sr-only">Help article</SheetDescription>
        <div className="flex h-12 shrink-0 items-center border-b px-5 pr-12">
          {slug && (
            <Link href={`/help/${slug}`} onClick={() => openHelp(null)} className="text-sm text-primary hover:underline">
              Open in Help Center
            </Link>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {shown ? (
            <MdxArticle article={shown} related={related} onNavigate={openHelp} compact />
          ) : failed ? (
            <p className="text-sm text-muted-foreground">This article isn&apos;t available.</p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
