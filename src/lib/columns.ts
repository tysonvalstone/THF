/**
 * Shared column engine for CSV exports. Pure (no React, no DOM) so it can be
 * unit tested and reused by the column picker, the export helpers and the
 * Export Template Builder.
 */

export type ColumnType = "string" | "number" | "currency" | "percent" | "date" | "boolean";

export interface ColumnDef<T> {
  key: string;
  label: string;
  type?: ColumnType;
  value: (row: T) => unknown;
  /** Required import field: always exported, header can't be renamed */
  required?: boolean;
  /** On by default (true when omitted) */
  defaultOn?: boolean;
}

export type DateFormat = "iso" | "us" | "eu";

export interface ColumnChoice {
  key: string;
  on: boolean;
  /** Custom header; empty or missing = the column's default label */
  label?: string;
}

export interface ColumnSetup {
  columns: ColumnChoice[];
  dateFormat: DateFormat;
  scope: "all" | "filtered";
}

export const DATE_FORMATS: { value: DateFormat; label: string }[] = [
  { value: "iso", label: "YYYY-MM-DD" },
  { value: "us", label: "MM/DD/YYYY" },
  { value: "eu", label: "DD/MM/YYYY" },
];

export function defaultSetup<T>(defs: ColumnDef<T>[]): ColumnSetup {
  return {
    columns: defs.map((d) => ({ key: d.key, on: d.required ? true : d.defaultOn !== false })),
    dateFormat: "iso",
    scope: "filtered",
  };
}

/**
 * Reconciles a saved setup with the current column list: keeps the saved order,
 * drops unknown keys, appends new columns with their default, forces required
 * columns on and clears their custom label.
 */
export function normalizeSetup<T>(defs: ColumnDef<T>[], setup: Partial<ColumnSetup> | null | undefined): ColumnSetup {
  const base = defaultSetup(defs);
  if (!setup) return base;
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const seen = new Set<string>();
  const columns: ColumnChoice[] = [];
  for (const c of setup.columns ?? []) {
    const d = byKey.get(c?.key);
    if (!d || seen.has(c.key)) continue;
    seen.add(c.key);
    const label = d.required ? undefined : c.label?.trim() || undefined;
    columns.push({ key: c.key, on: d.required ? true : !!c.on, ...(label ? { label } : {}) });
  }
  for (const c of base.columns) if (!seen.has(c.key)) columns.push(c);
  const dateFormat = setup.dateFormat && DATE_FORMATS.some((f) => f.value === setup.dateFormat) ? setup.dateFormat : base.dateFormat;
  const scope = setup.scope === "all" || setup.scope === "filtered" ? setup.scope : base.scope;
  return { columns, dateFormat, scope };
}

export interface ActiveColumn<T> {
  def: ColumnDef<T>;
  header: string;
}

/** The columns that will be written, in order, with their final headers */
export function activeColumns<T>(defs: ColumnDef<T>[], setup: ColumnSetup): ActiveColumn<T>[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return normalizeSetup(defs, setup)
    .columns.filter((c) => c.on)
    .map((c) => {
      const def = byKey.get(c.key)!;
      return { def, header: (!def.required && c.label?.trim()) || def.label };
    });
}

const pad = (n: number) => String(n).padStart(2, "0");

function formatDate(value: unknown, fmt: DateFormat): string {
  let y: number, m: number, d: number;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    y = value.getUTCFullYear();
    m = value.getUTCMonth() + 1;
    d = value.getUTCDate();
  } else {
    const s = String(value).trim();
    if (!s) return "";
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) {
      y = Number(iso[1]);
      m = Number(iso[2]);
      d = Number(iso[3]);
    } else {
      const t = new Date(s);
      if (Number.isNaN(t.getTime())) return s;
      y = t.getUTCFullYear();
      m = t.getUTCMonth() + 1;
      d = t.getUTCDate();
    }
  }
  if (fmt === "us") return `${pad(m)}/${pad(d)}/${y}`;
  if (fmt === "eu") return `${pad(d)}/${pad(m)}/${y}`;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Cell text for one value */
export function formatValue(value: unknown, type: ColumnType = "string", dateFormat: DateFormat = "iso"): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => formatValue(v, type, dateFormat)).join(";");
  if (type === "date") return formatDate(value, dateFormat);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (type === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (type === "percent") return String(round(value * 100, 1));
    if (type === "number" || type === "currency") return String(round(value, 2));
    return String(value);
  }
  if (value instanceof Date) return formatDate(value, dateFormat);
  return String(value);
}

/** RFC 4180 field quoting */
export function csvEscape(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv<T>(rows: T[], defs: ColumnDef<T>[], setup: ColumnSetup): string {
  const cols = activeColumns(defs, setup);
  const lines = [cols.map((c) => csvEscape(c.header)).join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(formatValue(c.def.value(r), c.def.type, setup.dateFormat))).join(","));
  return lines.join("\r\n");
}

export function previewTable<T>(rows: T[], defs: ColumnDef<T>[], setup: ColumnSetup, n = 5): { headers: string[]; rows: string[][] } {
  const cols = activeColumns(defs, setup);
  return {
    headers: cols.map((c) => c.header),
    rows: rows.slice(0, n).map((r) => cols.map((c) => formatValue(c.def.value(r), c.def.type, setup.dateFormat))),
  };
}
