/**
 * Writes an applied export spec to CSV, XLSX or PDF and triggers a download.
 * The XLSX and PDF libraries are loaded on demand.
 */
import type { ExportFormat, ExportSpec, FieldType } from "@/lib/ai/types";
import { fieldDef } from "@/lib/exports/fields";
import { columnLabel, formatCell, type ExportResult, type ExportRow } from "@/lib/exports/engine";
import { downloadText } from "@/lib/csv";
import { fmtDate, parseDate } from "@/lib/dates";
import { plural } from "@/lib/format";

export interface ExportOptions {
  /** As-of date, YYYY-MM-DD */
  asOf: string;
  /** Override the spec's format */
  format?: ExportFormat;
}

interface Col {
  field: string;
  label: string;
  type: FieldType;
  sfName?: string;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "export"
  );
}

export function exportFilename(spec: Pick<ExportSpec, "name">, asOf: string, format: ExportFormat): string {
  return `${slugify(spec.name)}-${asOf}.${format}`;
}

/** Salesforce import files use API names for headers and no totals */
export function isSalesforceImport(spec: Pick<ExportSpec, "id" | "name" | "format">): boolean {
  return spec.id === "tpl-sf-opportunity-import" || (spec.format === "csv" && /salesforce|\bimport\b|data ?loader/i.test(spec.name));
}

function columnsOf(spec: ExportSpec): Col[] {
  return spec.columns
    .filter((c) => fieldDef(spec.source, c.field))
    .map((c) => {
      const d = fieldDef(spec.source, c.field)!;
      return { field: c.field, label: columnLabel(spec.source, c), type: d.type, sfName: d.sfName };
    });
}

const isNum = (t: FieldType) => t === "number" || t === "currency" || t === "percent";

export async function exportSpec(spec: ExportSpec, result: ExportResult, opts: ExportOptions): Promise<string> {
  const format = opts.format ?? spec.format;
  const filename = exportFilename(spec, opts.asOf, format);
  const cols = columnsOf(spec);
  if (format === "csv") exportCsv(spec, result, cols, filename);
  else if (format === "xlsx") await exportXlsx(spec, result, cols, filename);
  else await exportPdf(spec, result, cols, filename, opts.asOf);
  return filename;
}

/* ------------------------------------------------------------------- CSV */

function csvValue(v: unknown, type: FieldType): string {
  if (v === null || v === undefined) return "";
  if (type === "percent" && typeof v === "number") return String(Math.round(v * 1000) / 10);
  if (type === "date" && typeof v === "string") return v.slice(0, 10);
  if (type === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  return String(v);
}

function exportCsv(spec: ExportSpec, result: ExportResult, cols: Col[], filename: string) {
  const sf = isSalesforceImport(spec);
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const header = cols.map((c) => (sf && c.sfName ? c.sfName : c.type === "percent" && !sf ? `${c.label} (%)` : c.label));
  const lines = [header.map(esc).join(",")];
  for (const r of result.rows) lines.push(cols.map((c) => esc(csvValue(r[c.field], c.type))).join(","));
  downloadText(filename, lines.join("\r\n"));
}

/* ------------------------------------------------------------------ XLSX */

const XLSX_FORMAT: Partial<Record<FieldType, string>> = {
  currency: '"$"#,##0',
  percent: "0.0%",
  number: "#,##0",
  date: "yyyy-mm-dd",
};

async function exportXlsx(spec: ExportSpec, result: ExportResult, cols: Col[], filename: string) {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  type Cell = import("write-excel-file/browser").Cell;
  type Row = import("write-excel-file/browser").Row;

  const border = { bottomBorderColor: "#cbd5e1", bottomBorderStyle: "thin" } as const;
  const dataCell = (r: ExportRow, c: Col): Cell => {
    const v = r[c.field];
    if (v === null || v === undefined || v === "") return null;
    if (c.type === "date" && typeof v === "string") return { value: parseDate(v.slice(0, 10)), type: Date, format: XLSX_FORMAT.date };
    if (c.type === "boolean") return { value: v ? "Yes" : "No", type: String };
    if (typeof v === "number") return { value: v, type: Number, format: XLSX_FORMAT[c.type] };
    return { value: String(v), type: String };
  };
  const sumRow = (label: string, sums: Record<string, number>, style: { backgroundColor?: string; top?: boolean }): Row =>
    cols.map((c, i) => {
      const base = {
        fontWeight: "bold" as const,
        backgroundColor: style.backgroundColor,
        ...(style.top ? { topBorderColor: "#94a3b8", topBorderStyle: "thin" as const } : {}),
      };
      if (i === 0) return { value: label, type: String, ...base };
      if (c.field in sums && isNum(c.type)) return { value: sums[c.field], type: Number, format: XLSX_FORMAT[c.type], ...base };
      return { value: "", type: String, ...base };
    });

  const header: Row = cols.map((c) => ({
    value: c.label,
    type: String,
    fontWeight: "bold",
    backgroundColor: "#f1f5f9",
    textColor: "#334155",
    align: isNum(c.type) ? "right" : "left",
    ...border,
  }));
  const sheet: Row[] = [header];
  const hasTotals = spec.totals.length > 0;
  if (result.groups) {
    for (const g of result.groups) {
      sheet.push([
        { value: `${columnGroupLabel(spec)}: ${g.key}  (${plural(g.rows.length, "row")})`, type: String, fontWeight: "bold", backgroundColor: "#f8fafc", columnSpan: cols.length },
        ...cols.slice(1).map(() => null),
      ]);
      for (const r of g.rows) sheet.push(cols.map((c) => dataCell(r, c)));
      if (hasTotals) sheet.push(sumRow(`Subtotal ${g.key}`, g.subtotals, { top: true }));
    }
  } else {
    for (const r of result.rows) sheet.push(cols.map((c) => dataCell(r, c)));
  }
  if (hasTotals) sheet.push(sumRow("Total", result.totals, { backgroundColor: "#f1f5f9", top: true }));

  const widths = cols.map((c) => {
    const longest = Math.max(
      c.label.length,
      ...result.rows.slice(0, 300).map((r) => {
        const v = r[c.field];
        return c.type === "date" ? 10 : typeof v === "number" ? formatCell(v, c.type).length : String(v ?? "").length;
      }),
    );
    return { width: Math.min(48, Math.max(8, longest + 2)) };
  });

  await writeXlsxFile(
    sheet,
    { sheet: spec.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31).trim() || "Export", columns: widths, stickyRowsCount: 1 },
    { fontFamily: "Calibri", fontSize: 11 },
  ).toFile(filename);
}

function columnGroupLabel(spec: ExportSpec): string {
  return spec.groupBy ? (fieldDef(spec.source, spec.groupBy)?.label ?? spec.groupBy) : "";
}

/* ------------------------------------------------------------------- PDF */

/** The standard PDF fonts are Latin-1 only */
function pdfText(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\xff]/g, "");
}

async function exportPdf(spec: ExportSpec, result: ExportResult, cols: Col[], filename: string, asOf: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  type RowInput = import("jspdf-autotable").RowInput;
  type CellDef = import("jspdf-autotable").CellDef;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter", compress: true });
  const margin = 36;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(pdfText(spec.name), margin, margin + 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(pdfText(`As of ${fmtDate(asOf)}  |  ${plural(result.rows.length, "row")}`), margin, margin + 24);

  const cell = (r: ExportRow, c: Col): string => pdfText(formatCell(r[c.field], c.type));
  const sumCells = (label: string, sums: Record<string, number>): CellDef[] =>
    cols.map((c, i) => ({
      content: i === 0 ? pdfText(label) : c.field in sums && isNum(c.type) ? pdfText(formatCell(sums[c.field], c.type)) : "",
      styles: { fontStyle: "bold", lineWidth: { top: 0.5 }, lineColor: [203, 213, 225] },
    }));

  const body: RowInput[] = [];
  const hasTotals = spec.totals.length > 0;
  if (result.groups) {
    for (const g of result.groups) {
      body.push([
        {
          content: pdfText(`${g.key}  (${plural(g.rows.length, "row")})`),
          colSpan: cols.length,
          styles: { fontStyle: "bold", fillColor: [248, 250, 252], textColor: [15, 23, 42] },
        },
      ]);
      for (const r of g.rows) body.push(cols.map((c) => cell(r, c)));
      if (hasTotals) body.push(sumCells("Subtotal", g.subtotals));
    }
  } else {
    for (const r of result.rows) body.push(cols.map((c) => cell(r, c)));
  }

  const columnStyles: Record<string, { halign: "right" }> = {};
  cols.forEach((c, i) => {
    if (isNum(c.type)) columnStyles[i] = { halign: "right" };
  });

  autoTable(doc, {
    startY: margin + 38,
    margin: { left: margin, right: margin, top: margin, bottom: margin },
    theme: "plain",
    head: [cols.map((c) => ({ content: pdfText(c.label), styles: { halign: isNum(c.type) ? "right" : "left" } }))],
    body,
    foot: hasTotals ? [sumCells("Total", result.totals)] : undefined,
    showFoot: "lastPage",
    styles: { font: "helvetica", fontSize: 8, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: { bottom: 0.5 }, overflow: "linebreak" },
    headStyles: { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: "bold", lineWidth: { bottom: 0.75 }, lineColor: [203, 213, 225] },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles,
    didDrawPage: () => {
      const n = doc.getNumberOfPages();
      const w = doc.internal.pageSize.getWidth();
      const h = doc.internal.pageSize.getHeight();
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`Page ${n}`, w - margin, h - 18, { align: "right" });
      doc.text(pdfText(spec.name), margin, h - 18);
    },
  });
  doc.save(filename);
}
