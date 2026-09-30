/**
 * Sales forecast for a month or quarter, by rep and team.
 *
 * Pure: everything is computed from a DataSnapshot and an as-of date, so time
 * travel works (deals created later are ignored, deals closed later count as
 * still open).
 *
 *   Effective category = manager override ?? rep category ?? derived from stage.
 *   Weighted           = Amount × stage probability.
 *   Seasonal factor    = segment close rate in the close month ÷ segment overall
 *                        close rate (clamped 0.3–1.7), from decided history.
 *   Seasonal expected  = Closed + Σ open Amount × min(1, probability × factor).
 *   Projected (what-if)= Closed + Σ open Amount × size × (1 − slippage)
 *                        × min(1, probability × factor × win-rate multiplier).
 *   Attainment         = Closed ÷ quota. Quotas are quarterly; a month is ⅓.
 */
import type { DataSnapshot } from "@/lib/data/types";
import { computeStats, estimateRate, type RateEstimate } from "@/lib/stats";
import { toOppRecords } from "@/lib/prioritization";
import { harvestWindowFor, isSeasonalSegment } from "@/lib/seasonality";
import { parseDate } from "@/lib/dates";
import { USER_BY_ID } from "@/data/reference/users";
import { SEGMENTS, type Account, type ForecastCategory, type Opportunity, type OpportunityStage, type Segment } from "@/types/salesforce";

export type Granularity = "month" | "quarter";

export interface WhatIf {
  /** Multiplier on every open deal's win probability (1 = as is) */
  winRate: number;
  /** Multiplier on open deal amounts (1 = as is) */
  dealSize: number;
  /** Percent of open value pushed out of the period, 0–100 */
  slippagePct: number;
}

export const DEFAULT_WHAT_IF: WhatIf = { winRate: 1, dealSize: 1, slippagePct: 0 };

export interface ForecastOptions {
  granularity?: Granularity;
  /** Periods from the as-of period: 0 = current, 1 = next, −1 = previous */
  offset?: number;
  /** Only this rep's deals and quota */
  ownerId?: string;
  whatIf?: Partial<WhatIf>;
}

export interface PeriodRange {
  /** "2026-Q4" or "2026-10" */
  key: string;
  /** "Q4 2026" or "Oct 2026" */
  label: string;
  granularity: Granularity;
  start: Date;
  /** Exclusive */
  end: Date;
  /** The quarter the period belongs to ("2026-Q4") */
  quarter: string;
}

export const CATEGORIES: ForecastCategory[] = ["Pipeline", "Best Case", "Commit", "Closed", "Omitted"];
/** Categories a person can pick for an open deal */
export const OPEN_CATEGORIES: ForecastCategory[] = ["Pipeline", "Best Case", "Commit", "Omitted"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export function periodFor(asOf: Date, granularity: Granularity = "quarter", offset = 0): PeriodRange {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  if (granularity === "month") {
    const start = new Date(Date.UTC(y, m + offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const sy = start.getUTCFullYear();
    const sm = start.getUTCMonth();
    return {
      key: `${sy}-${String(sm + 1).padStart(2, "0")}`,
      label: `${MONTHS[sm]} ${sy}`,
      granularity,
      start,
      end,
      quarter: `${sy}-Q${Math.floor(sm / 3) + 1}`,
    };
  }
  const start = new Date(Date.UTC(y, Math.floor(m / 3) * 3 + offset * 3, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1));
  const q = Math.floor(start.getUTCMonth() / 3) + 1;
  const key = `${start.getUTCFullYear()}-Q${q}`;
  return { key, label: `Q${q} ${start.getUTCFullYear()}`, granularity, start, end, quarter: key };
}

/** Quota for an owner (or the whole team) in a period; a month is a third of its quarter */
export function quotaFor(data: DataSnapshot, period: PeriodRange, ownerId?: string): number {
  const q = data.quotas.filter((x) => x.Period === period.quarter && (!ownerId || x.OwnerId === ownerId)).reduce((s, x) => s + x.Amount, 0);
  return period.granularity === "month" ? q / 3 : q;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const COMMIT_STAGES: OpportunityStage[] = ["Negotiation", "Board Approval"];

/** Category implied by stage and probability (for deals with no usable rep category) */
export function derivedCategory(o: Pick<Opportunity, "StageName" | "Probability" | "IsClosed" | "IsWon">): ForecastCategory {
  if (o.IsClosed) return o.IsWon ? "Closed" : "Omitted";
  if (COMMIT_STAGES.includes(o.StageName) || o.Probability >= 70) return "Commit";
  if (o.StageName === "Proposal" || o.Probability >= 40) return "Best Case";
  return "Pipeline";
}

/** Default win probability for a category, used when the stage probability is unknown as of the date */
const CATEGORY_PROBABILITY: Record<ForecastCategory, number> = { Commit: 0.75, "Best Case": 0.5, Pipeline: 0.2, Closed: 1, Omitted: 0 };

/**
 * The category that counts. Won-as-of deals are always Closed. For open deals:
 * the manager override, else the rep's category (unless it is Closed/Omitted
 * for a deal that is still open as of the date), else the stage-derived one.
 */
export function effectiveCategory(o: Opportunity, asOf?: Date): ForecastCategory {
  const closedAsOf = o.IsClosed && (!asOf || parseDate(o.CloseDate) <= asOf);
  if (closedAsOf) return o.IsWon ? "Closed" : "Omitted";
  if (o.Manager_Forecast_Category__c && o.Manager_Forecast_Category__c !== "Closed") return o.Manager_Forecast_Category__c;
  // Viewed before it closed (time travel): the record's final category and stage would give the outcome away
  if (o.IsClosed) return timeCategory(o, asOf!);
  const rep = o.ForecastCategoryName;
  if (rep && rep !== "Closed") return rep;
  return derivedCategory(o);
}

/** For a deal viewed before it closed: nearer close dates count as firmer */
function timeCategory(o: Opportunity, asOf: Date): ForecastCategory {
  const days = (parseDate(o.CloseDate).getTime() - asOf.getTime()) / DAY_MS;
  return days <= 30 ? "Commit" : days <= 90 ? "Best Case" : "Pipeline";
}

// ---------------------------------------------------------------------------
// Seasonal close rates (by the month a deal CLOSES)
// ---------------------------------------------------------------------------

export interface SeasonalRates {
  segment: Segment;
  overall: RateEstimate;
  /** Index 0 = January; blended toward `overall` when a month is thin */
  byCloseMonth: RateEstimate[];
}

const K = 10;

/** Close rate per segment by close month, from deals decided on or before the as-of date */
export function seasonalRates(data: DataSnapshot, asOf: Date): Map<Segment, SeasonalRates> {
  const records = toOppRecords(data);
  const stats = computeStats(records, { asOf, k: K, segments: SEGMENTS });
  const asOfDay = Math.floor(asOf.getTime() / DAY_MS);
  const won = new Map<string, number[]>();
  const decided = new Map<string, number[]>();
  for (const r of records) {
    if (!r.isClosed) continue;
    const closed = Math.floor(parseDate(r.closeDate).getTime() / DAY_MS);
    const created = Math.floor(parseDate(r.createdDate).getTime() / DAY_MS);
    if (closed > asOfDay || created > asOfDay) continue;
    const m = parseDate(r.closeDate).getUTCMonth();
    if (!decided.has(r.segment)) {
      decided.set(r.segment, new Array(12).fill(0));
      won.set(r.segment, new Array(12).fill(0));
    }
    decided.get(r.segment)![m]++;
    if (r.isWon) won.get(r.segment)![m]++;
  }
  const out = new Map<Segment, SeasonalRates>();
  for (const s of stats.segments) {
    const d = decided.get(s.segment) ?? new Array(12).fill(0);
    const w = won.get(s.segment) ?? new Array(12).fill(0);
    out.set(s.segment as Segment, {
      segment: s.segment as Segment,
      overall: s.closeRate,
      byCloseMonth: d.map((n, m) => estimateRate(w[m], n, s.closeRate, { k: K, priorLabel: "this segment's overall rate" })),
    });
  }
  return out;
}

const SHORT_SEGMENT: Record<Segment, string> = {
  "Country Elevator": "elevator",
  "Multi-Location Co-op": "co-op",
  "River Terminal": "terminal",
  "Rail/Shuttle Loader": "shuttle loader",
  "Ethanol Plant": "ethanol",
  "Feed Mill": "feed mill",
  Processor: "processor",
  "Seed Cleaner / Specialty Crop": "seed cleaner",
};

export const FACTOR_MIN = 0.3;
export const FACTOR_MAX = 1.7;

export interface SeasonalAdjustment {
  /** Close-month rate ÷ overall rate, clamped */
  factor: number;
  monthRate: number;
  overallRate: number;
  inHarvest: boolean;
  /** "Closes in harvest · co-op rate 13%" */
  note: string;
}

export function seasonalAdjustment(rates: SeasonalRates | undefined, account: Account | undefined, closeDate: string): SeasonalAdjustment {
  const d = parseDate(closeDate);
  const m = d.getUTCMonth();
  if (!rates) return { factor: 1, monthRate: 0, overallRate: 0, inHarvest: false, note: "" };
  const monthRate = rates.byCloseMonth[m].rate;
  const overallRate = rates.overall.rate;
  const raw = overallRate > 0 ? monthRate / overallRate : 1;
  const factor = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw));
  const hw = account && isSeasonalSegment(account.Segment__c) ? harvestWindowFor(account, d.getUTCFullYear()) : undefined;
  const inHarvest = !!hw && d >= hw.start && d <= hw.end;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const who = SHORT_SEGMENT[rates.segment] ?? rates.segment.toLowerCase();
  const note = inHarvest
    ? `Closes in harvest · ${who} rate ${pct(monthRate)}`
    : Math.abs(factor - 1) >= 0.1
      ? `${MONTHS[m]} close · ${who} rate ${pct(monthRate)} vs ${pct(overallRate)}`
      : "";
  return { factor, monthRate, overallRate, inHarvest, note };
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export interface ForecastDeal {
  opp: Opportunity;
  accountName: string;
  segment?: Segment;
  ownerName: string;
  /** Won on or before the as-of date */
  won: boolean;
  category: ForecastCategory;
  /** The rep's own category as of the date */
  repCategory: ForecastCategory;
  override?: ForecastCategory;
  /** 0–1 */
  probability: number;
  weighted: number;
  seasonal: SeasonalAdjustment;
  /** Won: Amount. Open: Amount × min(1, probability × factor). Omitted: 0 */
  seasonalExpected: number;
  /** With the what-if inputs */
  projected: number;
}

export interface ForecastTotals {
  quota: number;
  closed: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  omitted: number;
  /** Closed + Σ open Amount × probability */
  weighted: number;
  /** Closed + seasonally adjusted open value */
  seasonalExpected: number;
  /** Seasonal expected with the what-if inputs */
  projected: number;
  /** Closed ÷ quota × 100 (0 when there is no quota) */
  attainmentPct: number;
  /** Seasonal expected ÷ quota × 100 */
  forecastPct: number;
  /** Projected ÷ quota × 100 */
  projectedPct: number;
  deals: number;
}

export interface RepForecast extends ForecastTotals {
  ownerId: string;
  name: string;
}

export interface Forecast extends ForecastTotals {
  period: string;
  periodLabel: string;
  range: PeriodRange;
  whatIf: WhatIf;
  byRep: RepForecast[];
  /** Won and open deals closing in the period (omitted included, not counted) */
  dealRows: ForecastDeal[];
}

const emptyTotals = (quota: number): ForecastTotals => ({
  quota,
  closed: 0,
  commit: 0,
  bestCase: 0,
  pipeline: 0,
  omitted: 0,
  weighted: 0,
  seasonalExpected: 0,
  projected: 0,
  attainmentPct: 0,
  forecastPct: 0,
  projectedPct: 0,
  deals: 0,
});

function add(t: ForecastTotals, d: ForecastDeal) {
  t.deals++;
  const a = d.opp.Amount;
  if (d.won) t.closed += a;
  else if (d.category === "Commit") t.commit += a;
  else if (d.category === "Best Case") t.bestCase += a;
  else if (d.category === "Pipeline") t.pipeline += a;
  else if (d.category === "Omitted") t.omitted += a;
  t.weighted += d.weighted;
  t.seasonalExpected += d.seasonalExpected;
  t.projected += d.projected;
}

function finish<T extends ForecastTotals>(t: T): T {
  const pct = (x: number) => (t.quota > 0 ? (x / t.quota) * 100 : 0);
  t.attainmentPct = pct(t.closed);
  t.forecastPct = pct(t.seasonalExpected);
  t.projectedPct = pct(t.projected);
  return t;
}

export function buildForecast(data: DataSnapshot, asOf: Date, opts: ForecastOptions = {}): Forecast {
  const range = periodFor(asOf, opts.granularity ?? "quarter", opts.offset ?? 0);
  const whatIf: WhatIf = { ...DEFAULT_WHAT_IF, ...opts.whatIf };
  const slip = Math.min(1, Math.max(0, whatIf.slippagePct / 100));
  const rates = seasonalRates(data, asOf);
  const accounts = new Map(data.accounts.map((a) => [a.Id, a]));

  const deals: ForecastDeal[] = [];
  for (const o of data.opportunities) {
    if (opts.ownerId && o.OwnerId !== opts.ownerId) continue;
    const close = parseDate(o.CloseDate);
    if (close < range.start || close >= range.end) continue;
    if (parseDate(o.CreatedDate) > asOf) continue;
    const closedAsOf = o.IsClosed && close <= asOf;
    if (closedAsOf && !o.IsWon) continue; // lost in the period: not part of the forecast
    const acc = accounts.get(o.AccountId);
    const segment = acc?.Segment__c;
    const seasonal = seasonalAdjustment(segment ? rates.get(segment) : undefined, acc, o.CloseDate);
    const won = closedAsOf && o.IsWon;
    const category = effectiveCategory(o, asOf);
    const repCategory = o.IsClosed && !closedAsOf ? timeCategory(o, asOf) : o.ForecastCategoryName === "Closed" && !won ? derivedCategory(o) : o.ForecastCategoryName;
    const probability = won ? 1 : category === "Omitted" ? 0 : o.IsClosed ? CATEGORY_PROBABILITY[category] : Math.min(1, Math.max(0, o.Probability / 100));
    const amount = o.Amount;
    const seasonalExpected = won ? amount : Math.min(1, probability * seasonal.factor) * amount;
    const projected = won ? amount : Math.min(1, probability * seasonal.factor * whatIf.winRate) * amount * whatIf.dealSize * (1 - slip);
    deals.push({
      opp: o,
      accountName: acc?.Name ?? "",
      segment,
      ownerName: USER_BY_ID[o.OwnerId]?.Name ?? o.OwnerId,
      won,
      category,
      repCategory,
      override: o.Manager_Forecast_Category__c,
      probability,
      weighted: amount * probability,
      seasonal,
      seasonalExpected,
      projected,
    });
  }

  // Reps: everyone with a quota in the period's quarter, plus anyone with a deal in it
  const repIds = new Set<string>();
  for (const q of data.quotas) if (q.Period === range.quarter && (!opts.ownerId || q.OwnerId === opts.ownerId)) repIds.add(q.OwnerId);
  for (const d of deals) repIds.add(d.opp.OwnerId);
  const byRepMap = new Map<string, RepForecast>();
  for (const id of repIds) byRepMap.set(id, { ...emptyTotals(quotaFor(data, range, id)), ownerId: id, name: USER_BY_ID[id]?.Name ?? id });

  const team = emptyTotals(quotaFor(data, range, opts.ownerId));
  for (const d of deals) {
    add(team, d);
    add(byRepMap.get(d.opp.OwnerId)!, d);
  }
  const byRep = [...byRepMap.values()].map(finish).sort((a, b) => b.quota - a.quota || a.name.localeCompare(b.name));

  return { ...finish(team), period: range.key, periodLabel: range.label, range, whatIf, byRep, dealRows: deals };
}

export interface ForecastSummaryRep {
  ownerId: string;
  name: string;
  quota: number;
  closed: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  seasonalExpected: number;
  attainmentPct: number;
  forecastPct: number;
}

export interface ForecastSummary {
  period: string;
  quota: number;
  closed: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  seasonalExpected: number;
  attainmentPct: number;
  byRep: ForecastSummaryRep[];
}

/**
 * Team forecast for the as-of quarter (or month): the numbers for the Board
 * Report and Demo Mode. `seasonalExpected` includes closed deals;
 * `attainmentPct` is closed ÷ quota × 100.
 */
export function forecastSummary(data: DataSnapshot, asOf: Date, opts?: ForecastOptions): ForecastSummary {
  const f = buildForecast(data, asOf, opts);
  return {
    period: f.period,
    quota: f.quota,
    closed: f.closed,
    commit: f.commit,
    bestCase: f.bestCase,
    pipeline: f.pipeline,
    seasonalExpected: f.seasonalExpected,
    attainmentPct: f.attainmentPct,
    byRep: f.byRep.map((r) => ({
      ownerId: r.ownerId,
      name: r.name,
      quota: r.quota,
      closed: r.closed,
      commit: r.commit,
      bestCase: r.bestCase,
      pipeline: r.pipeline,
      seasonalExpected: r.seasonalExpected,
      attainmentPct: r.attainmentPct,
      forecastPct: r.forecastPct,
    })),
  };
}
