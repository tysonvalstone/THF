/**
 * Harvest-day summary shared with Quoting (board packet), Campaigns (mailer)
 * and prospect ranking. The model itself lives in ./engine.ts.
 */
import type { jsPDF } from "jspdf";
import type { Account } from "@/types/salesforce";
import type { DataSnapshot } from "@/lib/data/types";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { generateTrucks, mayLoseTrucks, quickLoss, simulateDay, type DaySim, type FacilityInput, type Truck } from "./engine";

export interface SimSettings {
  /** Minutes per truck at scale + probe, manual process */
  manualMinutes: number;
  /** Minutes per truck with ScaleTrac + GrainSight Mobile */
  automatedMinutes: number;
  /** A truck leaves when its wait passes this */
  waitLimitMinutes: number;
  /** Handling margin, $ per bushel */
  marginPerBu: number;
  /** Working harvest days in the season */
  seasonDays: number;
}

export const DEFAULT_SIM_SETTINGS: SimSettings = { manualMinutes: 5, automatedMinutes: 2, waitLimitMinutes: 45, marginPerBu: 0.2, seasonDays: 45 };

export interface HarvestSummary {
  accountId: string;
  facilityName: string;
  competitorName: string | null;
  /** Straight-line miles to the competitor */
  competitorMiles: number | null;
  /** Compass direction from the facility to the competitor, e.g. "NW" */
  competitorDirection: string | null;
  location: string;
  scales: number;
  pits: number;
  pitRateBph: number;
  yieldFactor: number;
  dailyBushels: number;
  trucksPerDay: number;
  manual: DayResult;
  automated: DayResult;
  /** Season dollars saved by automation (manual − automated losses) */
  seasonSavings: number;
  /** Bushels kept per day with automation */
  bushelsSavedPerDay: number;
  settings: SimSettings;
  /** Optional read-only link (set it from harvestShareUrl before drawing the PDF) */
  shareUrl?: string;
}

export interface DayResult {
  worstHour: { label: string; trucksWaiting: number; waitMinutes: number };
  trucksLost: number;
  bushelsLostPerDay: number;
  dollarsLostPerDay: number;
  seasonBushelsLost: number;
  seasonDollarsLost: number;
  trucksServed: number;
  maxQueue: number;
  maxWait: number;
}

export function resolveSettings(s: Partial<SimSettings> = {}): SimSettings {
  const out = { ...DEFAULT_SIM_SETTINGS };
  for (const k of Object.keys(out) as (keyof SimSettings)[]) {
    const v = s[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Facilities and competitors
// ---------------------------------------------------------------------------
/** Engine input for an account; null when it doesn't receive grain by truck */
export function facilityFromAccount(a: Account): FacilityInput | null {
  if (a.Facility_Type__c === "Agronomy Retailer") return null;
  if (!a.Scales__c || !a.Dump_Pits__c || !a.Dump_Pit_Rate_Bph__c) return null;
  const f: FacilityInput = {
    id: a.Id,
    facilityType: a.Facility_Type__c,
    segment: a.Segment__c,
    storageBu: a.Storage_Capacity_Bu__c,
    gallons: a.Annual_Production_Gal__c,
    tons: a.Annual_Production_Tons__c,
    locations: a.Number_of_Locations__c,
    coopParent: a.Facility_Type__c === "Cooperative" && !a.ParentId,
    scales: a.Scales__c,
    pits: a.Dump_Pits__c,
    pitRateBph: a.Dump_Pit_Rate_Bph__c,
    yieldFactor: a.County_Yield_Factor__c ?? 1,
  };
  return f.storageBu || f.gallons || f.tons ? f : null;
}

/** Grain-receiving facilities a farmer could haul to instead */
export function isGrainReceiver(a: Account): boolean {
  return a.Facility_Type__c === "Grain Elevator" || a.Facility_Type__c === "Cooperative";
}

export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing, degrees clockwise from north */
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

export const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];

export interface Competitor {
  account: Account;
  miles: number;
  bearing: number;
  direction: string;
}

const sameFamily = (a: Account, b: Account) => a.Id === b.Id || a.ParentId === b.Id || b.ParentId === a.Id || (!!a.ParentId && a.ParentId === b.ParentId);

const parentsCache = new WeakMap<Account[], Set<string>>();
function parentIds(accounts: Account[]): Set<string> {
  let set = parentsCache.get(accounts);
  if (!set) {
    set = new Set(accounts.map((c) => c.ParentId).filter((x): x is string => !!x));
    parentsCache.set(accounts, set);
  }
  return set;
}

/** The nearest other grain-receiving facility outside the account's own co-op */
export function nearestCompetitor(a: Account, accounts: Account[]): Competitor | null {
  const here = { lat: a.BillingLatitude, lon: a.BillingLongitude };
  if (!Number.isFinite(here.lat) || !Number.isFinite(here.lon)) return null;
  const parents = parentIds(accounts);
  let best: Account | null = null;
  let bestMiles = Infinity;
  for (const b of accounts) {
    if (!isGrainReceiver(b) || sameFamily(a, b) || !Number.isFinite(b.BillingLatitude)) continue;
    // A co-op parent is its head office; its locations compete, not the parent
    if (parents.has(b.Id)) continue;
    const d = milesBetween(here, { lat: b.BillingLatitude, lon: b.BillingLongitude });
    if (d < bestMiles) {
      bestMiles = d;
      best = b;
    }
  }
  if (!best) return null;
  const bearing = bearingDeg(here, { lat: best.BillingLatitude, lon: best.BillingLongitude });
  return { account: best, miles: bestMiles, bearing, direction: compass(bearing) };
}

// ---------------------------------------------------------------------------
// Summaries (cached per account inputs + settings)
// ---------------------------------------------------------------------------
const truckCache = new Map<string, Truck[]>();
const facilityKey = (f: FacilityInput) => JSON.stringify(f);

/** The facility's trucks for the day (cached; same facility, same trucks) */
export function trucksFor(f: FacilityInput): Truck[] {
  const k = facilityKey(f);
  let t = truckCache.get(k);
  if (!t) {
    if (truckCache.size > 3000) truckCache.clear();
    t = generateTrucks(f);
    truckCache.set(k, t);
  }
  return t;
}

export function dayResult(sim: Pick<DaySim, "worstHour" | "trucksLost" | "bushelsLost" | "trucksServed" | "maxQueue" | "maxWait">, s: SimSettings): DayResult {
  const dollars = sim.bushelsLost * s.marginPerBu;
  return {
    worstHour: { label: sim.worstHour.label, trucksWaiting: sim.worstHour.trucksWaiting, waitMinutes: sim.worstHour.waitMinutes },
    trucksLost: sim.trucksLost,
    bushelsLostPerDay: sim.bushelsLost,
    dollarsLostPerDay: Math.round(dollars),
    seasonBushelsLost: Math.round(sim.bushelsLost * s.seasonDays),
    seasonDollarsLost: Math.round(dollars * s.seasonDays),
    trucksServed: sim.trucksServed,
    maxQueue: sim.maxQueue,
    maxWait: sim.maxWait,
  };
}

/** Both scenarios for one facility, from the account and its competitor (no snapshot needed) */
export function summarize(account: Account, competitor: Competitor | null, settings: Partial<SimSettings> = {}): HarvestSummary | null {
  const f = facilityFromAccount(account);
  if (!f) return null;
  const s = resolveSettings(settings);
  const trucks = trucksFor(f);
  const manual = simulateDay(f, { serviceMinutes: s.manualMinutes, waitLimitMinutes: s.waitLimitMinutes }, trucks);
  const automated = simulateDay(f, { serviceMinutes: s.automatedMinutes, waitLimitMinutes: s.waitLimitMinutes }, trucks);
  const m = dayResult(manual, s);
  const a = dayResult(automated, s);
  return {
    accountId: account.Id,
    facilityName: account.Name,
    competitorName: competitor?.account.Name ?? null,
    competitorMiles: competitor ? Math.round(competitor.miles * 10) / 10 : null,
    competitorDirection: competitor?.direction ?? null,
    location: [account.BillingCity, account.BillingState].filter(Boolean).join(", "),
    scales: f.scales,
    pits: f.pits,
    pitRateBph: f.pitRateBph,
    yieldFactor: f.yieldFactor,
    dailyBushels: manual.dailyBushels,
    trucksPerDay: trucks.length,
    manual: m,
    automated: a,
    seasonSavings: Math.max(0, m.seasonDollarsLost - a.seasonDollarsLost),
    bushelsSavedPerDay: Math.max(0, m.bushelsLostPerDay - a.bushelsLostPerDay),
    settings: s,
  };
}

const summaryCache = new Map<string, HarvestSummary | null>();

/** Runs both scenarios for a facility (fast, deterministic). Null when the facility doesn't receive grain by truck. */
export function harvestSummaryFor(account: Account, data: DataSnapshot, settings: Partial<SimSettings> = {}): HarvestSummary | null {
  const f = facilityFromAccount(account);
  if (!f) return null;
  const s = resolveSettings(settings);
  const key = `${facilityKey(f)}|${JSON.stringify(s)}|${account.Name}|${account.BillingLatitude},${account.BillingLongitude}|${data.accounts.length}`;
  if (summaryCache.has(key)) return summaryCache.get(key)!;
  const out = summarize(account, nearestCompetitor(account, data.accounts), s);
  if (summaryCache.size > 500) summaryCache.clear();
  summaryCache.set(key, out);
  return out;
}

const riskCache = new Map<string, number>();

/** Modeled season dollars at risk (manual process), from the engine; cached per inputs */
export function estimateHarvestRisk(account: Account, settings: Partial<SimSettings> = {}): number | null {
  const f = facilityFromAccount(account);
  if (!f) return null;
  const s = resolveSettings(settings);
  const key = `${facilityKey(f)}|${s.manualMinutes}|${s.waitLimitMinutes}`;
  let bu = riskCache.get(key);
  if (bu === undefined) {
    const es = { serviceMinutes: s.manualMinutes, waitLimitMinutes: s.waitLimitMinutes };
    // Facilities that clearly keep up skip the simulation (tested to match it)
    bu = mayLoseTrucks(f, es) ? quickLoss(f, es, trucksFor(f)).bushelsLost : 0;
    if (riskCache.size > 5000) riskCache.clear();
    riskCache.set(key, bu);
  }
  return Math.round(bu * s.marginPerBu * s.seasonDays);
}

/** Season dollars at risk: the saved value when the simulator was saved to the account, else the estimate */
export function harvestRiskFor(account: Account): { dollars: number; saved: boolean } | null {
  if (typeof account.Harvest_At_Risk__c === "number") return { dollars: account.Harvest_At_Risk__c, saved: true };
  const d = estimateHarvestRisk(account);
  return d === null ? null : { dollars: d, saved: false };
}

// ---------------------------------------------------------------------------
// PDF card (board packet)
// ---------------------------------------------------------------------------
type RGB = [number, number, number];
const SLATE_900: RGB = [15, 23, 42];
const SLATE_500: RGB = [100, 116, 139];
const SLATE_200: RGB = [226, 232, 240];
const GREEN: RGB = [31, 95, 74];
const GOLD: RGB = [181, 130, 30];
const RED: RGB = [185, 28, 28];

/** Draws the summary card into a jsPDF document (units: pt); returns the y below it */
export function drawHarvestSummaryPdf(doc: jsPDF, summary: HarvestSummary, x: number, y: number, width: number): number {
  const s = summary;
  const pad = 14;
  const inner = width - pad * 2;
  const left = x + pad;
  const right = x + width - pad;
  const rowH = 16;

  let cy = y + pad + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...SLATE_900);
  doc.text("Harvest day at risk", left, cy);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_500);
  const where = `${s.facilityName}${s.location ? ` · ${s.location}` : ""}`;
  doc.text(doc.splitTextToSize(where, inner * 0.6)[0] as string, right, cy, { align: "right" });

  // Facility facts, wrapped to the card
  const facts = [`${fmtNumber(s.dailyBushels)} bu peak day`, `${fmtNumber(s.trucksPerDay)} trucks`, `${s.scales} scale${s.scales === 1 ? "" : "s"}`, `${s.pits} pit${s.pits === 1 ? "" : "s"} at ${fmtNumber(s.pitRateBph)} bu/h`].join("   ·   ");
  const competitor = s.competitorName ? `Nearest competitor: ${s.competitorName}, ${s.competitorMiles} mi ${s.competitorDirection}` : "";
  const factLines = [...(doc.splitTextToSize(facts, inner) as string[]), ...(competitor ? (doc.splitTextToSize(competitor, inner) as string[]) : [])];
  for (const line of factLines) {
    cy += 12;
    doc.text(line, left, cy);
  }

  // Manual vs automated
  cy += 18;
  const cols = [left, left + inner * 0.56, left + inner * 0.78, right];
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text("Worst hour", cols[1], cy, { align: "right" });
  doc.text("Lost per day", cols[2], cy, { align: "right" });
  doc.text(`Season (${s.settings.seasonDays} days)`, cols[3], cy, { align: "right" });
  cy += 5;
  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.8);
  doc.line(left, cy, right, cy);
  const row = (label: string, d: DayResult, color: RGB) => {
    cy += rowH;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_900);
    doc.text(label, cols[0], cy);
    doc.setFont("helvetica", "normal");
    doc.text(`${d.worstHour.label}: ${d.worstHour.trucksWaiting} trucks, ${d.worstHour.waitMinutes} min`, cols[1], cy, { align: "right" });
    doc.text(`${fmtNumber(d.bushelsLostPerDay)} bu · ${fmtMoney(d.dollarsLostPerDay, { compact: false })}`, cols[2], cy, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...color);
    doc.text(fmtMoney(d.seasonDollarsLost, { compact: false }), cols[3], cy, { align: "right" });
  };
  row(`Manual · ${s.settings.manualMinutes} min/truck`, s.manual, s.manual.seasonDollarsLost > 0 ? RED : SLATE_900);
  row(`Automated · ${s.settings.automatedMinutes} min/truck`, s.automated, SLATE_900);
  cy += 8;
  doc.line(left, cy, right, cy);

  cy += 18;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...GREEN);
  doc.text(`Saved with ScaleTrac + GrainSight Mobile: ${fmtMoney(s.seasonSavings, { compact: false })} per harvest`, left, cy);
  cy += 13;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...SLATE_500);
  doc.text(`${fmtNumber(s.bushelsSavedPerDay)} bu/day kept · $${s.settings.marginPerBu.toFixed(2)}/bu margin · trucks leave after ${s.settings.waitLimitMinutes} min`, left, cy, { maxWidth: inner });
  if (s.shareUrl) {
    cy += 14;
    const label = "See your harvest day: ";
    doc.text(label, left, cy);
    const lx = left + doc.getTextWidth(label);
    // Long signed links are shortened on the page; the link itself is complete
    let shown = s.shareUrl;
    while (shown.length > 24 && doc.getTextWidth(shown) > right - lx) shown = `${shown.slice(0, -2)}`;
    if (shown !== s.shareUrl) shown = `${shown.slice(0, -1)}…`;
    doc.setTextColor(...GREEN);
    doc.textWithLink(shown, lx, cy, { url: s.shareUrl });
  }
  const height = cy + pad - y;

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.8);
  doc.roundedRect(x, y, width, height, 4, 4, "S");
  doc.setFillColor(...GOLD);
  doc.rect(x, y + 4, 3, height - 8, "F");
  doc.setTextColor(0);
  doc.setFont("helvetica", "normal");
  return y + height;
}

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------
/** Read-only share link for a facility's simulator page (signed server-side) */
export async function harvestShareUrl(accountId: string, settings?: Partial<SimSettings>): Promise<string | null> {
  try {
    if (typeof window !== "undefined") {
      const res = await fetch("/api/share/harvest-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, settings }),
      });
      if (!res.ok) return null;
      const { url } = (await res.json()) as { url?: string };
      return url ?? null;
    }
    // Server: sign directly
    const { createShareToken, sharePath } = await import("./share-token");
    const host = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
    return host.replace(/\/$/, "") + sharePath(await createShareToken(accountId, settings));
  } catch {
    return null;
  }
}
