/**
 * Segment prioritization.
 *
 * Priority = seasonal close rate (for deals created this month, when the data
 * allows) × a weighted blend of deal size, cycle speed, product fit and
 * expansion potential. Each blend input is scaled 0–1 across segments.
 * Everything here runs in the browser on the already-loaded data, so the
 * sliders never re-query Salesforce.
 */
import type { DataSnapshot } from "@/lib/data/types";
import { computeStats, rateForMonth, type OppRecord, type RateEstimate, type SegmentStats, type StatsResult, type Tag } from "@/lib/stats";
import { productFitScore } from "@/data/reference/product-fit";
import { SEGMENTS, type Opportunity, type Segment } from "@/types/salesforce";
import { diffDays, parseDate } from "@/lib/dates";

export interface Weights {
  dealSize: number;
  cycleSpeed: number;
  productFit: number;
  expansion: number;
}

export const DEFAULT_WEIGHTS: Weights = { dealSize: 30, cycleSpeed: 25, productFit: 25, expansion: 20 };
export const DEFAULT_K = 10;

export const WEIGHT_LABELS: Record<keyof Weights, { label: string; help: string }> = {
  dealSize: { label: "Deal size", help: "Median amount of won deals in the segment. Bigger is better." },
  cycleSpeed: { label: "Cycle speed", help: "Median days from created to closed. Faster is better." },
  productFit: { label: "Product fit", help: "How well Ceres, GrainSight, ScaleTrac and the mobile apps fit the segment (editable table)." },
  expansion: { label: "Expansion potential", help: "Average locations per parent account: more locations means more modules and seats to add." },
};

export interface Component {
  /** Raw value (dollars, days, 0–1 fit, locations) */
  raw: number | null;
  /** Scaled 0–1 across segments */
  scaled: number;
  tag: Tag;
}

export interface SegmentPriority {
  segment: Segment;
  stats: SegmentStats;
  /** Rate used for ranking: this creation month when data allows */
  seasonalRate: RateEstimate;
  month: number;
  components: Record<keyof Weights, Component>;
  /** Weighted blend 0–1 */
  blend: number;
  /** Final priority, 0–100 */
  score: number;
  rank: number;
  accounts: number;
  openDeals: number;
  openPipeline: number;
}

export interface OpenOppValue {
  opp: Opportunity;
  accountName: string;
  segment: Segment;
  rate: RateEstimate;
  /** rate × Amount */
  expectedAmount: number;
  /** rate × Amount ÷ segment median days: expected dollars per day of cycle */
  expectedPerDay: number;
  medianDays: number;
}

export interface Prioritization {
  stats: StatsResult;
  segments: SegmentPriority[];
  topOpen: OpenOppValue[];
  /** Every open deal, same ordering as topOpen */
  allOpen: OpenOppValue[];
  month: number;
}

/** Opportunities joined to their account's segment (co-op locations roll up to the parent) */
export function toOppRecords(data: DataSnapshot): OppRecord[] {
  const seg = new Map(data.accounts.map((a) => [a.Id, a.Segment__c]));
  return data.opportunities
    .filter((o) => seg.has(o.AccountId))
    .map((o) => ({ segment: seg.get(o.AccountId)!, createdDate: o.CreatedDate, closeDate: o.CloseDate, isClosed: o.IsClosed, isWon: o.IsWon, amount: o.Amount }));
}

function scale(values: (number | null)[], opts: { log?: boolean; invert?: boolean } = {}): number[] {
  const t = values.map((v) => (v === null || !Number.isFinite(v) ? null : opts.log ? Math.log(Math.max(1, v)) : v));
  const present = t.filter((v): v is number => v !== null);
  const lo = Math.min(...present);
  const hi = Math.max(...present);
  return t.map((v) => {
    if (v === null || !present.length) return 0.5;
    const s = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    return opts.invert ? 1 - s : s;
  });
}

export function prioritize(data: DataSnapshot, asOf: Date, weights: Weights = DEFAULT_WEIGHTS, k = DEFAULT_K): Prioritization {
  const stats = computeStats(toOppRecords(data), { asOf, k, segments: SEGMENTS });
  const month = asOf.getUTCMonth();
  const bySeg = new Map(stats.segments.map((s) => [s.segment as Segment, s]));

  // Expansion: average locations per parent (top-level) account
  const locations = new Map<Segment, number[]>();
  for (const a of data.accounts) {
    if (a.ParentId) continue;
    locations.set(a.Segment__c, [...(locations.get(a.Segment__c) ?? []), a.Number_of_Locations__c || 1]);
  }
  const avgLocations = (s: Segment) => {
    const l = locations.get(s) ?? [];
    return l.length ? l.reduce((x, y) => x + y, 0) / l.length : null;
  };

  const segs = SEGMENTS.map((segment) => bySeg.get(segment)!).filter(Boolean);
  const dealRaw = segs.map((s) => s.medianWonAmount ?? stats.companyMedianWonAmount);
  const cycleRaw = segs.map((s) => s.medianDaysToClose ?? stats.companyMedianDaysToClose);
  const fitRaw = segs.map((s) => productFitScore(s.segment as Segment));
  const expRaw = segs.map((s) => avgLocations(s.segment as Segment));
  const dealScaled = scale(dealRaw, { log: true });
  const cycleScaled = scale(cycleRaw, { invert: true });
  const fitScaled = fitRaw; // already 0–1
  const expScaled = scale(expRaw, { log: true });

  const seasonal = segs.map((s) => rateForMonth(s, month));
  const maxRate = Math.max(...seasonal.map((r) => r.rate), 0.01);
  const wSum = Math.max(1, weights.dealSize + weights.cycleSpeed + weights.productFit + weights.expansion);

  const open = data.opportunities.filter((o) => parseDate(o.CreatedDate) <= asOf && !(o.IsClosed && parseDate(o.CloseDate) <= asOf));
  const seg = new Map(data.accounts.map((a) => [a.Id, a.Segment__c]));

  const out: SegmentPriority[] = segs.map((s, i) => {
    const segment = s.segment as Segment;
    const measured = s.decided >= 10;
    const components: Record<keyof Weights, Component> = {
      dealSize: { raw: dealRaw[i], scaled: dealScaled[i], tag: s.medianWonAmount === null ? "Prior" : measured ? "Measured" : "Blended" },
      cycleSpeed: { raw: cycleRaw[i], scaled: cycleScaled[i], tag: s.medianDaysToClose === null ? "Prior" : measured ? "Measured" : "Blended" },
      productFit: { raw: fitRaw[i], scaled: fitScaled[i], tag: "Measured" },
      expansion: { raw: expRaw[i], scaled: expScaled[i], tag: expRaw[i] === null ? "Prior" : "Measured" },
    };
    const blend =
      (weights.dealSize * components.dealSize.scaled +
        weights.cycleSpeed * components.cycleSpeed.scaled +
        weights.productFit * components.productFit.scaled +
        weights.expansion * components.expansion.scaled) /
      wSum;
    // Less certain rates count for a little less: Prior ×0.85, Blended ×0.92
    const confidence = seasonal[i].tag === "Prior" ? 0.85 : seasonal[i].tag === "Blended" ? 0.92 : 1;
    const rateFactor = (seasonal[i].rate * confidence) / maxRate;
    const openInSeg = open.filter((o) => seg.get(o.AccountId) === segment);
    return {
      segment,
      stats: s,
      seasonalRate: seasonal[i],
      month,
      components,
      blend,
      score: Math.round(100 * rateFactor * (0.25 + 0.75 * blend)),
      rank: 0,
      accounts: (locations.get(segment) ?? []).length,
      openDeals: openInSeg.length,
      openPipeline: openInSeg.reduce((sum, o) => sum + o.Amount, 0),
    };
  });
  out.sort((a, b) => b.score - a.score || a.segment.localeCompare(b.segment));
  out.forEach((s, i) => (s.rank = i + 1));

  // Top open deals by expected value per day of cycle
  const accName = new Map(data.accounts.map((a) => [a.Id, a.Name]));
  const allOpen: OpenOppValue[] = open
    .filter((o) => seg.has(o.AccountId))
    .map((o) => {
      const segment = seg.get(o.AccountId)!;
      const st = bySeg.get(segment)!;
      const rate = rateForMonth(st, parseDate(o.CreatedDate).getUTCMonth());
      const medianDays = Math.max(1, st.medianDaysToClose ?? stats.companyMedianDaysToClose ?? 120);
      return {
        opp: o,
        accountName: accName.get(o.AccountId) ?? "",
        segment,
        rate,
        expectedAmount: rate.rate * o.Amount,
        expectedPerDay: (rate.rate * o.Amount) / medianDays,
        medianDays,
      };
    })
    .sort((a, b) => b.expectedPerDay - a.expectedPerDay);

  return { stats, segments: out, topOpen: allOpen.slice(0, 25), allOpen, month };
}

/** Days a deal has been open as of a date */
export function ageDays(o: Opportunity, asOf: Date): number {
  return Math.max(0, diffDays(asOf, parseDate(o.CreatedDate)));
}
