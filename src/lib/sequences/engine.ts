/**
 * Email sequence engine: season phase, merge fields, variant selection,
 * blackout-aware scheduling and enrollment. Pure functions, no React.
 *
 * Nothing here sends anything. Enrollments are schedules that live in the
 * browser; the UI may log them as Salesforce-style Tasks.
 */
import type { Enrollment, MergeField, ScheduledStep, SeasonPhase, Sequence, SequenceStep, StepVariant, VariantRule } from "@/lib/ai/types";
import { MERGE_FIELDS } from "@/lib/ai/types";
import type { Account, Commodity, Contact } from "@/types/salesforce";
import type { Sender } from "@/lib/content/templates";
import { harvestWindow, phaseValue, plantingWindow, type MapCommodity } from "@/lib/cropCalendar";
import { blackoutStatus, blackoutsFor, nextBoardMeeting } from "@/lib/seasonality";
import { REGION_BY_ID } from "@/data/reference/regions";
import { addDays, diffDays, parseDate, toISODate } from "@/lib/dates";

/* ------------------------------------------------------------ season phase */

const MAP_COMMODITY: Partial<Record<Commodity, MapCommodity>> = {
  Corn: "Corn",
  Soybeans: "Soybeans",
  "Winter Wheat": "Wheat",
  "Spring Wheat": "Wheat",
  Rice: "Rice",
  Pulses: "Lentils",
};

export function mapCommodity(c: Commodity | undefined): MapCommodity {
  return (c && MAP_COMMODITY[c]) || "Corn";
}

export const SEASON_PHASE_LABEL: Record<SeasonPhase, string> = {
  planting: "Planting",
  growing: "Growing",
  harvest: "Harvest",
  "post-harvest": "Post-harvest",
  "off-season": "Off-season",
};

/** Days after the end of harvest that still count as "post-harvest" */
export const POST_HARVEST_DAYS = 120;

type PhaseAccount = Pick<Account, "Primary_Commodities__c" | "BillingState" | "BillingLatitude">;

/**
 * Season phase for an account on a date, from its primary commodity's crop
 * calendar at the account's state and latitude (Primary_Commodities__c[0];
 * Winter/Spring Wheat -> Wheat, Pulses -> Lentils, anything else -> Corn).
 * If that crop isn't grown in the state, Corn is tried, then "off-season".
 *
 *   planting      phaseValue <= -0.5 (inside the planting window)
 *   harvest       phaseValue >= +0.5 (inside the harvest window)
 *   growing       the most recent planting window ended after the most recent
 *                 harvest window (the crop is in the ground)
 *   post-harvest  the most recent harvest window ended within 120 days
 *   off-season    anything else (e.g. March for corn, before planting)
 */
export function seasonPhaseFor(account: PhaseAccount, date: Date): SeasonPhase {
  const state = account.BillingState;
  const lat = account.BillingLatitude ?? 41;
  let crop = mapCommodity(account.Primary_Commodities__c?.[0]);
  let v = phaseValue(crop, state, lat, date);
  if (v === null && crop !== "Corn") {
    crop = "Corn";
    v = phaseValue(crop, state, lat, date);
  }
  if (v === null) return "off-season";
  if (v <= -0.5) return "planting";
  if (v >= 0.5) return "harvest";

  const y = date.getUTCFullYear();
  const lastEnd = (win: typeof harvestWindow) =>
    [y - 1, y]
      .map((yr) => win(crop, state, lat, yr)?.end)
      .filter((d): d is Date => !!d && d <= date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
  const plantEnd = lastEnd(plantingWindow);
  const harvestEnd = lastEnd(harvestWindow);
  if (plantEnd && (!harvestEnd || plantEnd > harvestEnd)) return "growing";
  if (harvestEnd && diffDays(date, harvestEnd) <= POST_HARVEST_DAYS) return "post-harvest";
  return "off-season";
}

/* ------------------------------------------------------------ merge fields */

export interface MergeContext {
  account: Account;
  contact?: Contact;
  sender: Pick<Sender, "name">;
  /** The date the step goes out (or the as-of date) */
  asOf: Date;
  data: { accounts: Account[] };
}

export type MergeValues = Record<MergeField, string | null>;

/** "November 26" */
export function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

/** "corn", "wheat", "pulses" */
export function commodityNoun(c: Commodity | undefined): string | null {
  if (!c) return null;
  if (c === "Winter Wheat" || c === "Spring Wheat") return "wheat";
  return c.toLowerCase();
}

/** Blackout that the date is in, or that starts within `withinDays` */
export function upcomingBlackout(account: Account, date: Date, withinDays = 60) {
  const y = date.getUTCFullYear();
  const horizon = addDays(date, withinDays);
  return [...blackoutsFor(account, y - 1), ...blackoutsFor(account, y), ...blackoutsFor(account, y + 1)].find((b) => b.end >= date && b.start <= horizon);
}

function blank(s: string | undefined | null): string | null {
  const t = (s ?? "").trim();
  return t ? t : null;
}

export function mergeValues(ctx: MergeContext): MergeValues {
  const { account: a, contact, sender, asOf, data } = ctx;
  const children = data.accounts.filter((x) => x.ParentId === a.Id).length;
  const locations = a.Number_of_Locations__c > 0 ? a.Number_of_Locations__c : children;
  const fye = a.Fiscal_Year_End__c?.match(/^(\d{2})-(\d{2})$/);
  const board = nextBoardMeeting(a.Board_Meeting_Months__c, asOf);
  const blackout = upcomingBlackout(a, asOf);
  return {
    "contact.first_name": blank(contact?.FirstName),
    "contact.title": blank(contact?.Title),
    "account.name": blank(a.Name),
    "account.locations": locations > 0 ? `${locations} location${locations === 1 ? "" : "s"}` : null,
    region: blank(REGION_BY_ID[a.Region__c]?.name),
    state: blank(a.BillingState),
    commodity: commodityNoun(a.Primary_Commodities__c?.[0]),
    season_phase: seasonPhaseFor(a, asOf),
    blackout_end_date: blackout ? fmtMonthDay(blackout.end) : null,
    fiscal_year_end: fye ? fmtMonthDay(new Date(Date.UTC(2001, Number(fye[1]) - 1, Number(fye[2])))) : null,
    next_board_meeting: board ? fmtMonthDay(board) : null,
    "sender.name": blank(sender.name),
  };
}

/* ---------------------------------------------------------------- render */

export interface RenderSegment {
  text: string;
  field?: MergeField;
  missing?: boolean;
}

export interface Rendered {
  text: string;
  segments: RenderSegment[];
  missing: MergeField[];
  unknown: string[];
}

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;
const KNOWN = new Set<string>(MERGE_FIELDS);

export function isMergeField(s: string): s is MergeField {
  return KNOWN.has(s);
}

/** Merge fields used in a piece of text */
export function fieldsIn(text: string | undefined): MergeField[] {
  const out = new Set<MergeField>();
  for (const m of (text ?? "").matchAll(TOKEN)) if (isMergeField(m[1])) out.add(m[1]);
  return [...out];
}

/**
 * Replace {{field}} tokens. Missing values keep the {{field}} token in the
 * text (and are reported); unknown tokens are left as-is and reported.
 */
export function renderTemplate(text: string, values: Partial<MergeValues>): Rendered {
  const segments: RenderSegment[] = [];
  const missing = new Set<MergeField>();
  const unknown = new Set<string>();
  let out = "";
  let last = 0;
  const push = (s: RenderSegment) => {
    if (!s.text && !s.field) return;
    const prev = segments[segments.length - 1];
    if (!s.field && prev && !prev.field) prev.text += s.text;
    else segments.push(s);
    out += s.text;
  };
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    push({ text: text.slice(last, idx) });
    const name = m[1];
    if (isMergeField(name)) {
      const v = values[name];
      if (v === null || v === undefined || v === "") {
        missing.add(name);
        push({ text: `{{${name}}}`, field: name, missing: true });
      } else push({ text: v, field: name });
    } else {
      unknown.add(name);
      push({ text: m[0] });
    }
    last = idx + m[0].length;
  }
  push({ text: text.slice(last) });
  return { text: out, segments, missing: [...missing], unknown: [...unknown] };
}

/* --------------------------------------------------------------- variants */

export interface VariantFacts {
  season_phase: SeasonPhase;
  /** All of the account's commodities */
  commodity: string[];
  region: { id: string; name: string };
  state: string;
  segment: string;
}

export function factsFor(account: Account, date: Date): VariantFacts {
  return {
    season_phase: seasonPhaseFor(account, date),
    commodity: account.Primary_Commodities__c ?? [],
    region: { id: account.Region__c, name: REGION_BY_ID[account.Region__c]?.name ?? account.Region__c },
    state: account.BillingState,
    segment: account.Segment__c,
  };
}

function ruleMatches(r: VariantRule, f: VariantFacts): boolean {
  const v = r.value.trim().toLowerCase();
  let hit: boolean;
  switch (r.field) {
    case "commodity":
      hit = !!v && f.commodity.some((c) => c.toLowerCase().includes(v));
      break;
    case "region":
      hit = v === f.region.id.toLowerCase() || v === f.region.name.toLowerCase();
      break;
    default:
      hit = v === String(f[r.field] ?? "").toLowerCase();
  }
  return r.op === "neq" ? !hit : hit;
}

/** First variant whose rules all match. Variants with no rules never match. */
export function pickVariant(step: Pick<SequenceStep, "variants">, facts: VariantFacts): StepVariant | null {
  return step.variants.find((v) => v.rules.length > 0 && v.rules.every((r) => ruleMatches(r, facts))) ?? null;
}

/* ------------------------------------------------------------- schedule */

export interface ScheduleEntry {
  step: SequenceStep;
  /** YYYY-MM-DD */
  date: string;
  /** Set when the step was moved out of a no-contact period */
  originalDate?: string;
  reason?: string;
}

function nextWeekday(d: Date): Date {
  let x = d;
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x = addDays(x, 1);
  return x;
}

/**
 * Day N = start + (N - 1) days, pushed off weekends to the next weekday.
 *
 * Blackouts (seasonal segments only; see blackoutStatus):
 *   hard (harvest)          every step type moves to the blackout's resume date
 *   light (spring planting) only Call steps move; short emails and LinkedIn
 *                           touches are acceptable in a light no-contact period
 * A moved step records originalDate and a reason ("Harvest blackout").
 * Later steps keep their spacing from the step before them: each step goes
 * no earlier than the previous step's date + the difference in days, so a
 * move ripples forward instead of bunching steps up.
 */
export function scheduleSequence(sequence: Pick<Sequence, "steps">, account: Account, startDate: Date): ScheduleEntry[] {
  const steps = [...sequence.steps].sort((a, b) => a.day - b.day);
  const out: ScheduleEntry[] = [];
  /** Previous step's anchor date (before any weekend nudge) */
  let prev: { day: number; date: Date; reason?: string } | null = null;
  for (const step of steps) {
    const day = Math.max(1, Math.round(step.day || 1));
    const natural = addDays(startDate, day - 1);
    let date = natural;
    let reason: string | undefined;
    if (prev) {
      const spaced = addDays(prev.date, day - prev.day);
      if (spaced > date) {
        date = spaced;
        reason = prev.reason;
      }
    }
    // Weekend nudges don't ripple forward; blackout moves do
    let anchor = date;
    date = nextWeekday(date);
    for (let i = 0; i < 3; i++) {
      const b = blackoutStatus(account, date);
      const moves = b.status === "hard" || (b.status === "light" && step.type === "call");
      if (!moves || !b.resumeDate || !b.blackout) break;
      date = b.resumeDate;
      anchor = date;
      reason = `${b.blackout.label} blackout`;
    }
    const iso = toISODate(date);
    const naturalIso = toISODate(nextWeekday(natural));
    const entry: ScheduleEntry = { step, date: iso };
    if (reason && iso !== naturalIso) {
      entry.originalDate = toISODate(natural);
      entry.reason = reason;
    }
    out.push(entry);
    prev = { day, date: anchor, reason: entry.reason };
  }
  return out;
}

/* ------------------------------------------------------------ rendering */

export interface RenderedStep {
  step: SequenceStep;
  variant: StepVariant | null;
  subject?: Rendered;
  body: Rendered;
  missing: MergeField[];
}

/** Render one step for a recipient as of a send date */
export function renderStep(step: SequenceStep, ctx: MergeContext): RenderedStep {
  const variant = pickVariant(step, factsFor(ctx.account, ctx.asOf));
  const values = mergeValues(ctx);
  const subjectText = step.type === "email" ? (variant?.subject ?? step.subject ?? "") : undefined;
  const subject = subjectText !== undefined ? renderTemplate(subjectText, values) : undefined;
  const body = renderTemplate(variant?.body ?? step.body, values);
  return { step, variant, subject, body, missing: [...new Set([...(subject?.missing ?? []), ...body.missing])] };
}

/** All merge fields a sequence can use (default text and variants) */
export function sequenceFields(sequence: Pick<Sequence, "steps">): MergeField[] {
  const out = new Set<MergeField>();
  for (const s of sequence.steps) {
    for (const t of [s.subject, s.body, ...s.variants.flatMap((v) => [v.subject, v.body])]) fieldsIn(t).forEach((f) => out.add(f));
  }
  return [...out];
}

export function usesContactFields(sequence: Pick<Sequence, "steps">): boolean {
  return sequenceFields(sequence).some((f) => f.startsWith("contact."));
}

export interface RecipientPlan {
  schedule: (ScheduleEntry & { rendered: RenderedStep })[];
  missing: MergeField[];
  /** First step's date moved by a blackout */
  delayed: boolean;
}

export function planFor(sequence: Pick<Sequence, "steps">, ctx: MergeContext & { startDate: Date }): RecipientPlan {
  const schedule = scheduleSequence(sequence, ctx.account, ctx.startDate).map((e) => ({
    ...e,
    rendered: renderStep(e.step, { ...ctx, asOf: parseDate(e.date) }),
  }));
  const missing = [...new Set(schedule.flatMap((s) => s.rendered.missing))];
  return { schedule, missing, delayed: !!schedule[0]?.originalDate };
}

/* ------------------------------------------------------------ enrollment */

export interface EnrollContext {
  sender: Pick<Sender, "name">;
  /** Enrollment (time-travel) date */
  asOf: Date;
  data: { accounts: Account[] };
  enrolledBy: string;
}

function enrollmentId(): string {
  return `enr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function enrollmentFor(sequence: Sequence, account: Account, contact: Contact | undefined, ctx: EnrollContext): Enrollment {
  const plan = planFor(sequence, { account, contact, sender: ctx.sender, asOf: ctx.asOf, data: ctx.data, startDate: ctx.asOf });
  const steps: ScheduledStep[] = plan.schedule.map((s) => ({
    stepId: s.step.id,
    type: s.step.type,
    date: s.date,
    ...(s.originalDate ? { originalDate: s.originalDate } : {}),
    ...(s.rendered.variant ? { variantId: s.rendered.variant.id } : {}),
    ...(s.rendered.subject ? { subject: s.rendered.subject.text } : {}),
    body: s.rendered.body.text,
  }));
  return {
    id: enrollmentId(),
    sequenceId: sequence.id,
    sequenceName: sequence.name,
    accountId: account.Id,
    ...(contact ? { contactId: contact.Id } : {}),
    enrolledAt: new Date().toISOString(),
    startDate: toISODate(ctx.asOf),
    enrolledBy: ctx.enrolledBy,
    steps,
  };
}
