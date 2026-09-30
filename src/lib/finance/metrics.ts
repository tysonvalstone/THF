/**
 * SaaS revenue metrics from contracts, invoices and payments. Pure functions;
 * every amount is reported in USD (CAD converted at a fixed planning rate).
 *
 * Definitions (see content/help/finance.mdx):
 * - ARR: sum of annual recurring revenue of contracts in force on the date
 *   (signed and started, not past EndDate, not terminated), with each
 *   contract's yearly price increase applied for the contract year it is in.
 *   Draft / in-review / unsigned contracts never count; Expired and Terminated
 *   contracts count only for dates inside their service term. MRR = ARR / 12.
 * - ARR bridge: per account, opening ARR (day before the period) vs. closing
 *   ARR (period end). 0 → >0 is New, >0 → 0 is Churn, higher is Expansion
 *   (upsell or renewal uplift, including price increases), lower is
 *   Contraction. Opening + new + expansion − contraction − churn = closing.
 * - NRR / GRR (trailing 12 months): accounts with ARR a year ago; NRR = their
 *   ARR today ÷ their ARR then; GRR caps each account at its ARR then.
 * - ACV: average annualised recurring value, (TCV − one-time fees) ÷ years,
 *   of contracts signed in the trailing 12 months.
 * - Payback (months): S&M cost ÷ (new + expansion ARR × gross margin) × 12,
 *   trailing 12 months. S&M cost is a proxy: quota-carrying reps (owners of
 *   deals closed in the window) × a fully loaded cost per rep. Both constants
 *   are in PAYBACK_ASSUMPTIONS.
 * - Bookings: contracts signed in the period (TCV, and first-year value =
 *   first-year ARR + one-time fees).
 * - Billings: invoices issued in the period (not Draft or Void).
 * - Revenue: recurring revenue recognised ratably per contract day; one-time
 *   fees recognised at go-live (onboarding go-live date; contract start when
 *   there is no onboarding project; not yet when the project isn't live).
 * - Deferred revenue: per contract, billed (excluding tax) minus recognised,
 *   floored at zero, on the date.
 * - Cash collected: payments dated in the period.
 */
import type { Contract, Invoice, Opportunity } from "@/types/salesforce";
import type { DataSnapshot } from "@/lib/data/types";
import { addMonthsClamped, arrForYear, serviceEnd } from "@/lib/billing/schedule";

export const FX_TO_USD: Record<string, number> = { USD: 1, CAD: 0.73 };
export const fx = (ccy: string | undefined) => FX_TO_USD[ccy ?? "USD"] ?? 1;

export const PAYBACK_ASSUMPTIONS = {
  /** Fully loaded annual sales & marketing cost per quota-carrying rep (salary, commission, programs) */
  costPerRep: 240_000,
  /** Software gross margin */
  grossMargin: 0.8,
};

const DAY = 86_400_000;
const d = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const plusDays = (x: Date, n: number) => new Date(x.getTime() + n * DAY);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

type Data = Pick<DataSnapshot, "contracts" | "invoices" | "payments" | "opportunities" | "onboardingProjects">;

export interface Period {
  kind: PeriodKind;
  start: Date;
  /** Inclusive (the as-of date for to-date periods) */
  end: Date;
  label: string;
}
export type PeriodKind = "month" | "quarter" | "ytd";

/** Month-, quarter- or year-to-date ending on the as-of date */
export function periodFor(kind: PeriodKind, asOf: Date): Period {
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth();
  const start = kind === "month" ? new Date(Date.UTC(y, m, 1)) : kind === "quarter" ? new Date(Date.UTC(y, m - (m % 3), 1)) : new Date(Date.UTC(y, 0, 1));
  const label =
    kind === "month"
      ? asOf.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      : kind === "quarter"
        ? `Q${Math.floor(m / 3) + 1} ${y}`
        : `${y} year to date`;
  return { kind, start, end: asOf, label };
}

/* ---------------------------------------------------------------- ARR */

const LIVE = new Set<Contract["Status"]>(["Active", "Signed", "Expired", "Terminated"]);

/** Whether the contract is in force (earning) on the date */
export function inForce(c: Contract, date: Date): boolean {
  if (!LIVE.has(c.Status)) return false;
  const x = iso(date);
  return c.StartDate <= x && x <= serviceEnd(c);
}

/** Contract year (0-based) for a date */
function yearAt(c: Contract, date: Date): number {
  const s = d(c.StartDate);
  let months = (date.getUTCFullYear() - s.getUTCFullYear()) * 12 + (date.getUTCMonth() - s.getUTCMonth());
  if (date.getUTCDate() < s.getUTCDate()) months -= 1;
  return Math.max(0, Math.floor(months / 12));
}

/** The contract's ARR in USD on the date (0 when not in force) */
export function contractArrAt(c: Contract, date: Date): number {
  return inForce(c, date) ? arrForYear(c, yearAt(c, date)) * fx(c.CurrencyIsoCode) : 0;
}

export function arrAt(data: Pick<Data, "contracts">, date: Date): number {
  return r2(sum(data.contracts.map((c) => contractArrAt(c, date))));
}

export const mrrAt = (data: Pick<Data, "contracts">, date: Date) => r2(arrAt(data, date) / 12);

export function arrByAccount(data: Pick<Data, "contracts">, date: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of data.contracts) {
    const v = contractArrAt(c, date);
    if (v > 0) out.set(c.AccountId, (out.get(c.AccountId) ?? 0) + v);
  }
  return out;
}

export interface ArrBridge {
  opening: number;
  newArr: number;
  expansion: number;
  contraction: number;
  churn: number;
  closing: number;
  counts: { new: number; expansion: number; contraction: number; churn: number };
}

/** Opening ARR (day before `start`) to closing ARR (`end`), by account movement */
export function arrBridge(data: Pick<Data, "contracts">, start: Date, end: Date): ArrBridge {
  const before = arrByAccount(data, plusDays(start, -1));
  const after = arrByAccount(data, end);
  const b: ArrBridge = { opening: 0, newArr: 0, expansion: 0, contraction: 0, churn: 0, closing: 0, counts: { new: 0, expansion: 0, contraction: 0, churn: 0 } };
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id) ?? 0;
    const z = after.get(id) ?? 0;
    b.opening += a;
    b.closing += z;
    if (a === 0 && z > 0) {
      b.newArr += z;
      b.counts.new++;
    } else if (a > 0 && z === 0) {
      b.churn += a;
      b.counts.churn++;
    } else if (z > a + 0.005) {
      b.expansion += z - a;
      b.counts.expansion++;
    } else if (z < a - 0.005) {
      b.contraction += a - z;
      b.counts.contraction++;
    }
  }
  return { ...b, opening: r2(b.opening), newArr: r2(b.newArr), expansion: r2(b.expansion), contraction: r2(b.contraction), churn: r2(b.churn), closing: r2(b.closing) };
}

/** Net and gross revenue retention, trailing 12 months (null without a base) */
export function retention(data: Pick<Data, "contracts">, asOf: Date): { nrr: number | null; grr: number | null; baseArr: number } {
  const then = arrByAccount(data, plusDays(asOf, -365));
  const now = arrByAccount(data, asOf);
  let base = 0;
  let net = 0;
  let gross = 0;
  for (const [id, a] of then) {
    const z = now.get(id) ?? 0;
    base += a;
    net += z;
    gross += Math.min(a, z);
  }
  return base > 0 ? { nrr: net / base, grr: gross / base, baseArr: r2(base) } : { nrr: null, grr: null, baseArr: 0 };
}

/* ------------------------------------------------------------ bookings */

const signedIn = (c: Contract, from: Date, to: Date) => !!c.SignedDate && LIVE.has(c.Status) && c.SignedDate.slice(0, 10) >= iso(from) && c.SignedDate.slice(0, 10) <= iso(to);

/** Annualised recurring value of a contract, USD */
export const annualValue = (c: Contract) => ((c.TCV - (c.OneTimeFees || 0)) / Math.max(1, c.TermMonths / 12)) * fx(c.CurrencyIsoCode);

export function acv(data: Pick<Data, "contracts">, asOf: Date, days = 365): number | null {
  const signed = data.contracts.filter((c) => signedIn(c, plusDays(asOf, -days + 1), asOf));
  return signed.length ? r2(sum(signed.map(annualValue)) / signed.length) : null;
}

export interface Bookings {
  tcv: number;
  firstYear: number;
  count: number;
  renewals: number;
}

export function bookings(data: Pick<Data, "contracts">, from: Date, to: Date): Bookings {
  const signed = data.contracts.filter((c) => signedIn(c, from, to));
  return {
    tcv: r2(sum(signed.map((c) => c.TCV * fx(c.CurrencyIsoCode)))),
    firstYear: r2(sum(signed.map((c) => (c.ARR + (c.OneTimeFees || 0)) * fx(c.CurrencyIsoCode)))),
    count: signed.length,
    renewals: signed.filter((c) => !!c.RenewedFromId).length,
  };
}

/* ------------------------------------------------------------ billings */

const counted = (i: Invoice) => i.Status !== "Draft" && i.Status !== "Void";

export function billings(data: Pick<Data, "invoices">, from: Date, to: Date): { amount: number; count: number } {
  const a = iso(from);
  const b = iso(to);
  const inv = data.invoices.filter((i) => counted(i) && i.IssueDate >= a && i.IssueDate <= b);
  return { amount: r2(sum(inv.map((i) => i.Total * fx(i.CurrencyIsoCode)))), count: inv.length };
}

export function cashCollected(data: Pick<Data, "invoices" | "payments">, from: Date, to: Date): { amount: number; count: number } {
  const a = iso(from);
  const b = iso(to);
  const ccy = new Map(data.invoices.map((i) => [i.Id, i.CurrencyIsoCode]));
  const ps = data.payments.filter((p) => p.PaymentDate >= a && p.PaymentDate <= b);
  return { amount: r2(sum(ps.map((p) => p.Amount * fx(ccy.get(p.InvoiceId))))), count: ps.length };
}

/* ------------------------------------------------------------- revenue */

/** Go-live date for one-time fees; null when onboarding isn't live yet */
export function goLiveDate(data: Pick<Data, "onboardingProjects">, c: Contract): string | null {
  const p = data.onboardingProjects.find((x) => x.ContractId === c.Id);
  if (!p) return c.StartDate;
  return p.GoLiveDate ?? null;
}

/** Revenue recognised for one contract between two dates (inclusive), USD */
export function contractRevenue(c: Contract, from: Date, to: Date, goLive: string | null): number {
  if (!LIVE.has(c.Status)) return 0;
  const start = d(c.StartDate);
  const end = d(serviceEnd(c));
  let total = 0;
  for (let y = 0; y < 100; y++) {
    const ys = addMonthsClamped(start, y * 12);
    if (ys > end || ys > to) break;
    const ye = plusDays(addMonthsClamped(start, (y + 1) * 12), -1);
    const segStart = Math.max(ys.getTime(), from.getTime());
    const segEnd = Math.min(ye.getTime(), end.getTime(), to.getTime());
    if (segEnd < segStart) continue;
    const days = (segEnd - segStart) / DAY + 1;
    total += (arrForYear(c, y) / 365) * days;
  }
  if (goLive && c.OneTimeFees && goLive >= iso(from) && goLive <= iso(to)) total += c.OneTimeFees;
  return total * fx(c.CurrencyIsoCode);
}

export function revenue(data: Pick<Data, "contracts" | "onboardingProjects">, from: Date, to: Date): number {
  return r2(sum(data.contracts.map((c) => contractRevenue(c, from, to, goLiveDate(data, c)))));
}

/** Billed but not yet earned, on the date, USD */
export function deferredRevenue(data: Pick<Data, "contracts" | "invoices" | "onboardingProjects">, at: Date): number {
  const x = iso(at);
  const billed = new Map<string, number>();
  for (const i of data.invoices) {
    if (!counted(i) || i.IssueDate > x || i.External) continue;
    billed.set(i.ContractId, (billed.get(i.ContractId) ?? 0) + (i.Recurring + i.OneTime));
  }
  let total = 0;
  for (const c of data.contracts) {
    const b = billed.get(c.Id);
    if (!b) continue;
    const earned = contractRevenue(c, d(c.StartDate), at, goLiveDate(data, c)) / fx(c.CurrencyIsoCode);
    total += Math.max(0, b - earned) * fx(c.CurrencyIsoCode);
  }
  return r2(total);
}

/* ------------------------------------------------------------- payback */

export function payback(
  data: Pick<Data, "contracts" | "opportunities">,
  asOf: Date,
  assumptions: Partial<typeof PAYBACK_ASSUMPTIONS> & { reps?: number } = {},
): { months: number | null; smCost: number; newArr: number; reps: number } {
  const a = { ...PAYBACK_ASSUMPTIONS, ...assumptions };
  const from = plusDays(asOf, -364);
  const bridge = arrBridge(data, from, asOf);
  const newArr = bridge.newArr + bridge.expansion;
  const owners = new Set(data.opportunities.filter((o) => o.IsClosed && o.CloseDate >= iso(from) && o.CloseDate <= iso(asOf)).map((o) => o.OwnerId));
  const reps = assumptions.reps ?? Math.max(1, owners.size);
  const smCost = reps * a.costPerRep;
  const months = newArr > 0 ? (smCost / (newArr * a.grossMargin)) * 12 : null;
  return { months, smCost, newArr: r2(newArr), reps };
}

/* ------------------------------------------------------------ extras */

export function topWins(data: Pick<Data, "opportunities">, from: Date, to: Date, n = 5): Opportunity[] {
  return data.opportunities
    .filter((o) => o.IsWon && o.CloseDate >= iso(from) && o.CloseDate <= iso(to))
    .sort((a, b) => b.Amount - a.Amount)
    .slice(0, n);
}

export interface RenewalRow {
  contract: Contract;
  accountId: string;
  endDate: string;
  daysLeft: number;
  arr: number;
  /** Reasons the renewal looks at risk (empty = on track) */
  risks: string[];
}

/** Contracts ending within `days`, with simple risk flags (fallback when Customer Success health isn't available) */
export function upcomingRenewals(data: Pick<Data, "contracts" | "invoices">, asOf: Date, days = 120): RenewalRow[] {
  const x = iso(asOf);
  const horizon = iso(plusDays(asOf, days));
  const renewed = new Set(data.contracts.filter((c) => c.RenewedFromId && c.Status !== "Terminated").map((c) => c.RenewedFromId!));
  return data.contracts
    .filter((c) => inForce(c, asOf) && c.EndDate >= x && c.EndDate <= horizon && !renewed.has(c.Id))
    .map((c) => {
      const risks: string[] = [];
      if (!c.AutoRenew) risks.push("No auto-renew");
      const overdue = data.invoices.filter((i) => i.ContractId === c.Id && (i.Status === "Overdue" || (i.Status === "Sent" && i.DueDate < x)));
      if (overdue.length) risks.push(`${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"}`);
      const notice = iso(plusDays(d(c.EndDate), -(c.NoticeDays || 0)));
      if (notice <= x) risks.push("Notice date passed");
      return { contract: c, accountId: c.AccountId, endDate: c.EndDate, daysLeft: Math.round((d(c.EndDate).getTime() - asOf.getTime()) / DAY), arr: contractArrAt(c, asOf), risks };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/* ------------------------------------------------------------ summary */

export interface FinanceSummary {
  period: Period;
  arr: number;
  mrr: number;
  /** ARR at the same date a year earlier */
  arrYearAgo: number;
  nrr: number | null;
  grr: number | null;
  acv: number | null;
  payback: ReturnType<typeof payback>;
  bridge: ArrBridge;
  bookings: Bookings;
  billings: { amount: number; count: number };
  revenue: number;
  deferred: number;
  cash: { amount: number; count: number };
  topWins: Opportunity[];
}

export function financeSummary(data: Data, asOf: Date, kind: PeriodKind = "month"): FinanceSummary {
  const period = periodFor(kind, asOf);
  const ret = retention(data, asOf);
  return {
    period,
    arr: arrAt(data, asOf),
    mrr: mrrAt(data, asOf),
    arrYearAgo: arrAt(data, plusDays(asOf, -365)),
    nrr: ret.nrr,
    grr: ret.grr,
    acv: acv(data, asOf),
    payback: payback(data, asOf),
    bridge: arrBridge(data, period.start, period.end),
    bookings: bookings(data, period.start, period.end),
    billings: billings(data, period.start, period.end),
    revenue: revenue(data, period.start, period.end),
    deferred: deferredRevenue(data, asOf),
    cash: cashCollected(data, period.start, period.end),
    topWins: topWins(data, period.start, period.end),
  };
}
