import { REGION_BY_ID } from "@/data/reference/regions";
import { VENDOR_BY_NAME } from "@/data/reference/software";
import type { ClimateCondition, ClimateSignal } from "@/types/reference";
import type { DataSnapshot } from "@/lib/data/types";
import { diffDays, fmtMonthYear, fmtSpan, parseDate } from "@/lib/dates";
import {
  basisFor,
  crushMargin,
  crushMarginPercentile,
  feedCostChange,
  fmtBasis,
  pctChange,
} from "@/lib/market";
import { busyWindows, climateFor, cropNoun, windowPositions, type WindowPosition } from "@/lib/season";
import { buildEngagementIndex, engagementFor, type Engagement } from "./engagement";
import { targetFromAccount, targetFromLead, type Target } from "./target";

export type { Target } from "./target";
export { sizeLabel } from "./target";

export type FactorKey = "timing" | "market" | "fit" | "displacement" | "engagement" | "climate";

export const FACTOR_META: Record<FactorKey, { label: string; max: number; description: string }> = {
  timing: { label: "Season timing", max: 30, description: "Days until their next busy window (harvest, new-crop buying, application or feeding season). Peaks 3–8 weeks before it starts." },
  market: { label: "Market signal", max: 15, description: "Price moves, local basis, crop size, crush margins or ration costs that create workload or budget." },
  fit: { label: "Fit & size", max: 20, description: "Facility type fit with our product lines, plus size (revenue, volume) and number of locations." },
  displacement: { label: "Displacement", max: 15, description: "How replaceable their current system is: paper and legacy score highest, then competitor contracts nearing renewal." },
  engagement: { label: "Engagement", max: 15, description: "Recent touches, campaign responses and open deals. Penalized if we contacted them in the last 7 days." },
  climate: { label: "Climate", max: 5, description: "This season's regional conditions (early, wet, drought, record yields) that change timing or pain." },
};

export const FACTOR_KEYS = Object.keys(FACTOR_META) as FactorKey[];

export interface Factor {
  key: FactorKey;
  points: number;
  max: number;
  reason: string;
}

export type Tier = "Hot" | "Warm" | "Cool";

export interface ScoredTarget {
  target: Target;
  total: number;
  tier: Tier;
  factors: Record<FactorKey, Factor>;
  whyNow: string;
  /** The busy window driving timing, if any */
  timing?: WindowPosition;
  engagement: Engagement;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (x: number) => `${Math.abs(Math.round(x * 100))}%`;

// ---------------------------------------------------------------------------
// Timing (30)
// ---------------------------------------------------------------------------
function positionPoints(p: WindowPosition): number {
  const d = p.days;
  if (p.state === "during") return d < 5 ? 11 : 7;
  if (p.state === "after") return 24 - d * 0.1;
  if (d >= 21 && d <= 56) return 30;
  if (d > 56 && d <= 90) return 30 - (d - 56) * 0.3;
  if (d >= 8 && d < 21) return 23;
  if (d < 8) return 15;
  return Math.max(6, 19.8 - (d - 90) * 0.05);
}

function shiftNote(climate?: ClimateSignal): string {
  if (!climate || Math.abs(climate.harvestShiftDays) < 4) return "";
  const wk = Math.round(Math.abs(climate.harvestShiftDays) / 7) || 1;
  return climate.harvestShiftDays < 0 ? ` (running ~${wk} week${wk > 1 ? "s" : ""} early this year)` : ` (running ~${wk} week${wk > 1 ? "s" : ""} late this year)`;
}

function afterPhrase(t: Target): string {
  switch (t.facilityType) {
    case "Agronomy Retailer":
      return "prepay and next season's booking are next";
    case "Oilseed Crusher":
    case "Flour Mill":
      return "new-crop is booked, so procurement workflows can be fixed before next year";
    case "Seed Processor":
      return "grower settlements and lot paperwork are next";
    default:
      return "settlements, DP pricing and year-end inventory are next";
  }
}

function positionReason(t: Target, p: WindowPosition): string {
  const label = p.window.label;
  const where = `around ${t.city}`;
  const shift = shiftNote(p.window.climate);
  if (p.state === "during") {
    return p.days < 5
      ? `${label} just started ${where}. Keep it short and book time for after the rush`
      : `They're in the middle of ${label.toLowerCase()}. Keep it light and book a post-season demo`;
  }
  if (p.state === "after") return `${label} wrapped ${fmtSpan(p.days)} ago; ${afterPhrase(t)}`;
  if (p.days >= 21 && p.days <= 56) return `${label} starts in ${fmtSpan(p.days)} ${where}${shift}`;
  if (p.days > 56 && p.days <= 90) return `${label} is ${fmtSpan(p.days)} out: early enough to get on the calendar before the rush${shift}`;
  const busy = p.window.kind === "harvest" ? "the scale house gets busy" : "their crews get busy";
  if (p.days >= 8) return `${label} starts in ${fmtSpan(p.days)} ${where}${shift}. Last call before ${busy}`;
  if (p.days < 8) return `${label} starts in ${fmtSpan(p.days)} ${where}. They're about to be slammed`;
  return `Off-season: ${label.toLowerCase()} is ${fmtSpan(p.days)} away, a good time for a longer evaluation`;
}

function timingFactor(t: Target, asOf: Date): { factor: Factor; position?: WindowPosition } {
  const max = FACTOR_META.timing.max;
  const positions = windowPositions(busyWindows({ Region__c: t.regionId, Facility_Type__c: t.facilityType, Primary_Commodities__c: t.commodities }, asOf), asOf);

  if (t.facilityType === "Ethanol Plant") {
    const p = crushMarginPercentile(asOf);
    const m = crushMargin(asOf);
    const corn = positions.find((x) => x.window.commodity === "Corn");
    let points = 8 + 14 * p;
    let reason =
      p >= 0.66
        ? `Crush margins are in the top third of the last two years (~$${m.toFixed(2)}/gal), so there's budget to invest`
        : p <= 0.33
          ? `Margins are tight (~$${m.toFixed(2)}/gal), so every cent of corn basis and DDGS price matters`
          : `Crush margins are average (~$${m.toFixed(2)}/gal)`;
    if (corn?.state === "before" && corn.days >= 14 && corn.days <= 56) {
      points += 8;
      reason += `; new-crop corn buying starts in ${fmtSpan(corn.days)}`;
    } else if (corn?.state === "during") {
      points += 3;
      reason += "; they're buying new-crop corn off the combine now";
    }
    return { factor: { key: "timing", points: round1(clamp(points, 0, max)), max, reason }, position: corn };
  }

  if (t.facilityType === "Feed Mill") {
    const feeding = positions.find((x) => x.window.kind === "feeding-season");
    let points = 9;
    const parts: string[] = [];
    if (feeding?.state === "before" && feeding.days <= 56) {
      points += 11;
      parts.push(`Winter feeding season starts in ${fmtSpan(feeding.days)}, so tonnage is about to climb`);
    } else if (feeding?.state === "during") {
      points += 6;
      parts.push("Peak winter feeding season: high tonnage, tight delivery windows");
    } else {
      points += 3;
      parts.push("Steady-state feeding season");
    }
    if (t.livestock === "Poultry" || t.livestock === "Swine") {
      points += 4;
      parts.push(`${t.livestock.toLowerCase()} integrator demand runs year-round`);
    }
    return { factor: { key: "timing", points: round1(clamp(points, 0, max)), max, reason: parts.join("; ") }, position: feeding };
  }

  let best: { points: number; p: WindowPosition } | undefined;
  for (const p of positions) {
    const pts = positionPoints(p) * (0.65 + 0.35 * p.window.importance);
    if (!best || pts > best.points) best = { points: pts, p };
  }
  if (!best) return { factor: { key: "timing", points: 8, max, reason: "No strong seasonal driver right now" } };
  return {
    factor: { key: "timing", points: round1(clamp(best.points, 0, max)), max, reason: positionReason(t, best.p) },
    position: best.p,
  };
}

// ---------------------------------------------------------------------------
// Market signal (15)
// ---------------------------------------------------------------------------
function marketFactor(t: Target, asOf: Date): Factor {
  const max = FACTOR_META.market.max;
  if (t.facilityType === "Ethanol Plant") {
    const corn = pctChange("Corn", asOf, 3);
    const ddgs = pctChange("DDGS", asOf, 3);
    let points = 4;
    const parts: string[] = [];
    if (corn <= -0.04) {
      points += 6;
      parts.push(`corn is down ${pct(corn)} in 3 months, a window to lock in cheap bushels`);
    } else if (corn >= 0.04) {
      points += 4;
      parts.push(`corn is up ${pct(corn)} in 3 months, which squeezes margins and makes origination harder`);
    }
    if (ddgs >= 0.04) {
      points += 5;
      parts.push(`DDGS is up ${pct(ddgs)}, so co-product sales matter more`);
    } else if (ddgs <= -0.04) {
      points += 3;
      parts.push(`DDGS is off ${pct(ddgs)}, so every co-product sale needs to be tracked`);
    }
    return { key: "market", points: clamp(points, 0, max), max, reason: parts.join("; ") || "Corn and DDGS prices are steady" };
  }
  if (t.facilityType === "Feed Mill") {
    const cost = feedCostChange(asOf);
    const points = clamp(3 + Math.abs(cost) * 70, 0, 12);
    return {
      key: "market",
      points: round1(points),
      max,
      reason:
        cost <= -0.03
          ? `ration costs are down ${pct(cost)} in 3 months, which frees up margin to invest`
          : cost >= 0.03
            ? `ration costs are up ${pct(cost)} in 3 months, so ingredient costing and customer pricing have to tighten`
            : "ingredient prices are steady",
    };
  }

  const commodity = t.commodities[0];
  const region = REGION_BY_ID[t.regionId];
  const key = commodity;
  const noun = cropNoun(commodity).toLowerCase();
  const change = pctChange(key, asOf, 3);
  let points = 2 + Math.min(6, Math.abs(change) * 60);
  const parts: string[] = [];
  if (Math.abs(change) >= 0.05) {
    parts.push(
      t.facilityType === "Agronomy Retailer"
        ? change > 0
          ? `${noun} prices are up ${pct(change)} in 3 months, so growers are booking inputs early`
          : `${noun} prices are down ${pct(change)} in 3 months, so growers will push for prepay discounts`
        : `${noun} prices are ${change > 0 ? "up" : "down"} ${pct(change)} in 3 months, which means more contracts, hedges and pricing calls`,
    );
  }
  const basis = basisFor(t.regionId, commodity, asOf);
  const typical = region.typicalBasis[commodity];
  if (basis !== undefined && typical !== undefined && basis <= typical - 0.15) {
    points += 4;
    parts.push(`local ${noun} basis has widened to ${fmtBasis(basis)} (typically ${fmtBasis(typical)}), so storage and carry decisions multiply`);
  }
  const climate = climateFor(t.regionId, asOf.getUTCFullYear());
  if (climate.yieldIndex >= 1.04) {
    points += 4;
    parts.push("a big crop will strain storage and push ground piles");
  } else if (climate.yieldIndex <= 0.9) {
    points += 3;
    parts.push("a short crop means fierce competition for every bushel");
  }
  return { key: "market", points: round1(clamp(points, 0, max)), max, reason: parts.join("; ") || `${noun} prices and basis are steady` };
}

// ---------------------------------------------------------------------------
// Fit & size (20)
// ---------------------------------------------------------------------------
const TYPE_FIT: Record<Target["facilityType"], number> = {
  "Grain Elevator": 8,
  Cooperative: 8,
  "Ethanol Plant": 7,
  "Feed Mill": 7,
  "Oilseed Crusher": 6,
  "Agronomy Retailer": 6,
  "Flour Mill": 5,
  "Seed Processor": 5,
};

function fitFactor(t: Target): Factor {
  const max = FACTOR_META.fit.max;
  const typePts = TYPE_FIT[t.facilityType];
  const sizePts = clamp(((Math.log10(Math.max(t.revenue, 1)) - 6.7) / (8.7 - 6.7)) * 9, 0, 9);
  const locPts = clamp((t.locations - 1) * 0.5, 0, 3);
  const points = round1(typePts + sizePts + locPts);
  const rev = t.revenue >= 1e9 ? `$${(t.revenue / 1e9).toFixed(1)}B` : `$${Math.round(t.revenue / 1e6)}M`;
  const reason = `${t.locations > 1 ? `${t.locations}-location ` : "Single-site "}${t.facilityType.toLowerCase()}, ~${rev} revenue`;
  return { key: "fit", points, max, reason };
}

// ---------------------------------------------------------------------------
// Displacement (15)
// ---------------------------------------------------------------------------
const noteText = (n: string) => (n.charAt(0).toLowerCase() + n.slice(1)).replace(/\.$/, "");

function displacementFactor(t: Target, asOf: Date): Factor {
  const max = FACTOR_META.displacement.max;
  const vendor = VENDOR_BY_NAME[t.software];
  if (!vendor) return { key: "displacement", points: 6, max, reason: `Runs ${t.software}` };
  if (vendor.kind === "ours") return { key: "displacement", points: 0, max, reason: "Already a ThiboLiSoft customer" };
  if (vendor.kind === "manual") return { key: "displacement", points: 15, max, reason: `Still on ${t.software}: ${noteText(vendor.note)}` };
  if (t.softwareEnd) {
    const end = parseDate(t.softwareEnd);
    const months = diffDays(end, asOf) / 30.4;
    if (vendor.kind === "legacy") {
      return months < 0
        ? { key: "displacement", points: 15, max, reason: `${t.software} support ended ${fmtMonthYear(end)}; they're running unsupported` }
        : { key: "displacement", points: 15, max, reason: `${t.software} support ends ${fmtMonthYear(end)}, so they have to move` };
    }
    let points: number;
    let reason: string;
    if (months < 0) {
      points = 11;
      reason = `${t.software} contract lapsed ${fmtMonthYear(end)} and is month-to-month now`;
    } else if (months <= 6) {
      points = 14;
      reason = `${t.software} contract renews ${fmtMonthYear(end)} (${Math.max(1, Math.round(months))} mo)`;
    } else if (months <= 12) {
      points = 12;
      reason = `${t.software} contract renews ${fmtMonthYear(end)}: plan the switch now`;
    } else if (months <= 24) {
      points = 7;
      reason = `${t.software} contract runs to ${fmtMonthYear(end)}`;
    } else {
      points = 3;
      reason = `Locked into ${t.software} until ${fmtMonthYear(end)}`;
    }
    return { key: "displacement", points: round1(clamp(points - vendor.modernity * 2, 0, max)), max, reason };
  }
  return {
    key: "displacement",
    points: round1(clamp(14 - vendor.modernity * 8, 0, max)),
    max,
    reason: `On ${t.software}: ${noteText(vendor.note)}`,
  };
}

// ---------------------------------------------------------------------------
// Engagement (15)
// ---------------------------------------------------------------------------
function engagementFactor(t: Target, e: Engagement, asOf: Date): Factor {
  const max = FACTOR_META.engagement.max;
  let points = 0;
  const parts: string[] = [];
  const since = e.lastTouch ? diffDays(asOf, e.lastTouch) : undefined;
  if (since === undefined) {
    points += 2;
    parts.push("No touches in the last 12 months, so they haven't heard our pitch yet");
  } else if (since <= 30) points += 5;
  else if (since <= 90) points += 4;
  else if (since <= 180) points += 2;
  else points += 1;
  points += Math.min(3, e.touches * 0.35);
  if (e.lastResponse) {
    points += 4;
    parts.push(`Responded to "${e.lastResponse.campaign}" ${fmtSpan(diffDays(asOf, e.lastResponse.date))} ago`);
  }
  if (e.openOpportunities) {
    points += 3;
    parts.push(`${e.openOpportunities} open opportunit${e.openOpportunities > 1 ? "ies" : "y"}`);
  }
  if (t.leadRating === "Hot") {
    points += 3;
    parts.push("rated Hot by marketing");
  } else if (t.leadRating === "Warm") points += 1.5;
  if (e.lostRecently) {
    points -= 3;
    parts.push("lost a deal in the last 4 months, so give them room");
  }
  if (since !== undefined && since <= 7) {
    points -= 4;
    parts.push(`touched ${since === 0 ? "today" : `${since} day${since > 1 ? "s" : ""} ago`}, so don't over-contact`);
  } else if (since !== undefined && !parts.length) {
    parts.push(`${e.touches} touch${e.touches === 1 ? "" : "es"} this year; last ${fmtSpan(since)} ago`);
  }
  return { key: "engagement", points: round1(clamp(points, 0, max)), max, reason: parts.join("; ") };
}

// ---------------------------------------------------------------------------
// Climate (5)
// ---------------------------------------------------------------------------
const CLIMATE_POINTS: Record<ClimateCondition, number> = {
  "Wet Delays": 5,
  "Excellent Yields": 5,
  "Early & Dry": 4,
  "Drought Stress": 4,
  "Heat Stress": 3,
  Normal: 1,
};
const CLIMATE_PHRASE: Record<ClimateCondition, string> = {
  "Wet Delays": "wet weather is compressing harvest, so expect high-moisture grain and heavy drying charges",
  "Excellent Yields": "big yields will strain storage and ground piles",
  "Early & Dry": "a warm, dry finish pulled harvest early",
  "Drought Stress": "drought cut the crop, so competition for bushels is fierce",
  "Heat Stress": "heat pushed the crop to maturity early",
  Normal: "a normal season in their region",
};

function climateFactor(t: Target, asOf: Date, position?: WindowPosition): Factor {
  const max = FACTOR_META.climate.max;
  const climate = position?.window.climate ?? climateFor(t.regionId, asOf.getUTCFullYear());
  return { key: "climate", points: CLIMATE_POINTS[climate.condition], max, reason: CLIMATE_PHRASE[climate.condition] };
}

// ---------------------------------------------------------------------------
// Put it together
// ---------------------------------------------------------------------------
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function composeWhyNow(factors: Record<FactorKey, Factor>): string {
  const ranked = (["timing", "displacement", "market", "engagement", "climate"] as FactorKey[])
    .map((k) => factors[k])
    .filter((f) => f.reason)
    .sort((a, b) => b.points / b.max - a.points / a.max);
  const lead = factors.timing.points / factors.timing.max >= 0.5 ? factors.timing : ranked[0];
  const second = ranked.find((f) => f.key !== lead.key && f.points / f.max >= 0.5 && f.key !== "climate") ?? ranked.find((f) => f.key !== lead.key);
  return [lead, second]
    .filter(Boolean)
    .map((f) => cap(f!.reason))
    .join(". ") + ".";
}

export function scoreTarget(t: Target, asOf: Date, engagement: Engagement): ScoredTarget {
  const { factor: timing, position } = timingFactor(t, asOf);
  const factors: Record<FactorKey, Factor> = {
    timing,
    market: marketFactor(t, asOf),
    fit: fitFactor(t),
    displacement: displacementFactor(t, asOf),
    engagement: engagementFactor(t, engagement, asOf),
    climate: climateFactor(t, asOf, position),
  };
  const total = Math.round(FACTOR_KEYS.reduce((s, k) => s + factors[k].points, 0));
  return {
    target: t,
    total,
    tier: total >= 72 ? "Hot" : total >= 60 ? "Warm" : "Cool",
    factors,
    whyNow: composeWhyNow(factors),
    timing: position,
    engagement,
  };
}

/**
 * Score every prospect Account and open Lead as of `asOf`, best first.
 * Customers are excluded (they belong to account management, not prospecting).
 */
export function rankProspects(data: DataSnapshot, asOf: Date): ScoredTarget[] {
  const engagement = buildEngagementIndex(data, asOf);
  const targets: Target[] = [
    ...data.accounts.filter((a) => a.Type !== "Customer - Direct").map(targetFromAccount),
    ...data.leads.filter((l) => l.Status !== "Closed - Not Converted").map(targetFromLead),
  ];
  return targets
    .map((t) => scoreTarget(t, asOf, engagementFor(engagement, t.id)))
    .sort((a, b) => b.total - a.total || a.target.name.localeCompare(b.target.name));
}

export function scoreOne(data: DataSnapshot, t: Target, asOf: Date): ScoredTarget {
  return scoreTarget(t, asOf, engagementFor(buildEngagementIndex(data, asOf), t.id));
}
