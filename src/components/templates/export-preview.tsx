"use client";

import Link from "next/link";
import type { ExportSpec, FieldType } from "@/lib/ai/types";
import { fieldDef } from "@/lib/exports/fields";
import { columnLabel, formatCell, type ExportResult, type ExportRow } from "@/lib/exports/engine";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";

const PREVIEW_ROWS = 20;
const isNum = (t?: FieldType) => t === "number" || t === "currency" || t === "percent";

type Line = { kind: "group"; key: string; count: number } | { kind: "row"; row: ExportRow } | { kind: "subtotal"; sums: Record<string, number> };

export function ExportPreview({ spec, result }: { spec: ExportSpec; result: ExportResult }) {
  const cols = spec.columns
    .map((c) => ({ ...c, def: fieldDef(spec.source, c.field) }))
    .filter((c) => c.def)
    .map((c) => ({ field: c.field, label: columnLabel(spec.source, c), type: c.def!.type }));
  // Record link on the name column (else the first text column); account names link to the account
  const linkCol = cols.find((c) => c.field === "name")?.field ?? cols.find((c) => c.type === "string" && c.field !== "account")?.field;
  const hrefFor = (row: ExportRow, field: string): string | undefined => {
    const h = field === linkCol ? row._href : field === "account" ? row._account_href : undefined;
    return typeof h === "string" ? h : undefined;
  };
  const hasTotals = spec.totals.length > 0;

  const lines: Line[] = [];
  let shown = 0;
  if (result.groups) {
    for (const g of result.groups) {
      if (shown >= PREVIEW_ROWS) break;
      lines.push({ kind: "group", key: g.key, count: g.rows.length });
      const take = g.rows.slice(0, PREVIEW_ROWS - shown);
      take.forEach((row) => lines.push({ kind: "row", row }));
      shown += take.length;
      if (hasTotals) lines.push({ kind: "subtotal", sums: g.subtotals });
    }
  } else {
    result.rows.slice(0, PREVIEW_ROWS).forEach((row) => lines.push({ kind: "row", row }));
    shown = Math.min(PREVIEW_ROWS, result.rows.length);
  }

  const cellClass = (t: FieldType) => cn("px-3 py-2 whitespace-nowrap", isNum(t) && "text-right tabular");

  return (
    <section className="min-w-0 rounded-md border bg-card">
      <div className="flex items-baseline justify-between gap-3 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Preview</h2>
        <span className="text-xs text-muted-foreground tabular">
          {plural(result.rows.length, "row")}
          {result.rows.length > PREVIEW_ROWS && ` · first ${shown} shown`}
        </span>
      </div>
      {cols.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">No columns</p>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b bg-muted text-left text-xs text-muted-foreground">
              <tr>
                {cols.map((c) => (
                  <th key={c.field} className={cn("px-3 py-2.5 font-medium whitespace-nowrap", isNum(c.type) && "text-right")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={cols.length} className="px-3 py-8 text-center text-muted-foreground">
                    No rows match the filters
                  </td>
                </tr>
              )}
              {lines.map((l, i) => {
                if (l.kind === "group")
                  return (
                    <tr key={`g${i}`} className="border-b bg-muted/40">
                      <td colSpan={cols.length} className="px-3 py-2 text-xs font-medium">
                        {l.key} <span className="font-normal text-muted-foreground">· {plural(l.count, "row")}</span>
                      </td>
                    </tr>
                  );
                if (l.kind === "subtotal")
                  return (
                    <tr key={`s${i}`} className="border-b text-xs font-medium">
                      {cols.map((c, j) => (
                        <td key={c.field} className={cellClass(c.type)}>
                          {j === 0 ? "Subtotal" : c.field in l.sums ? formatCell(l.sums[c.field], c.type) : ""}
                        </td>
                      ))}
                    </tr>
                  );
                return (
                  <tr key={`r${i}`} className="border-b last:border-0 hover:bg-muted/30">
                    {cols.map((c) => {
                      const text = formatCell(l.row[c.field], c.type);
                      const href = hrefFor(l.row, c.field);
                      return (
                        <td key={c.field} className={cn(cellClass(c.type), c.type === "string" && "max-w-72 truncate")}>
                          {href && text ? (
                            href.startsWith("http") ? (
                              <a href={href} target="_blank" rel="noreferrer" className={cn(c.field === linkCol && "font-medium", "hover:text-primary hover:underline")}>
                                {text}
                              </a>
                            ) : (
                              <Link href={href} className={cn(c.field === linkCol && "font-medium", "hover:text-primary hover:underline")}>
                                {text}
                              </Link>
                            )
                          ) : (
                            text || <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            {hasTotals && lines.length > 0 && (
              <tfoot className="border-t bg-muted/50 font-semibold">
                <tr>
                  {cols.map((c, j) => (
                    <td key={c.field} className={cellClass(c.type)}>
                      {j === 0 ? "Total" : c.field in result.totals ? formatCell(result.totals[c.field], c.type) : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </section>
  );
}
