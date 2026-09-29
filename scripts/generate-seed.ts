/**
 * Deterministic mock-data generator.
 *
 *   npm run seed
 *
 * Writes Salesforce-shaped JSON to src/data/seed/. Same seed → same data, so
 * the files can be committed and hand-edited. Re-running overwrites them.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REGIONS, REGION_BY_STATE } from "../src/data/reference/regions";
import { TOWNS } from "../src/data/reference/towns";
import { AREA_CODES, POSTAL_FSA_LETTER, ZIP_PREFIX, CANADIAN_PROVINCES } from "../src/data/reference/geo";
import { SOFTWARE_VENDORS } from "../src/data/reference/software";
import { PRODUCTS } from "../src/data/reference/products";
import { USERS, ownerForRegion, CURRENT_USER_ID } from "../src/data/reference/users";
import type {
  Account,
  BuyingRole,
  Campaign,
  CampaignMember,
  Commodity,
  Contact,
  Event,
  FacilityType,
  Lead,
  LeadSource,
  LivestockFocus,
  Opportunity,
  OpportunityLineItem,
  OpportunityStage,
  RegionId,
  Task,
} from "../src/types/salesforce";
import type { PriceSeries, PriceSeriesKey } from "../src/types/reference";
import { SEGMENTS, OPEN_STAGES, type Segment } from "../src/types/salesforce";
import countiesTopoJson from "us-atlas/counties-10m.json";
import { writeExportTemplates } from "./prebuilt/exports";
import { writeSequences } from "./prebuilt/sequences";
import { feature } from "topojson-client";
import { geoCentroid } from "d3-geo";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { FeatureCollection, Geometry } from "geojson";

const OUT_DIR = join(__dirname, "..", "src", "data", "seed");
/** Demo "today". Activity history covers the 12 months before this date. */
const ANCHOR = new Date(Date.UTC(2026, 8, 29));
const HISTORY_START = new Date(Date.UTC(2025, 9, 1));

// ---------------------------------------------------------------------------
// Random helpers (mulberry32)
// ---------------------------------------------------------------------------
let rngState = 20260929;
function rand(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function weighted<T>(pairs: [T, number][]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
function sample<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}
/** Log-uniform between min and max */
const logUniform = (min: number, max: number) => Math.exp(Math.log(min) + rand() * (Math.log(max) - Math.log(min)));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
const DAY = 86_400_000;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const isoDateTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, ".000+0000");
function randomDateBetween(a: Date, b: Date): Date {
  return new Date(a.getTime() + rand() * (b.getTime() - a.getTime()));
}
function workHours(d: Date): Date {
  const x = new Date(d);
  // Business hours in Central time (~UTC-5)
  x.setUTCHours(int(13, 22), pick([0, 15, 30, 45]), 0, 0);
  // Push weekend dates to Monday
  const dow = x.getUTCDay();
  if (dow === 0) return addDays(x, 1);
  if (dow === 6) return addDays(x, 2);
  return x;
}

// ---------------------------------------------------------------------------
// Salesforce-style 18-char Ids
// ---------------------------------------------------------------------------
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const counters: Record<string, number> = {};
function sfId(prefix: string): string {
  counters[prefix] = (counters[prefix] ?? 0) + 1;
  let n = counters[prefix];
  let s = "";
  while (n > 0) {
    s = B62[n % 62] + s;
    n = Math.floor(n / 62);
  }
  return `${prefix}Hs${s.padStart(10, "0")}AAC`.slice(0, 18);
}

// ---------------------------------------------------------------------------
// Name pools (fictional companies; common first/last names)
// ---------------------------------------------------------------------------
const PREFIXES = [
  "Bluestem", "Northfork", "Tallgrass", "Cottonwood", "Big Sky", "Ridgeline", "Stonebridge", "Lone Tree",
  "Willow Creek", "Prairie Wind", "Golden Spike", "Twin Rivers", "Bur Oak", "Meadowlark", "Clearwater",
  "Sandhill", "Iron Horse", "High Line", "Red Cedar", "Coteau", "Kettle River", "Buffalo Ridge",
  "Loess Hills", "Pheasant Run", "Silver Creek", "Black Earth", "Cedar Bend", "Harvest Moon", "Eagle Butte",
  "Wheatland", "Parkland", "Aspen Grove", "Chinook", "Tri-County", "Crossroads", "Summit Ridge", "Deer Creek",
  "Timber Lake", "Grassland", "Blue Earth", "Sunflower", "Prairie Rose", "North Star", "Morning Star",
  "Kaw Valley", "Walnut Grove", "Oak Hollow", "Rolling Hills", "Plainsman", "Frontier", "Homestead",
  "Heritage Ridge", "Railside", "Sod House", "Coyote Ridge", "Grand Prairie", "Long Branch", "Spring Valley",
  "Elkhorn", "Tamarack", "Big Bend", "Three Forks", "Hackberry", "Osage", "Quail Hollow", "Stillwater",
  "Driftwood", "Southwind", "Juniper", "Flint Hills", "Keystone Valley", "Ironwood", "Harvest Line",
  "Granite Falls", "Copper Creek", "Maple Ridge", "Old Mill", "Riverbend", "Hilltop", "Lakeshore",
];
const SURNAMES = [
  "Olson", "Johnson", "Schmidt", "Miller", "Anderson", "Peterson", "Hansen", "Larson", "Nelson", "Weber",
  "Fischer", "Meyer", "Becker", "Wagner", "Hoffman", "Schroeder", "Klein", "Kruse", "Thompson", "Brandt",
  "Vogel", "Dykstra", "Janzen", "Friesen", "Penner", "Bergen", "Harms", "Koehn", "Stoltzfus", "Zimmerman",
  "Reimer", "Martens", "Sorensen", "Lindgren", "Haugen", "Eckert", "Baumann", "Carlson", "Dahl", "Moore",
  "Walker", "Mitchell", "Jackson", "Bishop", "Crawford", "Hughes", "Porter", "Rhodes", "Sutton", "Wade",
  "Garcia", "Hernandez", "Lopez", "Nguyen", "Patel", "Singh", "Kim", "Chen", "Okafor", "Mensah",
  "Tremblay", "Gagnon", "Roy", "Bouchard", "Gauthier", "Morin", "Lavoie", "Pelletier",
];
const FIRST_NAMES = [
  "Mark", "Steve", "Brian", "Kevin", "Jason", "Todd", "Chad", "Ryan", "Travis", "Dustin", "Kyle", "Brent",
  "Scott", "Doug", "Randy", "Curtis", "Wade", "Cody", "Derek", "Nathan", "Aaron", "Luis", "Carlos", "Raj",
  "Karen", "Lisa", "Jennifer", "Amy", "Sarah", "Heather", "Melissa", "Angela", "Kristin", "Megan", "Jill",
  "Brenda", "Tammy", "Rachel", "Katie", "Laura", "Nicole", "Maria", "Priya", "Grace", "Hannah", "Jess",
  "Colton", "Garrett", "Tanner", "Levi", "Wyatt", "Brooke", "Paige", "Shelby", "Morgan", "Taylor",
];
const QC_FIRST = ["Marc", "Luc", "Stéphane", "Mathieu", "Julie", "Isabelle", "Nathalie", "Sylvie", "François", "Guillaume"];
const QC_LAST = ["Tremblay", "Gagnon", "Roy", "Côté", "Bouchard", "Gauthier", "Morin", "Lavoie", "Fortin", "Pelletier", "Bélanger", "Lévesque"];

const STREETS = [
  "Elevator Rd", "Railroad St", "Depot St", "Industrial Dr", "Mill St", "Grain Terminal Rd", "County Rd",
  "Hwy", "Front St", "Commerce Dr", "Co-op Rd", "Main St", "Frontage Rd", "Ag Park Dr",
];

// ---------------------------------------------------------------------------
// Facility mix by region
// ---------------------------------------------------------------------------
const TYPE_WEIGHTS: Record<RegionId, [FacilityType, number][]> = {
  "southern-plains": [["Grain Elevator", 36], ["Cooperative", 14], ["Feed Mill", 12], ["Flour Mill", 7], ["Ethanol Plant", 5], ["Seed Processor", 5], ["Oilseed Crusher", 1]],
  "northern-plains": [["Grain Elevator", 34], ["Cooperative", 12], ["Ethanol Plant", 8], ["Oilseed Crusher", 5], ["Flour Mill", 4], ["Seed Processor", 10], ["Feed Mill", 3]],
  "western-corn-belt": [["Grain Elevator", 30], ["Cooperative", 14], ["Ethanol Plant", 16], ["Feed Mill", 12], ["Oilseed Crusher", 5], ["Seed Processor", 8]],
  "eastern-corn-belt": [["Grain Elevator", 34], ["Cooperative", 10], ["Ethanol Plant", 12], ["Feed Mill", 8], ["Oilseed Crusher", 6], ["Flour Mill", 3], ["Seed Processor", 8]],
  "great-lakes": [["Grain Elevator", 26], ["Cooperative", 12], ["Feed Mill", 28], ["Ethanol Plant", 8], ["Seed Processor", 6]],
  delta: [["Grain Elevator", 36], ["Feed Mill", 22], ["Seed Processor", 8], ["Cooperative", 8], ["Oilseed Crusher", 4], ["Flour Mill", 2]],
  southeast: [["Feed Mill", 50], ["Grain Elevator", 22], ["Cooperative", 6], ["Flour Mill", 3], ["Oilseed Crusher", 2]],
  "mid-atlantic": [["Feed Mill", 48], ["Grain Elevator", 22], ["Cooperative", 8], ["Flour Mill", 4], ["Seed Processor", 2]],
  "pacific-northwest": [["Grain Elevator", 34], ["Cooperative", 18], ["Flour Mill", 8], ["Seed Processor", 12], ["Feed Mill", 10]],
  "western-prairies": [["Grain Elevator", 36], ["Oilseed Crusher", 7], ["Seed Processor", 12], ["Cooperative", 8], ["Flour Mill", 4], ["Feed Mill", 7], ["Ethanol Plant", 2]],
  manitoba: [["Grain Elevator", 34], ["Oilseed Crusher", 6], ["Seed Processor", 12], ["Cooperative", 8], ["Feed Mill", 12], ["Flour Mill", 3], ["Ethanol Plant", 2]],
  "central-canada": [["Grain Elevator", 28], ["Feed Mill", 26], ["Cooperative", 12], ["Ethanol Plant", 6], ["Oilseed Crusher", 4], ["Flour Mill", 3], ["Seed Processor", 5]],
};

function commoditiesFor(type: FacilityType, regionId: RegionId): Commodity[] {
  const region = REGIONS.find((r) => r.id === regionId)!;
  const crops = region.crops.map((c) => c.commodity);
  switch (type) {
    case "Ethanol Plant":
      return crops.includes("Sorghum") && chance(0.5) ? ["Corn", "Sorghum"] : ["Corn"];
    case "Oilseed Crusher":
      return crops.includes("Canola") ? ["Canola"] : ["Soybeans"];
    case "Flour Mill": {
      const wheats = crops.filter((c) => c.includes("Wheat"));
      return wheats.length ? wheats.slice(0, 2) : ["Winter Wheat"];
    }
    case "Feed Mill":
      return crops.includes("Corn") ? ["Corn", "Soybeans"] : ["Barley", "Spring Wheat"].filter((c) => crops.includes(c as Commodity)) as Commodity[];
    default: {
      const weightedCrops = region.crops.map((c) => [c.commodity, c.importance] as [Commodity, number]);
      const n = Math.min(crops.length, type === "Cooperative" ? int(2, 4) : int(1, 3));
      const out = new Set<Commodity>();
      let guard = 0;
      while (out.size < n && guard++ < 30) out.add(weighted(weightedCrops));
      return [...out];
    }
  }
}

function companyName(type: FacilityType, state: string, used: Set<string>): string {
  for (let i = 0; i < 200; i++) {
    const p = pick(PREFIXES);
    const s = pick(SURNAMES);
    let name: string;
    if (state === "QC") {
      name = {
        "Grain Elevator": `Grains ${p} inc.`,
        Cooperative: `Coopérative agricole ${p}`,
        "Ethanol Plant": `Éthanol ${p} inc.`,
        "Feed Mill": `Meunerie ${pick(QC_LAST)} inc.`,
        "Oilseed Crusher": `Trituration ${p} inc.`,
        "Flour Mill": `Minoterie ${p}`,
        "Seed Processor": `Semences ${pick(QC_LAST)} inc.`,
        "Agronomy Retailer": `Agrocentre ${p}`,
      }[type];
    } else {
      const ca = CANADIAN_PROVINCES.includes(state);
      const options: Record<FacilityType, string[]> = {
        "Grain Elevator": [`${p} Grain`, `${p} Grain & Elevator`, `${p} Elevator Co.`, `${s} Grain LLC`, `${s} Bros. Grain`, ca ? `${p} Grain Ltd.` : `${p} Grain Co.`],
        Cooperative: [`${p} Cooperative`, `${p} Farmers Co-op`, `${p} Ag Cooperative`, `${p} Co-op Association`],
        "Ethanol Plant": [`${p} Renewable Fuels`, `${p} Energy LLC`, `${p} Ethanol`, `${p} Bio-Refining`],
        "Feed Mill": [`${p} Feeds`, `${s} Feed & Grain`, `${p} Nutrition`, `${p} Feed Mill`, `${s} Mill Inc.`],
        "Oilseed Crusher": ca ? [`${p} Canola Crushing`, `${p} Oilseeds Ltd.`] : [`${p} Soy Processors`, `${p} Oilseed Processing`, `${p} Crush LLC`],
        "Flour Mill": [`${p} Milling Co.`, `${p} Flour Mills`, `${s} Milling`],
        "Seed Processor": [`${p} Seed Co.`, `${s} Seeds`, `${p} Seed Cleaning`, `${s} Seed & Pulse`],
        "Agronomy Retailer": [`${p} Agronomy`, `${p} Crop Services`, `${p} Ag Supply`, `${s} Fertilizer & Chemical`],
      };
      name = pick(options[type]);
    }
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  throw new Error("Ran out of unique company names");
}

const slug = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");

function domainFor(name: string): string {
  const base = slug(name.replace(/\b(LLC|Inc\.?|inc\.|Ltd\.|Co\.|Company|Association)\b/g, ""));
  return `${base.slice(0, 22)}.com`;
}

function phone(state: string): string {
  const ac = pick(AREA_CODES[state] ?? ["555"]);
  return `(${ac}) 555-01${String(int(0, 99)).padStart(2, "0")}`;
}

function postalCode(state: string): string {
  if (CANADIAN_PROVINCES.includes(state)) {
    const L = "ABCEGHJKLMNPRSTVWXYZ";
    const letter = pick(POSTAL_FSA_LETTER[state] ?? ["X"]);
    return `${letter}${int(0, 9)}${pick([...L])} ${int(0, 9)}${pick([...L])}${int(0, 9)}`;
  }
  const [a, b] = ZIP_PREFIX[state] ?? [100, 999];
  return `${int(a, b)}${String(int(1, 99)).padStart(2, "0")}`;
}

function street(): string {
  const st = pick(STREETS);
  if (st === "County Rd") return `${int(1000, 3999)} County Rd ${int(4, 60)}`;
  if (st === "Hwy") return `${int(100, 29999)} Hwy ${int(2, 281)}`;
  return `${int(100, 2400)} ${st}`;
}

const personName = (state: string) =>
  state === "QC" ? { first: pick(QC_FIRST), last: pick(QC_LAST) } : { first: pick(FIRST_NAMES), last: pick(SURNAMES) };

// ---------------------------------------------------------------------------
// Size, revenue and descriptions
// ---------------------------------------------------------------------------
interface Size {
  storage?: number;
  gallons?: number;
  tons?: number;
  locations: number;
  revenue: number;
  employees: number;
}

function sizeFor(type: FacilityType): Size {
  switch (type) {
    case "Grain Elevator": {
      const storage = roundTo(logUniform(400_000, 14_000_000), 50_000);
      const locations = storage > 6e6 ? int(3, 8) : storage > 2e6 ? int(1, 4) : 1;
      return { storage, locations, revenue: roundTo(storage * 2.4 * 5.2, 100_000), employees: Math.round(6 + storage / 250_000 + locations * 3) };
    }
    case "Cooperative": {
      const storage = roundTo(logUniform(5_000_000, 70_000_000), 100_000);
      const locations = Math.round(4 + storage / 2_500_000 + int(0, 6));
      return { storage, locations, revenue: roundTo(storage * 2.6 * 5.2 * 1.25, 1_000_000), employees: Math.round(60 + locations * 12) };
    }
    case "Ethanol Plant": {
      const gallons = roundTo(logUniform(45_000_000, 320_000_000), 5_000_000);
      return { gallons, locations: gallons > 200e6 ? 2 : 1, storage: roundTo(gallons / 10, 100_000), revenue: roundTo(gallons * 2.35, 1_000_000), employees: Math.round(35 + gallons / 6_000_000) };
    }
    case "Feed Mill": {
      const tons = roundTo(logUniform(35_000, 650_000), 5_000);
      const locations = tons > 300_000 ? int(2, 5) : int(1, 2);
      return { tons, locations, revenue: roundTo(tons * 360, 100_000), employees: Math.round(18 + tons / 4_500) };
    }
    case "Oilseed Crusher": {
      const tons = roundTo(logUniform(300_000, 2_600_000), 50_000);
      return { tons, locations: 1, storage: roundTo(tons * 12, 100_000), revenue: roundTo(tons * 470, 1_000_000), employees: Math.round(55 + tons / 20_000) };
    }
    case "Flour Mill": {
      const tons = roundTo(logUniform(90_000, 750_000), 10_000);
      return { tons, locations: tons > 400_000 ? 2 : 1, revenue: roundTo(tons * 520, 1_000_000), employees: Math.round(45 + tons / 5_000) };
    }
    case "Seed Processor": {
      const tons = roundTo(logUniform(3_000, 45_000), 500);
      return { tons, locations: int(1, 3), storage: roundTo(tons * 30, 10_000), revenue: roundTo(tons * 950, 100_000), employees: Math.round(8 + tons / 900) };
    }
    case "Agronomy Retailer": {
      const tons = roundTo(logUniform(8_000, 130_000), 1_000);
      const locations = tons > 60_000 ? int(4, 12) : int(1, 4);
      return { tons, locations, revenue: roundTo(tons * 640, 100_000), employees: Math.round(10 + locations * 7) };
    }
  }
}

const fmtBu = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M bu` : `${Math.round(n / 1000)}K bu`);

function describe(type: FacilityType, commodities: Commodity[], s: Size, rail: boolean, livestock?: LivestockFocus): string {
  const c = commodities.join(", ").toLowerCase();
  switch (type) {
    case "Grain Elevator":
      return `${rail ? "Rail-served" : "Truck"} country elevator handling ${c}; ${fmtBu(s.storage!)} of upright and bunker storage across ${s.locations} location${s.locations > 1 ? "s" : ""}.`;
    case "Cooperative":
      return `Farmer-owned cooperative with grain, agronomy and energy divisions; ${fmtBu(s.storage!)} licensed storage at ${s.locations} locations.`;
    case "Ethanol Plant":
      return `${Math.round(s.gallons! / 1e6)}M gal/yr dry-mill ethanol plant grinding ${c}; sells DDGS and distillers corn oil${rail ? ", unit-train loadout" : ""}.`;
    case "Feed Mill":
      return `${Math.round(s.tons! / 1000)}K ton/yr feed mill serving ${livestock?.toLowerCase() ?? "livestock"} producers; bulk delivery fleet and bagged line.`;
    case "Oilseed Crusher":
      return `${commodities[0]} crush plant processing ${Math.round(s.tons! / 1000)}K tons/yr into meal and oil${rail ? "; rail-served" : ""}.`;
    case "Flour Mill":
      return `Flour mill grinding ${c}; ${Math.round(s.tons! / 1000)}K tons/yr with bakery and food-service customers.`;
    case "Seed Processor":
      return `Seed cleaning and conditioning plant for ${c}; ${Math.round(s.tons! / 1000)}K tons/yr with grower settlements and lot traceability.`;
    case "Agronomy Retailer":
      return `Agronomy retailer with ${s.locations} location${s.locations > 1 ? "s" : ""}: dry and liquid fertilizer, crop protection, seed and custom application.`;
  }
}

function pickSoftware(type: FacilityType): { name: string; end?: string } {
  const fits = SOFTWARE_VENDORS.filter((v) => v.kind !== "ours" && v.fits.includes(type));
  const kind = weighted<"manual" | "legacy" | "competitor">([["manual", 25], ["legacy", 35], ["competitor", 40]]);
  const pool = fits.filter((v) => v.kind === kind);
  const vendor = pool.length ? pick(pool) : pick(fits);
  if (vendor.name === "GrainMaster Classic") return { name: vendor.name, end: "2027-06-30" };
  if (vendor.kind === "competitor") {
    const end = randomDateBetween(new Date(Date.UTC(2026, 9, 1)), new Date(Date.UTC(2029, 5, 30)));
    // Contracts renew at month end
    end.setUTCDate(28);
    return { name: vendor.name, end: isoDate(end) };
  }
  return { name: vendor.name };
}

function livestockFor(regionId: RegionId): LivestockFocus {
  return pick(REGIONS.find((r) => r.id === regionId)!.livestock);
}

// ---------------------------------------------------------------------------
// Accounts
//
// Core market: ~457 facilities in Illinois (~249) and Iowa (~208, including
// 132 co-op locations under parent co-ops, and ~63 feed mills across both
// states), placed in real counties (centroids from the bundled us-atlas
// county shapes). Plus a lighter layer across the rest of the US and Canada.
// ---------------------------------------------------------------------------
const usedNames = new Set<string>();
const accounts: Account[] = [];

interface CountyInfo {
  fips: string;
  name: string;
  state: "IL" | "IA";
  lat: number;
  lon: number;
}

const countyTopo = countiesTopoJson as unknown as Topology<{ counties: GeometryCollection<{ name: string }> }>;
const COUNTIES: CountyInfo[] = (feature(countyTopo, countyTopo.objects.counties) as FeatureCollection<Geometry, { name: string }>).features
  .filter((f) => String(f.id).startsWith("17") || String(f.id).startsWith("19"))
  .map((f) => {
    const [lon, lat] = geoCentroid(f);
    return { fips: String(f.id), name: f.properties.name, state: String(f.id).startsWith("17") ? "IL" : "IA", lat, lon } as CountyInfo;
  })
  .sort((a, b) => a.fips.localeCompare(b.fips));

/** Counties on the Illinois / Mississippi / Ohio rivers (barge-loading country) */
const RIVER_COUNTIES = new Set([
  "Peoria", "Tazewell", "Fulton", "Mason", "Marshall", "Putnam", "LaSalle", "Woodford", "Cass", "Morgan", "Scott", "Pike",
  "Calhoun", "Greene", "Jersey", "Madison", "Adams", "Hancock", "Henderson", "Mercer", "Rock Island", "Whiteside", "Carroll",
  "Jo Daviess", "Alexander", "Union", "Jackson", "Randolph", "Monroe", "St. Clair", "Massac", "Pope", "Hardin", "Gallatin",
  "Lee", "Des Moines", "Louisa", "Muscatine", "Clinton", "Dubuque", "Clayton", "Allamakee",
]);
const RAILROADS_ILIA = ["BNSF", "Union Pacific", "CN", "Norfolk Southern", "CSX", "CPKC", "Iowa Interstate", "Iowa Northern", "Illinois Central"];
const RAILROADS_OTHER = ["BNSF", "Union Pacific", "CPKC", "CN", "Norfolk Southern", "CSX"];

function nearestTown(state: string, lat: number, lon: number): { name: string; km: number } {
  let best = { name: "", km: Infinity };
  for (const t of TOWNS) {
    if (t.state !== state) continue;
    const km = Math.hypot((t.lat - lat) * 111, (t.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180));
    if (km < best.km) best = { name: t.name, km };
  }
  return best;
}

function segmentFor(type: FacilityType, flags: { river: boolean; shuttle: boolean }): Segment {
  switch (type) {
    case "Cooperative":
      return "Multi-Location Co-op";
    case "Ethanol Plant":
      return "Ethanol Plant";
    case "Feed Mill":
      return "Feed Mill";
    case "Oilseed Crusher":
    case "Flour Mill":
      return "Processor";
    case "Seed Processor":
      return "Seed Cleaner / Specialty Crop";
    default:
      return flags.river ? "River Terminal" : flags.shuttle ? "Rail/Shuttle Loader" : "Country Elevator";
  }
}

const FY_ENDS = ["08-31", "08-31", "09-30", "12-31", "06-30"];
function boardMonths(segment: Segment): number[] {
  if (segment === "Multi-Location Co-op") return [1, 3, 5, 7, 9, 11];
  if (segment === "Country Elevator" || segment === "Rail/Shuttle Loader" || segment === "River Terminal") return pick([[1, 4, 7, 10], [2, 5, 8, 11], [3, 6, 9, 12]]);
  return pick([[3, 9], [1, 6, 11], [2, 8]]);
}

interface Place {
  city: string;
  state: string;
  lat: number;
  lon: number;
  county?: CountyInfo;
}

function makeAccount(
  place: Place,
  type: FacilityType,
  opts: { river?: boolean; shuttle?: boolean; parent?: Account; name?: string; locationNo?: number } = {},
): Account {
  const regionId = REGION_BY_STATE[place.state] as RegionId;
  const river = opts.river ?? (type === "Grain Elevator" && !!place.county && RIVER_COUNTIES.has(place.county.name) && chance(0.35));
  const shuttle = opts.shuttle ?? (type === "Grain Elevator" && !river && chance(0.14));
  const segment = segmentFor(type, { river, shuttle });
  const commodities = opts.parent ? opts.parent.Primary_Commodities__c : commoditiesFor(type, regionId);
  const size = sizeFor(type);
  if (river) size.storage = roundTo(logUniform(2_000_000, 9_000_000), 50_000);
  if (shuttle) size.storage = roundTo(logUniform(1_500_000, 6_000_000), 50_000);
  if (opts.parent) {
    // A single co-op location: elevator-sized, reports up to the parent
    size.storage = roundTo(logUniform(600_000, 5_000_000), 50_000);
    size.locations = 1;
    size.revenue = roundTo(size.storage * 2.4 * 5.2, 100_000);
    size.employees = Math.round(5 + size.storage / 300_000);
  }
  const rail = river || shuttle || chance(size.revenue > 80e6 ? 0.8 : 0.4);
  const livestock = type === "Feed Mill" ? livestockFor(regionId) : undefined;
  const name =
    opts.name ??
    (opts.parent ? `${opts.parent.Name} - ${place.city === "" ? place.county?.name : place.city} Location` : river ? companyNameTerminal(place.state) : companyName(type, place.state, usedNames));
  usedNames.add(name);
  const created = randomDateBetween(new Date(Date.UTC(2016, 0, 1)), new Date(Date.UTC(2025, 6, 1)));
  const jitter = () => (rand() - 0.5) * (place.county ? 0.28 : 0.08);
  const country = CANADIAN_PROVINCES.includes(place.state) ? "Canada" : "United States";
  return {
    Id: sfId("001"),
    Name: name,
    Type: "Prospect",
    Industry: "Agriculture",
    Phone: opts.parent ? opts.parent.Phone.slice(0, -2) + String(int(0, 99)).padStart(2, "0") : phone(place.state),
    Website: opts.parent ? opts.parent.Website : `www.${domainFor(name)}`,
    BillingStreet: street(),
    BillingCity: place.city,
    BillingState: place.state,
    BillingPostalCode: postalCode(place.state),
    BillingCountry: country,
    BillingLatitude: +(place.lat + jitter()).toFixed(4),
    BillingLongitude: +(place.lon + jitter()).toFixed(4),
    AnnualRevenue: size.revenue,
    NumberOfEmployees: size.employees,
    OwnerId: ownerForRegion(regionId),
    CreatedDate: isoDateTime(created),
    Description: opts.parent
      ? `Location ${opts.locationNo ?? ""} of ${opts.parent.Name}; ${fmtBu(size.storage!)} of storage${rail ? ", rail-served" : ""}. Buying decisions are made at the parent co-op.`
      : river
        ? `River terminal on the ${place.state === "IA" || ["Rock Island", "Mercer", "Henderson", "Hancock", "Adams", "Pike", "Calhoun", "Jo Daviess", "Carroll", "Whiteside"].includes(place.county?.name ?? "") ? "Mississippi" : "Illinois"} River loading barges for export; ${fmtBu(size.storage!)} of storage.`
        : shuttle
          ? `Shuttle loader: 110-car unit trains on the ${pick(RAILROADS_ILIA)}; ${fmtBu(size.storage!)} of storage.`
          : describe(type, commodities, size, rail, livestock),
    Facility_Type__c: type,
    Primary_Commodities__c: commodities,
    ...(size.storage ? { Storage_Capacity_Bu__c: size.storage } : {}),
    ...(size.gallons ? { Annual_Production_Gal__c: size.gallons } : {}),
    ...(size.tons ? { Annual_Production_Tons__c: size.tons } : {}),
    Number_of_Locations__c: size.locations,
    Current_Software__c: opts.parent ? opts.parent.Current_Software__c : pickSoftware(type).name,
    ...(livestock ? { Livestock_Focus__c: livestock } : {}),
    Region__c: regionId,
    Rail_Served__c: rail,
    Segment__c: segment,
    ...(opts.parent ? { ParentId: opts.parent.Id } : {}),
    ...(place.county ? { County__c: place.county.name, County_FIPS__c: place.county.fips } : {}),
    ...(rail ? { Railroad__c: pick(place.county ? RAILROADS_ILIA : RAILROADS_OTHER) } : {}),
    River_Access__c: river,
    Shuttle_Loader__c: shuttle,
    Fiscal_Year_End__c: segment === "Multi-Location Co-op" ? pick(["08-31", "08-31", "09-30"]) : pick(FY_ENDS),
    Board_Meeting_Months__c: boardMonths(segment),
  };
}

function companyNameTerminal(state: string): string {
  for (let i = 0; i < 200; i++) {
    const n = pick([`${pick(PREFIXES)} River Terminal`, `${pick(PREFIXES)} Barge & Grain`, `${pick(SURNAMES)} River Grain`, `${pick(PREFIXES)} Port Terminal`]);
    if (!usedNames.has(n)) return n;
  }
  return `${pick(PREFIXES)} River Terminal ${state}`;
}

function countyPlace(state: "IL" | "IA", preferRiver = false): Place {
  const pool = COUNTIES.filter((c) => c.state === state && (!preferRiver || RIVER_COUNTIES.has(c.name)));
  const county = pick(pool.length ? pool : COUNTIES.filter((c) => c.state === state));
  const town = nearestTown(state, county.lat, county.lon);
  return { city: town.km <= 40 ? town.name : `${county.name} County`, state, lat: county.lat, lon: county.lon, county };
}

function addCore(state: "IL" | "IA", type: FacilityType, n: number, opts: { river?: boolean; shuttle?: boolean } = {}) {
  for (let i = 0; i < n; i++) {
    const place = countyPlace(state, opts.river);
    accounts.push(makeAccount(place, type, { river: opts.river ?? false, shuttle: opts.shuttle ?? false }));
  }
}

/** Parent co-op with child locations spread across nearby counties */
function addCoop(state: "IL" | "IA", totalLocations: number) {
  const hq = countyPlace(state);
  const parent = makeAccount(hq, "Cooperative");
  parent.Number_of_Locations__c = totalLocations;
  parent.Storage_Capacity_Bu__c = roundTo(totalLocations * logUniform(1_500_000, 3_500_000), 100_000);
  parent.AnnualRevenue = roundTo(parent.Storage_Capacity_Bu__c * 2.6 * 5.2 * 1.25, 1_000_000);
  parent.NumberOfEmployees = Math.round(60 + totalLocations * 11);
  parent.Description = `Farmer-owned cooperative (HQ) with grain, agronomy and energy divisions across ${totalLocations} locations. Board meets every other month.`;
  accounts.push(parent);
  const near = COUNTIES.filter((c) => c.state === state).sort(
    (a, b) => Math.hypot(a.lat - hq.lat, a.lon - hq.lon) - Math.hypot(b.lat - hq.lat, b.lon - hq.lon),
  );
  for (let i = 1; i < totalLocations; i++) {
    const county = near[Math.min(near.length - 1, Math.floor(rand() * Math.min(near.length, 6 + totalLocations)))];
    const town = nearestTown(state, county.lat, county.lon);
    const place: Place = { city: town.km <= 40 ? town.name : `${county.name} County`, state, lat: county.lat, lon: county.lon, county };
    accounts.push(makeAccount(place, "Grain Elevator", { parent, river: false, shuttle: chance(0.1), locationNo: i + 1 }));
  }
  return parent;
}

// Illinois (~249)
addCore("IL", "Grain Elevator", 120);
const ilCoops = [addCoop("IL", 12), addCoop("IL", 10), addCoop("IL", 8)];
addCore("IL", "Grain Elevator", 25, { river: true });
addCore("IL", "Grain Elevator", 28, { shuttle: true });
addCore("IL", "Ethanol Plant", 12);
addCore("IL", "Feed Mill", 24);
addCore("IL", "Oilseed Crusher", 3);
addCore("IL", "Flour Mill", 3);
addCore("IL", "Seed Processor", 4);
// Iowa (~208, 132 of them co-op locations)
const iaCoopSizes = [12, 24, 20, 18, 17, 15, 14, 12];
const iaCoops = iaCoopSizes.map((n) => addCoop("IA", n));
addCore("IA", "Grain Elevator", 10);
addCore("IA", "Grain Elevator", 2, { river: true });
addCore("IA", "Grain Elevator", 8, { shuttle: true });
addCore("IA", "Ethanol Plant", 12);
addCore("IA", "Feed Mill", 39);
addCore("IA", "Oilseed Crusher", 3);
addCore("IA", "Seed Processor", 2);

// Light layer elsewhere in the US and Canada
for (const town of TOWNS) {
  if (town.state === "IL" || town.state === "IA") continue;
  const n = weighted([[1, 30], [2, 42], [3, 22], [4, 6]]);
  for (let i = 0; i < n; i++) {
    const regionId = REGION_BY_STATE[town.state] as RegionId;
    accounts.push(makeAccount({ city: town.name, state: town.state, lat: town.lat, lon: town.lon }, weighted(TYPE_WEIGHTS[regionId])));
  }
}

// Customers. Coverage is deliberately thin in Iowa co-ops: exactly one parent
// co-op (12 locations) runs ThiboLiSoft → "12 of 132 Iowa co-op locations".
const CUSTOMER_SHARE: Record<Segment, number> = {
  "Country Elevator": 0.2,
  "Multi-Location Co-op": 0.3,
  "River Terminal": 0.12,
  "Rail/Shuttle Loader": 0.22,
  "Ethanol Plant": 0.3,
  "Feed Mill": 0.22,
  Processor: 0.25,
  "Seed Cleaner / Specialty Crop": 0,
};
const coreCoopParents = new Set([...ilCoops, ...iaCoops].map((p) => p.Id));
for (const a of accounts) {
  if (a.ParentId) continue;
  let customer: boolean;
  if (a.Id === iaCoops[0].Id || a.Id === ilCoops[1].Id) customer = true;
  else if (coreCoopParents.has(a.Id)) customer = false;
  else customer = chance(CUSTOMER_SHARE[a.Segment__c]);
  if (customer) {
    a.Type = "Customer - Direct";
    a.Current_Software__c = "ThiboLiSoft";
  } else if (a.Current_Software__c === "ThiboLiSoft") {
    a.Current_Software__c = pickSoftware(a.Facility_Type__c).name;
  }
  if (a.Type === "Prospect") {
    const sw = pickSoftware(a.Facility_Type__c);
    a.Current_Software__c = sw.name;
    if (sw.end) a.Software_Contract_End__c = sw.end;
  }
}
// Child locations inherit the parent's status and software
const byId = new Map(accounts.map((a) => [a.Id, a]));
for (const a of accounts) {
  if (!a.ParentId) continue;
  const p = byId.get(a.ParentId)!;
  a.Type = p.Type;
  a.Current_Software__c = p.Current_Software__c;
  if (p.Software_Contract_End__c) a.Software_Contract_End__c = p.Software_Contract_End__c;
  a.OwnerId = p.OwnerId;
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------
const ROLES: Record<FacilityType, [string, BuyingRole][]> = {
  "Grain Elevator": [["General Manager", "Decision Maker"], ["Controller", "Economic Buyer"], ["Grain Merchandiser", "Champion"], ["Board Member", "Board Member"], ["Office Manager", "End User"]],
  Cooperative: [["General Manager / CEO", "Decision Maker"], ["Controller / CFO", "Economic Buyer"], ["Grain Merchandiser", "Champion"], ["Board Chair", "Board Member"], ["Board Member", "Board Member"], ["IT Manager", "Influencer"]],
  "Ethanol Plant": [["General Manager", "Decision Maker"], ["Commodity Manager", "Champion"], ["Plant Manager", "Influencer"], ["Controller", "Economic Buyer"], ["IT Manager", "Influencer"]],
  "Feed Mill": [["General Manager", "Decision Maker"], ["Mill Manager", "Champion"], ["Controller", "Economic Buyer"], ["Nutritionist", "Influencer"], ["Delivery Manager", "End User"]],
  "Oilseed Crusher": [["General Manager", "Decision Maker"], ["Oilseed Procurement Manager", "Champion"], ["Plant Manager", "Influencer"], ["Controller", "Economic Buyer"], ["IT Manager", "Influencer"]],
  "Flour Mill": [["General Manager", "Decision Maker"], ["Wheat Buyer", "Champion"], ["Mill Manager", "Influencer"], ["Controller", "Economic Buyer"], ["Quality Manager", "End User"]],
  "Seed Processor": [["Owner / President", "Decision Maker"], ["Plant Manager", "Champion"], ["Office Manager", "End User"]],
  "Agronomy Retailer": [["General Manager", "Decision Maker"], ["Agronomy Manager", "Champion"], ["Controller", "Economic Buyer"], ["Application Manager", "End User"]],
};

const contacts: Contact[] = [];
const contactsByAccount = new Map<string, Contact[]>();
for (const a of accounts) {
  const roles: [string, BuyingRole][] = a.ParentId ? [["Location Manager", "End User"]] : ROLES[a.Facility_Type__c];
  const n = a.ParentId ? 1 : Math.min(roles.length, a.Segment__c === "Multi-Location Co-op" ? 5 : a.AnnualRevenue > 150e6 ? int(4, 5) : a.AnnualRevenue > 30e6 ? int(3, 4) : 3);
  const domain = a.Website.replace(/^www\./, "");
  const list: Contact[] = [];
  const usedPeople = new Set<string>();
  for (let i = 0; i < n; i++) {
    let p = personName(a.BillingState);
    while (usedPeople.has(p.first + p.last)) p = personName(a.BillingState);
    usedPeople.add(p.first + p.last);
    const [title, role] = roles[i];
    const c: Contact = {
      Id: sfId("003"),
      AccountId: a.Id,
      FirstName: p.first,
      LastName: p.last,
      Name: `${p.first} ${p.last}`,
      Title: title,
      Email: `${slug(p.first)}.${slug(p.last)}@${domain}`,
      Phone: a.Phone.slice(0, -2) + String(int(0, 99)).padStart(2, "0"),
      ...(chance(0.6) ? { MobilePhone: phone(a.BillingState) } : {}),
      MailingStreet: a.BillingStreet,
      MailingCity: a.BillingCity,
      MailingState: a.BillingState,
      MailingPostalCode: a.BillingPostalCode,
      MailingCountry: a.BillingCountry,
      OwnerId: a.OwnerId,
      Buying_Role__c: role,
      HasOptedOutOfEmail: chance(0.04),
      CreatedDate: a.CreatedDate,
    };
    list.push(c);
    contacts.push(c);
  }
  contactsByAccount.set(a.Id, list);
}

// ---------------------------------------------------------------------------
// Leads (not yet converted)
// ---------------------------------------------------------------------------
const leads: Lead[] = [];
const LEAD_TITLES = ["General Manager", "Owner", "Controller", "Grain Merchandiser", "Plant Manager", "Operations Manager", "IT Manager", "Office Manager"];
for (let i = 0; i < 120; i++) {
  const town = pick(TOWNS);
  const regionId = REGION_BY_STATE[town.state] as RegionId;
  const type = weighted(TYPE_WEIGHTS[regionId]);
  const size = sizeFor(type);
  const company = companyName(type, town.state, usedNames);
  const p = personName(town.state);
  const software = pickSoftware(type);
  const livestock = type === "Feed Mill" ? livestockFor(regionId) : undefined;
  const status = weighted<Lead["Status"]>([["Open - Not Contacted", 45], ["Working - Contacted", 30], ["Nurturing", 20], ["Closed - Not Converted", 5]]);
  leads.push({
    Id: sfId("00Q"),
    FirstName: p.first,
    LastName: p.last,
    Name: `${p.first} ${p.last}`,
    Title: pick(LEAD_TITLES),
    Company: company,
    Email: `${slug(p.first)}.${slug(p.last)}@${domainFor(company)}`,
    Phone: phone(town.state),
    Street: street(),
    City: town.name,
    State: town.state,
    PostalCode: postalCode(town.state),
    Country: CANADIAN_PROVINCES.includes(town.state) ? "Canada" : "United States",
    Latitude: +(town.lat + (rand() - 0.5) * 0.08).toFixed(4),
    Longitude: +(town.lon + (rand() - 0.5) * 0.08).toFixed(4),
    Industry: "Agriculture",
    LeadSource: weighted<LeadSource>([["Web", 25], ["Trade Show", 25], ["Referral", 12], ["Purchased List", 18], ["Webinar", 10], ["Direct Mail", 8], ["Partner", 2]]),
    Status: status,
    Rating: weighted<Lead["Rating"]>([["Hot", 15], ["Warm", 45], ["Cold", 40]]),
    NumberOfEmployees: size.employees,
    AnnualRevenue: size.revenue,
    OwnerId: ownerForRegion(regionId),
    CreatedDate: isoDateTime(workHours(randomDateBetween(HISTORY_START, addDays(ANCHOR, -3)))),
    IsConverted: false,
    Facility_Type__c: type,
    Primary_Commodities__c: commoditiesFor(type, regionId),
    ...(size.storage ? { Storage_Capacity_Bu__c: size.storage } : {}),
    ...(size.gallons ? { Annual_Production_Gal__c: size.gallons } : {}),
    ...(size.tons ? { Annual_Production_Tons__c: size.tons } : {}),
    Number_of_Locations__c: size.locations,
    Current_Software__c: software.name,
    ...(software.end ? { Software_Contract_End__c: software.end } : {}),
    ...(livestock ? { Livestock_Focus__c: livestock } : {}),
    Region__c: regionId,
    Segment__c: segmentFor(type, { river: false, shuttle: chance(0.1) }),
  });
}

// ---------------------------------------------------------------------------
// Opportunities + line items
//
// ~3 years of history (≈1,300 closed) + ~150 open. Seasonality is real:
// elevator/co-op deals created Aug–Nov (harvest) close far less often and
// take longer; deals created Dec–Feb close best. Ethanol, feed and processors
// are steady all year. River Terminal is deliberately thin (<10 decided) and
// Seed Cleaner / Specialty Crop has no closed history at all.
// ---------------------------------------------------------------------------
const OPP_HISTORY_START = new Date(Date.UTC(2023, 8, 1));
// Deal history uses its own random stream so adding facilities doesn't reshuffle it
rngState = Number(process.env.OPP_SEED ?? 42);

const STAGE_PROB: Record<OpportunityStage, number> = {
  Prospecting: 10, Qualification: 20, "Needs Analysis": 40, Proposal: 60, Negotiation: 75, "Board Approval": 90, "Closed Won": 100, "Closed Lost": 0,
};
const FORECAST: Record<OpportunityStage, Opportunity["ForecastCategoryName"]> = {
  Prospecting: "Pipeline", Qualification: "Pipeline", "Needs Analysis": "Pipeline", Proposal: "Best Case", Negotiation: "Commit", "Board Approval": "Commit", "Closed Won": "Closed", "Closed Lost": "Omitted",
};
const NEXT_STEPS: Record<OpportunityStage, string[]> = {
  Prospecting: ["Intro call with GM: confirm scale ticket and settlement workflow", "Identify the controller (economic buyer)", "Get intro to controller via merchandiser"],
  Qualification: ["Discovery call: year-end close and settlement timing", "Confirm budget cycle and board meeting date", "Map current ticket-to-settlement process with office manager"],
  "Needs Analysis": ["On-site scale house walkthrough (after harvest)", "Demo GrainSight position report to merchandiser", "Collect ticket volumes and location list for sizing"],
  Proposal: ["Review proposal with GM and controller", "Send revised pricing with implementation before planting", "Reference call with a customer of similar size"],
  Negotiation: ["Finalize 3-year terms; legal review of MSA", "Confirm go-live before spring planting", "Align price with fiscal-year budget"],
  "Board Approval": ["Board meeting: present business case", "Send board packet to GM", "Board vote scheduled; e-signature packet ready"],
  "Closed Won": ["Kickoff scheduled with implementation team"],
  "Closed Lost": ["Revisit in 12 months"],
};
const LOSS_REASONS = ["Chose competitor (HarvestCore 360)", "No decision: board deferred", "Budget frozen after margin squeeze", "Incumbent offered a discounted upgrade", "Timing: harvest started before a decision", "Went dark during harvest"];

interface SegmentHistory {
  closed: number;
  open: number;
  baseWin: number;
  medianDeal: number;
  medianCycle: number;
  seasonal: boolean;
}
const HISTORY: Record<Segment, SegmentHistory> = {
  "Country Elevator": { closed: 380, open: 34, baseWin: 0.3, medianDeal: 48_000, medianCycle: 105, seasonal: true },
  "Multi-Location Co-op": { closed: 250, open: 26, baseWin: 0.3, medianDeal: 165_000, medianCycle: 150, seasonal: true },
  "River Terminal": { closed: 7, open: 4, baseWin: 0.35, medianDeal: 120_000, medianCycle: 120, seasonal: true },
  "Rail/Shuttle Loader": { closed: 170, open: 18, baseWin: 0.31, medianDeal: 92_000, medianCycle: 118, seasonal: true },
  "Ethanol Plant": { closed: 185, open: 22, baseWin: 0.33, medianDeal: 145_000, medianCycle: 95, seasonal: false },
  "Feed Mill": { closed: 225, open: 26, baseWin: 0.33, medianDeal: 68_000, medianCycle: 78, seasonal: false },
  Processor: { closed: 115, open: 14, baseWin: 0.3, medianDeal: 185_000, medianCycle: 128, seasonal: false },
  "Seed Cleaner / Specialty Crop": { closed: 0, open: 4, baseWin: 0.3, medianDeal: 40_000, medianCycle: 90, seasonal: true },
};
/** Win multiplier by month the deal was created (0 = Jan) for harvest-driven buyers */
const SEASONAL_WIN = [1.8, 1.6, 1.2, 0.8, 0.75, 1.2, 1.15, 0.6, 0.35, 0.3, 0.45, 1.75];
const SEASONAL_CYCLE = [0.85, 0.9, 1, 1.1, 1.1, 1, 1, 1.3, 1.6, 1.7, 1.5, 0.9];

const lognormal = (median: number, sigma: number) => {
  // Box–Muller
  const u = Math.max(1e-9, rand());
  const v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * z);
};

function productsFor(a: { Facility_Type__c: FacilityType }, addOn: boolean) {
  const fits = PRODUCTS.filter((p) => p.Best_Fit__c.includes(a.Facility_Type__c));
  const n = addOn ? int(1, 2) : int(2, Math.min(3, fits.length));
  const chosen = sample(fits, n);
  if (!addOn) chosen.push(PRODUCTS.find((p) => p.ProductCode === "SVC-IMPL")!);
  return chosen;
}

const opportunities: Opportunity[] = [];
const lineItems: OpportunityLineItem[] = [];
const recentCutoff = addDays(ANCHOR, -365);

function makeOpp(a: Account, stage: OpportunityStage, created: Date, close: Date, addOn: boolean, amount: number) {
  const id = sfId("006");
  const prods = productsFor(a, addOn);
  const isClosed = stage === "Closed Won" || stage === "Closed Lost";
  // Line items only for open and recent deals (keeps the seed small)
  if (!isClosed || close >= recentCutoff) {
    const weights = prods.map((p) => p.List_Price__c * (p.Pricing_Unit__c === "per location / year" ? a.Number_of_Locations__c : 1));
    const total = weights.reduce((s, w) => s + w, 0) || 1;
    prods.forEach((p, i) => {
      const qty = p.Pricing_Unit__c === "per location / year" ? a.Number_of_Locations__c : 1;
      const lineTotal = Math.round((amount * weights[i]) / total / 10) * 10;
      const unit = Math.round(lineTotal / qty);
      lineItems.push({ Id: sfId("00k"), OpportunityId: id, Product2Id: p.Id, Quantity: qty, UnitPrice: unit, TotalPrice: unit * qty, ...(p.Pricing_Unit__c !== "one-time" ? { Description: "3-year subscription" } : {}) });
    });
  }
  const people = contactsByAccount.get(a.Id) ?? [];
  const econ = people.find((c) => c.Buying_Role__c === "Economic Buyer");
  const stageIdx = OPEN_STAGES.indexOf(stage);
  const ebIdentified = isClosed || stageIdx >= 1 || chance(0.3);
  const mainProducts = prods.filter((p) => p.Family !== "Services").map((p) => p.Name);
  const opp: Opportunity = {
    Id: id,
    AccountId: a.Id,
    Name: `${a.Name} - ${mainProducts.slice(0, 2).join(" + ")}${addOn ? " Add-On" : ""}`,
    Type: addOn ? "Add-On Business" : "New Business",
    StageName: stage,
    Amount: Math.round(amount / 100) * 100,
    CloseDate: isoDate(close),
    Probability: STAGE_PROB[stage],
    ForecastCategoryName: FORECAST[stage],
    NextStep: pick(NEXT_STEPS[stage]),
    LeadSource: weighted<LeadSource>([["Trade Show", 25], ["Referral", 20], ["Web", 20], ["Direct Mail", 15], ["Webinar", 10], ["Purchased List", 10]]),
    OwnerId: a.OwnerId,
    IsClosed: isClosed,
    IsWon: stage === "Closed Won",
    CreatedDate: isoDateTime(workHours(created)),
    LastModifiedDate: isoDateTime(workHours(randomDateBetween(created, isClosed ? close : addDays(ANCHOR, -1)))),
    ...(stage === "Closed Lost" ? { Loss_Reason__c: pick(LOSS_REASONS) } : {}),
    ...(people[0] ? { Primary_Contact__c: people[0].Id } : {}),
    Economic_Buyer_Identified__c: ebIdentified && !!econ,
    ...(ebIdentified && econ ? { Economic_Buyer__c: econ.Id } : {}),
  };
  opportunities.push(opp);
  return opp;
}

// Deals live on top-level accounts; co-op location deals roll up to the parent.
const topLevel = accounts.filter((a) => !a.ParentId);
const bySegment = new Map<Segment, Account[]>();
for (const a of topLevel) bySegment.set(a.Segment__c, [...(bySegment.get(a.Segment__c) ?? []), a]);

for (const segment of SEGMENTS) {
  const h = HISTORY[segment];
  const pool = bySegment.get(segment) ?? [];
  const customersInSeg = pool.filter((a) => a.Type === "Customer - Direct");
  const prospectsInSeg = pool.filter((a) => a.Type === "Prospect");
  if (!pool.length) continue;
  let made = 0;
  let guard = 0;
  while (made < h.closed && guard++ < h.closed * 20) {
    const created = randomDateBetween(OPP_HISTORY_START, addDays(ANCHOR, -40));
    const m = created.getUTCMonth();
    const winP = Math.min(0.9, h.baseWin * (h.seasonal ? SEASONAL_WIN[m] : 0.93 + rand() * 0.14));
    const cycle = Math.max(21, Math.round(lognormal(h.medianCycle * (h.seasonal ? SEASONAL_CYCLE[m] : 1), 0.35)));
    const close = addDays(created, cycle);
    if (close > addDays(ANCHOR, -2)) continue;
    const won = chance(winP);
    // Wins land on customers (new business or add-ons); losses mostly on prospects
    const account = won ? (customersInSeg.length ? pick(customersInSeg) : pick(pool)) : chance(0.75) && prospectsInSeg.length ? pick(prospectsInSeg) : pick(pool);
    const addOn = account.Type === "Customer - Direct" && chance(won ? 0.65 : 0.5);
    const amount = lognormal(h.medianDeal * (addOn ? 0.45 : 1), 0.45);
    makeOpp(account, won ? "Closed Won" : "Closed Lost", created, close, addOn, amount);
    made++;
  }
  // Open pipeline
  for (let i = 0; i < h.open; i++) {
    const addOn = customersInSeg.length > 0 && chance(0.25);
    const account = addOn ? pick(customersInSeg) : pick(prospectsInSeg.length ? prospectsInSeg : pool);
    const hasBoard = segment === "Multi-Location Co-op" || segment === "Country Elevator" || segment === "Rail/Shuttle Loader";
    const stage = weighted<OpportunityStage>([
      ["Prospecting", 25], ["Qualification", 22], ["Needs Analysis", 18], ["Proposal", 15], ["Negotiation", 10], [hasBoard ? "Board Approval" : "Negotiation", 10],
    ]);
    const idx = OPEN_STAGES.indexOf(stage);
    const created = addDays(ANCHOR, -int(15 + idx * 20, 60 + idx * 40));
    const close = addDays(ANCHOR, int(20 + (5 - idx) * 10, 60 + (5 - idx) * 30));
    const amount = lognormal(h.medianDeal * (addOn ? 0.45 : 1), 0.4);
    makeOpp(account, stage, created, close, addOn, amount);
  }
}
opportunities.sort((a, b) => a.CreatedDate.localeCompare(b.CreatedDate));

// ---------------------------------------------------------------------------
// Campaigns + members (historical)
// ---------------------------------------------------------------------------
interface CampaignSpec {
  name: string;
  type: Campaign["Type"];
  status: Campaign["Status"];
  start: string;
  end: string;
  season: string;
  regions: RegionId[];
  types: FacilityType[];
  commodity?: Commodity;
  budget: number;
  responseRate: number;
  description: string;
}
const CAMPAIGN_SPECS: CampaignSpec[] = [
  { name: "2025 Fall Settlement Season - Corn Belt", type: "Direct Mail", status: "Completed", start: "2025-10-20", end: "2025-12-15", season: "Post-harvest", regions: ["western-corn-belt", "eastern-corn-belt"], types: ["Grain Elevator", "Cooperative"], commodity: "Corn", budget: 18000, responseRate: 0.07, description: "Settlement and 1099 season mailer: 'Close the year without the Excel all-nighters.'" },
  { name: "Spring Agronomy Booking Push", type: "Call Blitz", status: "Completed", start: "2026-01-12", end: "2026-02-20", season: "Pre-planting", regions: ["western-corn-belt", "eastern-corn-belt", "northern-plains", "manitoba"], types: ["Agronomy Retailer", "Cooperative"], budget: 6000, responseRate: 0.11, description: "Call blitz to agronomy managers ahead of prepay and spring booking season." },
  { name: "Ethanol Margin Management Webinar", type: "Event", status: "Completed", start: "2026-02-18", end: "2026-02-18", season: "Year-round", regions: ["western-corn-belt", "eastern-corn-belt", "northern-plains", "great-lakes"], types: ["Ethanol Plant"], commodity: "Corn", budget: 9000, responseRate: 0.14, description: "Webinar on locking crush margins with real-time corn origination and DDGS sales data." },
  { name: "AgTech Expo 2026 - Booth Follow-up", type: "Event", status: "Completed", start: "2026-03-05", end: "2026-03-31", season: "Pre-planting", regions: ["western-corn-belt", "southern-plains", "northern-plains", "eastern-corn-belt"], types: ["Grain Elevator", "Cooperative", "Ethanol Plant", "Seed Processor"], budget: 42000, responseRate: 0.12, description: "Trade show booth scans and follow-up sequence." },
  { name: "Poultry Feed Mill Efficiency Series", type: "Email", status: "Completed", start: "2026-04-06", end: "2026-05-15", season: "Year-round", regions: ["southeast", "mid-atlantic", "delta"], types: ["Feed Mill"], budget: 4500, responseRate: 0.05, description: "Three-part email series on batching accuracy, VFD records and delivery routing." },
  { name: "Winter Wheat Pre-Harvest - Southern Plains", type: "Email", status: "Completed", start: "2026-04-20", end: "2026-05-29", season: "Pre-harvest", regions: ["southern-plains"], types: ["Grain Elevator", "Cooperative", "Flour Mill"], commodity: "Winter Wheat", budget: 5000, responseRate: 0.06, description: "Scale house readiness sequence 4-6 weeks before winter wheat harvest." },
  { name: "Prairie Canola Harvest Readiness", type: "Multi-Channel", status: "Completed", start: "2026-06-22", end: "2026-08-14", season: "Pre-harvest", regions: ["western-prairies", "manitoba"], types: ["Grain Elevator", "Oilseed Crusher", "Seed Processor"], commodity: "Canola", budget: 21000, responseRate: 0.08, description: "Postcard + email + call touchpoints ahead of canola and CWRS harvest." },
  { name: "Corn Belt Pre-Harvest Scale Readiness", type: "Direct Mail", status: "In Progress", start: "2026-08-10", end: "2026-10-15", season: "Pre-harvest", regions: ["western-corn-belt", "eastern-corn-belt", "great-lakes"], types: ["Grain Elevator", "Cooperative"], commodity: "Corn", budget: 24000, responseRate: 0.05, description: "Direct mail letter + follow-up call: kiosk tickets and real-time position before the dump pit backs up." },
];

const campaigns: Campaign[] = [];
const campaignMembers: CampaignMember[] = [];
const tasks: Task[] = [];
const events: Event[] = [];

for (const spec of CAMPAIGN_SPECS) {
  const id = sfId("701");
  const start = new Date(spec.start + "T00:00:00Z");
  const end = new Date(spec.end + "T00:00:00Z");
  const matchAccounts = accounts.filter((a) => spec.regions.includes(a.Region__c) && spec.types.includes(a.Facility_Type__c));
  const targets = sample(matchAccounts, Math.min(matchAccounts.length, spec.type === "Event" ? int(20, 35) : int(35, 80)));
  const matchLeads = leads.filter((l) => spec.regions.includes(l.Region__c) && spec.types.includes(l.Facility_Type__c));
  const leadTargets = sample(matchLeads, Math.min(matchLeads.length, int(3, 10)));
  let responses = 0;
  for (const a of targets) {
    const c = contactsByAccount.get(a.Id)![0];
    const responded = chance(spec.responseRate * (a.Type === "Customer - Direct" ? 0.6 : 1.4));
    const sent = randomDateBetween(start, addDays(start, 7));
    const respondedAt = responded ? randomDateBetween(addDays(sent, 2), end < ANCHOR ? end : ANCHOR) : undefined;
    if (responded) responses++;
    const cmStatus: CampaignMember["Status"] = responded ? "Responded" : spec.type === "Email" && chance(0.35) ? "Opened" : "Sent";
    campaignMembers.push({
      Id: sfId("00v"),
      CampaignId: id,
      ContactId: c.Id,
      AccountId: a.Id,
      Status: cmStatus,
      HasResponded: responded,
      ...(respondedAt ? { FirstRespondedDate: isoDate(respondedAt) } : {}),
      CreatedDate: isoDateTime(workHours(sent)),
    });
    if (spec.type === "Direct Mail" || spec.type === "Multi-Channel") {
      tasks.push({
        Id: sfId("00T"),
        Subject: `Mail drop: ${spec.name}`,
        Type: "Mail Drop",
        TaskSubtype: "Task",
        Status: "Completed",
        Priority: "Normal",
        ActivityDate: isoDate(sent),
        WhoId: c.Id,
        WhatId: id,
        AccountId: a.Id,
        OwnerId: a.OwnerId,
        Description: `Letter mailed to ${c.Name} (${c.Title}) via mail house.`,
        CreatedDate: isoDateTime(workHours(sent)),
        CompletedDateTime: isoDateTime(workHours(sent)),
      });
    }
    if (respondedAt) {
      tasks.push({
        Id: sfId("00T"),
        Subject: `Campaign response: ${spec.name}`,
        Type: "Follow-up",
        TaskSubtype: "Task",
        Status: "Completed",
        Priority: "High",
        ActivityDate: isoDate(respondedAt),
        WhoId: c.Id,
        WhatId: id,
        AccountId: a.Id,
        OwnerId: a.OwnerId,
        Description: pick([
          `${c.FirstName} replied asking for pricing for ${a.Number_of_Locations__c} location${a.Number_of_Locations__c > 1 ? "s" : ""}.`,
          `${c.FirstName} requested a demo after the busy season.`,
          `${c.FirstName} called in from the letter; wants to see the producer portal.`,
          `${c.FirstName} forwarded to their controller; asked about settlement automation.`,
        ]),
        CreatedDate: isoDateTime(workHours(respondedAt)),
        CompletedDateTime: isoDateTime(workHours(respondedAt)),
      });
    }
  }
  for (const l of leadTargets) {
    const sent = randomDateBetween(start, addDays(start, 7));
    const responded = chance(spec.responseRate);
    if (responded) responses++;
    campaignMembers.push({
      Id: sfId("00v"),
      CampaignId: id,
      LeadId: l.Id,
      Status: responded ? "Responded" : "Sent",
      HasResponded: responded,
      ...(responded ? { FirstRespondedDate: isoDate(addDays(sent, int(3, 20))) } : {}),
      CreatedDate: isoDateTime(workHours(sent)),
    });
  }
  const sentCount = targets.length + leadTargets.length;
  const actualCost = spec.status === "Completed" ? Math.round(spec.budget * (0.85 + rand() * 0.2)) : Math.round(spec.budget * 0.6);
  campaigns.push({
    Id: id,
    Name: spec.name,
    Type: spec.type,
    Status: spec.status,
    IsActive: spec.status === "In Progress",
    StartDate: spec.start,
    EndDate: spec.end,
    BudgetedCost: spec.budget,
    ActualCost: actualCost,
    ExpectedRevenue: Math.round(sentCount * spec.responseRate * 0.25 * 120000),
    ExpectedResponse: Math.round(spec.responseRate * 100),
    NumberSent: sentCount,
    Description: spec.description,
    OwnerId: CURRENT_USER_ID,
    CreatedDate: isoDateTime(workHours(addDays(start, -int(10, 25)))),
    Season__c: spec.season,
    Target_Regions__c: spec.regions,
    Target_Facility_Types__c: spec.types,
    ...(spec.commodity ? { Target_Commodity__c: spec.commodity } : {}),
  });
  void responses;
}

// ---------------------------------------------------------------------------
// Activity history (12 months of calls, emails, meetings)
// ---------------------------------------------------------------------------
const CALL_SUBJECTS = [
  "Call: intro and current ticketing setup",
  "Call: check-in on harvest volumes",
  "Call: settlement process discovery",
  "Call: follow-up on pricing questions",
  "Call: GM asked to reconnect after busy season",
  "Call: merchandiser position-report pain points",
  "Call: year-end close timeline",
  "Call: reference check request",
];
const CALL_DISPOSITIONS: [string, number][] = [["Connected", 45], ["Left Voicemail", 30], ["No Answer", 15], ["Gatekeeper", 10]];
const EMAIL_SUBJECTS = [
  "Email: harvest readiness checklist",
  "Email: case study: 40% faster settlements",
  "Email: producer portal overview",
  "Email: recap and next steps",
  "Email: pricing for additional locations",
  "Email: DP and basis contract automation",
  "Email: scale kiosk video",
];
const CALL_NOTES = [
  "Still keying scale tickets twice; office manager spends two days on every settlement run.",
  "GM is heads-down until harvest wraps. Asked us to call back after the last corn is in.",
  "Merchandiser builds the daily position in Excel from three systems. Interested in real-time position.",
  "Controller wants to see 1099 and deferred payment handling before the board meeting.",
  "Current vendor raised renewal price 18%. Open to a comparison.",
  "Lines at the scale backed onto the highway last fall. Kiosk tickets resonated.",
  "Discussed drying and shrink discounts; they calculate them by hand today.",
  "Board approves capital projects in January; need a proposal by early December.",
];

function activityCount(a: Account, hasOpp: boolean): number {
  if (hasOpp) return int(4, 10);
  if (a.Type === "Customer - Direct") return int(1, 5);
  return weighted([[0, 35], [int(1, 3), 40], [int(4, 6), 18], [int(7, 10), 7]]);
}

const oppByAccount = new Map<string, Opportunity[]>();
for (const o of opportunities) oppByAccount.set(o.AccountId, [...(oppByAccount.get(o.AccountId) ?? []), o]);

for (const a of accounts) {
  const opps = oppByAccount.get(a.Id) ?? [];
  const openOpp = opps.find((o) => !o.IsClosed);
  const recentOpps = opps.filter((o) => !o.IsClosed || new Date(o.CloseDate) >= HISTORY_START);
  const n = a.ParentId ? (chance(0.2) ? 1 : 0) : activityCount(a, recentOpps.length > 0);
  const people = contactsByAccount.get(a.Id)!;
  for (let i = 0; i < n; i++) {
    const when = workHours(randomDateBetween(HISTORY_START, addDays(ANCHOR, -1)));
    const who = pick(people);
    const relatedOpp = opps.find((o) => new Date(o.CreatedDate) <= when && (!o.IsClosed || new Date(o.CloseDate) >= when));
    const kind = weighted<"call" | "email">([["call", 55], ["email", 45]]);
    if (kind === "call") {
      const disposition = weighted(CALL_DISPOSITIONS);
      tasks.push({
        Id: sfId("00T"),
        Subject: pick(CALL_SUBJECTS),
        Type: "Call",
        TaskSubtype: "Call",
        Status: "Completed",
        Priority: "Normal",
        ActivityDate: isoDate(when),
        WhoId: who.Id,
        WhatId: relatedOpp?.Id ?? a.Id,
        AccountId: a.Id,
        OwnerId: a.OwnerId,
        Description: disposition === "Connected" ? `Spoke with ${who.FirstName} (${who.Title}). ${pick(CALL_NOTES)}` : `${disposition}: ${who.Name}.`,
        CallDisposition: disposition,
        CallDurationInSeconds: disposition === "Connected" ? int(180, 1500) : int(15, 60),
        CreatedDate: isoDateTime(when),
        CompletedDateTime: isoDateTime(when),
      });
    } else {
      tasks.push({
        Id: sfId("00T"),
        Subject: pick(EMAIL_SUBJECTS),
        Type: "Email",
        TaskSubtype: "Email",
        Status: "Completed",
        Priority: "Normal",
        ActivityDate: isoDate(when),
        WhoId: who.Id,
        WhatId: relatedOpp?.Id ?? a.Id,
        AccountId: a.Id,
        OwnerId: a.OwnerId,
        Description: `To: ${who.Email}`,
        CreatedDate: isoDateTime(when),
        CompletedDateTime: isoDateTime(when),
      });
    }
  }
  // Meetings / demos for opportunity accounts
  for (const o of recentOpps) {
    const nEvents = o.StageName === "Prospecting" ? 0 : int(1, 3);
    for (let i = 0; i < nEvents; i++) {
      const start = workHours(randomDateBetween(new Date(o.CreatedDate), o.IsClosed ? new Date(o.CloseDate) : addDays(ANCHOR, -1)));
      const type = weighted<Event["Type"]>([["Demo", 40], ["Meeting", 35], ["Site Visit", 25]]);
      const who = pick(people);
      events.push({
        Id: sfId("00U"),
        Subject: type === "Demo" ? `Demo: ${o.Name.split(" - ")[1] ?? "platform"}` : type === "Site Visit" ? `Site visit: scale house & office walkthrough` : `Meeting: ${pick(["pricing review", "implementation timeline", "executive sponsor", "reference call debrief"])}`,
        Type: type,
        StartDateTime: isoDateTime(start),
        EndDateTime: isoDateTime(new Date(start.getTime() + (type === "Site Visit" ? 3 : 1) * 3600_000)),
        Location: type === "Site Visit" ? `${a.BillingStreet}, ${a.BillingCity}, ${a.BillingState}` : "Zoom",
        WhoId: who.Id,
        WhatId: o.Id,
        AccountId: a.Id,
        OwnerId: a.OwnerId,
        Description: `${type} with ${who.Name} (${who.Title}).`,
        CreatedDate: isoDateTime(addDays(start, -int(3, 14))),
      });
    }
  }
  // Open follow-up task on active deals
  if (openOpp) {
    const due = addDays(ANCHOR, int(-3, 12));
    tasks.push({
      Id: sfId("00T"),
      Subject: `Follow up: ${openOpp.NextStep}`,
      Type: "Follow-up",
      TaskSubtype: "Task",
      Status: "Not Started",
      Priority: openOpp.StageName === "Negotiation" ? "High" : "Normal",
      ActivityDate: isoDate(due),
      WhoId: people[0].Id,
      WhatId: openOpp.Id,
      AccountId: a.Id,
      OwnerId: a.OwnerId,
      Description: openOpp.NextStep,
      CreatedDate: isoDateTime(workHours(addDays(ANCHOR, -int(2, 10)))),
    });
  }
}

// Lead touches
for (const l of leads) {
  if (l.Status === "Open - Not Contacted") continue;
  const n = int(1, 4);
  for (let i = 0; i < n; i++) {
    const when = workHours(randomDateBetween(new Date(l.CreatedDate), addDays(ANCHOR, -1)));
    const call = chance(0.6);
    tasks.push({
      Id: sfId("00T"),
      Subject: call ? pick(CALL_SUBJECTS) : pick(EMAIL_SUBJECTS),
      Type: call ? "Call" : "Email",
      TaskSubtype: call ? "Call" : "Email",
      Status: "Completed",
      Priority: "Normal",
      ActivityDate: isoDate(when),
      WhoId: l.Id,
      OwnerId: l.OwnerId,
      Description: call ? `Spoke with ${l.FirstName}. ${pick(CALL_NOTES)}` : `To: ${l.Email}`,
      ...(call ? { CallDisposition: weighted(CALL_DISPOSITIONS), CallDurationInSeconds: int(30, 900) } : {}),
      CreatedDate: isoDateTime(when),
      CompletedDateTime: isoDateTime(when),
    });
  }
}

tasks.sort((a, b) => a.ActivityDate.localeCompare(b.ActivityDate));
events.sort((a, b) => a.StartDateTime.localeCompare(b.StartDateTime));

// ---------------------------------------------------------------------------
// Monthly price series, Jan 2024 – Dec 2027 (mock but realistic levels)
// ---------------------------------------------------------------------------
const PRICE_SPECS: { key: PriceSeriesKey; label: string; unit: string; currency: "USD" | "CAD"; base: number; vol: number; seasonAmp: number; peakMonth: number }[] = [
  { key: "Corn", label: "Corn (nearby futures)", unit: "$/bu", currency: "USD", base: 4.35, vol: 0.035, seasonAmp: 0.05, peakMonth: 6 },
  { key: "Soybeans", label: "Soybeans (nearby futures)", unit: "$/bu", currency: "USD", base: 10.6, vol: 0.03, seasonAmp: 0.04, peakMonth: 6 },
  { key: "Winter Wheat", label: "HRW wheat (KC futures)", unit: "$/bu", currency: "USD", base: 5.75, vol: 0.04, seasonAmp: 0.05, peakMonth: 3 },
  { key: "Spring Wheat", label: "HRS wheat (MGEX futures)", unit: "$/bu", currency: "USD", base: 6.45, vol: 0.035, seasonAmp: 0.04, peakMonth: 4 },
  { key: "Canola", label: "Canola (ICE futures)", unit: "CAD/t", currency: "CAD", base: 665, vol: 0.03, seasonAmp: 0.04, peakMonth: 6 },
  { key: "Sorghum", label: "Grain sorghum (cash)", unit: "$/bu", currency: "USD", base: 4.05, vol: 0.035, seasonAmp: 0.05, peakMonth: 6 },
  { key: "Barley", label: "Feed barley (cash)", unit: "$/bu", currency: "USD", base: 5.2, vol: 0.025, seasonAmp: 0.04, peakMonth: 5 },
  { key: "Pulses", label: "Yellow peas (cash)", unit: "CAD/bu", currency: "CAD", base: 9.6, vol: 0.03, seasonAmp: 0.04, peakMonth: 5 },
  { key: "Rice", label: "Rough rice (futures)", unit: "$/cwt", currency: "USD", base: 15.4, vol: 0.025, seasonAmp: 0.03, peakMonth: 6 },
  { key: "DDGS", label: "DDGS (FOB plant)", unit: "$/ton", currency: "USD", base: 178, vol: 0.04, seasonAmp: 0.05, peakMonth: 3 },
  { key: "Ethanol", label: "Ethanol (Chicago rack)", unit: "$/gal", currency: "USD", base: 1.86, vol: 0.045, seasonAmp: 0.05, peakMonth: 7 },
  { key: "Soybean Meal", label: "Soybean meal (futures)", unit: "$/ton", currency: "USD", base: 318, vol: 0.035, seasonAmp: 0.04, peakMonth: 6 },
];
/** Narrative tweaks for the 2026 marketing year (big U.S. corn crop, dry Prairies). */
const NARRATIVE: Partial<Record<PriceSeriesKey, { from: string; factor: number }>> = {
  Corn: { from: "2026-06", factor: 0.92 },
  Canola: { from: "2026-06", factor: 1.09 },
  Ethanol: { from: "2026-05", factor: 1.06 },
  Soybeans: { from: "2026-07", factor: 0.97 },
  "Soybean Meal": { from: "2026-07", factor: 0.93 },
};

const prices: PriceSeries[] = PRICE_SPECS.map((spec) => {
  let level = 1;
  const points = [];
  for (let y = 2024; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      level += (1 - level) * 0.15 + (rand() - 0.5) * 2 * spec.vol;
      const seasonal = spec.seasonAmp * Math.cos((2 * Math.PI * (m - spec.peakMonth)) / 12);
      const month = `${y}-${String(m).padStart(2, "0")}`;
      const tweak = NARRATIVE[spec.key];
      const factor = tweak && month >= tweak.from ? tweak.factor : 1;
      const price = spec.base * level * (1 + seasonal) * factor;
      points.push({ month, price: +price.toFixed(spec.base > 100 ? 0 : 2) });
    }
  }
  return { key: spec.key, label: spec.label, unit: spec.unit, currency: spec.currency, points };
});

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const files: Record<string, unknown> = {
  "users.json": USERS,
  "accounts.json": accounts,
  "contacts.json": contacts,
  "leads.json": leads,
  "opportunities.json": opportunities,
  "opportunity-line-items.json": lineItems,
  "campaigns.json": campaigns,
  "campaign-members.json": campaignMembers,
  "tasks.json": tasks,
  "events.json": events,
  "prices.json": prices,
};
for (const [file, data] of Object.entries(files)) {
  writeFileSync(join(OUT_DIR, file), JSON.stringify(data, null, 1) + "\n");
}
// Prebuilt export templates and email sequences
writeExportTemplates(OUT_DIR);
writeSequences(OUT_DIR);

const open = opportunities.filter((o) => !o.IsClosed);
console.log(
  [
    `accounts:      ${accounts.length} (${accounts.filter((a) => a.Type === "Customer - Direct").length} customers; IL ${accounts.filter((a) => a.BillingState === "IL").length}, IA ${accounts.filter((a) => a.BillingState === "IA").length}, feed mills IL+IA ${accounts.filter((a) => (a.BillingState === "IL" || a.BillingState === "IA") && a.Segment__c === "Feed Mill").length})`,
    `closed opps:   ${opportunities.filter((o) => o.IsClosed).length} · by segment ${JSON.stringify(Object.fromEntries(SEGMENTS.map((sg) => [sg, opportunities.filter((o) => o.IsClosed && accounts.find((a) => a.Id === o.AccountId)?.Segment__c === sg).length])))}`,
    `contacts:      ${contacts.length}`,
    `leads:         ${leads.length}`,
    `opportunities: ${opportunities.length} (${open.length} open, $${(open.reduce((s, o) => s + o.Amount, 0) / 1e6).toFixed(2)}M pipeline)`,
    `line items:    ${lineItems.length}`,
    `campaigns:     ${campaigns.length} (${campaignMembers.length} members)`,
    `tasks:         ${tasks.length}`,
    `events:        ${events.length}`,
    `regions:       ${REGIONS.length}`,
  ].join("\n"),
);
