/**
 * Commissions per rep per plan year.
 *
 *   First-year value (FYV) = contract ARR + one-time fees when the deal has a
 *                            contract, else the opportunity Amount.
 *   Base                   = FYV below the annual quota × BaseRatePct.
 *   Accelerator            = FYV above the annual quota × AcceleratorPct
 *                            (marginal: deals are counted in close-date order,
 *                            so only the part of a deal past quota earns it).
 *   Multi-year bonus       = FYV × MultiYearBonusPct when the term is 24+ months
 *                            (contract term, else the accepted quote's term).
 *   Earned                 = every closed-won deal in the year, as of the date.
 *   Payable                = earned and the contract's first invoice is paid.
 *   Paid                   = paid out on the payroll at the end of the month
 *                            after the first invoice was paid (or after the
 *                            close date, if the invoice was paid before it).
 */
import type { DataSnapshot } from "@/lib/data/types";
import { parseDate, toISODate } from "@/lib/dates";
import { USER_BY_ID } from "@/data/reference/users";
import type { CommissionPlan, Contract, Invoice, Opportunity } from "@/types/salesforce";

export const MULTI_YEAR_MONTHS = 24;

/** Used when a rep has no plan for the year */
export const DEFAULT_PLAN: Omit<CommissionPlan, "Id" | "OwnerId" | "Year" | "AnnualQuota"> = { BaseRatePct: 8, AcceleratorPct: 12, MultiYearBonusPct: 2 };

export type CommissionStatus = "Awaiting invoice" | "Awaiting payment" | "Payable" | "Paid";

export interface CommissionLine {
  opp: Opportunity;
  accountName: string;
  closeDate: string;
  contract?: Contract;
  firstYearValue: number;
  /** Where the first-year value came from */
  valueSource: "Contract" | "Opportunity";
  termMonths: number;
  termSource: "Contract" | "Quote" | "Default";
  multiYear: boolean;
  /** Bookings counted before this deal in the year */
  cumulativeBefore: number;
  belowQuota: number;
  aboveQuota: number;
  base: number;
  accelerator: number;
  bonus: number;
  total: number;
  firstInvoice?: Invoice;
  firstInvoicePaidDate?: string;
  /** Payroll date the commission is (or will be) paid on */
  payoutDate?: string;
  status: CommissionStatus;
}

export interface RepCommission {
  ownerId: string;
  name: string;
  year: number;
  plan: CommissionPlan;
  /** false when the rep has no plan for the year and DEFAULT_PLAN is used */
  hasPlan: boolean;
  bookings: number;
  /** Bookings ÷ annual quota × 100 */
  attainmentPct: number;
  earned: number;
  payable: number;
  paid: number;
  /** Earned but not yet payable (first invoice not paid) */
  pending: number;
  lines: CommissionLine[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Last day of the month after `iso` (the payroll run that pays a commission) */
export function payoutDateFor(iso: string): string {
  const d = parseDate(iso);
  return toISODate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0)));
}

function paidDate(inv: Invoice, data: DataSnapshot): string | undefined {
  const paid = inv.Status === "Paid" || (inv.Total > 0 && inv.AmountPaid >= inv.Total);
  if (!paid) return undefined;
  if (inv.PaidDate) return inv.PaidDate;
  const dates = data.payments.filter((p) => p.InvoiceId === inv.Id).map((p) => p.PaymentDate).sort();
  return dates[dates.length - 1] ?? inv.DueDate;
}

/** The contract for a won deal: the earliest non-renewal contract on the opportunity */
export function contractFor(data: DataSnapshot, oppId: string): Contract | undefined {
  return data.contracts
    .filter((c) => c.OpportunityId === oppId && c.Status !== "Terminated" && !c.RenewedFromId)
    .sort((a, b) => a.StartDate.localeCompare(b.StartDate))[0];
}

/** Term in months: contract, else the accepted (or latest) quote, else 12 */
export function termFor(data: DataSnapshot, oppId: string, contract?: Contract): { months: number; source: CommissionLine["termSource"] } {
  if (contract?.TermMonths) return { months: contract.TermMonths, source: "Contract" };
  const quotes = data.quotes.filter((q) => q.OpportunityId === oppId).sort((a, b) => b.CreatedDate.localeCompare(a.CreatedDate));
  const q = quotes.find((x) => x.Status === "Accepted") ?? quotes[0];
  if (q?.Contract_Term_Months__c) return { months: q.Contract_Term_Months__c, source: "Quote" };
  return { months: 12, source: "Default" };
}

export function planFor(data: DataSnapshot, ownerId: string, year: number): { plan: CommissionPlan; hasPlan: boolean } {
  const p = data.commissionPlans.find((x) => x.OwnerId === ownerId && x.Year === year);
  if (p) return { plan: p, hasPlan: true };
  const quota = data.quotas.filter((q) => q.OwnerId === ownerId && q.Period.startsWith(`${year}-`)).reduce((s, q) => s + q.Amount, 0);
  return { plan: { Id: "", OwnerId: ownerId, Year: year, AnnualQuota: quota, ...DEFAULT_PLAN }, hasPlan: false };
}

/** One rep's commission statement for a plan year, as of a date */
export function repCommission(data: DataSnapshot, ownerId: string, year: number, asOf: Date): RepCommission {
  const { plan, hasPlan } = planFor(data, ownerId, year);
  const accounts = new Map(data.accounts.map((a) => [a.Id, a.Name]));
  const asOfISO = toISODate(asOf);
  const won = data.opportunities
    .filter((o) => o.OwnerId === ownerId && o.IsWon && o.CloseDate.startsWith(`${year}-`) && o.CloseDate <= asOfISO)
    .sort((a, b) => a.CloseDate.localeCompare(b.CloseDate) || a.Id.localeCompare(b.Id));

  const quota = Math.max(0, plan.AnnualQuota);
  let cumulative = 0;
  const lines: CommissionLine[] = won.map((o) => {
    const contract = contractFor(data, o.Id);
    const fyv = contract ? contract.ARR + contract.OneTimeFees : o.Amount;
    const term = termFor(data, o.Id, contract);
    const room = Math.max(0, quota - cumulative);
    const belowQuota = Math.min(fyv, room);
    const aboveQuota = fyv - belowQuota;
    const base = round2((belowQuota * plan.BaseRatePct) / 100);
    const accelerator = round2((aboveQuota * plan.AcceleratorPct) / 100);
    const multiYear = term.months >= MULTI_YEAR_MONTHS;
    const bonus = multiYear ? round2((fyv * plan.MultiYearBonusPct) / 100) : 0;

    const firstInvoice = contract
      ? data.invoices.filter((i) => i.ContractId === contract.Id && i.Status !== "Void").sort((a, b) => a.IssueDate.localeCompare(b.IssueDate) || a.Id.localeCompare(b.Id))[0]
      : undefined;
    // Never payable before the deal closed (an invoice paid earlier counts from the close date)
    const raw = firstInvoice ? paidDate(firstInvoice, data) : undefined;
    const pd = raw && raw < o.CloseDate ? o.CloseDate : raw;
    const paidAsOf = pd && pd <= asOfISO ? pd : undefined;
    const payoutDate = paidAsOf ? payoutDateFor(paidAsOf) : undefined;
    const status: CommissionStatus = !firstInvoice || (firstInvoice.IssueDate > asOfISO && !paidAsOf) ? "Awaiting invoice" : !paidAsOf ? "Awaiting payment" : payoutDate! <= asOfISO ? "Paid" : "Payable";

    const line: CommissionLine = {
      opp: o,
      accountName: accounts.get(o.AccountId) ?? "",
      closeDate: o.CloseDate,
      contract,
      firstYearValue: fyv,
      valueSource: contract ? "Contract" : "Opportunity",
      termMonths: term.months,
      termSource: term.source,
      multiYear,
      cumulativeBefore: cumulative,
      belowQuota,
      aboveQuota,
      base,
      accelerator,
      bonus,
      total: round2(base + accelerator + bonus),
      firstInvoice,
      firstInvoicePaidDate: paidAsOf,
      payoutDate,
      status,
    };
    cumulative += fyv;
    return line;
  });

  const sum = (f: (l: CommissionLine) => boolean) => round2(lines.filter(f).reduce((s, l) => s + l.total, 0));
  return {
    ownerId,
    name: USER_BY_ID[ownerId]?.Name ?? ownerId,
    year,
    plan,
    hasPlan,
    bookings: cumulative,
    attainmentPct: quota > 0 ? (cumulative / quota) * 100 : 0,
    earned: sum(() => true),
    payable: sum((l) => l.status === "Payable"),
    paid: sum((l) => l.status === "Paid"),
    pending: sum((l) => l.status === "Awaiting invoice" || l.status === "Awaiting payment"),
    lines,
  };
}

/** Every rep with a plan or a closed-won deal in the year */
export function commissionReport(data: DataSnapshot, year: number, asOf: Date): RepCommission[] {
  const ids = new Set<string>();
  for (const p of data.commissionPlans) if (p.Year === year) ids.add(p.OwnerId);
  const asOfISO = toISODate(asOf);
  for (const o of data.opportunities) if (o.IsWon && o.CloseDate.startsWith(`${year}-`) && o.CloseDate <= asOfISO) ids.add(o.OwnerId);
  return [...ids].map((id) => repCommission(data, id, year, asOf)).sort((a, b) => b.earned - a.earned || a.name.localeCompare(b.name));
}
