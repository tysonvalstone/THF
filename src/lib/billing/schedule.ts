/**
 * Invoice schedules: when a contract bills, for which service period, and
 * for how much. Pure functions (relative imports only, so the seed script
 * can use them too).
 *
 * - Billing frequency: Annual (12 months), Quarterly (3) or Monthly (1),
 *   periods stepped from StartDate and cut at EndDate / TerminatedDate.
 * - Price increase: recurring amounts grow by PriceIncreasePct per contract
 *   year (year 1 at list, year 2 × (1 + pct), …).
 * - One-time fees bill on the first invoice.
 * - Payment terms: due = issue + Net 30 / 45 / 60 (Due on receipt = issue).
 * - Harvest terms: always annual, due Dec 15 after harvest (the first
 *   Dec 15 at least 14 days after the issue date).
 */
import type { Contract, Invoice, InvoiceStatus } from "../../types/salesforce";
import type { DataSnapshot, Mutation } from "../data/types";
import { newId } from "../data/local-repository";

export interface ScheduleEntry {
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  recurring: number;
  oneTime: number;
  /** 0-based contract year the period starts in */
  contractYear: number;
}

export const FREQ_MONTHS = { Annual: 12, Quarterly: 3, Monthly: 1 } as const;
export const NET_DAYS: Record<Contract["PaymentTerms"], number> = { "Net 30": 30, "Net 45": 45, "Net 60": 60, "Due on receipt": 0 };
/** Days before Dec 15 an invoice must be issued to be due that same Dec 15 */
const HARVEST_LEAD_DAYS = 14;

const DAY = 86_400_000;
const d = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const plusDays = (x: Date, n: number) => new Date(x.getTime() + n * DAY);
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Adds months, clamping to the last day of the target month (Jan 31 + 1 → Feb 28) */
export function addMonthsClamped(x: Date, n: number): Date {
  const y = x.getUTCFullYear();
  const m = x.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(x.getUTCDate(), last)));
}

/** Dec 15 after harvest for an invoice issued on `issue` */
export function harvestDueDate(issue: string): string {
  const x = d(issue);
  const sameYear = new Date(Date.UTC(x.getUTCFullYear(), 11, 15));
  return iso(plusDays(x, HARVEST_LEAD_DAYS) <= sameYear ? sameYear : new Date(Date.UTC(x.getUTCFullYear() + 1, 11, 15)));
}

/** Due date for an invoice of this contract issued on `issue` */
export function dueDateFor(contract: Pick<Contract, "HarvestTerms" | "PaymentTerms">, issue: string): string {
  if (contract.HarvestTerms) return harvestDueDate(issue);
  return iso(plusDays(d(issue), NET_DAYS[contract.PaymentTerms] ?? 30));
}

/** Months per invoice (harvest terms always bill annually) */
export function billingMonths(contract: Pick<Contract, "HarvestTerms" | "BillingFrequency">): number {
  return contract.HarvestTerms ? 12 : (FREQ_MONTHS[contract.BillingFrequency] ?? 12);
}

/** 0-based contract year for a date (year 1 = 0) */
export function contractYear(contract: Pick<Contract, "StartDate">, date: string): number {
  const s = d(contract.StartDate);
  const x = d(date);
  let months = (x.getUTCFullYear() - s.getUTCFullYear()) * 12 + (x.getUTCMonth() - s.getUTCMonth());
  if (x.getUTCDate() < s.getUTCDate()) months -= 1;
  return Math.max(0, Math.floor(months / 12));
}

/** ARR in force for a contract year, with the yearly price increase applied */
export function arrForYear(contract: Pick<Contract, "ARR" | "PriceIncreasePct">, year: number): number {
  return contract.ARR * Math.pow(1 + (contract.PriceIncreasePct || 0) / 100, Math.max(0, year));
}

/** Last day the contract is billable/earning (EndDate, or the day before termination) */
export function serviceEnd(contract: Pick<Contract, "EndDate" | "TerminatedDate">): string {
  if (contract.TerminatedDate && contract.TerminatedDate <= contract.EndDate) return iso(plusDays(d(contract.TerminatedDate), -1));
  return contract.EndDate;
}

/** Every invoice the contract produces over its term */
export function invoiceSchedule(contract: Contract): ScheduleEntry[] {
  const months = billingMonths(contract);
  const start = d(contract.StartDate);
  const end = d(serviceEnd(contract));
  const out: ScheduleEntry[] = [];
  for (let i = 0; i < 1000; i++) {
    const ps = addMonthsClamped(start, i * months);
    if (ps > end) break;
    const fullEnd = plusDays(addMonthsClamped(start, (i + 1) * months), -1);
    const pe = fullEnd > end ? end : fullEnd;
    const fullDays = (fullEnd.getTime() - ps.getTime()) / DAY + 1;
    const days = (pe.getTime() - ps.getTime()) / DAY + 1;
    const year = Math.floor((i * months) / 12);
    const recurring = round2(arrForYear(contract, year) * (months / 12) * Math.min(1, days / fullDays));
    const issueDate = iso(ps);
    out.push({
      periodStart: iso(ps),
      periodEnd: iso(pe),
      issueDate,
      dueDate: dueDateFor(contract, issueDate),
      recurring,
      oneTime: i === 0 ? round2(contract.OneTimeFees || 0) : 0,
      contractYear: year,
    });
  }
  return out;
}

/** "INV-10001"-style numbers: one past the highest in the data */
export function nextInvoiceNumber(invoices: Pick<Invoice, "InvoiceNumber">[], offset = 0): string {
  let max = 10000;
  for (const inv of invoices) {
    const m = /^INV-(\d+)$/.exec(inv.InvoiceNumber);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `INV-${max + 1 + offset}`;
}

/** An Invoice record for a schedule entry */
export function invoiceFromEntry(
  contract: Contract,
  entry: ScheduleEntry,
  input: { id: string; number: string; status: InvoiceStatus; issueDate?: string },
): Invoice {
  const issueDate = input.issueDate ?? entry.issueDate;
  const total = round2(entry.recurring + entry.oneTime);
  return {
    Id: input.id,
    InvoiceNumber: input.number,
    ContractId: contract.Id,
    AccountId: contract.AccountId,
    Status: input.status,
    IssueDate: issueDate,
    DueDate: dueDateFor(contract, issueDate),
    PeriodStart: entry.periodStart,
    PeriodEnd: entry.periodEnd,
    Recurring: entry.recurring,
    OneTime: entry.oneTime,
    Tax: 0,
    Total: total,
    AmountPaid: 0,
    HarvestTerms: contract.HarvestTerms,
    RemindersSent: 0,
    CurrencyIsoCode: contract.CurrencyIsoCode,
  };
}

/** Whether terms need Finance review before the invoice goes out */
export function needsFinanceReview(contract: Pick<Contract, "HarvestTerms" | "PaymentTerms">): boolean {
  return contract.HarvestTerms || contract.PaymentTerms === "Net 60";
}

/**
 * The contract's first invoice, created when the contract is signed.
 *
 * Policy: Sent (issued today) when the service period has started and the
 * terms are standard; Draft otherwise (future start date, or harvest / Net 60
 * terms, which Finance reviews and sends). Harvest terms are due Dec 15.
 * Returns [] when the first period is already invoiced.
 */
export function firstInvoiceMutations(ctx: { data: DataSnapshot; asOf: Date; userId: string }, contract: Contract): Mutation[] {
  const first = invoiceSchedule(contract)[0];
  if (!first) return [];
  if (ctx.data.invoices.some((i) => i.ContractId === contract.Id && i.PeriodStart === first.periodStart)) return [];
  const today = iso(ctx.asOf);
  const started = first.issueDate <= today;
  const status: InvoiceStatus = started && !needsFinanceReview(contract) ? "Sent" : "Draft";
  const record = invoiceFromEntry(contract, first, {
    id: newId("Invoice"),
    number: nextInvoiceNumber(ctx.data.invoices),
    status,
    issueDate: started ? today : first.issueDate,
  });
  return [{ op: "create", object: "Invoice", record }];
}
