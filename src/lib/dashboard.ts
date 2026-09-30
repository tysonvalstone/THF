/**
 * Home dashboard calculations. Everything is computed for the time-travel date.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Prioritization } from "@/lib/prioritization";
import type { ScoredTarget } from "@/lib/scoring";
import type { Account, Commodity, OpportunityStage } from "@/types/salesforce";
import { OPEN_STAGES } from "@/types/salesforce";
import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { blackoutStatus, nextBoardMeeting, SELLING_WINDOWS, windowRange } from "@/lib/seasonality";
import { harvestWindow, phaseValue, plantingWindow, type MapCommodity } from "@/lib/cropCalendar";
import { estimateDeal } from "@/lib/regionInsights";
import { addDays, diffDays, parseDate, toISODate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";

/* ---------------------------------------------------------------- KPIs */

/** Open on the date (a deal created any time on the as-of day counts) */
export const isOpenAt = (o: { CreatedDate: string; IsClosed: boolean; CloseDate: string }, d: Date) =>
  o.CreatedDate.slice(0, 10) <= toISODate(d) && !(o.IsClosed && parseDate(o.CloseDate) <= d);

export function pipelineAt(data: DataSnapshot, d: Date) {
  const open = data.opportunities.filter((o) => isOpenAt(o, d));
  return {
    count: open.length,
    total: open.reduce((s, o) => s + o.Amount, 0),
    weighted: open.reduce((s, o) => s + (o.Amount * o.Probability) / 100, 0),
  };
}

function wonBetween(data: DataSnapshot, start: Date, end: Date) {
  return data.opportunities.filter((o) => o.IsWon && parseDate(o.CloseDate) > start && parseDate(o.CloseDate) <= end);
}

/** Quarter-to-date closed won, compared with the same number of days into the previous quarter */
export function closedWonQuarter(data: DataSnapshot, asOf: Date) {
  const q = Math.floor(asOf.getUTCMonth() / 3);
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), q * 3, 1));
  const prevStart = new Date(Date.UTC(asOf.getUTCFullYear(), q * 3 - 3, 1));
  const into = diffDays(asOf, start);
  const sum = (s: Date, e: Date) => wonBetween(data, addDays(s, -1), e).reduce((t, o) => t + o.Amount, 0);
  return { now: sum(start, asOf), prev: sum(prevStart, addDays(prevStart, into)), quarter: `Q${q + 1}` };
}

export function winRate(data: DataSnapshot, end: Date) {
  const start = addDays(end, -365);
  const closed = data.opportunities.filter((o) => o.IsClosed && parseDate(o.CloseDate) > start && parseDate(o.CloseDate) <= end);
  return closed.length ? closed.filter((o) => o.IsWon).length / closed.length : null;
}

export function avgDealSize(data: DataSnapshot, end: Date) {
  const won = wonBetween(data, addDays(end, -365), end);
  return won.length ? won.reduce((s, o) => s + o.Amount, 0) / won.length : null;
}

/* -------------------------------------------------------------- charts */

export function pipelineByStage(data: DataSnapshot, asOf: Date): { stage: OpportunityStage; amount: number; count: number }[] {
  const open = data.opportunities.filter((o) => isOpenAt(o, asOf));
  return OPEN_STAGES.map((stage) => {
    const inStage = open.filter((o) => o.StageName === stage);
    return { stage, amount: inStage.reduce((s, o) => s + o.Amount, 0), count: inStage.length };
  });
}

export function closedWonByMonth(data: DataSnapshot, asOf: Date): { key: string; label: string; amount: number; count: number }[] {
  const out = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - i, 1));
    const end = i === 0 ? asOf : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const won = wonBetween(data, addDays(start, -1), end);
    out.push({
      key: toISODate(start).slice(0, 7),
      label: start.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      amount: won.reduce((s, o) => s + o.Amount, 0),
      count: won.length,
    });
  }
  return out;
}

/* ------------------------------------------------------- season phases */

export type Phase = "planting" | "growing" | "harvest" | "post-harvest" | "off-season";

export function toMapCommodity(c: Commodity): MapCommodity | null {
  if (c === "Corn" || c === "Soybeans" || c === "Rice") return c;
  if (c === "Winter Wheat" || c === "Spring Wheat") return "Wheat";
  if (c === "Pulses") return "Lentils";
  return null;
}

/**
 * Planting / harvest from the crop-calendar phase value (|v| ≥ 0.5); post-harvest
 * for 120 days after the harvest window ends; growing between the planting and
 * harvest windows; off-season otherwise.
 */
export function phaseAt(commodity: MapCommodity, state: string, lat: number, date: Date): Phase | null {
  const v = phaseValue(commodity, state, lat, date);
  if (v === null) return null;
  if (v <= -0.5) return "planting";
  if (v >= 0.5) return "harvest";
  const y = date.getUTCFullYear();
  for (const year of [y, y - 1]) {
    const h = harvestWindow(commodity, state, lat, year);
    if (h && h.end < date && diffDays(date, h.end) <= 120) return "post-harvest";
  }
  const p = plantingWindow(commodity, state, lat, y);
  const h = harvestWindow(commodity, state, lat, y);
  if (p && h && date > p.end && date < h.start) return "growing";
  return "off-season";
}

const PHASE_WHY: Record<Phase, string> = {
  "post-harvest": "Harvest is in. Buyers are reviewing the year and setting next year's budgets.",
  "off-season": "Quiet months on the farm: time for planning, demos and implementations.",
  growing: "Crop is in the ground. A good window for demos before harvest prep starts.",
  planting: "Planting is under way. Keep outreach short and focus on quick wins.",
  harvest: "Crop is coming in. Support customers and sell to year-round buyers.",
};
const PHASE_FACTOR: Record<Phase, number> = { "post-harvest": 1.25, "off-season": 1.1, growing: 1, planting: 0.6, harvest: 0.4 };
const BLACKOUT_FACTOR = { none: 1, light: 0.6, hard: 0.1 } as const;

export interface TopCommodity {
  commodity: MapCommodity;
  phase: Phase;
  regions: string[];
  accounts: number;
  outOfBlackout: number;
  why: string;
}

export interface TopRegion {
  regionId: string;
  name: string;
  outOfBlackout: number;
  accounts: number;
  openPipeline: number;
}

/** Top commodity and region to work this month, from seasonality + ranking */
export function focusThisMonth(data: DataSnapshot, asOf: Date, prio: Prioritization, ranked: ScoredTarget[]): { commodity: TopCommodity | null; region: TopRegion | null } {
  const score = new Map(ranked.map((r) => [r.target.id, r.total]));
  const openBy = new Map<string, number>();
  for (const o of data.opportunities) if (isOpenAt(o, asOf)) openBy.set(o.AccountId, (openBy.get(o.AccountId) ?? 0) + o.Amount);
  const parents = data.accounts.filter((a) => !a.ParentId);

  // Value of an account right now: estimated deal × prospect score, discounted by blackout
  const value = (a: Account) => {
    const b = blackoutStatus(a, asOf).status;
    const s = (score.get(a.Id) ?? 50) / 100;
    return { v: estimateDeal(a, openBy, prio) * s * BLACKOUT_FACTOR[b], open: b === "none" };
  };

  // Commodity
  const byCommodity = new Map<MapCommodity, { total: number; accounts: number; open: number; phases: Map<Phase, number>; regions: Map<string, number> }>();
  const byRegion = new Map<string, { total: number; accounts: number; open: number; pipeline: number }>();
  for (const a of parents) {
    const { v, open } = value(a);
    const r = byRegion.get(a.Region__c) ?? { total: 0, accounts: 0, open: 0, pipeline: 0 };
    r.total += v;
    r.accounts += 1;
    r.open += open ? 1 : 0;
    r.pipeline += openBy.get(a.Id) ?? 0;
    byRegion.set(a.Region__c, r);

    const mc = toMapCommodity(a.Primary_Commodities__c[0]);
    if (!mc) continue;
    const phase = phaseAt(mc, a.BillingState, a.BillingLatitude, asOf);
    if (!phase) continue;
    const c = byCommodity.get(mc) ?? { total: 0, accounts: 0, open: 0, phases: new Map(), regions: new Map() };
    c.total += v * PHASE_FACTOR[phase];
    c.accounts += 1;
    c.open += open ? 1 : 0;
    c.phases.set(phase, (c.phases.get(phase) ?? 0) + 1);
    c.regions.set(`${a.Region__c}|${phase}`, (c.regions.get(`${a.Region__c}|${phase}`) ?? 0) + 1);
    byCommodity.set(mc, c);
  }

  const bestC = [...byCommodity.entries()].sort((x, y) => y[1].total - x[1].total)[0];
  let commodity: TopCommodity | null = null;
  if (bestC) {
    const [mc, c] = bestC;
    const phase = [...c.phases.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const regions = [...c.regions.entries()]
      .filter(([k]) => k.endsWith(`|${phase}`))
      .sort((x, y) => y[1] - x[1])
      .slice(0, 2)
      .map(([k]) => REGION_BY_ID[k.split("|")[0] as keyof typeof REGION_BY_ID]?.name ?? k);
    commodity = { commodity: mc, phase, regions, accounts: c.accounts, outOfBlackout: c.open, why: PHASE_WHY[phase] };
  }

  const bestR = [...byRegion.entries()].sort((x, y) => y[1].total - x[1].total)[0];
  const region: TopRegion | null = bestR
    ? {
        regionId: bestR[0],
        name: REGION_BY_ID[bestR[0] as keyof typeof REGION_BY_ID]?.name ?? bestR[0],
        outOfBlackout: bestR[1].open,
        accounts: bestR[1].accounts,
        openPipeline: bestR[1].pipeline,
      }
    : null;
  return { commodity, region };
}

/* ------------------------------------------------------------- upcoming */

export interface UpcomingItem {
  date: Date;
  kind: "blackout" | "window" | "board" | "close";
  title: string;
  detail: string;
  href?: string;
}

/** Next key dates after asOf: blackouts ending, selling windows opening, board meetings, deals closing */
export function upcoming(data: DataSnapshot, asOf: Date, limit = 5): UpcomingItem[] {
  const horizon = addDays(asOf, 120);
  const items: UpcomingItem[] = [];

  // Blackouts ending, grouped by region (earliest end in each)
  const ends = new Map<string, { date: Date; count: number }>();
  for (const a of data.accounts) {
    if (a.ParentId) continue;
    const b = blackoutStatus(a, asOf);
    if (b.status !== "hard" || !b.blackout) continue;
    const cur = ends.get(a.Region__c);
    ends.set(a.Region__c, { date: cur && cur.date < b.blackout.end ? cur.date : b.blackout.end, count: (cur?.count ?? 0) + 1 });
  }
  for (const [regionId, e] of ends) {
    items.push({
      date: e.date,
      kind: "blackout",
      title: `Harvest blackout ends · ${REGION_BY_ID[regionId as keyof typeof REGION_BY_ID]?.name ?? regionId}`,
      detail: `${e.count} account${e.count === 1 ? "" : "s"}`,
      href: `/map?region=${regionId}`,
    });
  }

  // Selling windows opening
  for (const w of SELLING_WINDOWS) {
    const r = windowRange(w, addDays(asOf, 1));
    if (r.start > asOf && r.start <= horizon) items.push({ date: r.start, kind: "window", title: `${w.name} opens`, detail: w.when, href: "/calendar" });
  }

  // Board meetings for accounts with open deals
  const openAccounts = new Set(data.opportunities.filter((o) => isOpenAt(o, asOf)).map((o) => o.AccountId));
  const byId = new Map(data.accounts.map((a) => [a.Id, a]));
  const boards: UpcomingItem[] = [];
  for (const id of openAccounts) {
    const a = byId.get(id);
    const m = a && nextBoardMeeting(a.Board_Meeting_Months__c, addDays(asOf, 1));
    if (a && m && m <= horizon) boards.push({ date: m, kind: "board", title: `Board meeting · ${a.Name}`, detail: "Open deal", href: `/accounts/${a.Id}` });
  }
  items.push(...boards.sort((x, y) => +x.date - +y.date).slice(0, 3));

  // Deals scheduled to close
  const closes = data.opportunities
    .filter((o) => isOpenAt(o, asOf) && parseDate(o.CloseDate) > asOf && parseDate(o.CloseDate) <= horizon)
    .sort((x, y) => y.Amount - x.Amount)
    .slice(0, 3)
    .map<UpcomingItem>((o) => ({ date: parseDate(o.CloseDate), kind: "close", title: `Close date · ${o.Name}`, detail: fmtMoney(o.Amount), href: `/opportunities/${o.Id}` }));
  items.push(...closes);

  // Next five, at most two of a kind
  const perKind = new Map<string, number>();
  return items
    .filter((i) => i.date > asOf)
    .sort((x, y) => +x.date - +y.date)
    .filter((i) => {
      const n = perKind.get(i.kind) ?? 0;
      perKind.set(i.kind, n + 1);
      return n < 2;
    })
    .slice(0, limit);
}

export const REGION_NAME = (id: string) => REGION_BY_ID[id as keyof typeof REGION_BY_ID]?.name ?? REGIONS.find((r) => r.id === id)?.name ?? id;

/* ------------------------------------------------------ closed won mix */

export interface MixRow {
  key: string;
  label: string;
  value: number;
  count: number;
}

/** Closed-won dollars in the trailing `days` by rep, product, commodity and region */
export function closedWonMix(data: DataSnapshot, asOf: Date, users: Record<string, { Name: string }>, days = 365) {
  const since = addDays(asOf, -days);
  const won = data.opportunities.filter((o) => o.IsWon && parseDate(o.CloseDate) > since && parseDate(o.CloseDate) <= asOf);
  const byAccount = new Map(data.accounts.map((a) => [a.Id, a]));
  const productName = new Map(data.products.map((p) => [p.Id, p.Name]));
  const add = (m: Map<string, MixRow>, key: string, label: string, value: number) => {
    const r = m.get(key) ?? { key, label, value: 0, count: 0 };
    r.value += value;
    r.count += 1;
    m.set(key, r);
  };
  const rep = new Map<string, MixRow>();
  const product = new Map<string, MixRow>();
  const commodity = new Map<string, MixRow>();
  const region = new Map<string, MixRow>();
  const wonIds = new Set(won.map((o) => o.Id));
  for (const o of won) {
    add(rep, o.OwnerId, users[o.OwnerId]?.Name ?? "Other", o.Amount);
    const a = byAccount.get(o.AccountId);
    const c = a?.Primary_Commodities__c[0];
    add(commodity, c ?? "Other", c ?? "Other", o.Amount);
    if (a) add(region, a.Region__c, REGION_NAME(a.Region__c), o.Amount);
  }
  for (const li of data.lineItems) if (wonIds.has(li.OpportunityId)) add(product, li.Product2Id, productName.get(li.Product2Id) ?? "Other", li.TotalPrice);
  const sorted = (m: Map<string, MixRow>) => [...m.values()].sort((x, y) => y.value - x.value);
  return { total: won.reduce((s, o) => s + o.Amount, 0), deals: won.length, rep: sorted(rep), product: sorted(product), commodity: sorted(commodity), region: sorted(region) };
}
