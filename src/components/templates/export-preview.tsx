"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import type { ExportSpec, FieldType } from "@/lib/ai/types";
import { fieldDef } from "@/lib/exports/fields";
import { columnLabel, formatCell, type ExportResult, type ExportRow } from "@/lib/exports/engine";
import { plural } from "@/lib/format";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const isNum = (t?: FieldType) => t === "number" || t === "currency" || t === "percent";

type Line = { id: string } & ({ kind: "group"; key: string; count: number } | { kind: "row"; row: ExportRow } | { kind: "subtotal"; sums: Record<string, number> });

/** Paginated preview of an export (group headings and subtotals stay in line) */
export function ExportPreview({ spec, result }: { spec: ExportSpec; result: ExportResult }) {
  const cols = useMemo(
    () =>
      spec.columns
        .map((c) => ({ ...c, def: fieldDef(spec.source, c.field) }))
        .filter((c) => c.def)
        .map((c) => ({ field: c.field, label: columnLabel(spec.source, c), type: c.def!.type })),
    [spec.columns, spec.source],
  );
  // Record link on the name column (else the first text column); account names link to the account
  const linkCol = cols.find((c) => c.field === "name")?.field ?? cols.find((c) => c.type === "string" && c.field !== "account")?.field;
  const hasTotals = spec.totals.length > 0;

  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [];
    if (result.groups) {
      result.groups.forEach((g, gi) => {
        out.push({ id: `g${gi}`, kind: "group", key: g.key, count: g.rows.length });
        g.rows.forEach((row, ri) => out.push({ id: `g${gi}r${ri}`, kind: "row", row }));
        if (hasTotals) out.push({ id: `g${gi}s`, kind: "subtotal", sums: g.subtotals });
      });
    } else {
      result.rows.forEach((row, ri) => out.push({ id: `r${ri}`, kind: "row", row }));
    }
    return out;
  }, [result, hasTotals]);

  const columns: Column<Line>[] = cols.map((c, j) => ({
    key: c.field,
    header: c.label,
    align: isNum(c.type) ? "right" : "left",
    className: cn("whitespace-nowrap", c.type === "string" && "max-w-72 truncate"),
    cell: (l) => {
      if (l.kind === "group") return j === 0 ? <span className="text-xs font-medium">{l.key} <span className="font-normal text-muted-foreground">· {plural(l.count, "row")}</span></span> : null;
      if (l.kind === "subtotal") return <span className="text-xs font-medium">{j === 0 ? "Subtotal" : c.field in l.sums ? formatCell(l.sums[c.field], c.type) : ""}</span>;
      const text = formatCell(l.row[c.field], c.type);
      const h = c.field === linkCol ? l.row._href : c.field === "account" ? l.row._account_href : undefined;
      const href = typeof h === "string" ? h : undefined;
      if (!text) return <span className="text-muted-foreground/60">—</span>;
      if (!href) return text;
      const cls = cn(c.field === linkCol && "font-medium", "hover:text-primary hover:underline");
      return href.startsWith("http") ? (
        <a href={href} target="_blank" rel="noreferrer" className={cls}>
          {text}
        </a>
      ) : (
        <Link href={href} className={cls}>
          {text}
        </Link>
      );
    },
  }));

  return (
    <section className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Preview</h2>
        <span className="text-xs text-muted-foreground tabular">{plural(result.rows.length, "row")}</span>
      </div>
      {cols.length === 0 ? (
        <p className="rounded-md border bg-card px-4 py-8 text-center text-sm text-muted-foreground">No columns</p>
      ) : (
        <Suspense fallback={<Skeleton className="h-80" />}>
          <DataTable
            rows={lines}
            columns={columns}
            rowKey={(l) => l.id}
            param="pp"
            filterKey={`${spec.id}|${result.rows.length}|${spec.groupBy ?? ""}`}
            dense
            rowClassName={(l) => (l.kind === "group" ? "bg-muted/40" : l.kind === "subtotal" ? "bg-slate-50/60" : undefined)}
            empty="No rows match the filters"
            caption="Export preview"
          />
          {hasTotals && lines.length > 0 && (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border bg-muted/50 px-3 py-2 text-sm">
              <dt className="font-semibold">Total</dt>
              {cols
                .filter((c) => c.field in result.totals)
                .map((c) => (
                  <div key={c.field} className="flex gap-1.5">
                    <dt className="text-muted-foreground">{c.label}</dt>
                    <dd className="font-semibold tabular">{formatCell(result.totals[c.field], c.type)}</dd>
                  </div>
                ))}
            </dl>
          )}
        </Suspense>
      )}
    </section>
  );
}
