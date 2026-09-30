/**
 * One-click monthly Board Report (PDF) for the as-of month: cover and KPIs,
 * ARR bridge waterfall, bookings / billings / revenue, pipeline and forecast,
 * top wins, renewals at risk, cash collected and receivables aging.
 * jspdf + jspdf-autotable are loaded on demand. Browser only.
 */
import type { jsPDF } from "jspdf";
import type { DataSnapshot } from "@/lib/data/types";
import { USER_BY_ID } from "@/data/reference/users";
import { fmtDate, toISODate } from "@/lib/dates";
import { pipelineByStage } from "@/lib/dashboard";
import { drawPdfFooterBrand, drawPdfLogo, loadPdfLogo } from "@/lib/exports/pdf-brand";
import { agingBuckets } from "@/lib/billing";
import { forecastSummary } from "@/lib/forecast";
import { renewalsAtRisk } from "@/lib/success/health";
import { financeSummary, fx, upcomingRenewals, type ArrBridge } from "./metrics";

type Rgb = [number, number, number];
const INK: Rgb = [15, 23, 42];
const BODY: Rgb = [30, 41, 59];
const MUTED: Rgb = [100, 116, 139];
const LINE: Rgb = [226, 232, 240];
const HEAD: Rgb = [241, 245, 249];
const ACCENT: Rgb = [31, 95, 74];
const NEG: Rgb = [148, 163, 184];
const UP: Rgb = [122, 170, 150];
const M = 48;

const t = (s: string) =>
  s
    .replace(/[‒-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\xff\n]/g, "");

const usd = (n: number, compact = false) => {
  if (compact) {
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  }
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
};
const pct = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);

export interface BoardReportOptions {
  /** Download the file (default true) */
  download?: boolean;
  /** Shown on the cover */
  preparedBy?: string;
}

export interface BoardReportResult {
  filename: string;
  blob: Blob;
  pages: number;
}

/** Pipeline and forecast numbers; falls back to a simple pipeline by stage */
function forecastRows(data: DataSnapshot, asOf: Date): { title: string; rows: [string, string][] } {
  try {
    const f = forecastSummary(data, asOf);
    return {
      title: `Forecast, ${f.period}`,
      rows: [
        ["Quota", usd(f.quota)],
        ["Closed won", usd(f.closed)],
        ["Commit", usd(f.commit)],
        ["Best case", usd(f.bestCase)],
        ["Pipeline", usd(f.pipeline)],
        ["Seasonally expected", usd(f.seasonalExpected)],
        ["Attainment", `${Math.round(f.attainmentPct)}%`],
      ],
    };
  } catch {
    return { title: "Open pipeline by stage", rows: pipelineByStage(data, asOf).map((s) => [`${s.stage} (${s.count})`, usd(s.amount)]) };
  }
}

function riskRows(data: DataSnapshot, asOf: Date): string[][] {
  const name = (id: string) => data.accounts.find((a) => a.Id === id)?.Name ?? id;
  try {
    return renewalsAtRisk(data, asOf)
      .slice(0, 10)
      .map((r) => [r.account.Name, fmtDate(r.contract.EndDate), `${r.daysToEnd} days`, usd(r.arr * fx(r.contract.CurrencyIsoCode)), `${r.health.band} (${r.health.score})`]);
  } catch {
    return upcomingRenewals(data, asOf)
      .filter((r) => r.risks.length)
      .slice(0, 10)
      .map((r) => [name(r.accountId), fmtDate(r.endDate), `${r.daysLeft} days`, usd(r.arr), r.risks.join(", ")]);
  }
}

/** ARR bridge as a waterfall: opening, +new, +expansion, -contraction, -churn, closing */
function drawWaterfall(doc: jsPDF, b: ArrBridge, x: number, y: number, w: number, h: number) {
  const steps: { label: string; value: number; kind: "total" | "up" | "down" }[] = [
    { label: "Opening", value: b.opening, kind: "total" },
    { label: "New", value: b.newArr, kind: "up" },
    { label: "Expansion", value: b.expansion, kind: "up" },
    { label: "Contraction", value: -b.contraction, kind: "down" },
    { label: "Churn", value: -b.churn, kind: "down" },
    { label: "Closing", value: b.closing, kind: "total" },
  ];
  let run = 0;
  const bars = steps.map((s) => {
    if (s.kind === "total") {
      run = s.value;
      return { ...s, from: 0, to: s.value };
    }
    const from = run;
    run += s.value;
    return { ...s, from, to: run };
  });
  const max = Math.max(1, ...bars.map((bar) => Math.max(bar.from, bar.to)));
  // Start the axis above zero when movements are small next to total ARR
  const lo = Math.min(max, ...bars.filter((bar) => bar.kind !== "total").map((bar) => Math.min(bar.from, bar.to)));
  const floor = lo > max * 0.5 ? Math.max(0, lo - (max - lo) * 1.2) : 0;
  const labelH = 26;
  const plotH = h - labelH - 14;
  const base = y + 14 + plotH;
  const slot = w / bars.length;
  const bw = Math.min(56, slot * 0.56);
  const Y = (v: number) => base - ((Math.max(v, floor) - floor) / (max - floor)) * plotH;
  if (floor > 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(`axis from ${usd(floor, true)}`, x + w, y - 6, { align: "right" });
  }
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(x, base, x + w, base);
  bars.forEach((bar, i) => {
    const cx = x + slot * i + slot / 2;
    const top = Y(Math.max(bar.from, bar.to));
    const height = Math.max(0.75, Math.abs(Y(bar.from) - Y(bar.to)));
    doc.setFillColor(...(bar.kind === "total" ? ACCENT : bar.kind === "up" ? UP : NEG));
    doc.rect(cx - bw / 2, top, bw, height, "F");
    // Connector to the next bar
    if (i < bars.length - 1) {
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.4);
      doc.line(cx + bw / 2, Y(bar.to), cx + slot - bw / 2, Y(bar.to));
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    const v = bar.kind === "total" ? usd(bar.value, true) : bar.value === 0 ? "$0" : `${bar.value >= 0 ? "+" : "-"}${usd(Math.abs(bar.value), true)}`;
    doc.text(v, cx, top - 4, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(bar.label, cx, base + 12, { align: "center" });
  });
}

/**
 * Builds the Board Report for the as-of month. Downloads it unless
 * `opts.download` is false; always returns the Blob.
 */
export async function generateBoardReport(data: DataSnapshot, asOf: Date, opts: BoardReportOptions = {}): Promise<BoardReportResult> {
  const [{ jsPDF: JsPdf }, { autoTable }, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadPdfLogo()]);
  const doc = new JsPdf({ unit: "pt", format: "letter", compress: true });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const CW = W - 2 * M;
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
  const font = (size: number, style: "normal" | "bold" = "normal", color: Rgb = BODY) => {
    doc.setFont("helvetica", style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };
  const ensure = (y: number, need: number) => {
    if (y + need <= H - M - 10) return y;
    doc.addPage();
    return M;
  };
  const section = (text: string, y: number) => {
    y = ensure(y, 80);
    font(11, "bold", INK);
    doc.text(t(text), M, y);
    doc.setDrawColor(...ACCENT);
    doc.setLineWidth(1);
    doc.line(M, y + 5, M + 28, y + 5);
    return y + 18;
  };
  const table = (head: string[], body: string[][], y: number, right: number[] = [], widths: Record<number, number> = {}) => {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M, top: M, bottom: M + 10 },
      head: [head.map(t)],
      body: body.length ? body.map((r) => r.map(t)) : [[{ content: "None", colSpan: head.length, styles: { textColor: MUTED } }]],
      theme: "plain",
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: BODY, lineColor: LINE, lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: HEAD, textColor: [51, 65, 85], fontStyle: "bold" },
      columnStyles: Object.fromEntries(
        head.map((_, i) => [i, { ...(right.includes(i) ? { halign: "right" as const } : {}), ...(widths[i] ? { cellWidth: widths[i] } : {}) }]),
      ),
      didParseCell: (d) => {
        if (d.section === "head" && right.includes(d.column.index)) d.cell.styles.halign = "right";
      },
    });
    return lastY() + 20;
  };

  const s = financeSummary(data, asOf, "month");
  const monthLabel = s.period.label;
  const account = (id: string) => data.accounts.find((a) => a.Id === id)?.Name ?? id;

  // Cover
  drawPdfLogo(doc, logo, M, M, 26);
  font(26, "bold", INK);
  doc.text("Board Report", M, 150);
  font(15, "normal", ACCENT);
  doc.text(t(monthLabel), M, 174);
  font(9.5, "normal", MUTED);
  doc.text(t(`ThiboLiSoft · month to date through ${fmtDate(asOf)}${opts.preparedBy ? ` · prepared by ${opts.preparedBy}` : ""}`), M, 192);

  // KPI tiles
  const kpis: [string, string, string][] = [
    ["ARR", usd(s.arr), s.arrYearAgo ? `${s.arr >= s.arrYearAgo ? "+" : ""}${Math.round(((s.arr - s.arrYearAgo) / s.arrYearAgo) * 100)}% vs. a year ago` : ""],
    ["MRR", usd(s.mrr), ""],
    ["Net revenue retention", pct(s.nrr), "Trailing 12 months"],
    ["Gross revenue retention", pct(s.grr), "Trailing 12 months"],
    ["Average contract value", s.acv === null ? "-" : usd(s.acv), "Signed, trailing 12 months"],
    ["Sales payback", s.payback.months === null ? "-" : `${s.payback.months.toFixed(1)} months`, "S&M cost proxy"],
    ["Bookings (TCV)", usd(s.bookings.tcv), `${s.bookings.count} contract${s.bookings.count === 1 ? "" : "s"}`],
    ["Cash collected", usd(s.cash.amount), `${s.cash.count} payment${s.cash.count === 1 ? "" : "s"}`],
  ];
  const cols = 4;
  const tileW = (CW - (cols - 1) * 10) / cols;
  const tileH = 62;
  let y = 230;
  kpis.forEach(([label, value, sub], i) => {
    const cx = M + (i % cols) * (tileW + 10);
    const cy = y + Math.floor(i / cols) * (tileH + 10);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.75);
    doc.roundedRect(cx, cy, tileW, tileH, 4, 4, "S");
    font(8, "normal", MUTED);
    doc.text(t(label), cx + 10, cy + 16);
    font(15, "bold", INK);
    doc.text(t(value), cx + 10, cy + 36);
    font(7.5, "normal", MUTED);
    doc.text(t(sub), cx + 10, cy + 51);
  });
  y += 2 * (tileH + 10) + 24;

  // ARR bridge
  y = section(`ARR bridge, ${monthLabel}`, y);
  drawWaterfall(doc, s.bridge, M, y, CW, 190);
  y += 204;
  font(8, "normal", MUTED);
  doc.text(
    t(`${s.bridge.counts.new} new · ${s.bridge.counts.expansion} expanded · ${s.bridge.counts.contraction} contracted · ${s.bridge.counts.churn} churned accounts`),
    M,
    y,
  );

  // Bookings, billings, revenue
  doc.addPage();
  y = section("Bookings, billings and revenue", M);
  y = table(
    ["Measure", monthLabel, "Detail"],
    [
      ["Bookings (TCV)", usd(s.bookings.tcv), `${s.bookings.count} signed, ${s.bookings.renewals} renewal${s.bookings.renewals === 1 ? "" : "s"}`],
      ["Bookings (first-year value)", usd(s.bookings.firstYear), "First-year ARR + one-time fees"],
      ["Billings", usd(s.billings.amount), `${s.billings.count} invoice${s.billings.count === 1 ? "" : "s"} issued`],
      ["Revenue (recognised)", usd(s.revenue), "Ratable subscription + one-time at go-live"],
      ["Deferred revenue", usd(s.deferred), `Billed, not yet earned, at ${fmtDate(asOf)}`],
      ["Cash collected", usd(s.cash.amount), `${s.cash.count} payment${s.cash.count === 1 ? "" : "s"}`],
    ],
    y,
    [1],
  );

  // Pipeline and forecast
  const f = forecastRows(data, asOf);
  y = section(`Pipeline and forecast: ${f.title}`, y);
  y = table(["Measure", "Amount"], f.rows, y, [1]);
  if (!f.title.startsWith("Open pipeline")) {
    y = table(
      ["Open pipeline by stage", "Deals", "Amount"],
      pipelineByStage(data, asOf).map((st) => [st.stage, String(st.count), usd(st.amount)]),
      y,
      [1, 2],
    );
  }

  // Top wins
  y = section(`Top wins, ${monthLabel}`, y);
  y = table(
    ["Opportunity", "Account", "Owner", "Closed", "Amount"],
    s.topWins.map((o) => [o.Name, account(o.AccountId), USER_BY_ID[o.OwnerId]?.Name ?? "", fmtDate(o.CloseDate), usd(o.Amount)]),
    y,
    [4],
    { 2: 92, 3: 72, 4: 70 },
  );

  // Renewals at risk
  y = section("Renewals at risk", y);
  y = table(["Account", "Ends", "In", "ARR", "Health / risk"], riskRows(data, asOf), y, [3], { 1: 72, 2: 52, 3: 70, 4: 120 });

  // Aging
  const aging = agingBuckets(data, asOf, fx);
  const open = aging.reduce((a, b) => a + b.amount, 0);
  y = section(`Receivables aging at ${fmtDate(asOf)}`, y);
  y = table(
    ["Days past due", "Invoices", "Open balance", "Share"],
    [...aging.map((b) => [b.label, String(b.count), usd(b.amount), open ? `${Math.round((b.amount / open) * 100)}%` : "-"]), ["Total", String(aging.reduce((a, b) => a + b.count, 0)), usd(open), ""]],
    y,
    [1, 2, 3],
  );

  // Footers
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font(7.5, "normal", [148, 163, 184]);
    doc.text(t(`Board Report · ${monthLabel}`), M, H - 22);
    doc.text(`Page ${i} of ${n}`, W - M, H - 22, { align: "right" });
    drawPdfFooterBrand(doc, H - 22);
  }

  const filename = `Board-Report-${toISODate(asOf).slice(0, 7)}.pdf`;
  const blob = doc.output("blob");
  if (opts.download !== false) doc.save(filename);
  return { filename, blob, pages: n };
}
