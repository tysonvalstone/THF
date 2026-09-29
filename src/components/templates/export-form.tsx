"use client";

import { useMemo } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { ExportFilter, ExportFormat, ExportSource, ExportSpec, FieldType, FilterOp } from "@/lib/ai/types";
import { EXPORT_FIELDS, SOURCE_LABELS, fieldDef } from "@/lib/exports/fields";
import { DEFAULT_COLUMNS, type ExportRow } from "@/lib/exports/engine";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const NONE = "__none";
const ADD = "__add";

const OP_LABELS: Record<FilterOp, string> = {
  eq: "is",
  neq: "is not",
  in: "is any of",
  contains: "contains",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
  isTrue: "is yes",
  isFalse: "is no",
};

function opsFor(type: FieldType | undefined): FilterOp[] {
  if (type === "boolean") return ["isTrue", "isFalse"];
  if (type === "number" || type === "currency" || type === "percent") return ["eq", "neq", "gt", "gte", "lt", "lte"];
  if (type === "date") return ["eq", "gt", "gte", "lt", "lte"];
  return ["eq", "neq", "in", "contains"];
}

const isNum = (t?: FieldType) => t === "number" || t === "currency" || t === "percent";

function Section({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-md border bg-card p-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function FieldSelect({
  source,
  value,
  onChange,
  exclude,
  placeholder,
  className,
  label,
}: {
  source: ExportSource;
  value: string;
  onChange: (v: string) => void;
  exclude?: Set<string>;
  placeholder?: string;
  className?: string;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className={cn("w-full min-w-0 bg-card", className)} aria-label={label}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {EXPORT_FIELDS[source]
          .filter((f) => f.key === value || !exclude?.has(f.key))
          .map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

export function ExportForm({ spec, rows, onChange }: { spec: ExportSpec; rows: ExportRow[]; onChange: (patch: Partial<ExportSpec>) => void }) {
  const src = spec.source;
  const colFields = new Set(spec.columns.map((c) => c.field));

  /** Distinct values for string fields, offered as filter suggestions */
  const suggestions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of EXPORT_FIELDS[src]) {
      if (f.type !== "string" || f.key === "id" || f.key.endsWith("_id")) continue;
      const set = new Set<string>();
      for (const r of rows) {
        const v = r[f.key];
        if (typeof v === "string" && v) set.add(v);
        if (set.size > 60) break;
      }
      if (set.size > 0 && set.size <= 60) out[f.key] = [...set].sort();
    }
    return out;
  }, [rows, src]);

  const setColumns = (columns: ExportSpec["columns"]) => {
    const keep = new Set(columns.map((c) => c.field));
    onChange({ columns, totals: spec.totals.filter((t) => keep.has(t)) });
  };
  const move = (i: number, d: -1 | 1) => {
    const next = [...spec.columns];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setColumns(next);
  };
  const setFilter = (i: number, patch: Partial<ExportFilter>) => onChange({ filters: spec.filters.map((f, k) => (k === i ? { ...f, ...patch } : f)) });

  const totalCandidates = spec.columns.filter((c) => {
    const t = fieldDef(src, c.field)?.type;
    return t === "currency" || t === "number";
  });

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section title="Details">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={spec.name} onChange={(e) => onChange({ name: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Data source</Label>
              <Select
                value={src}
                onValueChange={(v) => {
                  const s = v as ExportSource;
                  if (s === src) return;
                  onChange({ source: s, columns: DEFAULT_COLUMNS[s].map((field) => ({ field })), filters: [], groupBy: null, sort: [], totals: [] });
                }}
              >
                <SelectTrigger className="w-full bg-card" aria-label="Data source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOURCE_LABELS) as ExportSource[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Format</Label>
              <div role="radiogroup" aria-label="Format" className="grid h-8 grid-cols-3 rounded-md border p-0.5">
                {(["csv", "xlsx", "pdf"] as ExportFormat[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={spec.format === f}
                    onClick={() => onChange({ format: f })}
                    className={cn(
                      "rounded-[4px] text-xs font-medium uppercase transition-colors",
                      spec.format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Group, sort and totals">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Group by</Label>
            <Select value={spec.groupBy ?? NONE} onValueChange={(v) => onChange({ groupBy: v === NONE ? null : v })}>
              <SelectTrigger className="w-full bg-card" aria-label="Group by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None</SelectItem>
                {EXPORT_FIELDS[src]
                  .filter((f) => f.type === "string" || f.type === "boolean")
                  .map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Sort</Label>
            <div className="grid gap-2">
              {spec.sort.map((s, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_124px_28px] items-center gap-2">
                  <FieldSelect
                    source={src}
                    label={`Sort field ${i + 1}`}
                    value={s.field}
                    onChange={(field) => onChange({ sort: spec.sort.map((x, k) => (k === i ? { ...x, field } : x)) })}
                  />
                  <Select value={s.dir} onValueChange={(dir) => onChange({ sort: spec.sort.map((x, k) => (k === i ? { ...x, dir: dir as "asc" | "desc" } : x)) })}>
                    <SelectTrigger size="sm" className="w-full bg-card" aria-label={`Sort direction ${i + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">Ascending</SelectItem>
                      <SelectItem value="desc">Descending</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove sort" onClick={() => onChange({ sort: spec.sort.filter((_, k) => k !== i) })}>
                    <X />
                  </Button>
                </div>
              ))}
              {spec.sort.length < 3 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={() => onChange({ sort: [...spec.sort, { field: spec.columns[0]?.field ?? EXPORT_FIELDS[src][1].key, dir: "asc" }] })}
                >
                  <Plus /> Add sort
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Totals</Label>
            {totalCandidates.length === 0 ? (
              <p className="text-xs text-muted-foreground">No number or currency columns</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {totalCandidates.map((c) => {
                  const id = `total-${c.field}`;
                  const checked = spec.totals.includes(c.field);
                  return (
                    <label key={c.field} htmlFor={id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={(v) => onChange({ totals: v ? [...spec.totals, c.field] : spec.totals.filter((t) => t !== c.field) })}
                      />
                      {c.label?.trim() || fieldDef(src, c.field)?.label}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section
        title="Columns"
        action={
          <Select
            value={ADD}
            onValueChange={(v) => {
              if (v !== ADD) setColumns([...spec.columns, { field: v }]);
            }}
          >
            <SelectTrigger size="sm" className="bg-card" aria-label="Add column">
              <SelectValue>
                <Plus className="size-3.5" /> Add column
              </SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value={ADD} className="hidden">
                Add column
              </SelectItem>
              {EXPORT_FIELDS[src]
                .filter((f) => !colFields.has(f.key))
                .map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        }
      >
        {spec.columns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No columns</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {spec.columns.map((c, i) => {
              const def = fieldDef(src, c.field);
              return (
                <li key={c.field} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <Input
                      value={c.label ?? ""}
                      placeholder={def?.label ?? c.field}
                      aria-label={`Header for ${def?.label ?? c.field}`}
                      onChange={(e) => setColumns(spec.columns.map((x, k) => (k === i ? { ...x, label: e.target.value || undefined } : x)))}
                      className="h-7 min-w-0 flex-1 border-transparent px-1.5 shadow-none placeholder:text-foreground hover:border-input focus-visible:border-ring"
                    />
                    {c.label && c.label !== def?.label && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{def?.label}</span>}
                  </div>
                  <div className="flex items-center">
                    <Button variant="ghost" size="icon-xs" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Move down" disabled={i === spec.columns.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label="Remove column" onClick={() => setColumns(spec.columns.filter((_, k) => k !== i))}>
                      <X />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section
        title="Filters"
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const f = EXPORT_FIELDS[src].find((x) => x.key !== "id") ?? EXPORT_FIELDS[src][0];
              onChange({ filters: [...spec.filters, { field: f.key, op: opsFor(f.type)[0] }] });
            }}
          >
            <Plus /> Add filter
          </Button>
        }
      >
        {spec.filters.length === 0 ? (
          <p className="text-xs text-muted-foreground">All records</p>
        ) : (
          <div className="grid gap-2">
            {spec.filters.map((f, i) => {
              const type = fieldDef(src, f.field)?.type;
              const ops = opsFor(type);
              const needsValue = f.op !== "isTrue" && f.op !== "isFalse";
              const listId = suggestions[f.field] ? `filter-values-${i}` : undefined;
              return (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_28px] items-start gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.2fr)_28px] sm:items-center">
                  <div className="grid grid-cols-2 gap-2 sm:contents">
                    <FieldSelect
                      source={src}
                      label={`Filter field ${i + 1}`}
                      value={f.field}
                      onChange={(field) => {
                        const t = fieldDef(src, field)?.type;
                        setFilter(i, { field, op: opsFor(t).includes(f.op) ? f.op : opsFor(t)[0], value: t === "boolean" ? undefined : f.value });
                      }}
                    />
                    <Select value={ops.includes(f.op) ? f.op : ops[0]} onValueChange={(op) => setFilter(i, { op: op as FilterOp })}>
                      <SelectTrigger size="sm" className="w-full min-w-0 bg-card" aria-label={`Filter operator ${i + 1}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ops.map((op) => (
                          <SelectItem key={op} value={op}>
                            {OP_LABELS[op]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {needsValue ? (
                      <Input
                        className="col-span-2 h-7 min-w-0 sm:col-span-1"
                        aria-label={`Filter value ${i + 1}`}
                        type={type === "date" ? "date" : "text"}
                        inputMode={isNum(type) ? "decimal" : undefined}
                        list={listId}
                        value={f.value ?? ""}
                        placeholder={f.op === "in" ? "IL, IA" : type === "percent" ? "25%" : isNum(type) ? "0" : "Value"}
                        onChange={(e) => setFilter(i, { value: e.target.value })}
                      />
                    ) : (
                      <span className="hidden sm:block" />
                    )}
                  </div>
                  <Button variant="ghost" size="icon-sm" aria-label="Remove filter" onClick={() => onChange({ filters: spec.filters.filter((_, k) => k !== i) })}>
                    <X />
                  </Button>
                  {listId && (
                    <datalist id={listId}>
                      {suggestions[f.field].map((v) => (
                        <option key={v} value={v} />
                      ))}
                    </datalist>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
