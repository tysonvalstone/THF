/**
 * Rough crop calendar for the seasonality heat map.
 *
 * Static defaults only (no live data). Each commodity has a planting and a
 * harvest "bell" centred on a peak day-of-year at a reference latitude; the
 * peaks shift later by `shiftDaysPerDegree` for every degree north, so
 * southern Illinois reaches harvest before northern Illinois and Canada later
 * still. All date math is UTC.
 */

export type MapCommodity = "Wheat" | "Corn" | "Soybeans" | "Rice" | "Lentils";

export const MAP_COMMODITIES: MapCommodity[] = ["Wheat", "Corn", "Soybeans", "Rice", "Lentils"];

export interface CropCalendarVariant {
  name: string;
  regions: string[];
  plantPeakDoy: number;
  harvestPeakDoy: number;
  referenceLat: number;
}

export interface CropCalendarEntry {
  commodity: MapCommodity;
  label: string;
  /** Day-of-year of the planting peak at the reference latitude */
  plantPeakDoy: number;
  /** Day-of-year of the harvest peak at the reference latitude */
  harvestPeakDoy: number;
  /** Half-width in days of the planting/harvest bell (so the harvest window ≈ peak ± spread) */
  plantSpreadDays: number;
  harvestSpreadDays: number;
  referenceLat: number;
  /** Days later per degree north (e.g. 2.5) */
  shiftDaysPerDegree: number;
  /**
   * Optional separate latitude shift for planting. Winter wheat is planted
   * *earlier* in the north, so this can be negative. Defaults to shiftDaysPerDegree.
   */
  plantShiftDaysPerDegree?: number;
  /**
   * Optional northern limit of cultivation. Large provinces (ON, QC, MB) span far
   * beyond where the crop is grown; points north of this return null ("Not grown").
   */
  maxLat?: number;
  /** Growing regions: US state and Canadian province postal codes */
  regions: string[];
  /** Optional override for a second population, e.g. spring wheat in the north */
  variants?: CropCalendarVariant[];
}

const CORN_SOY_REGIONS = [
  "IA", "IL", "IN", "OH", "NE", "MN", "SD", "ND", "KS", "MO", "WI", "MI", "KY", "TN", "AR", "MS",
  "LA", "NC", "PA", "NY", "DE", "MD", "VA", "TX", "CO", "ON", "QC", "MB",
];

// Day-of-year references (non-leap): Mar 15 = 74, Apr 15 = 105, May 1 = 121, May 25 = 145,
// Jun 25 = 176, Aug 15 = 227, Aug 20 = 232, Sep 10 = 253, Oct 1 = 274, Oct 10 = 283.
export const CROP_CALENDAR: Record<MapCommodity, CropCalendarEntry> = {
  Corn: {
    commodity: "Corn",
    label: "Corn",
    plantPeakDoy: 121, // ~May 1 at 40°N (planted Apr–May)
    harvestPeakDoy: 280, // ~Oct 7 at 40°N (harvest Sep–Nov)
    plantSpreadDays: 18,
    harvestSpreadDays: 24,
    referenceLat: 40,
    shiftDaysPerDegree: 3,
    maxLat: 50.5,
    regions: CORN_SOY_REGIONS,
  },
  Soybeans: {
    commodity: "Soybeans",
    label: "Soybeans",
    plantPeakDoy: 142, // ~May 22 (planted May–Jun)
    harvestPeakDoy: 274, // ~Oct 1 (harvest Sep–Oct)
    plantSpreadDays: 18,
    harvestSpreadDays: 18,
    referenceLat: 40,
    shiftDaysPerDegree: 3,
    maxLat: 50.5,
    regions: CORN_SOY_REGIONS,
  },
  Wheat: {
    commodity: "Wheat",
    label: "Wheat (winter + spring)",
    plantPeakDoy: 274, // winter wheat planted ~Oct 1 in Kansas, earlier further north
    harvestPeakDoy: 180, // winter wheat harvest ~Jun 29 in Kansas, moving north through July
    plantSpreadDays: 18,
    harvestSpreadDays: 16,
    referenceLat: 38,
    shiftDaysPerDegree: 3.5,
    plantShiftDaysPerDegree: -2,
    maxLat: 56,
    regions: ["KS", "OK", "TX", "NE", "CO", "SD", "MT", "WA", "OR", "ID", "IL", "IN", "OH", "MO", "KY", "MI"],
    variants: [
      {
        name: "Spring wheat",
        regions: ["ND", "MN", "MT", "SD", "SK", "AB", "MB"],
        plantPeakDoy: 125, // ~May 5 (planted Apr–May)
        harvestPeakDoy: 235, // ~Aug 23 (harvest Aug–Sep)
        referenceLat: 48,
      },
    ],
  },
  Rice: {
    commodity: "Rice",
    label: "Rice",
    plantPeakDoy: 108, // ~Apr 18 (planted Mar–May)
    harvestPeakDoy: 255, // ~Sep 12 (harvest Aug–Oct)
    plantSpreadDays: 24,
    harvestSpreadDays: 24,
    referenceLat: 34,
    shiftDaysPerDegree: 2,
    regions: ["AR", "LA", "MS", "TX", "MO", "CA"],
  },
  Lentils: {
    commodity: "Lentils",
    label: "Lentils",
    plantPeakDoy: 125, // ~May 5 (planted Apr–May)
    harvestPeakDoy: 222, // ~Aug 10 at 48°N (harvest Aug)
    plantSpreadDays: 15,
    harvestSpreadDays: 14,
    referenceLat: 48,
    shiftDaysPerDegree: 1.5,
    maxLat: 55,
    regions: ["MT", "ND", "WA", "ID", "SK", "AB"],
  },
};

/* ------------------------------------------------------------------ helpers */

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365;

/** Fractional day-of-year (Jan 1 00:00 UTC = 1). */
function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return (date.getTime() - start) / DAY_MS + 1;
}

/** Shortest distance between two days-of-year on a 365-day circle. */
function circularDistance(a: number, b: number): number {
  const d = (((a - b) % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return Math.min(d, YEAR_DAYS - d);
}

/** Smooth bell: 1 at the peak, 0.5 at ±spread, → 0 far away. */
function bell(doy: number, peak: number, spread: number): number {
  const x = circularDistance(doy, peak) / spread;
  return Math.pow(2, -x * x);
}

interface Population {
  plantPeak: number;
  harvestPeak: number;
  plantSpread: number;
  harvestSpread: number;
}

/** Populations (base and/or variants) of a commodity grown in a region, shifted to `lat`. */
function populations(commodity: MapCommodity, region: string, lat: number): Population[] {
  const e = CROP_CALENDAR[commodity];
  if (!e) return [];
  if (e.maxLat !== undefined && lat > e.maxLat) return [];
  const code = region.toUpperCase();
  const plantShift = e.plantShiftDaysPerDegree ?? e.shiftDaysPerDegree;
  const out: Population[] = [];
  if (e.regions.includes(code)) {
    out.push({
      plantPeak: e.plantPeakDoy + plantShift * (lat - e.referenceLat),
      harvestPeak: e.harvestPeakDoy + e.shiftDaysPerDegree * (lat - e.referenceLat),
      plantSpread: e.plantSpreadDays,
      harvestSpread: e.harvestSpreadDays,
    });
  }
  for (const v of e.variants ?? []) {
    if (!v.regions.includes(code)) continue;
    // Variants are single-season crops, so planting shifts with the harvest shift.
    out.push({
      plantPeak: v.plantPeakDoy + e.shiftDaysPerDegree * (lat - v.referenceLat),
      harvestPeak: v.harvestPeakDoy + e.shiftDaysPerDegree * (lat - v.referenceLat),
      plantSpread: e.plantSpreadDays,
      harvestSpread: e.harvestSpreadDays,
    });
  }
  return out;
}

function populationValue(p: Population, doy: number): number {
  const v = bell(doy, p.harvestPeak, p.harvestSpread) - bell(doy, p.plantPeak, p.plantSpread);
  return Math.max(-1, Math.min(1, v));
}

/** Whether a commodity is grown in a region at all (base or any variant). */
export function isGrownIn(commodity: MapCommodity, region: string): boolean {
  const e = CROP_CALENDAR[commodity];
  const code = region.toUpperCase();
  return e.regions.includes(code) || (e.variants ?? []).some((v) => v.regions.includes(code));
}

/** All region codes where a commodity is grown (base + variants, de-duplicated). */
export function growingRegions(commodity: MapCommodity): string[] {
  const e = CROP_CALENDAR[commodity];
  return Array.from(new Set([...e.regions, ...(e.variants ?? []).flatMap((v) => v.regions)]));
}

/* ---------------------------------------------------------------- public API */

/**
 * −1 = planting peak, 0 = growing / off-season, +1 = harvest peak. null = not grown there.
 * Where two populations overlap (e.g. winter and spring wheat in MT/SD), the
 * stronger signal wins.
 */
export function phaseValue(commodity: MapCommodity, region: string, lat: number, date: Date): number | null {
  const pops = populations(commodity, region, lat);
  if (!pops.length) return null;
  const doy = dayOfYear(date);
  let best = 0;
  for (const p of pops) {
    const v = populationValue(p, doy);
    if (Math.abs(v) > Math.abs(best)) best = v;
  }
  return best;
}

/** Human label for a phase value. Thresholds: |v| ≥ 0.8 peak, ≥ 0.5 active window. */
export function phaseLabel(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "Not grown";
  if (value <= -0.8) return "Planting peak";
  if (value <= -0.5) return "Planting";
  if (value >= 0.8) return "Harvest peak";
  if (value >= 0.5) return "Harvest";
  return "Growing / off-season";
}

function windowAround(year: number, peakDoy: number, spread: number): { start: Date; end: Date } {
  const jan1 = Date.UTC(year, 0, 1);
  const at = (doy: number) => {
    const d = new Date(jan1 + Math.round(doy - 1) * DAY_MS);
    return d;
  };
  return { start: at(peakDoy - spread), end: at(peakDoy + spread) };
}

/**
 * Estimated harvest window (peak ± spread) for the given calendar year.
 * Uses the base population where present, otherwise the first matching variant.
 */
export function harvestWindow(
  commodity: MapCommodity,
  region: string,
  lat: number,
  year: number,
): { start: Date; end: Date } | null {
  const p = populations(commodity, region, lat)[0];
  return p ? windowAround(year, p.harvestPeak, p.harvestSpread) : null;
}

/**
 * Estimated planting window (peak ± spread) for the given calendar year.
 * Uses the base population where present, otherwise the first matching variant.
 */
export function plantingWindow(
  commodity: MapCommodity,
  region: string,
  lat: number,
  year: number,
): { start: Date; end: Date } | null {
  const p = populations(commodity, region, lat)[0];
  return p ? windowAround(year, p.plantPeak, p.plantSpread) : null;
}
