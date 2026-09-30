"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Makes the column sortable */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right";
  className?: string;
  /** Hide on narrow screens */
  hideBelow?: "sm" | "md" | "lg";
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Client-side search across all pages */
  search?: { placeholder: string; text: (row: T) => string };
  /** Filter controls rendered in the toolbar (the caller filters `rows`) */
  filters?: React.ReactNode;
  /** Changes whenever the caller's filters change; the table goes back to page 1 */
  filterKey?: string;
  /** Buttons at the right of the toolbar, e.g. "New" */
  actions?: React.ReactNode;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Rows per page (default 10) */
  pageSize?: number;
  /** Page-size choices; set [] to hide the selector */
  pageSizes?: number[];
  /** URL parameter for the page number, when a page has more than one table */
  param?: string;
  /** Keep the page in component state instead of the URL (drawers, popovers) */
  urlState?: boolean;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  empty?: React.ReactNode;
  /** Minimum table width before it scrolls sideways */
  minWidth?: number;
  className?: string;
  /** Smaller paddings (map sidebar, drawers) */
  dense?: boolean;
  caption?: string;
}

function pageList(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push("…");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < total - 1) out.push("…");
  out.push(total);
  return out;
}

const HIDE = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

/**
 * The shared paginated list: numbered pages, "Showing 11–20 of 200", a page-size
 * selector, sorting and search across all pages, the page kept in the URL, and
 * a jump to (and highlight of) records that were just created or changed.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  search,
  filters,
  filterKey = "",
  actions,
  defaultSort,
  pageSize: defaultSize = 10,
  pageSizes = [10, 25, 50],
  param = "page",
  urlState = true,
  onRowClick,
  rowClassName,
  empty = "No records",
  minWidth,
  className,
  dense,
  caption,
}: DataTableProps<T>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { recentIds } = useStore();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(defaultSort ?? null);
  const [localPage, setLocalPage] = useState(1);
  const [size, setSize] = useState(defaultSize);

  const urlPage = Number(params.get(param)) || 1;
  const page = urlState ? urlPage : localPage;
  const setPage = (p: number) => {
    if (!urlState) return setLocalPage(p);
    const next = new URLSearchParams(params.toString());
    if (p <= 1) next.delete(param);
    else next.set(param, String(p));
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q && search ? rows.filter((r) => search.text(r).toLowerCase().includes(q)) : rows;
    if (!sort) return list;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return list;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const x = col.sortValue!(a);
      const y = col.sortValue!(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, query, search, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages);
  const start = (current - 1) * size;
  const shown = sorted.slice(start, start + size);

  // Search, filters, sort or page size changed: back to page 1
  const resetKey = `${query}|${filterKey}|${sort?.key}|${sort?.dir}|${size}`;
  const lastReset = useRef(resetKey);
  useEffect(() => {
    if (lastReset.current === resetKey) return;
    lastReset.current = resetKey;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the page is URL state; reset it when the list changes
    if (current !== 1) setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on reset-key changes
  }, [resetKey]);

  // A record that was just created or edited: jump to its page
  useEffect(() => {
    if (!recentIds.size) return;
    const i = sorted.findIndex((r) => recentIds.has(rowKey(r)));
    if (i < 0) return;
    const p = Math.floor(i / size) + 1;
    // Follows a store event (a record was just changed), not derived state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p !== current) setPage(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to new changes only
  }, [recentIds]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: key === columns[0]?.key ? "asc" : "desc" }));

  const pad = dense ? "px-3 py-1.5" : "px-4 py-2.5";
  return (
    <div className={cn("space-y-2", className)}>
      {(search || filters || actions) && (
        <div className="flex flex-wrap items-center gap-2">
          {search && (
            <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={search.placeholder}
                aria-label={search.placeholder}
                className="h-8 w-full rounded-md border border-input bg-card pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-primary/50"
              />
            </div>
          )}
          {filters}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </div>
      )}

      <div className="relative overflow-x-auto rounded-md border bg-card">
        <table className="w-full text-sm" style={minWidth ? { minWidth } : undefined}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(pad, "font-medium whitespace-nowrap", c.align === "right" && "text-right", c.hideBelow && HIDE[c.hideBelow], c.className)}
                  aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                >
                  {c.sortValue ? (
                    <button type="button" onClick={() => toggleSort(c.key)} className={cn("inline-flex items-center gap-1 hover:text-foreground", c.align === "right" && "flex-row-reverse")}>
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === "asc" ? (
                          <ChevronUp className="size-3" aria-hidden />
                        ) : (
                          <ChevronDown className="size-3" aria-hidden />
                        )
                      ) : (
                        <span className="size-3" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {shown.map((r) => {
              const id = rowKey(r);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  className={cn(
                    "transition-colors duration-700",
                    onRowClick && "cursor-pointer hover:bg-slate-50",
                    recentIds.has(id) && "bg-accent-soft hover:bg-accent-soft",
                    rowClassName?.(r),
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn(pad, "align-middle", c.align === "right" && "text-right tabular", c.hideBelow && HIDE[c.hideBelow], c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {!shown.length && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="tabular">
            Showing {start + 1}–{Math.min(start + size, sorted.length)} of {sorted.length.toLocaleString()}
          </span>
          <div className="flex items-center gap-3">
            {pageSizes.length > 0 && (
              <label className="flex items-center gap-1.5">
                Rows
                <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="h-7 rounded-md border border-input bg-card px-1.5 text-xs text-foreground">
                  {pageSizes.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {pages > 1 && (
              <nav className="flex items-center gap-0.5" aria-label="Pages">
                <button
                  type="button"
                  onClick={() => setPage(current - 1)}
                  disabled={current === 1}
                  aria-label="Previous page"
                  className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5" aria-hidden />
                </button>
                {pageList(current, pages).map((p, i) =>
                  p === "…" ? (
                    <span key={`gap-${i}`} className="px-1">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      aria-current={p === current ? "page" : undefined}
                      className={cn("h-7 min-w-7 rounded-md px-1.5 tabular hover:bg-muted", p === current && "bg-primary font-medium text-primary-foreground hover:bg-primary")}
                    >
                      {p}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => setPage(current + 1)}
                  disabled={current === pages}
                  aria-label="Next page"
                  className="flex size-7 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
                >
                  <ChevronRight className="size-3.5" aria-hidden />
                </button>
              </nav>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
