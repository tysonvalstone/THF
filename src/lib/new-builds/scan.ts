/**
 * Simulated "scan" of public sources for new and expanding facilities.
 *
 * Mock only: nothing is fetched. Results are generated deterministically from
 * the as-of date (the time-travel date), so the same date always "finds" the
 * same 1–3 projects, and a second scan on the same date finds nothing new.
 */
import { TOWNS } from "@/data/reference/towns";
import { REGION_BY_STATE } from "@/data/reference/regions";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import type { FacilityType, NewBuild, NewBuildStage, RegionId, Segment } from "@/types/salesforce";

export interface ScanSource {
  name: string;
  detail: string;
}

/** The sources a scan walks through, in order */
export const SCAN_SOURCES: ScanSource[] = [
  { name: "State air permit applications", detail: "Construction permit filed with the state environmental agency" },
  { name: "County board minutes", detail: "Conditional-use permit approved at the county board meeting" },
  { name: "Trade press", detail: "Reported in a regional agribusiness trade publication" },
  { name: "USDA grant announcements", detail: "Named in a USDA rural energy and infrastructure grant round" },
  { name: "Economic development releases", detail: "Announced by the state economic development office" },
  { name: "Rail spur filings", detail: "Industry track agreement filed with the serving railroad" },
];

/** Source label as stored on NewBuild.Source (matches the seeded records) */
const SOURCE_LABEL = ["State air permit application", "County board minutes", "Trade press", "USDA grant announcement", "Economic development release", "Rail spur filing"];

export function sourceIndex(source: string): number {
  const i = SOURCE_LABEL.indexOf(source);
  return i >= 0 ? i : SCAN_SOURCES.findIndex((s) => s.name === source);
}

export const NEW_BUILD_STAGES: NewBuildStage[] = ["Announced", "Permitting", "Under Construction", "Commissioning"];

const SPECS: { segment: Segment; type: FacilityType; states: string[]; unit: NewBuild["Capacity_Unit"]; cap: [number, number]; invest: [number, number]; names: string[]; what: string }[] = [
  { segment: "Ethanol Plant", type: "Ethanol Plant", states: ["IA", "NE", "SD", "MN", "IN", "ND"], unit: "gal/yr", cap: [60e6, 150e6], invest: [140e6, 260e6], names: ["Renewable Fuels", "Bioenergy", "Clean Fuels LLC", "Ethanol Partners"], what: "ethanol plant" },
  { segment: "Rail/Shuttle Loader", type: "Grain Elevator", states: ["KS", "NE", "ND", "SD", "IA", "IL"], unit: "bu", cap: [3e6, 8e6], invest: [28e6, 55e6], names: ["Grain Terminal", "Shuttle Loading", "Rail Grain LLC"], what: "110-car shuttle loader" },
  { segment: "Feed Mill", type: "Feed Mill", states: ["IA", "MN", "NC", "IN", "OH", "MO"], unit: "tons/yr", cap: [150e3, 450e3], invest: [30e6, 70e6], names: ["Feeds", "Nutrition", "Feed Mill LLC"], what: "feed mill" },
  { segment: "Processor", type: "Oilseed Crusher", states: ["ND", "IA", "KS", "SK", "MN"], unit: "tons/yr", cap: [800e3, 1.6e6], invest: [300e6, 550e6], names: ["Crush", "Oilseed Processing", "Soy Processing"], what: "soybean crush plant" },
  { segment: "Multi-Location Co-op", type: "Cooperative", states: ["IA", "IL", "MN", "NE"], unit: "bu", cap: [2e6, 5e6], invest: [18e6, 40e6], names: ["Cooperative", "Farmers Co-op"], what: "co-op receiving expansion" },
  { segment: "Country Elevator", type: "Grain Elevator", states: ["IL", "IN", "OH", "MO"], unit: "bu", cap: [1e6, 3e6], invest: [9e6, 20e6], names: ["Grain Co.", "Grain LLC"], what: "new country elevator" },
];

/** Stable 0–1 value for a key (FNV-1a + avalanche) */
export function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const pick = <T>(arr: readonly T[], key: string): T => arr[Math.floor(hash01(key) * arr.length) % arr.length];

export function capacityText(nb: Pick<NewBuild, "Capacity" | "Capacity_Unit">): string {
  if (nb.Capacity_Unit === "gal/yr") return `${Math.round(nb.Capacity / 1e6)}M gal/yr`;
  if (nb.Capacity_Unit === "bu") return `${(nb.Capacity / 1e6).toFixed(1)}M bu`;
  return nb.Capacity >= 1e6 ? `${+(nb.Capacity / 1e6).toFixed(2)}M tons/yr` : `${Math.round(nb.Capacity / 1e3)}K tons/yr`;
}

function summaryFor(company: string, capText: string, what: string, town: string, state: string, stage: NewBuildStage): string {
  const tail =
    stage === "Announced"
      ? "Newly announced; no software vendor selected yet."
      : stage === "Permitting"
        ? "In permitting; the owner is lining up vendors."
        : stage === "Under Construction"
          ? "Under construction; scale house and office systems are being specified."
          : "Commissioning; receiving starts soon.";
  return `${company} plans a ${capText} ${what} near ${town}, ${state}. ${tail}`;
}

export type ScannedBuild = Omit<NewBuild, "Id">;

/**
 * The new builds a scan on `asOfISO` finds (1–3), minus any already in
 * `existing` (same name), so re-scanning the same date finds nothing new.
 */
export function scanNewBuilds(asOfISO: string, existing: Pick<NewBuild, "Name">[] = []): ScannedBuild[] {
  const asOf = parseDate(asOfISO);
  const seed = `scan:${asOfISO}`;
  const count = 1 + Math.floor(hash01(`${seed}:count`) * 3);
  const names = new Set(existing.map((e) => e.Name));
  const out: ScannedBuild[] = [];
  for (let k = 0; k < count; k++) {
    const key = `${seed}:${k}`;
    const spec = pick(SPECS, `${key}:spec`);
    const state = pick(spec.states, `${key}:state`);
    const towns = TOWNS.filter((t) => t.state === state);
    if (!towns.length) continue;
    const town = pick(towns, `${key}:town`);
    // Fresh finds are mostly early-stage
    const stage: NewBuildStage = hash01(`${key}:stage`) < 0.6 ? "Announced" : hash01(`${key}:stage2`) < 0.75 ? "Permitting" : "Under Construction";
    const announced = addDays(asOf, -Math.floor(hash01(`${key}:ago`) * 10));
    const months = stage === "Announced" ? 26 : stage === "Permitting" ? 22 : 12;
    const cap = spec.cap[0] + hash01(`${key}:cap`) * (spec.cap[1] - spec.cap[0]);
    const capacity = spec.unit === "gal/yr" ? Math.round(cap / 5e6) * 5e6 : spec.unit === "bu" ? Math.round(cap / 1e5) * 1e5 : Math.round(cap / 1e4) * 1e4;
    const invest = Math.round((spec.invest[0] + hash01(`${key}:inv`) * (spec.invest[1] - spec.invest[0])) / 1e6) * 1e6;
    const si = Math.floor(hash01(`${key}:src`) * SCAN_SOURCES.length) % SCAN_SOURCES.length;
    const company = `${town.name} ${pick(spec.names, `${key}:name`)}`;
    const name = `${company} ${spec.what}`;
    if (names.has(name) || out.some((o) => o.Name === name)) continue;
    const jitter = (h: string) => (hash01(`${key}:${h}`) - 0.5) * 0.18;
    const capText =
      spec.unit === "gal/yr" ? `${Math.round(capacity / 1e6)} million gallons a year` : spec.unit === "bu" ? `${(capacity / 1e6).toFixed(1)} million bushels of storage` : `${capacity.toLocaleString("en-US")} tons a year`;
    out.push({
      Name: name,
      Company: company,
      Facility_Type__c: spec.type,
      Segment__c: spec.segment,
      City: town.name,
      State: state,
      Country: ["SK", "MB", "AB", "ON"].includes(state) ? "Canada" : "United States",
      Latitude: +(town.lat + jitter("lat")).toFixed(4),
      Longitude: +(town.lon + jitter("lon")).toFixed(4),
      Region__c: (REGION_BY_STATE[state] ?? "western-corn-belt") as RegionId,
      Stage: stage,
      Status: "New",
      Capacity: capacity,
      Capacity_Unit: spec.unit,
      Estimated_Investment: invest,
      Announced_Date: toISODate(announced),
      Expected_Completion: toISODate(addDays(announced, months * 30)),
      Source: SOURCE_LABEL[si],
      Source_Detail: SCAN_SOURCES[si].detail,
      Summary: summaryFor(company, capText, spec.what, town.name, state, stage),
    });
  }
  return out;
}
