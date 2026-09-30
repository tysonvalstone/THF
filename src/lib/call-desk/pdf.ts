/**
 * Pre-call brief as a branded one-to-two page PDF (browser only).
 */
import type { Call } from "@/types/salesforce";
import { drawPdfFooterBrand, drawPdfLogo, loadPdfLogo } from "@/lib/exports/pdf-brand";
import { briefText } from "./brief";
import type { CallBrief } from "./types";

export async function downloadBriefPdf(brief: CallBrief, call: Call): Promise<void> {
  const [{ jsPDF }, logo] = await Promise.all([import("jspdf"), loadPdfLogo()]);
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  drawPdfLogo(doc, logo, M, 36, 22);
  let y = 84;
  // Helvetica has no arrow glyph
  const lines = briefText(brief, call).replace(/→/g, "->").split("\n");
  const [title, , ...rest] = lines;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(doc.splitTextToSize(title, W - 2 * M), M, y);
  y += 24;
  const footer = () => drawPdfFooterBrand(doc, H - 24);
  for (const raw of rest) {
    const heading = /^[A-Z][A-Z' ()0-9,]+$/.test(raw) && raw.length > 3;
    doc.setFont("helvetica", heading ? "bold" : "normal");
    doc.setFontSize(heading ? 10.5 : 9.5);
    doc.setTextColor(heading ? 31 : 30, heading ? 95 : 41, heading ? 74 : 59);
    const wrapped = raw ? (doc.splitTextToSize(raw, W - 2 * M) as string[]) : [""];
    const h = wrapped.length * (heading ? 14 : 12.5) + (heading ? 4 : 0);
    if (y + h > H - 48) {
      footer();
      doc.addPage();
      y = 48;
    }
    if (heading) y += 4;
    doc.text(wrapped, M, y);
    y += h - (heading ? 4 : 0) + (raw ? 0 : -4);
  }
  footer();
  const safe = brief.snapshot.accountName.replace(/[^\w-]+/g, "-").replace(/-+/g, "-");
  doc.save(`Brief-${safe}-${call.Start.slice(0, 10)}.pdf`);
}
