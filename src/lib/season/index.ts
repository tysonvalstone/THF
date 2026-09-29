import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { CLIMATE_SIGNALS } from "@/data/reference/climate";
import type { ClimateSignal, CropWindow, Region } from "@/types/reference";
import type { Commodity, FacilityType, RegionId } from "@/types/salesforce";
import { addDays, diffDays } from "@/lib/dates";

/** "Soybeans" → "Soybean" for use before a noun ("soybean harvest") */
export function cropNoun(c: Commodity): string {
  if (c === "Soybeans") return "Soybean";
  if (c === "Pulses") return "Pulse";
  return c.replace(" Wheat", " wheat");
}

export type Phase ="Planting" | "Growing" | "Pre-harvest" | "Harvest" | "Post-harvest" | "Dormant";

export const PHASE_ORDER: Phase[] = ["Pre-harvest", "Harvest", "Post-harvest", "Planting", "Growing", "Dormant"];

const PHASE_SALIENCE: Record<Phase, number> = {
  Harvest: 1,
  "Pre-harvest": 0.95,
  Planting: 0.7,
  "Post-harvest": 0.6,
  Growing: 0.4,
  Dormant: 0.2,
};

export function climateFor(regionId: RegionId, year: number): ClimateSignal {
  return (
    CLIMATE_SIGNALS.find((c) => c.regionId === regionId && c.year === year) ?? {
      regionId,
      year,
      condition: "Normal",
      harvestShiftDays: 0,
      yieldIndex: 1,
      note: "Normal season.",
    }
  );
}

function md(year: number, monthDay: string): Date {
  const [m, d] = monthDay.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, d));
}

export interface HarvestWindow {
  commodity: Commodity;
  /** Calendar year the harvest happens in */
  year: number;
  plantStart: Date;
  plantEnd: Date;
  start: Date;
  end: Date;
  climate: ClimateSignal;
}

/** Harvest windows for a crop in the years around `asOf`, with climate shifts applied. */
export function harvestWindows(regionId: RegionId, crop: CropWindow, asOf: Date): HarvestWindow[] {
  const y = asOf.getUTCFullYear();
  const plantedYearBefore = Number(crop.plantStart.slice(0, 2)) > Number(crop.harvestStart.slice(0, 2));
  return [y - 1, y, y + 1].map((year) => {
    const climate = climateFor(regionId, year);
    const plantYear = plantedYearBefore ? year - 1 : year;
    return {
      commodity: crop.commodity,
      year,
      plantStart: md(plantYear, crop.plantStart),
      plantEnd: md(plantYear, crop.plantEnd),
      start: addDays(md(year, crop.harvestStart), climate.harvestShiftDays),
      end: addDays(md(year, crop.harvestEnd), climate.harvestShiftDays),
      climate,
    };
  });
}

export interface CropStatus {
  regionId: RegionId;
  commodity: Commodity;
  importance: number;
  phase: Phase;
  /** Current harvest window if in harvest, otherwise the next one */
  window: HarvestWindow;
  lastWindow?: HarvestWindow;
  /** Days until next harvest starts (0 while harvesting) */
  daysToHarvest: number;
  daysSinceHarvestEnd?: number;
  /** 0–1 while harvesting */
  harvestProgress?: number;
  /** Ideal campaign launch: 6 → 4 weeks before harvest starts */
  launchStart: Date;
  launchEnd: Date;
}

export function cropStatus(regionId: RegionId, crop: CropWindow, asOf: Date): CropStatus {
  const windows = harvestWindows(regionId, crop, asOf);
  const current = windows.find((w) => asOf >= w.start && asOf <= w.end);
  const next = windows.find((w) => w.start > asOf) ?? windows[windows.length - 1];
  const last = [...windows].reverse().find((w) => w.end < asOf);
  const window = current ?? next;
  const daysToHarvest = current ? 0 : diffDays(next.start, asOf);
  const daysSinceHarvestEnd = last ? diffDays(asOf, last.end) : undefined;

  let phase: Phase;
  if (current) phase = "Harvest";
  else if (daysToHarvest <= 60) phase = "Pre-harvest";
  else if (daysSinceHarvestEnd !== undefined && daysSinceHarvestEnd <= 75) phase = "Post-harvest";
  else if (asOf >= next.plantStart && asOf <= next.plantEnd) phase = "Planting";
  else if (asOf > next.plantEnd) phase = "Growing";
  else phase = "Dormant";

  return {
    regionId,
    commodity: crop.commodity,
    importance: crop.importance,
    phase,
    window,
    lastWindow: last,
    daysToHarvest,
    daysSinceHarvestEnd,
    harvestProgress: current
      ? Math.min(1, Math.max(0, diffDays(asOf, current.start) / Math.max(1, diffDays(current.end, current.start))))
      : undefined,
    launchStart: addDays(window.start, -42),
    launchEnd: addDays(window.start, -28),
  };
}

export interface RegionStatus {
  region: Region;
  headline: CropStatus;
  crops: CropStatus[];
  climate: ClimateSignal;
}

export function regionStatus(regionId: RegionId, asOf: Date): RegionStatus {
  const region = REGION_BY_ID[regionId];
  const crops = region.crops
    .map((c) => cropStatus(regionId, c, asOf))
    .sort((a, b) => PHASE_SALIENCE[b.phase] * b.importance - PHASE_SALIENCE[a.phase] * a.importance);
  const headline = crops[0];
  return { region, headline, crops, climate: headline.window.climate };
}

export function allRegionStatuses(asOf: Date): RegionStatus[] {
  return REGIONS.map((r) => regionStatus(r.id, asOf));
}

/** Short label like "Corn harvest · week 2" or "Canola harvest in 3 wks" */
export function cropStatusLabel(s: CropStatus): string {
  switch (s.phase) {
    case "Harvest": {
      const week = Math.floor((s.harvestProgress ?? 0) * (diffDays(s.window.end, s.window.start) / 7)) + 1;
      return `${cropNoun(s.commodity)} harvest · week ${week}`;
    }
    case "Pre-harvest":
      return `${cropNoun(s.commodity)} harvest in ${Math.max(1, Math.round(s.daysToHarvest / 7))} wk${s.daysToHarvest >= 11 ? "s" : ""}`;
    case "Post-harvest":
      return `${s.commodity} post-harvest`;
    case "Planting":
      return `${s.commodity} planting`;
    case "Growing":
      return `${s.commodity} growing`;
    default:
      return `${s.commodity} off-season`;
  }
}

// ---------------------------------------------------------------------------
// Busy windows by facility type — when a facility is slammed, and therefore
// when to reach it (just before) and when not to (during).
// ---------------------------------------------------------------------------

export interface BusyWindow {
  kind: "harvest" | "spring-application" | "fall-application" | "feeding-season";
  label: string;
  commodity?: Commodity;
  start: Date;
  end: Date;
  importance: number;
  climate?: ClimateSignal;
}

const GRAIN_TYPES: FacilityType[] = ["Grain Elevator", "Cooperative", "Seed Processor", "Oilseed Crusher", "Flour Mill"];

export function busyWindows(
  entity: { Region__c: RegionId; Facility_Type__c: FacilityType; Primary_Commodities__c: Commodity[] },
  asOf: Date,
): BusyWindow[] {
  const region = REGION_BY_ID[entity.Region__c];
  const type = entity.Facility_Type__c;
  const out: BusyWindow[] = [];

  if (GRAIN_TYPES.includes(type) || type === "Ethanol Plant") {
    const crops = region.crops.filter((c) => entity.Primary_Commodities__c.includes(c.commodity));
    for (const crop of crops) {
      const verb = type === "Oilseed Crusher" || type === "Flour Mill" || type === "Ethanol Plant" ? "new-crop" : "harvest";
      for (const w of harvestWindows(region.id, crop, asOf)) {
        out.push({
          kind: "harvest",
          label: verb === "harvest" ? `${cropNoun(crop.commodity)} harvest` : `New-crop ${cropNoun(crop.commodity).toLowerCase()} buying`,
          commodity: crop.commodity,
          start: w.start,
          end: w.end,
          importance: type === "Ethanol Plant" ? 0.5 : Math.max(0.5, crop.importance),
          climate: w.climate,
        });
      }
    }
  }

  if (type === "Agronomy Retailer" || type === "Cooperative") {
    const major = region.crops.filter((c) => c.importance >= 0.5 && Number(c.plantStart.slice(0, 2)) <= 6);
    const main = [...region.crops].sort((a, b) => b.importance - a.importance)[0];
    const y = asOf.getUTCFullYear();
    for (const year of [y - 1, y, y + 1]) {
      if (major.length) {
        const starts = major.map((c) => md(year, c.plantStart).getTime());
        const ends = major.map((c) => md(year, c.plantEnd).getTime());
        out.push({
          kind: "spring-application",
          label: "Spring application & seed delivery",
          start: addDays(new Date(Math.min(...starts)), -30),
          end: new Date(Math.max(...ends)),
          importance: type === "Agronomy Retailer" ? 1 : 0.6,
        });
      }
      const climate = climateFor(region.id, year);
      out.push({
        kind: "fall-application",
        label: "Fall fertilizer application",
        start: addDays(md(year, main.harvestStart), 21 + climate.harvestShiftDays),
        end: addDays(md(year, main.harvestEnd), 21 + climate.harvestShiftDays),
        importance: type === "Agronomy Retailer" ? 0.8 : 0.4,
        climate,
      });
    }
  }

  if (type === "Feed Mill") {
    const y = asOf.getUTCFullYear();
    for (const year of [y - 1, y]) {
      out.push({
        kind: "feeding-season",
        label: "Winter feeding season",
        start: new Date(Date.UTC(year, 10, 1)),
        end: new Date(Date.UTC(year + 1, 2, 31)),
        importance: 0.7,
      });
    }
  }
  return out.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export interface WindowPosition {
  window: BusyWindow;
  state: "before" | "during" | "after";
  /** days until start (before), into window (during) or since end (after) */
  days: number;
}

/** Where `asOf` sits relative to each distinct busy-window series (nearest instance). */
export function windowPositions(windows: BusyWindow[], asOf: Date): WindowPosition[] {
  const byLabel = new Map<string, BusyWindow[]>();
  for (const w of windows) byLabel.set(w.label, [...(byLabel.get(w.label) ?? []), w]);
  const out: WindowPosition[] = [];
  for (const list of byLabel.values()) {
    const during = list.find((w) => asOf >= w.start && asOf <= w.end);
    if (during) {
      out.push({ window: during, state: "during", days: diffDays(asOf, during.start) });
      continue;
    }
    const next = list.find((w) => w.start > asOf);
    const last = [...list].reverse().find((w) => w.end < asOf);
    const daysToNext = next ? diffDays(next.start, asOf) : Infinity;
    const daysSinceLast = last ? diffDays(asOf, last.end) : Infinity;
    if (last && daysSinceLast <= 75 && (daysToNext > 56 || !next)) {
      out.push({ window: last, state: "after", days: daysSinceLast });
    } else if (next) {
      out.push({ window: next, state: "before", days: daysToNext });
    }
  }
  return out;
}
