import { PRICES } from "@/data/seed";
import { REGION_BY_ID } from "@/data/reference/regions";
import type { PriceSeries, PriceSeriesKey } from "@/types/reference";
import type { Commodity, RegionId } from "@/types/salesforce";
import { addMonths, monthKey } from "@/lib/dates";
import { cropStatus } from "@/lib/season";

const SERIES: Record<string, PriceSeries> = Object.fromEntries(PRICES.map((p) => [p.key, p]));

export function series(key: PriceSeriesKey): PriceSeries {
  return SERIES[key];
}

export function priceAt(key: PriceSeriesKey, date: Date): number {
  const s = SERIES[key];
  const m = monthKey(date);
  const pts = s.points;
  if (m <= pts[0].month) return pts[0].price;
  if (m >= pts[pts.length - 1].month) return pts[pts.length - 1].price;
  return pts.find((p) => p.month === m)?.price ?? pts[pts.length - 1].price;
}

/** Fractional change over the trailing `months` (e.g. -0.08 = down 8%) */
export function pctChange(key: PriceSeriesKey, date: Date, months = 3): number {
  const now = priceAt(key, date);
  const then = priceAt(key, addMonths(date, -months));
  return (now - then) / then;
}

/** Trailing monthly history for sparklines */
export function history(key: PriceSeriesKey, date: Date, months = 12): { month: string; price: number }[] {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = addMonths(date, -i);
    out.push({ month: monthKey(d), price: priceAt(key, d) });
  }
  return out;
}

/**
 * Simplified dry-mill ethanol crush margin, $/gal:
 * ethanol + DDGS credit (≈0.003 t/gal) − corn/2.85 gal/bu − ~$0.45 opex.
 */
export function crushMargin(date: Date): number {
  const eth = priceAt("Ethanol", date);
  const ddgs = priceAt("DDGS", date);
  const corn = priceAt("Corn", date);
  return eth + 0.003 * ddgs - corn / 2.85 - 0.45;
}

/** Percentile (0–1) of the current crush margin vs. the trailing 24 months */
export function crushMarginPercentile(date: Date): number {
  const now = crushMargin(date);
  const past = Array.from({ length: 24 }, (_, i) => crushMargin(addMonths(date, -(i + 1))));
  return past.filter((m) => m < now).length / past.length;
}

/** Ration cost change: 70% corn / 30% soybean meal, trailing 3 months */
export function feedCostChange(date: Date): number {
  return 0.7 * pctChange("Corn", date, 3) + 0.3 * pctChange("Soybean Meal", date, 3);
}

/** Estimated local cash basis, $/bu (negative = under futures) */
export function basisFor(regionId: RegionId, commodity: Commodity, date: Date): number | undefined {
  const region = REGION_BY_ID[regionId];
  const typical = region.typicalBasis[commodity];
  const crop = region.crops.find((c) => c.commodity === commodity);
  if (typical === undefined || !crop) return undefined;
  const status = cropStatus(regionId, crop, date);
  const seasonal =
    status.phase === "Harvest" ? -0.2 : status.phase === "Post-harvest" ? -0.1 : status.phase === "Pre-harvest" ? -0.04 : 0.06;
  const cropSize = -(status.window.climate.yieldIndex - 1) * 1.5;
  return +(typical + seasonal + cropSize).toFixed(2);
}

export function fmtPrice(key: PriceSeriesKey, value: number): string {
  const s = SERIES[key];
  if (s.unit.startsWith("$/bu")) return `$${value.toFixed(2)}/bu`;
  if (s.unit === "$/gal") return `$${value.toFixed(2)}/gal`;
  if (s.unit === "CAD/t") return `C$${Math.round(value)}/t`;
  if (s.unit === "CAD/bu") return `C$${value.toFixed(2)}/bu`;
  if (s.unit === "$/cwt") return `$${value.toFixed(2)}/cwt`;
  return `$${Math.round(value)}/ton`;
}

export function fmtBasis(b: number): string {
  const cents = Math.round(b * 100);
  return `${cents >= 0 ? "+" : "−"}${Math.abs(cents)}¢`;
}
