/**
 * Customer health score (pure, unit tested in success.test.ts).
 *
 * 0–100, the sum of five parts:
 * - Usage (30): HealthSignal.UsageScore × 0.30
 * - Support (20): 20 − 2.5 × ticket load, where ticket load over the last 90 days
 *   weights Low 0.5, Normal 1, High 2, Urgent 3, and ×1.25 while a ticket is
 *   still open. Without ticket records the signal's SupportTickets90d is the load.
 * - CSAT (25): CSAT (0–10) × 2.5
 * - Payments (15): 15 minus 4 / 8 / 12 for the oldest overdue invoice being
 *   1–29 / 30–59 / 60+ days late, 2 per extra overdue invoice, and 1.5 per
 *   invoice paid more than 10 days late in the past year
 * - Stakeholders (10): 0 when a key contact changed recently
 *
 * Bands: Healthy ≥ 70, Watch 45–69, At Risk < 45.
 * Trend: today's score minus the score 90 days earlier, with tickets and
 * invoices as they stood then (usage, CSAT and stakeholders held constant).
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Contract, HealthSignal, Invoice, SupportTicket } from "@/types/salesforce";
import { addDays, diffDays, parseDate } from "@/lib/dates";
import { arrFor, customerAccounts, liveContracts, renewalDateFor } from "./common";

export type HealthBand = "Healthy" | "Watch" | "At Risk";
export const HEALTH_BANDS: HealthBand[] = ["Healthy", "Watch", "At Risk"];
export type HealthTrend = "up" | "down" | "flat";

export const BAND_MIN = { Healthy: 70, Watch: 45 } as const;
export const TREND_DAYS = 90;
/** Points of change before a trend counts as up or down */
export const TREND_THRESHOLD = 5;

export const TICKET_WEIGHT: Record<SupportTicket["Priority"], number> = { Low: 0.5, Normal: 1, High: 2, Urgent: 3 };

export type HealthPartKey = "usage" | "support" | "csat" | "payments" | "stakeholder";

export interface HealthPart {
  key: HealthPartKey;
  label: string;
  /** Plain-language input, e.g. "82 / 100", "3 tickets (1 open)" */
  input: string;
  points: number;
  max: number;
}

export interface HealthResult {
  accountId: string;
  score: number;
  band: HealthBand;
  /** Score 90 days earlier */
  previous: number;
  delta: number;
  trend: HealthTrend;
  parts: HealthPart[];
  usage: number;
  csat: number;
  tickets90d: number;
  openTickets: number;
  overdueAmount: number;
  overdueInvoices: number;
  maxDaysLate: number;
  stakeholderChange: boolean;
  locations: number;
  locationsLive: number;
  signal?: HealthSignal;
}

export function bandFor(score: number): HealthBand {
  if (score >= BAND_MIN.Healthy) return "Healthy";
  if (score >= BAND_MIN.Watch) return "Watch";
  return "At Risk";
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Latest signal on or before asOf (else the earliest one after) */
export function signalFor(data: Pick<DataSnapshot, "healthSignals">, accountId: string, asOf: Date): HealthSignal | undefined {
  const all = data.healthSignals.filter((s) => s.AccountId === accountId).sort((a, b) => a.AsOfDate.localeCompare(b.AsOfDate));
  const before = all.filter((s) => parseDate(s.AsOfDate) <= asOf);
  return before[before.length - 1] ?? all[0];
}

function openAt(t: SupportTicket, at: Date): boolean {
  if (t.Status !== "Closed") return !t.ClosedDate || parseDate(t.ClosedDate) > at;
  return !!t.ClosedDate && parseDate(t.ClosedDate) > at;
}

/** Tickets created in the 90 days up to `at`, their weighted load and how many are open */
export function ticketLoad(tickets: SupportTicket[], at: Date): { count: number; open: number; load: number } {
  const from = addDays(at, 1 - TREND_DAYS);
  let count = 0;
  let open = 0;
  let load = 0;
  for (const t of tickets) {
    const c = parseDate(t.CreatedDate);
    if (c >= addDays(at, 1) || c < from) continue;
    const isOpen = openAt(t, at);
    count++;
    if (isOpen) open++;
    load += TICKET_WEIGHT[t.Priority] * (isOpen ? 1.25 : 1);
  }
  return { count, open, load };
}

export function supportPoints(load: number): number {
  return round1(clamp(20 - 2.5 * load, 0, 20));
}

function unpaidAt(i: Invoice, at: Date): boolean {
  if (i.Status === "Void" || i.Status === "Draft") return false;
  if (parseDate(i.IssueDate) > at) return false;
  if (i.PaidDate) return parseDate(i.PaidDate) > at;
  return i.AmountPaid < i.Total;
}

/** Overdue invoices and late-payment history as they stood on `at` */
export function paymentStanding(invoices: Invoice[], at: Date): { overdueAmount: number; overdueCount: number; maxDaysLate: number; latePaid: number; points: number } {
  let overdueAmount = 0;
  let overdueCount = 0;
  let maxDaysLate = 0;
  let latePaid = 0;
  for (const i of invoices) {
    const due = parseDate(i.DueDate);
    if (unpaidAt(i, at) && due < at) {
      overdueCount++;
      overdueAmount += i.PaidDate ? i.Total : i.Total - i.AmountPaid;
      maxDaysLate = Math.max(maxDaysLate, diffDays(at, due));
    }
    if (i.PaidDate && i.Status !== "Void") {
      const paid = parseDate(i.PaidDate);
      if (paid <= at && diffDays(at, paid) <= 365 && diffDays(paid, due) > 10) latePaid++;
    }
  }
  let penalty = maxDaysLate >= 60 ? 12 : maxDaysLate >= 30 ? 8 : maxDaysLate > 0 ? 4 : 0;
  penalty += Math.max(0, overdueCount - 1) * 2 + latePaid * 1.5;
  return { overdueAmount: Math.round(overdueAmount * 100) / 100, overdueCount, maxDaysLate, latePaid, points: round1(clamp(15 - penalty, 0, 15)) };
}

export interface HealthInputs {
  usage: number;
  csat: number;
  stakeholderChange: boolean;
  tickets: SupportTicket[];
  /** Used when there are no ticket records for the account */
  fallbackTickets90d: number;
  invoices: Invoice[];
}

/** Score and breakdown at one date */
export function scoreAt(inputs: HealthInputs, at: Date): { score: number; parts: HealthPart[]; tickets: ReturnType<typeof ticketLoad>; pay: ReturnType<typeof paymentStanding> } {
  const tickets = inputs.tickets.length ? ticketLoad(inputs.tickets, at) : { count: inputs.fallbackTickets90d, open: 0, load: inputs.fallbackTickets90d };
  const pay = paymentStanding(inputs.invoices, at);
  const usage = clamp(inputs.usage, 0, 100);
  const csat = clamp(inputs.csat, 0, 10);
  const parts: HealthPart[] = [
    { key: "usage", label: "Usage", input: `${Math.round(usage)} / 100`, points: round1(usage * 0.3), max: 30 },
    {
      key: "support",
      label: "Support tickets",
      input: `${tickets.count} in 90 days${tickets.open ? ` (${tickets.open} open)` : ""}`,
      points: supportPoints(tickets.load),
      max: 20,
    },
    { key: "csat", label: "CSAT", input: `${round1(csat)} / 10`, points: round1(csat * 2.5), max: 25 },
    {
      key: "payments",
      label: "Payments",
      input: pay.overdueCount
        ? `${pay.overdueCount} overdue, ${pay.maxDaysLate} days late`
        : pay.latePaid
          ? `${pay.latePaid} paid late this year`
          : "On time",
      points: pay.points,
      max: 15,
    },
    { key: "stakeholder", label: "Stakeholders", input: inputs.stakeholderChange ? "Key contact changed" : "Stable", points: inputs.stakeholderChange ? 0 : 10, max: 10 },
  ];
  const score = Math.round(clamp(parts.reduce((s, p) => s + p.points, 0), 0, 100));
  return { score, parts, tickets, pay };
}

type HealthData = Pick<DataSnapshot, "accounts" | "healthSignals" | "supportTickets" | "invoices">;

function indexBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function compute(account: Account | undefined, accountId: string, signal: HealthSignal | undefined, tickets: SupportTicket[], invoices: Invoice[], asOf: Date): HealthResult {
  const visibleTickets = tickets.filter((t) => parseDate(t.CreatedDate) < addDays(asOf, 1));
  const inputs: HealthInputs = {
    usage: signal?.UsageScore ?? 60,
    csat: signal?.CSAT ?? 7,
    stakeholderChange: signal?.StakeholderChange ?? false,
    tickets: visibleTickets,
    fallbackTickets90d: signal?.SupportTickets90d ?? 0,
    invoices,
  };
  const now = scoreAt(inputs, asOf);
  const before = scoreAt(inputs, addDays(asOf, -TREND_DAYS));
  const delta = now.score - before.score;
  const locations = Math.max(1, account?.Number_of_Locations__c ?? 1);
  return {
    accountId,
    score: now.score,
    band: bandFor(now.score),
    previous: before.score,
    delta,
    trend: delta >= TREND_THRESHOLD ? "up" : delta <= -TREND_THRESHOLD ? "down" : "flat",
    parts: now.parts,
    usage: inputs.usage,
    csat: inputs.csat,
    tickets90d: now.tickets.count,
    openTickets: visibleTickets.filter((t) => openAt(t, asOf)).length,
    overdueAmount: now.pay.overdueAmount,
    overdueInvoices: now.pay.overdueCount,
    maxDaysLate: now.pay.maxDaysLate,
    stakeholderChange: inputs.stakeholderChange,
    locations,
    locationsLive: Math.min(locations, signal?.LocationsLive ?? locations),
    signal,
  };
}

/** Health for one account */
export function healthFor(data: HealthData, accountId: string, asOf: Date): HealthResult {
  return compute(
    data.accounts.find((a) => a.Id === accountId),
    accountId,
    signalFor(data, accountId, asOf),
    data.supportTickets.filter((t) => t.AccountId === accountId),
    data.invoices.filter((i) => i.AccountId === accountId),
    asOf,
  );
}

/** Health for every customer account, keyed by AccountId */
export function healthAll(data: HealthData & Pick<DataSnapshot, "contracts">, asOf: Date): Map<string, HealthResult> {
  const tickets = indexBy(data.supportTickets, (t) => t.AccountId);
  const invoices = indexBy(data.invoices, (i) => i.AccountId);
  const signals = indexBy(data.healthSignals, (s) => s.AccountId);
  const out = new Map<string, HealthResult>();
  for (const a of customerAccounts(data)) {
    const sig = signalFor({ healthSignals: signals.get(a.Id) ?? [] }, a.Id, asOf);
    out.set(a.Id, compute(a, a.Id, sig, tickets.get(a.Id) ?? [], invoices.get(a.Id) ?? [], asOf));
  }
  return out;
}

export interface RenewalAtRisk {
  contract: Contract;
  account: Account;
  health: HealthResult;
  arr: number;
  daysToEnd: number;
}

/** Window (days) in which a contract end counts as an upcoming renewal */
export const RENEWAL_HORIZON_DAYS = 180;

/**
 * Live contracts ending within 180 days whose customer is At Risk, or on
 * Watch and either trending down or within 90 days of the end. Soonest first.
 * A renewal already won (Closed Won renewal opportunity) is excluded.
 */
export function renewalsAtRisk(data: DataSnapshot, asOf: Date): RenewalAtRisk[] {
  const health = healthAll(data, asOf);
  const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
  const opps = new Map(data.opportunities.map((o) => [o.Id, o]));
  const out: RenewalAtRisk[] = [];
  for (const c of data.contracts) {
    if (c.Status !== "Active") continue;
    const daysToEnd = diffDays(parseDate(c.EndDate), asOf);
    if (daysToEnd < 0 || daysToEnd > RENEWAL_HORIZON_DAYS) continue;
    const renewal = c.RenewalOpportunityId ? opps.get(c.RenewalOpportunityId) : undefined;
    if (renewal?.IsWon) continue;
    const account = accounts.get(c.AccountId);
    const h = health.get(c.AccountId);
    if (!account || !h) continue;
    const risky = h.band === "At Risk" || (h.band === "Watch" && (h.trend === "down" || daysToEnd <= 90));
    if (risky) out.push({ contract: c, account, health: h, arr: c.ARR, daysToEnd });
  }
  return out.sort((a, b) => a.daysToEnd - b.daysToEnd || b.arr - a.arr);
}

/** Customer rows for the Health page: health plus ARR and renewal date */
export function customerRows(data: DataSnapshot, asOf: Date): { account: Account; health: HealthResult; arr: number; renewalDate?: string; contracts: number }[] {
  const health = healthAll(data, asOf);
  return customerAccounts(data).map((account) => ({
    account,
    health: health.get(account.Id)!,
    arr: arrFor(data, account.Id, asOf),
    renewalDate: renewalDateFor(data, account.Id, asOf),
    contracts: liveContracts(data, account.Id).length,
  }));
}
