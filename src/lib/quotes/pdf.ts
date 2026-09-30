/**
 * Branded quote PDF and co-op board packet (jspdf + jspdf-autotable, loaded
 * on demand). Browser only.
 */
import type { jsPDF } from "jspdf";
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Contact, Opportunity, Pricebook2, Product2, Quote, QuoteLineItem } from "@/types/salesforce";
import { USER_BY_ID } from "@/data/reference/users";
import { addDays, fmtDate, parseDate, toISODate } from "@/lib/dates";
import { blackoutsFor, isSeasonalSegment, nextBoardMeeting } from "@/lib/seasonality";
import { drawPdfFooterBrand, drawPdfLogo, loadPdfLogo } from "@/lib/exports/pdf-brand";
import { drawHarvestSummaryPdf, harvestShareUrl, harvestSummaryFor, type HarvestSummary } from "@/lib/harvest/summary";
import { isRecurring, productMap, unitLabel } from "./catalog";
import { computeTotals, fmtCurrency, fmtPctValue, paymentSchedule, type QuoteTotals } from "./pricing";
import { quoteApproval, quoteLines } from "./lifecycle";

type Rgb = [number, number, number];
const INK: Rgb = [15, 23, 42];
const BODY: Rgb = [30, 41, 59];
const MUTED: Rgb = [100, 116, 139];
const LINE: Rgb = [226, 232, 240];
const HEAD: Rgb = [241, 245, 249];
const ACCENT: Rgb = [31, 95, 74];
const M = 48;
const SELLER = "ThiboLiSoft";

/** jsPDF's built-in fonts are Latin-1 */
function t(s: string): string {
  return s
    .replace(/[‒-―−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[→]/g, "->")
    .replace(/[^\x20-\xff\n]/g, "");
}

interface Ctx {
  q: Quote;
  lines: QuoteLineItem[];
  products: Map<string, Product2>;
  totals: QuoteTotals;
  account?: Account;
  contact?: Contact;
  opp?: Opportunity;
  book?: Pricebook2;
  ccy: "USD" | "CAD";
  asOf: Date;
  owner: string;
}

function context(data: DataSnapshot, quoteId: string, asOf: Date): Ctx {
  const q = data.quotes.find((x) => x.Id === quoteId);
  if (!q) throw new Error("Quote not found");
  const lines = quoteLines(data, quoteId);
  const products = productMap(data.products);
  const book = data.pricebooks.find((b) => b.Id === q.Pricebook2Id);
  return {
    q,
    lines,
    products,
    totals: computeTotals(q, lines, products),
    account: data.accounts.find((a) => a.Id === q.AccountId),
    contact: data.contacts.find((c) => c.Id === q.ContactId),
    opp: data.opportunities.find((o) => o.Id === q.OpportunityId),
    book,
    ccy: book?.CurrencyIsoCode ?? "USD",
    asOf,
    owner: USER_BY_ID[q.OwnerId]?.Name ?? SELLER,
  };
}

async function loadPdf() {
  const [{ jsPDF }, { autoTable }, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadPdfLogo()]);
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  return { doc, autoTable, logo };
}
type AutoTable = Awaited<ReturnType<typeof loadPdf>>["autoTable"];

const lastY = (doc: jsPDF) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;
const pageW = (doc: jsPDF) => doc.internal.pageSize.getWidth();
const pageH = (doc: jsPDF) => doc.internal.pageSize.getHeight();

function font(doc: jsPDF, size: number, style: "normal" | "bold" = "normal", color: Rgb = BODY) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

/** Starts a new page when fewer than `need` points are left */
function ensure(doc: jsPDF, y: number, need: number): number {
  if (y + need <= pageH(doc) - M) return y;
  doc.addPage();
  return M;
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  y = ensure(doc, y, 60);
  font(doc, 11, "bold", INK);
  doc.text(t(text), M, y);
  doc.setDrawColor(...ACCENT);
  doc.setLineWidth(1);
  doc.line(M, y + 5, M + 28, y + 5);
  return y + 18;
}

function paragraph(doc: jsPDF, text: string, y: number, opts: { size?: number; color?: Rgb; width?: number; x?: number } = {}): number {
  font(doc, opts.size ?? 9.5, "normal", opts.color ?? BODY);
  const lines = doc.splitTextToSize(t(text), opts.width ?? pageW(doc) - 2 * M) as string[];
  const lh = (opts.size ?? 9.5) * 1.4;
  y = ensure(doc, y, lines.length * lh);
  doc.text(lines, opts.x ?? M, y);
  return y + lines.length * lh;
}

function footers(doc: jsPDF, label: string) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font(doc, 7.5, "normal", [148, 163, 184]);
    doc.text(t(label), M, pageH(doc) - 22);
    doc.text(`Page ${i} of ${n}`, pageW(doc) - M, pageH(doc) - 22, { align: "right" });
    drawPdfFooterBrand(doc, pageH(doc) - 22);
  }
}

const tableStyles = {
  theme: "plain" as const,
  styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: BODY, lineColor: LINE, lineWidth: { bottom: 0.5 }, overflow: "linebreak" as const },
  headStyles: { fillColor: HEAD, textColor: [51, 65, 85] as Rgb, fontStyle: "bold" as const, lineWidth: { bottom: 0.75 }, lineColor: [203, 213, 225] as Rgb },
};

function kv(doc: jsPDF, autoTable: AutoTable, rows: [string, string][], y: number, x: number, width: number, opts: { boldLast?: boolean } = {}) {
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: pageW(doc) - x - width, top: M, bottom: M },
    tableWidth: width,
    theme: "plain",
    body: rows.map(([k, v], i) => [
      { content: t(k), styles: { textColor: MUTED, fontStyle: opts.boldLast && i === rows.length - 1 ? "bold" : "normal" } },
      { content: t(v), styles: { halign: "right", fontStyle: opts.boldLast && i === rows.length - 1 ? "bold" : "normal", textColor: INK } },
    ]),
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 0, right: 0 } },
  });
  return lastY(doc);
}

/** The quote itself: parties, lines, totals, schedule, terms and signatures */
function drawQuote(doc: jsPDF, autoTable: AutoTable, c: Ctx, y: number, opts: { signature: boolean }): number {
  const { q, totals, ccy, account: a, contact } = c;
  const money = (n: number) => fmtCurrency(n, ccy, { cents: false });
  const w = pageW(doc) - 2 * M;

  // Parties and key dates
  font(doc, 8, "bold", MUTED);
  doc.text("BILL TO", M, y);
  doc.text("QUOTE DETAILS", M + w / 2 + 10, y);
  font(doc, 9.5, "bold", INK);
  const bill = [
    a?.Name ?? "",
    a ? a.BillingStreet : "",
    a ? `${a.BillingCity}, ${a.BillingState} ${a.BillingPostalCode}` : "",
    a?.BillingCountry ?? "",
    contact ? `Attn: ${contact.Name}${contact.Title ? `, ${contact.Title}` : ""}` : "",
    contact?.Email ?? "",
  ].filter(Boolean);
  doc.text(t(bill[0] ?? ""), M, y + 14);
  font(doc, 9, "normal", BODY);
  bill.slice(1).forEach((line, i) => doc.text(t(line), M, y + 27 + i * 12));
  const details: [string, string][] = [
    ["Quote date", fmtDate(q.CreatedDate)],
    ["Valid until", fmtDate(q.ExpirationDate)],
    ["Go-live (service start)", fmtDate(q.Start_Date__c)],
    ["Term", `${q.Contract_Term_Months__c} months`],
    ["Billing", `${q.Billing_Frequency__c}, ${q.Payment_Terms__c}`],
    ["Currency", ccy],
    ["Prepared by", c.owner],
  ];
  const detailsEnd = kv(doc, autoTable, details, y + 6, M + w / 2 + 10, w / 2 - 10);
  y = Math.max(detailsEnd, y + 27 + (bill.length - 1) * 12) + 16;

  // Lines, grouped recurring / one-time
  const head = [["Product", "Qty", "List", "Disc.", "Net unit", "Total"]];
  type Row = (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[];
  const body: Row[] = [];
  const group = (label: string, recurring: boolean) => {
    const ls = c.lines.filter((l) => isRecurring(c.products.get(l.Product2Id) ?? { Pricing_Unit__c: "per year" }) === recurring);
    if (!ls.length) return;
    body.push([{ content: t(label), colSpan: 6, styles: { fontStyle: "bold", fillColor: [248, 250, 252], textColor: INK } }]);
    for (const l of ls) {
      const p = c.products.get(l.Product2Id);
      body.push([
        t(`${p?.Name ?? l.Product2Id}\n${p ? unitLabel(p) : ""}${l.Description ? ` - ${l.Description}` : ""}`),
        String(l.Quantity),
        money(l.ListPrice),
        l.Discount ? fmtPctValue(l.Discount) : "-",
        money(l.UnitPrice),
        money(l.TotalPrice),
      ]);
    }
  };
  group("Recurring (annual)", true);
  group("One-time", false);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: M, bottom: M },
    head,
    body,
    ...tableStyles,
    columnStyles: { 0: { cellWidth: 210 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right";
    },
  });
  y = lastY(doc) + 12;

  // Totals
  y = ensure(doc, y, 170);
  const rows: [string, string][] = [["Recurring, list", money(totals.recurringList)]];
  if (totals.recurringList !== totals.recurringNet) rows.push(["Line discounts", `-${money(totals.recurringList - totals.recurringNet)}`]);
  if (totals.headerDiscount) rows.push([`Additional discount (${fmtPctValue(q.Discount__c)})`, `-${money(totals.headerDiscount)}`]);
  rows.push(["Annual recurring (ARR)", money(totals.arr)]);
  if (totals.oneTimeCount) rows.push(["One-time fees", money(totals.oneTime)]);
  if (totals.tax) rows.push([`Tax (${fmtPctValue(q.Tax_Rate__c)})`, money(totals.tax)]);
  rows.push(["First-year total", money(totals.firstYear)]);
  rows.push([`Total contract value (${q.Contract_Term_Months__c} months)`, money(totals.tcv)]);
  y = kv(doc, autoTable, rows, y, M + w / 2 + 10, w / 2 - 10, { boldLast: true }) + 18;

  // Payment schedule
  y = drawSchedule(doc, autoTable, c, y);

  // Terms
  y = sectionTitle(doc, "Terms", ensure(doc, y + 6, 120));
  const terms = [
    `Prices in ${ccy === "CAD" ? "Canadian dollars" : "US dollars"}, valid until ${fmtDate(q.ExpirationDate)}.`,
    `Subscription term of ${q.Contract_Term_Months__c} months from the go-live date (${fmtDate(q.Start_Date__c)}). Subscription fees are invoiced ${({ Annual: "annually", Quarterly: "quarterly", Monthly: "monthly" } as const)[q.Billing_Frequency__c]} in advance; one-time fees are invoiced with the first invoice.`,
    `Payment terms: ${q.Payment_Terms__c}.${q.Tax_Rate__c ? ` Tax at ${fmtPctValue(q.Tax_Rate__c)}.` : " Applicable taxes are extra."}`,
    "Implementation and training are scheduled outside harvest and spring planting.",
  ];
  for (const line of terms) y = paragraph(doc, `-  ${line}`, y, { size: 8.5 }) + 2;
  if (q.Description) y = paragraph(doc, q.Description, y + 4, { size: 8.5, color: MUTED });

  if (opts.signature) y = drawSignatures(doc, c, y + 14);
  return y;
}

function drawSchedule(doc: jsPDF, autoTable: AutoTable, c: Ctx, y: number): number {
  const money = (n: number) => fmtCurrency(n, c.ccy);
  const s = paymentSchedule(c.totals, { start: c.q.Start_Date__c, termMonths: c.q.Contract_Term_Months__c, frequency: c.q.Billing_Frequency__c, taxRate: c.q.Tax_Rate__c });
  y = sectionTitle(doc, `Payment schedule (${c.q.Billing_Frequency__c.toLowerCase()})`, y);
  const total = s.reduce((x, i) => x + i.amount, 0);
  autoTable(doc, {
    startY: y - 6,
    margin: { left: M, right: M, top: M, bottom: M },
    head: [["#", "Invoice date", "Subscription", "One-time", "Tax", "Amount"]],
    body: s.map((i) => [String(i.n), fmtDate(i.date), money(i.recurring), i.oneTime ? money(i.oneTime) : "-", i.tax ? money(i.tax) : "-", money(i.amount)]),
    foot: [["", "Total", "", "", "", money(total)]],
    showFoot: "lastPage",
    ...tableStyles,
    footStyles: { fillColor: HEAD, textColor: INK, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 28 }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index > 1) d.cell.styles.halign = "right";
    },
  });
  return lastY(doc) + 14;
}

function drawSignatures(doc: jsPDF, c: Ctx, y: number): number {
  y = ensure(doc, y, 130);
  y = sectionTitle(doc, "Acceptance", y);
  const w = (pageW(doc) - 2 * M - 30) / 2;
  const block = (x: number, party: string, name?: string) => {
    font(doc, 9, "bold", INK);
    doc.text(t(party), x, y + 4);
    doc.setDrawColor(...([148, 163, 184] as Rgb));
    doc.setLineWidth(0.5);
    ["Signature", "Name", "Title", "Date"].forEach((label, i) => {
      const ly = y + 40 + i * 32;
      doc.line(x, ly, x + w, ly);
      font(doc, 7.5, "normal", MUTED);
      doc.text(label, x, ly + 10);
      if (label === "Name" && name) {
        font(doc, 9.5, "normal", BODY);
        doc.text(t(name), x + 2, ly - 5);
      }
    });
  };
  block(M, c.account?.Name ?? "Customer", c.contact?.Name);
  block(M + w + 30, SELLER, c.owner);
  return y + 40 + 4 * 32;
}

function header(doc: jsPDF, logo: string | null, title: string, sub: string): number {
  drawPdfLogo(doc, logo, M - 2, M - 16, 18);
  font(doc, 8, "normal", MUTED);
  doc.text(SELLER, pageW(doc) - M, M - 4, { align: "right" });
  font(doc, 18, "bold", INK);
  doc.text(t(title), M, M + 30);
  font(doc, 10, "normal", MUTED);
  doc.text(t(sub), M, M + 46);
  return M + 72;
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Branded quote PDF, downloaded as Quote-Q-01041-Account-Name.pdf */
export async function downloadQuotePdf(data: DataSnapshot, quoteId: string, asOf: Date): Promise<void> {
  const c = context(data, quoteId, asOf);
  const { doc, autoTable, logo } = await loadPdf();
  const y = header(doc, logo, `Quote ${c.q.QuoteNumber}`, c.q.Name);
  drawQuote(doc, autoTable, c, y, { signature: true });
  footers(doc, `Quote ${c.q.QuoteNumber} - ${c.account?.Name ?? ""}`);
  doc.save(`Quote-${c.q.QuoteNumber}-${slug(c.account?.Name ?? "")}.pdf`);
}

interface Milestone {
  when: string;
  what: string;
  note: string;
}

/** Implementation plan around the account's harvest and planting windows */
export function implementationTimeline(c: Pick<Ctx, "q" | "account" | "asOf">, meeting: Date | null): Milestone[] {
  const start = parseDate(c.q.Start_Date__c);
  const sign = meeting && meeting > c.asOf ? addDays(meeting, 7) : addDays(c.asOf, 14);
  const rows: { at: Date; m: Milestone }[] = [];
  const add = (at: Date, when: string, what: string, note: string) => rows.push({ at, m: { when, what, note } });
  if (meeting) add(meeting, fmtDate(meeting), "Board meeting", "Approve the agreement");
  add(sign, fmtDate(sign), "Agreement signed", "Kickoff call scheduled");
  const seasonal = !!c.account && isSeasonalSegment(c.account.Segment__c);
  const harvestNow = seasonal ? blackoutsFor(c.account!, sign.getUTCFullYear()).find((b) => b.kind === "hard" && sign >= b.start && sign <= b.end) : undefined;
  const kickoff = harvestNow ? addDays(harvestNow.end, 3) : addDays(sign, 7);
  add(kickoff, fmtDate(kickoff), "Kickoff and data review", harvestNow ? "After harvest wraps up" : "Project plan, data extracts");
  const tight = start < addDays(kickoff, 30);
  if (tight) {
    add(start, fmtDate(start), "Go-live", "Service term starts; implementation runs after this date");
  } else {
    const migrate = addDays(start, -45) > kickoff ? addDays(start, -45) : addDays(kickoff, 3);
    add(migrate, `${fmtDate(migrate)} - ${fmtDate(addDays(start, -1))}`, "Configuration and data migration", "Tickets, contracts, producer balances");
    add(addDays(start, -10), fmtDate(addDays(start, -10)), "Scale house and office training", "On site, outside harvest");
    add(start, fmtDate(start), "Go-live", "Service term starts");
  }
  if (seasonal) {
    const y = start.getUTCFullYear();
    const next = [...blackoutsFor(c.account!, y), ...blackoutsFor(c.account!, y + 1)].filter((b) => b.start > start);
    const plant = next.find((b) => b.kind === "light");
    const harvest = next.find((b) => b.kind === "hard");
    if (plant) add(plant.start, `${fmtDate(plant.start)} - ${fmtDate(plant.end)}`, "Spring planting", "Stabilize; no major changes");
    if (harvest) add(harvest.start, `${fmtDate(harvest.start)} - ${fmtDate(harvest.end)}`, "First harvest on the new system", "Harvest support coverage");
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime()).map((r) => r.m);
}

/** Co-op board packet: cover, summary, quote, schedule, harvest-day card, timeline, ROI */
export async function downloadBoardPacketPdf(data: DataSnapshot, quoteId: string, asOf: Date): Promise<void> {
  const c = context(data, quoteId, asOf);
  const { q, totals, ccy, account: a } = c;
  const money = (n: number) => fmtCurrency(n, ccy, { cents: false });
  const meeting = nextBoardMeeting(a?.Board_Meeting_Months__c, asOf);
  let summary: HarvestSummary | null = null;
  let share: string | null = null;
  if (a) {
    try {
      summary = harvestSummaryFor(a, data);
    } catch {
      summary = null;
    }
    if (summary) {
      try {
        share = await harvestShareUrl(a.Id);
      } catch {
        share = null;
      }
    }
  }
  const { doc, autoTable, logo } = await loadPdf();
  const W = pageW(doc);

  // Cover
  drawPdfLogo(doc, logo, M - 2, M - 10, 24);
  doc.setFillColor(...ACCENT);
  doc.rect(M, 250, 40, 3, "F");
  font(doc, 11, "normal", MUTED);
  doc.text("Board packet", M, 240);
  font(doc, 26, "bold", INK);
  doc.text(doc.splitTextToSize(t(a?.Name ?? q.Name), W - 2 * M) as string[], M, 290);
  font(doc, 12, "normal", BODY);
  doc.text(t(meeting ? `Board meeting of ${fmtDate(meeting)}` : "For board review"), M, 340);
  doc.text(t(`Software agreement proposal - Quote ${q.QuoteNumber}`), M, 358);
  font(doc, 9.5, "normal", MUTED);
  const coverRows = [
    `Prepared by ${c.owner}, ${SELLER}`,
    c.contact ? `For ${c.contact.Name}${c.contact.Title ? `, ${c.contact.Title}` : ""}` : "",
    `Prepared ${fmtDate(asOf)}  |  Quote valid until ${fmtDate(q.ExpirationDate)}`,
  ].filter(Boolean);
  coverRows.forEach((r, i) => doc.text(t(r), M, 400 + i * 14));

  // Executive summary
  doc.addPage();
  let y = header(doc, logo, "Executive summary", `${a?.Name ?? ""} - Quote ${q.QuoteNumber}`);
  const modules = c.lines.filter((l) => isRecurring(c.products.get(l.Product2Id))).map((l) => c.products.get(l.Product2Id)?.Name ?? "");
  const services = c.lines.filter((l) => !isRecurring(c.products.get(l.Product2Id))).map((l) => c.products.get(l.Product2Id)?.Name ?? "");
  const approval = quoteApproval(data, q);
  const points = [
    `Recommendation: approve a ${q.Contract_Term_Months__c}-month agreement for ${modules.join(", ") || "the proposed modules"}${services.length ? `, with ${services.join(", ")}` : ""}.`,
    `Investment: ${money(totals.firstYear)} in the first year (${money(totals.arr)} a year recurring${totals.oneTime ? ` plus ${money(totals.oneTime)} one-time` : ""}); ${money(totals.tcv)} over the term.`,
    `Timing: go-live on ${fmtDate(q.Start_Date__c)}, after harvest, so implementation and training stay out of the busy season.`,
    a ? `Scope: ${a.Number_of_Locations__c} location${a.Number_of_Locations__c === 1 ? "" : "s"}${a.Scales__c ? `, ${a.Scales__c} truck scale${a.Scales__c === 1 ? "" : "s"}` : ""}; replaces ${a.Current_Software__c || "current systems"}.` : "",
    summary && summary.manual.seasonDollarsLost > 0 ? `Harvest impact: the harvest-day model shows ${money(summary.manual.seasonDollarsLost)} of margin lost per season to truck lines today${summary.seasonSavings > 0 ? `, and ${money(summary.seasonSavings)} recovered with automated receiving` : ""}.` : "",
    totals.discountTotal > 0 ? `Pricing: ${money(totals.discountTotal)} below list in the first year (largest discount ${approval.discount}%).` : "",
    meeting && q.ExpirationDate < toISODate(meeting) ? `Note: this quote is valid until ${fmtDate(q.ExpirationDate)}; ${SELLER} will extend it through the board meeting.` : "",
  ].filter(Boolean);
  for (const p of points) y = paragraph(doc, `-  ${p}`, y, { size: 10 }) + 6;
  y += 8;
  kv(
    doc,
    autoTable,
    [
      ["Annual recurring (ARR)", money(totals.arr)],
      ["One-time fees", money(totals.oneTime)],
      ["First-year total", money(totals.firstYear)],
      ["Term", `${q.Contract_Term_Months__c} months`],
      ["Total contract value", money(totals.tcv)],
    ],
    y,
    M,
    260,
    { boldLast: true },
  );

  // The quote (with its payment schedule)
  doc.addPage();
  y = header(doc, logo, `Quote ${q.QuoteNumber}`, q.Name);
  drawQuote(doc, autoTable, c, y, { signature: false });

  // Harvest-day summary
  if (summary) {
    doc.addPage();
    y = header(doc, logo, "Harvest-day summary", a?.Name ?? "");
    drawHarvestSummaryPdf(doc, share ? { ...summary, shareUrl: share } : summary, M, y, W - 2 * M);
  }

  // Implementation timeline
  doc.addPage();
  y = header(doc, logo, "Implementation timeline", "Planned around harvest and spring planting");
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: M, bottom: M },
    head: [["When", "Milestone", "Notes"]],
    body: implementationTimeline(c, meeting).map((m) => [t(m.when), t(m.what), t(m.note)]),
    ...tableStyles,
    styles: { ...tableStyles.styles, fontSize: 9.5, cellPadding: { top: 6, bottom: 6, left: 5, right: 5 } },
    columnStyles: { 0: { cellWidth: 170 }, 1: { fontStyle: "bold", textColor: INK } },
  });

  // ROI
  doc.addPage();
  const positive = (n: number | null | undefined) => (n != null && n > 0 ? n : null);
  const atRisk = positive(summary?.manual.seasonDollarsLost) ?? positive(a?.Harvest_At_Risk__c);
  const saved = positive(summary?.seasonSavings);
  y = header(doc, logo, "Return on investment", atRisk != null ? "Harvest dollars at risk vs. annual cost" : "Investment summary");
  const rows: [string, string][] = [];
  if (atRisk != null) rows.push(["Harvest $ at risk per season (today)", money(atRisk)]);
  if (saved != null) rows.push(["Recovered per season with automation", money(saved)]);
  rows.push(["Annual recurring cost", money(totals.arr)]);
  rows.push(["First-year cost (incl. one-time)", money(totals.firstYear)]);
  // Payback and net benefit only from modeled savings, never from gross dollars at risk
  if (saved != null) {
    const years = totals.termYears;
    rows.push(["Payback on first-year cost", `${Math.max(0.1, Math.round((totals.firstYear / saved) * 120) / 10)} months of harvest savings`]);
    rows.push([`Savings over ${q.Contract_Term_Months__c} months`, money(saved * years)]);
    rows.push(["Net benefit over the term (savings - TCV)", money(saved * years - totals.tcv)]);
  }
  y = kv(doc, autoTable, rows, y, M, 340, { boldLast: saved != null }) + 20;
  const benefit = saved ?? atRisk;
  if (benefit != null) {
    // Simple bar comparison
    const max = Math.max(benefit, totals.arr);
    const bw = W - 2 * M - 170 - 80;
    const bar = (label: string, v: number, color: Rgb, by: number) => {
      font(doc, 9, "normal", BODY);
      doc.text(t(label), M, by + 10);
      doc.setFillColor(...color);
      doc.rect(M + 170, by, Math.max(2, (v / max) * bw), 14, "F");
      font(doc, 8.5, "bold", INK);
      doc.text(money(v), M + 174 + Math.max(2, (v / max) * bw), by + 10);
    };
    bar(saved != null ? "Recovered per season" : "At risk per season", benefit, ACCENT, y);
    bar("Annual recurring cost", totals.arr, [148, 163, 184], y + 24);
    y += 60;
  }
  paragraph(
    doc,
    summary && atRisk != null
      ? `Modeled with the Harvest Day Simulator: ${summary.trucksPerDay} trucks a day, ${summary.settings.manualMinutes} minutes per truck manual vs. ${summary.settings.automatedMinutes} automated, ${summary.settings.seasonDays} harvest days, $${summary.settings.marginPerBu.toFixed(2)} per bushel margin.`
      : atRisk != null
        ? "Harvest $ at risk from the facility's latest harvest-day model."
        : summary
          ? "The harvest-day model shows no trucks lost at this facility's current receiving capacity."
          : "A harvest-day model is not available for this facility yet.",
    y,
    { size: 8.5, color: MUTED },
  );

  footers(doc, `Board packet - ${a?.Name ?? ""} - Quote ${q.QuoteNumber}`);
  doc.save(`Board-Packet-${q.QuoteNumber}-${slug(a?.Name ?? "")}.pdf`);
}
