/**
 * Selling seasonality for grain buyers.
 *
 * Harvest is a no-contact period, not an opportunity: elevator and co-op
 * buyers go dark from mid-August to Thanksgiving, and lightly again during
 * spring planting. Both shift 1–2 weeks later going north, and later still in
 * Canada. Ethanol plants, feed mills and processors run year-round.
 */
import { SEASONAL_SEGMENTS, type Account, type Opportunity, type Segment } from "@/types/salesforce";
import { addDays, diffDays, fmtShortDate, parseDate } from "@/lib/dates";

export interface SeasonalEntity {
  Segment__c?: Segment;
  BillingLatitude?: number;
  BillingCountry?: string;
}

export function isSeasonalSegment(segment: Segment | undefined): boolean {
  return !!segment && SEASONAL_SEGMENTS.includes(segment);
}

/** Days to shift seasonal windows: 0 at ≤38°N, ~1 week at 42°N, 2 weeks at ≥45°N; +7 more in Canada */
export function northShiftDays(lat = 41, country?: string): number {
  const base = Math.round(Math.min(14, Math.max(0, (lat - 38) * 2)));
  return base + (country === "Canada" ? 7 : 0);
}

/** US Thanksgiving: fourth Thursday of November */
export function thanksgiving(year: number): Date {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstThu = 1 + ((4 - nov1.getUTCDay() + 7) % 7);
  return new Date(Date.UTC(year, 10, firstThu + 21));
}

export interface Blackout {
  kind: "hard" | "light";
  label: string;
  start: Date;
  end: Date;
}

export function blackoutsFor(e: SeasonalEntity, year: number): Blackout[] {
  if (!isSeasonalSegment(e.Segment__c)) return [];
  const shift = northShiftDays(e.BillingLatitude, e.BillingCountry);
  return [
    { kind: "light", label: "Spring planting", start: addDays(new Date(Date.UTC(year, 3, 15)), shift), end: addDays(new Date(Date.UTC(year, 5, 5)), shift) },
    { kind: "hard", label: "Harvest", start: addDays(new Date(Date.UTC(year, 7, 15)), shift), end: addDays(thanksgiving(year), shift) },
  ];
}

/** The harvest (hard no-contact) window for a year */
export function harvestWindowFor(e: SeasonalEntity, year: number): Blackout | undefined {
  return blackoutsFor(e, year).find((b) => b.kind === "hard");
}

/** Next weekday after a date */
function nextBusinessDay(d: Date): Date {
  let x = addDays(d, 1);
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x = addDays(x, 1);
  return x;
}

export interface BlackoutStatus {
  status: "hard" | "light" | "none";
  blackout?: Blackout;
  /** First suggested contact date after the blackout */
  resumeDate?: Date;
  /** Plain-English warning for outreach */
  message?: string;
}

export function blackoutStatus(e: SeasonalEntity, date: Date): BlackoutStatus {
  const y = date.getUTCFullYear();
  const b = [...blackoutsFor(e, y - 1), ...blackoutsFor(e, y)].find((x) => date >= x.start && date <= x.end);
  if (!b) return { status: "none" };
  let resume = nextBusinessDay(b.end);
  // Land after the Thanksgiving weekend
  if (b.kind === "hard" && resume.getUTCDay() === 5) resume = addDays(resume, 3);
  return {
    status: b.kind,
    blackout: b,
    resumeDate: resume,
    message:
      b.kind === "hard"
        ? `In harvest blackout until ${fmtShortDate(b.end)}. Schedule for ${fmtShortDate(resume)}?`
        : `Spring planting (light no-contact) until ${fmtShortDate(b.end)}. Keep it short, or schedule for ${fmtShortDate(resume)}.`,
  };
}

// ---------------------------------------------------------------------------
// Selling windows (the campaign calendar)
// ---------------------------------------------------------------------------
export type SellingWindowId = "year-end" | "implementation" | "planting" | "budget" | "quick-wins" | "harvest" | "shoulder";

export interface SellingWindowDef {
  id: SellingWindowId;
  name: string;
  when: string;
  /** Month-day ranges, inclusive (may wrap the year) */
  start: string;
  end: string;
  sellToGrain: "prime" | "good" | "limited" | "no-contact";
  summary: string;
}

export const SELLING_WINDOWS: SellingWindowDef[] = [
  {
    id: "year-end",
    name: "Year-end & audit season",
    when: "Dec – Feb",
    start: "12-01",
    end: "02-20",
    sellToGrain: "prime",
    summary: "Prime time: year-end close, audits, board meetings and next year's budgets. Elevators and co-ops have time to talk.",
  },
  {
    id: "implementation",
    name: "Live before planting",
    when: "Late Feb – Mar",
    start: "02-21",
    end: "04-14",
    sellToGrain: "good",
    summary: "Implementation window: decisions made now can go live before spring planting.",
  },
  {
    id: "planting",
    name: "Spring planting",
    when: "Mid-Apr – early Jun",
    start: "04-15",
    end: "06-05",
    sellToGrain: "limited",
    summary: "Light no-contact for elevators and co-ops. Short check-ins only; focus on ethanol, feed and processors.",
  },
  {
    id: "budget",
    name: "Budget window",
    when: "Jun – Jul",
    start: "06-06",
    end: "07-31",
    sellToGrain: "good",
    summary: "Fiscal years often end Aug 31 or Sep 30, so this is when next year's budget gets written.",
  },
  {
    id: "quick-wins",
    name: "Quick wins only",
    when: "Early Aug",
    start: "08-01",
    end: "08-14",
    sellToGrain: "limited",
    summary: "Small, fast decisions only: mobile add-ons (GrainSight Mobile, ScaleTrac Mobile) and pilots.",
  },
  {
    id: "harvest",
    name: "Harvest",
    when: "Mid-Aug – Thanksgiving",
    start: "08-15",
    end: "11-28",
    sellToGrain: "no-contact",
    summary: "No-contact for elevators and co-ops. Support customers, collect NPS and testimonials, and sell to year-round segments.",
  },
  {
    id: "shoulder",
    name: "Post-harvest wrap-up",
    when: "Late Nov",
    start: "11-29",
    end: "11-30",
    sellToGrain: "good",
    summary: "Harvest is winding down; book December meetings.",
  },
];

function mdToDate(md: string, year: number): Date {
  const [m, d] = md.split("-").map(Number);
  return new Date(Date.UTC(year, m - 1, d));
}

export function sellingWindowAt(date: Date): SellingWindowDef {
  const y = date.getUTCFullYear();
  for (const w of SELLING_WINDOWS) {
    const start = mdToDate(w.start, y);
    let end = mdToDate(w.end, y);
    if (end < start) {
      // wraps the year (Dec → Feb)
      if (date >= start || date <= end) return w;
      continue;
    }
    end = addDays(end, 0);
    if (date >= start && date <= end) return w;
  }
  return SELLING_WINDOWS.find((w) => w.id === "shoulder")!;
}

/** Start and end of a selling window occurrence that contains or follows `date` */
export function windowRange(w: SellingWindowDef, date: Date): { start: Date; end: Date } {
  const y = date.getUTCFullYear();
  for (const year of [y - 1, y, y + 1]) {
    const start = mdToDate(w.start, year);
    let end = mdToDate(w.end, year);
    if (end < start) end = mdToDate(w.end, year + 1);
    if (end >= date) return { start, end };
  }
  return { start: mdToDate(w.start, y + 1), end: mdToDate(w.end, y + 1) };
}

// ---------------------------------------------------------------------------
// Board meetings and close-date checks
// ---------------------------------------------------------------------------

/** Boards usually meet on the second Tuesday of their meeting months */
export function nextBoardMeeting(months: number[] | undefined, after: Date): Date | null {
  if (!months?.length) return null;
  for (let i = 0; i < 24; i++) {
    const y = after.getUTCFullYear() + Math.floor((after.getUTCMonth() + i) / 12);
    const m = (after.getUTCMonth() + i) % 12;
    if (!months.includes(m + 1)) continue;
    const first = new Date(Date.UTC(y, m, 1));
    const firstTue = 1 + ((2 - first.getUTCDay() + 7) % 7);
    const meeting = new Date(Date.UTC(y, m, firstTue + 7));
    if (meeting >= after) return meeting;
  }
  return null;
}

export interface CloseDateFlag {
  kind: "board" | "blackout" | "economic-buyer";
  message: string;
}

/** Sanity checks on an open deal's close date and buying committee */
export function closeDateFlags(o: Opportunity, a: Account | undefined, asOf: Date): CloseDateFlag[] {
  if (o.IsClosed || !a) return [];
  const flags: CloseDateFlag[] = [];
  const close = parseDate(o.CloseDate);
  const meeting = nextBoardMeeting(a.Board_Meeting_Months__c, asOf);
  const needsBoard = a.Segment__c === "Multi-Location Co-op" || o.StageName === "Board Approval";
  if (needsBoard && meeting && close < meeting) {
    flags.push({ kind: "board", message: `Closes ${fmtShortDate(close)}, before the next board meeting (${fmtShortDate(meeting)}). Move the close date or get on that agenda.` });
  }
  const b = blackoutStatus(a, close);
  if (b.status !== "none" && b.blackout) {
    flags.push({
      kind: "blackout",
      message: `Closes ${fmtShortDate(close)}, inside the ${b.blackout.label.toLowerCase()} ${b.status === "hard" ? "no-contact" : "light no-contact"} period (to ${fmtShortDate(b.blackout.end)}).`,
    });
  }
  if (!o.Economic_Buyer_Identified__c && o.StageName !== "Prospecting") {
    flags.push({ kind: "economic-buyer", message: "Past Prospecting without an identified economic buyer." });
  }
  return flags;
}

/** Days until a blackout ends (0 if not in one) */
export function daysUntilClear(e: SeasonalEntity, date: Date): number {
  const s = blackoutStatus(e, date);
  return s.blackout ? Math.max(0, diffDays(s.blackout.end, date)) : 0;
}
