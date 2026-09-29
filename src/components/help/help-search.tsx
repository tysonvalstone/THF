"use client";

import { useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { Search } from "lucide-react";
import type { HelpIndexEntry } from "@/lib/help/types";
import { cn } from "@/lib/utils";

function snippet(text: string, query: string): string {
  const q = query.trim().toLowerCase().split(/\s+/)[0] ?? "";
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return text.slice(0, 140);
  const start = Math.max(0, i - 50);
  return `${start ? "…" : ""}${text.slice(start, i + 110)}…`;
}

/** Client-side search over titles, summaries and body text */
export function HelpSearch({ index, onSelect, autoFocus }: { index: HelpIndexEntry[]; onSelect: (slug: string) => void; autoFocus?: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fuse = useMemo(
    () =>
      new Fuse(index, {
        keys: [
          { name: "title", weight: 3 },
          { name: "summary", weight: 2 },
          { name: "text", weight: 1 },
        ],
        ignoreLocation: true,
        threshold: 0.35,
        minMatchCharLength: 2,
      }),
    [index],
  );
  const results = useMemo(() => (query.trim().length > 1 ? fuse.search(query.trim()).slice(0, 8) : []), [fuse, query]);

  const choose = (slug: string) => {
    onSelect(slug);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!results.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(results[active].item.slug);
          } else if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search help"
        aria-label="Search help"
        className="h-10 w-full rounded-md border border-input bg-card pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
      />
      {open && query.trim().length > 1 && (
        <ul className="absolute top-11 right-0 left-0 z-30 max-h-96 overflow-y-auto rounded-md border bg-card py-1 shadow-lg" role="listbox">
          {results.map((r, i) => (
            <li key={r.item.slug} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(r.item.slug)}
                onMouseEnter={() => setActive(i)}
                className={cn("block w-full px-3 py-2 text-left", i === active && "bg-accent-soft")}
              >
                <span className="block text-sm font-medium">{r.item.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{snippet(r.item.text, query)}</span>
              </button>
            </li>
          ))}
          {!results.length && <li className="px-3 py-3 text-sm text-muted-foreground">No articles found</li>}
        </ul>
      )}
    </div>
  );
}
