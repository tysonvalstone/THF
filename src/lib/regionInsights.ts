/**
 * Area insights for the Opportunity Map drill-down. Summary lines come from
 * a small config; stats, top accounts and insights are computed from the
 * loaded (mock or live) account and opportunity data.
 */
import { REGION_BY_ID, REGION_BY_STATE } from "@/data/reference/regions";
import { STATE_NAMES } from "@/data/reference/geo";
import type { DataSnapshot } from "@/lib/data/types";
import type { ScoredTarget } from "@/lib/scoring";
import type { Prioritization } from "@/lib/prioritization";
import { blackoutStatus, isSeasonalSegment, nextBoardMeeting, sellingWindowAt, windowRange } from "@/lib/seasonality";
import { phaseLabel, phaseValue, type MapCommodity } from "@/lib/cropCalendar";
import { isCovered } from "@/lib/facilities";
import { fmtShortDate, parseDate } from "@/lib/dates";
import { plural } from "@/lib/format";
import type { Account, RegionId, Segment } from "@/types/salesforce";

/** One-line summaries for key states and provinces (regions use REGIONS[].summary) */
const STATE_SUMMARY: Record<string, string> = {
  IL: "Top-yield corn and soybeans, Illinois River barge terminals and dense processor demand around Decatur.",
  IA: "The largest corn state, with multi-location co-ops, ethanol plants and hog feed mills in every county.",
  NE: "Irrigated corn and soybeans, shuttle loaders on the BNSF and UP, and feedyard demand.",
  MN: "Corn, soybeans and sugar beets, with large co-ops and Red River Valley shuttle loaders.",
  IN: "Corn and soybeans with soft red winter wheat, Ohio River terminals and growing poultry feed demand.",
  OH: "Corn, soybeans and soft wheat serving Lake Erie terminals and eastern feed mills.",
  KS: "Hard red winter wheat and sorghum, with country elevators and large flour mills.",
  ND: "Spring wheat, canola, pulses and soybeans moving by unit train to the PNW.",
  SD: "Corn and soybeans pushing west, shuttle loaders and ethanol plants along I-29.",
  MO: "Corn and soybeans along the Missouri and Mississippi rivers, with barge terminals.",
  WI: "Corn and soybeans alongside the densest dairy feed demand in the country.",
  SK: "Canola, CWRS wheat, durum and pulses at high-throughput inland terminals.",
  AB: "Canola, wheat and barley, with feedlot demand in the south.",
  MB: "Canola, spring wheat and a growing soybean and corn acreage in the Red River Valley.",
  ON: "Corn, soybeans and soft wheat with supply-managed dairy, poultry and hog feed demand.",
};

export type AreaLevel = "all" | "region" | "state";

export interface Area {
  level: AreaLevel;
  regionId?: RegionId;
  state?: string;
}

export function areaName(a: Area): string {
  if (a.level === "state" && a.state) return STATE_NAMES[a.state] ?? a.state;
  if (a.level === "region" && a.regionId) return REGION_BY_ID[a.regionId].name;
  return "North America";
}

/** State/province codes to zoom to */
export function areaCodes(a: Area): string[] {
  if (a.level === "state" && a.state) return [a.state];
  if (a.level === "region" && a.regionId) return REGION_BY_ID[a.regionId].states;
  return [];
}

export function nextArea(current: Area, clickedCode: string): Area | null {
  const regionId = REGION_BY_STATE[clickedCode] as RegionId | undefined;
  if (!regionId) return null;
  if (current.level === "region" && current.regionId === regionId) return { level: "state", regionId, state: clickedCode };
  if (current.level === "state" && current.regionId === regionId) return current.state === clickedCode ? current : { level: "state", regionId, state: clickedCode };
  return { level: "region", regionId };
}

export function inArea(a: Area, state: string): boolean {
  if (a.level === "state") return state === a.state;
  if (a.level === "region") return REGION_BY_STATE[state] === a.regionId;
  return true;
}

export function areaSummary(a: Area): string {
  if (a.level === "state" && a.state) return STATE_SUMMARY[a.state] ?? REGION_BY_ID[REGION_BY_STATE[a.state] as RegionId]?.summary ?? "";
  if (a.level === "region" && a.regionId) return REGION_BY_ID[a.regionId].summary;
  return "Grain, feed and processing facilities across the United States and Canada.";
}

export interface TopAccount {
  account: Account;
  score: number;
  estDeal: number;
  blackout: string;
}

export interface AreaInsights {
  name: string;
  summary: string;
  facilities: number;
  customers: number;
  penetration: { covered: number; total: number; label: string };
  openPipeline: number;
  openDeals: number;
  phase: string;
  top: TopAccount[];
  insights: string[];
}

const SEG_SHORT: Partial<Record<Segment, string>> = {
  "Rail/Shuttle Loader": "shuttle loaders",
  "River Terminal": "river terminals",
  "Country Elevator": "country elevators",
  "Ethanol Plant": "ethanol plants",
  "Feed Mill": "feed mills",
  Processor: "processors",
};

export function computeAreaInsights(
  data: DataSnapshot,
  area: Area,
  asOf: Date,
  commodity: MapCommodity,
  ranked: ScoredTarget[],
  prio: Prioritization,
): AreaInsights {
  const all = data.accounts.filter((a) => inArea(area, a.BillingState));
  const byId = new Map(data.accounts.map((a) => [a.Id, a]));
  const customers = all.filter(isCovered);

  // Penetration: co-op locations where there are any, otherwise all facilities
  const coop = all.filter((a) => a.Segment__c === "Multi-Location Co-op" || !!a.ParentId);
  const penetration =
    coop.length >= 10
      ? { covered: coop.filter(isCovered).length, total: coop.length, label: "co-op locations covered" }
      : { covered: customers.length, total: all.length, label: "facilities covered" };

  const ids = new Set(all.map((a) => a.Id));
  const open = data.opportunities.filter((o) => ids.has(o.AccountId) && parseDate(o.CreatedDate) <= asOf && !(o.IsClosed && parseDate(o.CloseDate) <= asOf));

  // Season phase for the selected commodity at the area's facility-weighted latitude
  const states = [...new Set(all.map((a) => a.BillingState))];
  const lead = area.state ?? states.sort((x, y) => all.filter((a) => a.BillingState === y).length - all.filter((a) => a.BillingState === x).length)[0];
  const lat = all.length ? all.reduce((s, a) => s + a.BillingLatitude, 0) / all.length : 42;
  const phase = lead ? phaseLabel(phaseValue(commodity, lead, lat, asOf)) : "—";

  // Top potential customers: ranked prospect accounts in the area
  const medianDeal = new Map(prio.segments.map((s) => [s.segment, s.stats.medianWonAmount ?? prio.stats.companyMedianWonAmount ?? 50_000]));
  const top: TopAccount[] = ranked
    .filter((s) => s.target.kind === "account" && inArea(area, s.target.state))
    .slice(0, 8)
    .map((s) => {
      const account = byId.get(s.target.id)!;
      const openDeal = open.find((o) => o.AccountId === account.Id);
      const b = blackoutStatus(account, asOf);
      return {
        account,
        score: s.total,
        estDeal: openDeal?.Amount ?? medianDeal.get(account.Segment__c) ?? 50_000,
        blackout: b.status === "hard" ? `Blackout to ${fmtShortDate(b.blackout!.end)}` : b.status === "light" ? "Planting" : "Open",
      };
    });

  // Key insights (pick the three most useful)
  const insights: string[] = [];
  const seasonal = all.filter((a) => isSeasonalSegment(a.Segment__c));
  if (seasonal.length) {
    const statuses = seasonal.map((a) => blackoutStatus(a, asOf)).filter((b) => b.status === "hard");
    if (statuses.length) {
      const ends = statuses.map((b) => b.blackout!.end.getTime());
      const first = new Date(Math.min(...ends));
      const last = new Date(Math.max(...ends));
      insights.push(first.getTime() === last.getTime() ? `Harvest blackout ends ${fmtShortDate(first)}` : `Harvest blackout ends ${fmtShortDate(first)} – ${fmtShortDate(last)}`);
    } else {
      const w = sellingWindowAt(asOf);
      const r = windowRange(w, asOf);
      insights.push(`${w.name} window open through ${fmtShortDate(r.end)}`);
    }
  } else {
    insights.push("Year-round segments only: no harvest blackout");
  }
  const uncovered = new Map<Segment, number>();
  for (const a of all) if (!isCovered(a) && SEG_SHORT[a.Segment__c]) uncovered.set(a.Segment__c, (uncovered.get(a.Segment__c) ?? 0) + 1);
  const bestGap = [...uncovered.entries()].filter(([s]) => s !== "Country Elevator").sort((x, y) => y[1] - x[1])[0] ?? [...uncovered.entries()].sort((x, y) => y[1] - x[1])[0];
  if (bestGap) insights.push(`${plural(bestGap[1], SEG_SHORT[bestGap[0]]!.replace(/s$/, ""), SEG_SHORT[bestGap[0]]!)} with no coverage`);
  const fyCoops = all.filter((a) => a.Segment__c === "Multi-Location Co-op" && !a.ParentId);
  const fyCount = new Map<string, number>();
  for (const a of fyCoops) fyCount.set(a.Fiscal_Year_End__c, (fyCount.get(a.Fiscal_Year_End__c) ?? 0) + 1);
  const topFy = [...fyCount.entries()].sort((x, y) => y[1] - x[1])[0];
  if (topFy && topFy[1] >= 2) {
    insights.push(`${topFy[1]} co-op fiscal years end ${fmtShortDate(`2026-${topFy[0]}`)}`);
  } else {
    const meetings = all
      .filter((a) => !a.ParentId && a.Board_Meeting_Months__c.length)
      .map((a) => nextBoardMeeting(a.Board_Meeting_Months__c, asOf))
      .filter((d): d is Date => !!d && d.getUTCMonth() === asOf.getUTCMonth() && d.getUTCFullYear() === asOf.getUTCFullYear());
    if (meetings.length) insights.push(`${plural(meetings.length, "board meeting")} this month`);
    else if (open.length) insights.push(`${plural(open.length, "open deal")} in the area`);
  }

  return {
    name: areaName(area),
    summary: areaSummary(area),
    facilities: all.length,
    customers: customers.length,
    penetration,
    openPipeline: open.reduce((s, o) => s + o.Amount, 0),
    openDeals: open.length,
    phase,
    top,
    insights: insights.slice(0, 3),
  };
}

/** Estimated deal size: the account's open deal, else its segment's median won deal */
export function estimateDeal(account: Account, openAmountByAccount: Map<string, number>, prio: Prioritization): number {
  const open = openAmountByAccount.get(account.Id);
  if (open) return open;
  const seg = prio.segments.find((s) => s.segment === account.Segment__c);
  return seg?.stats.medianWonAmount ?? prio.stats.companyMedianWonAmount ?? 50_000;
}

export function blackoutLabel(account: Account, asOf: Date): { text: string; blocked: boolean } {
  const b = blackoutStatus(account, asOf);
  if (b.status === "hard") return { text: `No contact to ${fmtShortDate(b.blackout!.end)}`, blocked: true };
  if (b.status === "light") return { text: "Planting (light)", blocked: false };
  return { text: "Open", blocked: false };
}
