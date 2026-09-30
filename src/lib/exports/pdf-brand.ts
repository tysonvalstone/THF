/**
 * HarvestSignal branding for jsPDF documents: the logo lockup (from the brand
 * PNG) top-left of page 1 and a small wordmark in the page footer.
 */
import type { jsPDF } from "jspdf";

const LOGO_URL = "/brand/harvestsignal-logo.png";

let logoPromise: Promise<string | null> | null = null;

/** The logo PNG as a data URL, loaded once per session; null if it can't be fetched */
export function loadPdfLogo(): Promise<string | null> {
  logoPromise ??= fetch(LOGO_URL)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then(
      (blob) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        }),
    )
    .catch(() => {
      logoPromise = null;
      return null;
    });
  return logoPromise;
}

/**
 * Draws the logo with its top-left at (x, y), `height` points tall. Falls back
 * to the wordmark in text if the image isn't available. Returns the drawn width.
 */
export function drawPdfLogo(doc: jsPDF, logo: string | null, x: number, y: number, height: number): number {
  if (logo) {
    const { width, height: h } = doc.getImageProperties(logo);
    const w = (width / h) * height;
    doc.addImage(logo, "PNG", x, y, w, height);
    return w;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(height * 0.8);
  doc.setTextColor(31, 95, 74);
  doc.text("HarvestSignal", x, y + height * 0.75);
  const w = doc.getTextWidth("HarvestSignal");
  doc.setFont("helvetica", "normal");
  doc.setTextColor(0);
  return w;
}

/** "HarvestSignal" centred in the footer of the current page */
export function drawPdfFooterBrand(doc: jsPDF, baseline: number) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(31, 95, 74);
  doc.text("HarvestSignal", w / 2, baseline, { align: "center" });
}
