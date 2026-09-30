/**
 * Invoice and payment history for every signed contract, following each
 * contract's billing schedule (src/lib/billing/schedule.ts) from StartDate up
 * to the anchor date. Deterministic (hash01), so re-running the seed never
 * changes existing records.
 *
 * Status mix: most invoices Paid 0–40 days after issue (harvest-terms invoices
 * around Dec 15), invoices not yet due mostly Sent, about 8% Overdue spread
 * over the aging buckets (some partly paid, with reminders sent), a couple
 * Void. Signed contracts that haven't started get their first invoice as a
 * Draft.
 */
import type { SeedContext } from "./platform";
import type { DataSnapshot } from "../../src/lib/data/types";
import type { Contract, Invoice, Payment } from "../../src/types/salesforce";
import { invoiceFromEntry, invoiceSchedule, serviceEnd } from "../../src/lib/billing/schedule";
import { hash01 } from "./quoting";

const DAY = 86_400_000;
const d = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const plusDays = (s: string, n: number) => iso(new Date(d(s).getTime() + n * DAY));
const daysBetween = (a: string, b: string) => Math.round((d(b).getTime() - d(a).getTime()) / DAY);
const r2 = (n: number) => Math.round(n * 100) / 100;

const METHODS: [Payment["Method"], number][] = [
  ["ACH", 0.55],
  ["Check", 0.85],
  ["Wire", 0.95],
  ["Card", 1],
];

export function buildFinance(ctx: SeedContext, contracts: Pick<DataSnapshot, "contracts" | "contractClauses" | "clauses">): Pick<DataSnapshot, "invoices" | "payments"> {
  const anchor = iso(ctx.anchor);
  const invoices: Invoice[] = [];
  const payments: { p: Omit<Payment, "Id">; inv: Invoice }[] = [];
  const list = [...contracts.contracts].sort((a, b) => a.Id.localeCompare(b.Id));

  for (const c of list) {
    if (c.Status === "Draft" || c.Status === "Legal Review" || c.Status === "Sent for Signature") continue;
    const schedule = invoiceSchedule(c);
    if (c.Status === "Signed" && c.StartDate > anchor) {
      if (schedule[0]) invoices.push(invoiceFromEntry(c, schedule[0], { id: "", number: "", status: "Draft" }));
      continue;
    }
    const last = serviceEnd(c) < anchor ? serviceEnd(c) : anchor;
    schedule.forEach((e, idx) => {
      if (e.issueDate > last) return;
      const inv = invoiceFromEntry(c, e, { id: "", number: "", status: "Sent" });
      const key = `${c.Id}:${e.periodStart}`;
      const h = hash01(`${key}:status`);
      const pastDue = daysBetween(inv.DueDate, anchor);
      if (idx > 0 && hash01(`${key}:void`) < 0.03) {
        inv.Status = "Void";
      } else if (pastDue > 0 && pastDue <= 150 && h < 0.42) {
        inv.Status = "Overdue";
        if (hash01(`${key}:partial`) < 0.25) pay(inv, c, r2(inv.Total * 0.5), plusDays(inv.IssueDate, 10 + Math.floor(hash01(`${key}:pd`) * 20)), key);
        inv.RemindersSent = Math.min(3, Math.floor(pastDue / 15) + (pastDue > 3 ? 1 : 0));
        if (inv.RemindersSent) inv.LastReminderDate = plusDays(inv.DueDate, Math.min(pastDue - 1, (inv.RemindersSent - 1) * 15 + 3));
      } else if (pastDue <= 0 && h < 0.65) {
        // Not yet due: mostly still Sent
        const early = plusDays(inv.IssueDate, Math.floor(hash01(`${key}:days`) * 41));
        if (h < 0.2 && early <= anchor) pay(inv, c, inv.Total, early, key);
      } else {
        const date = c.HarvestTerms
          ? plusDays(inv.DueDate, -20 + Math.floor(hash01(`${key}:days`) * 30))
          : plusDays(inv.IssueDate, Math.floor(hash01(`${key}:days`) * 41));
        if (date <= anchor) pay(inv, c, inv.Total, date, key);
        else if (pastDue > 0) inv.Status = "Overdue";
      }
      invoices.push(inv);
    });
  }

  function pay(inv: Invoice, c: Contract, amount: number, date: string, key: string) {
    const m = hash01(`${key}:method`);
    const method = METHODS.find(([, cut]) => m < cut)![0];
    const ref = method === "Check" ? `CHK ${10000 + Math.floor(hash01(`${key}:ref`) * 89999)}` : `${method}-${Math.floor(hash01(`${key}:ref`) * 1e8).toString(36).toUpperCase()}`;
    payments.push({ p: { InvoiceId: "", AccountId: c.AccountId, Amount: amount, PaymentDate: date < inv.IssueDate ? inv.IssueDate : date, Method: method, Reference: ref }, inv });
    inv.AmountPaid = r2(inv.AmountPaid + amount);
    if (inv.AmountPaid >= inv.Total - 0.005) {
      inv.Status = "Paid";
      inv.PaidDate = date < inv.IssueDate ? inv.IssueDate : date;
    }
  }

  // Numbers and Ids in issue order
  invoices.sort((a, b) => a.IssueDate.localeCompare(b.IssueDate) || a.ContractId.localeCompare(b.ContractId) || a.PeriodStart.localeCompare(b.PeriodStart));
  invoices.forEach((inv, i) => {
    inv.Id = `a0IHs0000${String(i + 1).padStart(5, "0")}AAA`.slice(0, 18);
    inv.InvoiceNumber = `INV-${10001 + i}`;
  });
  payments.sort((a, b) => a.p.PaymentDate.localeCompare(b.p.PaymentDate) || a.inv.Id.localeCompare(b.inv.Id));
  const out: Payment[] = payments.map(({ p, inv }, i) => ({ Id: `a0YHs0000${String(i + 1).padStart(5, "0")}AAA`.slice(0, 18), ...p, InvoiceId: inv.Id }));
  return { invoices, payments: out };
}
