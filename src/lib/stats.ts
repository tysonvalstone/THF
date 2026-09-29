/**
 * Segment statistics from Salesforce opportunity history.
 *
 * Pure and dependency-free. Everything here answers one question: "how likely
 * is a deal in this segment to close, and how sure are we?" Every rate carries
 * a Wilson 95% interval and a tag saying where it came from:
 *
 *   - Measured: the segment has enough decided deals to stand on its own.
 *   - Blended:  a few decided deals, shrunk toward a prior (the company rate,
 *               or for month buckets the segment's own rate).
 *   - Prior:    no decided deals at all, so we fall back to the prior.
 *
 * Rates are never null and never NaN, so downstream math can use them freely;
 * the UI uses `enoughData` to decide whether to show a bare percentage.
 */

export type Tag = "Measured" | "Blended" | "Prior";

/** Minimal opportunity shape (maps from Salesforce Opportunity + Account.Segment__c) */
export interface OppRecord {
  segment: string;
  createdDate: string; // ISO date or datetime
  closeDate: string; // ISO date
  isClosed: boolean;
  isWon: boolean;
  amount: number | null;
}

export interface RateEstimate {
  /** Rate to use for math, 0–1. Never null, never NaN. */
  rate: number;
  /** Wilson 95% interval bounds, 0–1 */
  low: number;
  high: number;
  /** Raw counts behind the estimate (the segment's/bucket's own measured counts) */
  won: number;
  decided: number;
  tag: Tag;
  /** false when decided < minDecided — UI must then show "Not enough data" instead of a bare % */
  enoughData: boolean;
  /** Plain-English explanation for tooltips, e.g. "18 won of 42 decided deals (measured)" */
  explanation: string;
}

export interface StatsOptions {
  /** Prior strength for blending, default 10 */
  k?: number;
  /** Minimum decided deals for a measured rate, default 10 */
  minDecided?: number;
  /** Segments to always include even with zero history */
  segments?: string[];
  /** Only use opps created on/before this date (for time travel). Default: no cutoff */
  asOf?: Date;
}

export interface SegmentStats {
  segment: string;
  won: number;
  lost: number;
  decided: number;
  open: number;
  closeRate: RateEstimate;
  /** Median days Created→Close over decided deals; null if none */
  medianDaysToClose: number | null;
  /** Median Amount of won deals; null if none */
  medianWonAmount: number | null;
  /** 12 buckets by month the opp was CREATED (index 0 = January) */
  byCreatedMonth: RateEstimate[];
}

export interface StatsResult {
  /** Company-wide, tag "Measured" when enough data */
  company: RateEstimate;
  companyMedianDaysToClose: number | null;
  companyMedianWonAmount: number | null;
  /** One per segment (including options.segments with zero history), sorted by segment name */
  segments: SegmentStats[];
}

const DEFAULT_K = 10;
const DEFAULT_MIN_DECIDED = 10;
/** Assumed company close rate when there is no decided history at all */
const DEFAULT_COMPANY_RATE = 0.25;
const Z_95 = 1.96;
const DAY_MS = 86_400_000;

const COMPANY_LABEL = "the company-wide rate";
const SEGMENT_LABEL = "this segment's overall rate";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Wilson score interval for a binomial proportion. Behaves well for small n
 * and for 0% / 100% observations (unlike the normal approximation).
 * Accepts fractional counts so it can be applied to blended "effective" counts.
 */
export function wilsonInterval(successes: number, n: number, z: number = Z_95): { low: number; high: number } {
  if (!(n > 0)) return { low: 0, high: 1 };
  const p = clamp01(successes / n);
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: clamp01((center - margin) / denom),
    high: clamp01((center + margin) / denom),
  };
}

/** Bayesian-style shrinkage: (won + k × prior) ÷ (decided + k). */
export function blendedRate(won: number, decided: number, priorRate: number, k: number): number {
  const denom = decided + k;
  if (!(denom > 0)) return clamp01(priorRate);
  return clamp01((won + k * priorRate) / denom);
}

/** Median of a list of numbers (average of the middle two for even lengths); null when empty. */
export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * Turn raw won/decided counts into a tagged rate estimate:
 *   decided >= minDecided → Measured (won ÷ decided)
 *   0 < decided < minDecided → Blended toward the prior
 *   decided == 0 → Prior (the prior's own rate and interval)
 */
export function estimateRate(
  won: number,
  decided: number,
  prior: { rate: number; low: number; high: number },
  opts: { k?: number; minDecided?: number; priorLabel?: string } = {},
): RateEstimate {
  const k = opts.k ?? DEFAULT_K;
  const minDecided = opts.minDecided ?? DEFAULT_MIN_DECIDED;
  const priorLabel = opts.priorLabel ?? COMPANY_LABEL;

  if (decided <= 0) {
    return {
      rate: clamp01(prior.rate),
      low: clamp01(prior.low),
      high: clamp01(prior.high),
      won: 0,
      decided: 0,
      tag: "Prior",
      enoughData: false,
      explanation: `No decided deals yet, so we use ${priorLabel} (${pct(prior.rate)}) as a prior.`,
    };
  }

  if (decided >= minDecided) {
    return {
      rate: clamp01(won / decided),
      ...wilsonInterval(won, decided),
      won,
      decided,
      tag: "Measured",
      enoughData: true,
      explanation: `Measured: ${won} won of ${plural(decided, "decided deal")}.`,
    };
  }

  // Thin data: shrink toward the prior and put the interval on the effective counts.
  return {
    rate: blendedRate(won, decided, prior.rate, k),
    ...wilsonInterval(won + k * prior.rate, decided + k),
    won,
    decided,
    tag: "Blended",
    enoughData: false,
    explanation:
      `Only ${plural(decided, "decided deal")} (${won} won), so this is blended with ${priorLabel} ` +
      `(${pct(prior.rate)}, k = ${k}).`,
  };
}

// ---------------------------------------------------------------------------
// Dates (UTC day numbers from the ISO date part; avoids timezone drift and
// Salesforce's "+0000" offset format)
// ---------------------------------------------------------------------------

function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS);
}

/** 0–11 month of an ISO date string, or null if unparseable */
function monthOf(iso: string): number | null {
  const m = /^\d{4}-(\d{2})/.exec(iso ?? "");
  if (!m) return null;
  const month = +m[1] - 1;
  return month >= 0 && month < 12 ? month : null;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface Tally {
  won: number;
  lost: number;
  open: number;
  daysToClose: number[];
  wonAmounts: number[];
  /** Per created-month won/decided counts */
  monthWon: number[];
  monthDecided: number[];
}

const newTally = (): Tally => ({
  won: 0,
  lost: 0,
  open: 0,
  daysToClose: [],
  wonAmounts: [],
  monthWon: new Array(12).fill(0),
  monthDecided: new Array(12).fill(0),
});

/**
 * Compute company-wide and per-segment close-rate statistics.
 * With `asOf`, the history is viewed as it stood on that date: opps created
 * later are ignored and opps that closed later are counted as still open.
 */
export function computeStats(opps: OppRecord[], options: StatsOptions = {}): StatsResult {
  const k = options.k ?? DEFAULT_K;
  const minDecided = options.minDecided ?? DEFAULT_MIN_DECIDED;
  const asOfDay = options.asOf ? Math.floor(options.asOf.getTime() / DAY_MS) : null;

  const company = newTally();
  const bySegment = new Map<string, Tally>();
  for (const s of options.segments ?? []) if (!bySegment.has(s)) bySegment.set(s, newTally());

  for (const opp of opps) {
    const created = dayNumber(opp.createdDate);
    const closed = dayNumber(opp.closeDate);
    if (asOfDay !== null && created !== null && created > asOfDay) continue;

    let seg = bySegment.get(opp.segment);
    if (!seg) bySegment.set(opp.segment, (seg = newTally()));

    const closedByAsOf = asOfDay === null || (closed !== null && closed <= asOfDay);
    const decided = opp.isClosed && closedByAsOf;

    for (const t of [company, seg]) {
      if (!decided) {
        t.open++;
        continue;
      }
      if (opp.isWon) t.won++;
      else t.lost++;
      if (created !== null && closed !== null) t.daysToClose.push(Math.max(0, closed - created));
      if (opp.isWon && opp.amount !== null && Number.isFinite(opp.amount)) t.wonAmounts.push(opp.amount);
      const month = monthOf(opp.createdDate);
      if (month !== null) {
        t.monthDecided[month]++;
        if (opp.isWon) t.monthWon[month]++;
      }
    }
  }

  const companyRate = companyEstimate(company.won, company.won + company.lost, k, minDecided);

  const segments = [...bySegment.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segment, t]): SegmentStats => {
      const decided = t.won + t.lost;
      const closeRate = estimateRate(t.won, decided, companyRate, { k, minDecided, priorLabel: COMPANY_LABEL });
      if (closeRate.tag === "Prior") {
        closeRate.explanation = `No history for this segment yet, so we use ${COMPANY_LABEL} (${pct(companyRate.rate)}) as a prior.`;
      }
      return {
        segment,
        won: t.won,
        lost: t.lost,
        decided,
        open: t.open,
        closeRate,
        medianDaysToClose: median(t.daysToClose),
        medianWonAmount: median(t.wonAmounts),
        byCreatedMonth: t.monthDecided.map((d, m) => monthEstimate(closeRate, t.monthWon[m], d, k, minDecided)),
      };
    });

  return {
    company: companyRate,
    companyMedianDaysToClose: median(company.daysToClose),
    companyMedianWonAmount: median(company.wonAmounts),
    segments,
  };
}

/**
 * Company-wide rate. With enough history it is simply measured; with a little
 * it is blended toward an assumed 25% default; with none it IS that default.
 */
function companyEstimate(won: number, decided: number, k: number, minDecided: number): RateEstimate {
  const assumed = { rate: DEFAULT_COMPANY_RATE, low: 0, high: 1 };
  const est = estimateRate(won, decided, assumed, { k, minDecided, priorLabel: "an assumed default rate" });
  if (est.tag === "Prior") {
    est.explanation = `No decided deals company-wide yet, so we assume a default ${pct(DEFAULT_COMPANY_RATE)} close rate.`;
  }
  return est;
}

/** A created-month bucket, blended toward the segment's own overall rate. */
function monthEstimate(segmentRate: RateEstimate, won: number, decided: number, k: number, minDecided: number): RateEstimate {
  // A segment with no history of its own has nothing to say about seasonality.
  if (segmentRate.tag === "Prior") return { ...segmentRate };
  const est = estimateRate(won, decided, segmentRate, { k, minDecided, priorLabel: SEGMENT_LABEL });
  if (est.tag === "Prior") {
    est.explanation = `No decided deals created in this month, so we use ${SEGMENT_LABEL} (${pct(segmentRate.rate)}).`;
  }
  return est;
}

/** Seasonal rate: the segment's rate for opps created in `month` (0–11) when that bucket has enough data, otherwise blended toward the segment's overall rate */
export function rateForMonth(stats: SegmentStats, month: number): RateEstimate {
  const m = ((Math.trunc(month) % 12) + 12) % 12;
  return stats.byCreatedMonth[m] ?? stats.closeRate;
}

/** Display string: "42% (Measured)", "Not enough data · 35% blended", "31% (Prior)" */
export function formatRate(r: RateEstimate): string {
  switch (r.tag) {
    case "Measured":
      return `${pct(r.rate)} (Measured)`;
    case "Blended":
      return `Not enough data · ${pct(r.rate)} blended`;
    case "Prior":
      return `${pct(r.rate)} (Prior)`;
  }
}
