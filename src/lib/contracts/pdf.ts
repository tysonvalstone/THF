/**
 * Contract PDFs (jspdf + jspdf-autotable, loaded on demand; browser only):
 * the Order Form, key terms, clauses and signature block. Signed contracts
 * carry the drawn signature, timestamp and an e-signature audit line;
 * unsigned ones are the "for signature" copy with blank signature lines.
 */
import type { jsPDF } from "jspdf";
import type { DataSnapshot } from "@/lib/data/types";

import { USER_BY_ID } from "@/data/reference/users";
import { fmtDate } from "@/lib/dates";
import { drawPdfFooterBrand, drawPdfLogo, loadPdfLogo } from "@/lib/exports/pdf-brand";
import { fmtCurrency, fmtPctValue } from "@/lib/quotes/pricing";
import { clausesFor, customerSignerFor, noticeDeadline, orderFormLines } from "./core";

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
    .replace(/·/g, "-")
    .replace(/[^\x20-\xff\n]/g, "");
}

const pageW = (doc: jsPDF) => doc.internal.pageSize.getWidth();
const pageH = (doc: jsPDF) => doc.internal.pageSize.getHeight();
const lastY = (doc: jsPDF) => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 0;

function font(doc: jsPDF, size: number, style: "normal" | "bold" | "italic" = "normal", color: Rgb = BODY) {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
}

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

function paragraph(doc: jsPDF, text: string, y: number, opts: { size?: number; color?: Rgb; style?: "normal" | "bold" | "italic" } = {}): number {
  const size = opts.size ?? 9;
  font(doc, size, opts.style ?? "normal", opts.color ?? BODY);
  const lines = doc.splitTextToSize(t(text), pageW(doc) - 2 * M) as string[];
  const lh = size * 1.4;
  for (const line of lines) {
    y = ensure(doc, y, lh);
    doc.text(line, M, y);
    y += lh;
  }
  return y;
}

/** UTC timestamp for the audit line: "Sep 29, 2026 at 14:05 UTC" */
function fmtStamp(isoDate: string): string {
  const d = new Date(isoDate);
  return `${fmtDate(d)} at ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

const TABLE = {
  theme: "plain" as const,
  styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: BODY, lineColor: LINE, lineWidth: { bottom: 0.5 }, overflow: "linebreak" as const },
  headStyles: { fillColor: HEAD, textColor: [51, 65, 85] as Rgb, fontStyle: "bold" as const, lineWidth: { bottom: 0.75 }, lineColor: [203, 213, 225] as Rgb },
};

/** Downloads the contract PDF: signed copy when signed, else the copy for signature */
export async function downloadContractPdf(data: DataSnapshot, contractId: string): Promise<void> {
  const c = data.contracts.find((x) => x.Id === contractId);
  if (!c) throw new Error("Contract not found");
  const [{ jsPDF }, { autoTable }, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), loadPdfLogo()]);
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  const signed = !!c.SignedDate && ["Signed", "Active", "Expired", "Terminated"].includes(c.Status);
  const a = data.accounts.find((x) => x.Id === c.AccountId);
  const signer = customerSignerFor(data, c);
  const owner = USER_BY_ID[c.OwnerId]?.Name ?? SELLER;
  const money = (n: number) => fmtCurrency(n, c.CurrencyIsoCode, { cents: false });
  const W = pageW(doc);
  const w = W - 2 * M;

  // Header
  drawPdfLogo(doc, logo, M - 2, M - 16, 18);
  font(doc, 8, "bold", signed ? ACCENT : MUTED);
  doc.text(signed ? "SIGNED" : "FOR SIGNATURE", W - M, M - 4, { align: "right" });
  font(doc, 18, "bold", INK);
  doc.text("Order Form and Subscription Agreement", M, M + 30);
  font(doc, 10, "normal", MUTED);
  doc.text(t(`${c.ContractNumber} - ${a?.Name ?? c.Name}`), M, M + 46);
  let y = M + 74;

  // Parties
  font(doc, 8, "bold", MUTED);
  doc.text("CUSTOMER", M, y);
  doc.text("PROVIDER", M + w / 2 + 10, y);
  const cust = [a?.Name ?? "", a?.BillingStreet ?? "", a ? `${a.BillingCity}, ${a.BillingState} ${a.BillingPostalCode}` : "", a?.BillingCountry ?? "", signer ? `Attn: ${signer.Name}${signer.Title ? `, ${signer.Title}` : ""}` : ""].filter(Boolean);
  const prov = [SELLER, "Account owner: " + owner, "contracts@thibolisoft.example"];
  cust.forEach((line, i) => {
    font(doc, 9, i === 0 ? "bold" : "normal", i === 0 ? INK : BODY);
    doc.text(t(line), M, y + 14 + i * 12);
  });
  prov.forEach((line, i) => {
    font(doc, 9, i === 0 ? "bold" : "normal", i === 0 ? INK : BODY);
    doc.text(t(line), M + w / 2 + 10, y + 14 + i * 12);
  });
  y += 14 + Math.max(cust.length, prov.length) * 12 + 14;

  // Key terms
  y = sectionTitle(doc, "Key terms", y);
  const terms: [string, string][] = [
    ["Start date", fmtDate(c.StartDate)],
    ["End date", fmtDate(c.EndDate)],
    ["Term", `${c.TermMonths} months`],
    ["Automatic renewal", c.AutoRenew ? "Yes, 12-month renewal terms" : "No"],
    ["Notice period", `${c.NoticeDays} days (by ${fmtDate(noticeDeadline(c))})`],
    ["Annual price increase", `Up to ${fmtPctValue(c.PriceIncreasePct)}`],
    ["Billing", `${c.BillingFrequency} in advance`],
    ["Payment terms", c.HarvestTerms ? `Harvest terms: annual invoice due Dec 15; one-time fees ${c.PaymentTerms}` : c.PaymentTerms],
    ["Data protection addendum", c.DPA ? "Included" : "Not included"],
    ["Currency", c.CurrencyIsoCode],
  ];
  const half = Math.ceil(terms.length / 2);
  const kv = (rows: [string, string][], x: number, startY: number) => {
    autoTable(doc, {
      startY,
      margin: { left: x, right: W - x - (w / 2 - 10), top: M, bottom: M },
      tableWidth: w / 2 - 10,
      theme: "plain",
      body: rows.map(([k, v]) => [
        { content: t(k), styles: { textColor: MUTED } },
        { content: t(v), styles: { textColor: INK } },
      ]),
      styles: { font: "helvetica", fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 0, right: 4 } },
      columnStyles: { 0: { cellWidth: 110 } },
    });
    return lastY(doc);
  };
  const y1 = kv(terms.slice(0, half), M, y - 6);
  const y2 = kv(terms.slice(half), M + w / 2 + 10, y - 6);
  y = Math.max(y1, y2) + 18;

  // Order Form
  y = sectionTitle(doc, "Order Form", y);
  const lines = orderFormLines(data, c);
  type Cell = string | { content: string; colSpan?: number; styles?: Record<string, unknown> };
  const body: Cell[][] = [];
  const group = (label: string, recurring: boolean) => {
    const ls = lines.filter((l) => l.recurring === recurring);
    if (!ls.length) return;
    body.push([{ content: label, colSpan: 6, styles: { fontStyle: "bold", fillColor: [248, 250, 252], textColor: INK } }]);
    for (const l of ls) body.push([t(l.name), String(l.quantity), money(l.listPrice), l.discount ? fmtPctValue(l.discount) : "-", money(l.unitPrice), money(l.total)]);
  };
  group("Subscription (annual)", true);
  group("One-time", false);
  autoTable(doc, {
    startY: y - 6,
    margin: { left: M, right: M, top: M, bottom: M },
    head: [["Product", "Qty", "List", "Disc.", "Net unit", "Total"]],
    body,
    foot: [
      ["Annual recurring (ARR)", "", "", "", "", money(c.ARR)],
      ...(c.OneTimeFees ? [["One-time fees", "", "", "", "", money(c.OneTimeFees)]] : []),
      [`Total contract value (${c.TermMonths} months)`, "", "", "", "", money(c.TCV)],
    ],
    showFoot: "lastPage",
    ...TABLE,
    footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 200 }, 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section !== "body" && d.column.index > 0) d.cell.styles.halign = "right";
    },
  });
  y = lastY(doc) + 22;

  // Clauses
  y = sectionTitle(doc, "Terms and conditions", y);
  clausesFor(data, c.Id).forEach((r, i) => {
    y = ensure(doc, y, 40);
    y = paragraph(doc, `${i + 1}. ${r.Name}`, y, { size: 9.5, style: "bold", color: INK });
    y = paragraph(doc, r.Body, y + 1, { size: 8.5 }) + 8;
  });
  y = paragraph(
    doc,
    "This Order Form and the terms above are the entire agreement between the parties for the Services and supersede any purchase order terms. Each person signing represents that they are authorized to bind their party.",
    y + 4,
    { size: 8.5, color: MUTED },
  );

  // Signatures
  y = ensure(doc, y + 18, 190);
  y = sectionTitle(doc, "Signatures", y);
  const colW = (w - 30) / 2;
  const block = (x: number, party: string, rows: { signature?: string; typed?: string; name?: string; title?: string; date?: string }) => {
    font(doc, 9, "bold", INK);
    doc.text(t(party), x, y + 4);
    const sigLine = y + 62;
    if (rows.signature) {
      try {
        const p = doc.getImageProperties(rows.signature);
        const h = 44;
        const iw = Math.min(colW, (p.width / p.height) * h);
        doc.addImage(rows.signature, "PNG", x, sigLine - h - 2, iw, h);
      } catch {
        rows.typed ??= rows.name;
      }
    }
    if (!rows.signature && rows.typed) {
      font(doc, 14, "italic", INK);
      doc.text(t(`/s/ ${rows.typed}`), x + 2, sigLine - 8);
    }
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.5);
    (["Signature", "Name", "Title", "Date"] as const).forEach((label, i) => {
      const ly = sigLine + i * 28;
      doc.line(x, ly, x + colW, ly);
      font(doc, 7.5, "normal", MUTED);
      doc.text(label, x, ly + 10);
      const v = label === "Name" ? rows.name : label === "Title" ? rows.title : label === "Date" ? rows.date : undefined;
      if (v) {
        font(doc, 9.5, "normal", BODY);
        doc.text(t(v), x + 2, ly - 5);
      }
    });
  };
  if (signed) {
    block(M, a?.Name ?? "Customer", { signature: c.SignatureImage, typed: c.SignatureImage ? undefined : c.SignedByName, name: c.SignedByName, title: c.SignedByTitle, date: fmtStamp(c.SignedDate!) });
    block(M + colW + 30, SELLER, { typed: owner, name: owner, title: USER_BY_ID[c.OwnerId]?.Title ?? "Account Executive", date: fmtDate(c.SignedDate!) });
  } else {
    block(M, a?.Name ?? "Customer", { name: signer?.Name, title: signer?.Title });
    block(M + colW + 30, SELLER, { name: owner });
  }
  y += 62 + 4 * 28;
  if (signed) {
    y = paragraph(
      doc,
      `Signed electronically by ${c.SignedByName ?? "the customer"}${c.SignedByTitle ? `, ${c.SignedByTitle}` : ""}, on ${fmtStamp(c.SignedDate!)}. Contract ${c.ContractNumber}, document ID ${c.Id}.`,
      y + 6,
      { size: 8, color: ACCENT },
    );
  }

  // Footers
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font(doc, 7.5, "normal", [148, 163, 184]);
    doc.text(t(`${c.ContractNumber} - ${a?.Name ?? ""}${signed ? "" : " - for signature"}`), M, pageH(doc) - 22);
    doc.text(`Page ${i} of ${n}`, W - M, pageH(doc) - 22, { align: "right" });
    drawPdfFooterBrand(doc, pageH(doc) - 22);
  }
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  doc.save(`Contract-${c.ContractNumber}-${slug(a?.Name ?? "")}${signed ? "-signed" : "-for-signature"}.pdf`);
}

