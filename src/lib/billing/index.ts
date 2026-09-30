/**
 * Billing and collections: invoice automation, payments, reminders (dunning)
 * and aging. Every function is pure and returns Salesforce-style mutations
 * for the caller to commit (useCrud().run), so changes are undoable and
 * audited like any other edit.
 */
import type { Account, Contact, Contract, Invoice, InvoiceStatus, Payment, Task } from "@/types/salesforce";
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import { mergeValues, renderTemplate, type MergeValues } from "@/lib/sequences/engine";
import { dueDateFor, invoiceFromEntry, invoiceSchedule, nextInvoiceNumber, round2 } from "./schedule";

export * from "./schedule";

export interface BillingContext {
  data: DataSnapshot;
  asOf: Date;
  userId: string;
  /** Sender name for reminder emails */
  senderName?: string;
}

const DAY = 86_400_000;
const isoOf = (x: Date) => x.toISOString().slice(0, 10);
const dateOf = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`);

function stamp(asOf: Date): string {
  const now = new Date();
  const x = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
  return x.toISOString().replace(/\.\d{3}Z$/, ".000+0000");
}

/* ------------------------------------------------------------- status */

export const balanceOf = (inv: Pick<Invoice, "Total" | "AmountPaid">) => round2(Math.max(0, inv.Total - inv.AmountPaid));

/** Open = issued, not void, balance left */
export const isOpen = (inv: Invoice) => (inv.Status === "Sent" || inv.Status === "Overdue") && balanceOf(inv) > 0;

/** Status as of a date: a Sent invoice past its due date shows as Overdue */
export function effectiveStatus(inv: Invoice, asOf: Date): InvoiceStatus {
  if (inv.Status === "Sent" && inv.DueDate < isoOf(asOf) && balanceOf(inv) > 0) return "Overdue";
  if (inv.Status === "Overdue" && inv.DueDate >= isoOf(asOf)) return "Sent";
  return inv.Status;
}

/** Days past due (0 when not yet due or closed) */
export function daysOverdue(inv: Invoice, asOf: Date): number {
  if (!isOpen(inv)) return 0;
  return Math.max(0, Math.round((asOf.getTime() - dateOf(inv.DueDate).getTime()) / DAY));
}

/* ---------------------------------------------------------- automation */

/** Contracts that bill: Active (and signed contracts whose start date has passed) */
const billable = (c: Contract, today: string) => c.Status === "Active" || (c.Status === "Signed" && c.StartDate <= today);

/**
 * Idempotent billing run for the as-of date:
 * - issues (Sent) every scheduled invoice with issue date ≤ asOf for billable
 *   contracts that has no invoice for that period yet (Draft and Void count);
 * - marks Sent invoices past due as Overdue, and Overdue invoices not yet due
 *   (after time travel backwards) as Sent.
 * Running it again on the result returns [].
 */
export function billingMutations(data: DataSnapshot, asOf: Date): Mutation[] {
  const today = isoOf(asOf);
  const out: Mutation[] = [];
  const periods = new Set(data.invoices.map((i) => `${i.ContractId}|${i.PeriodStart}`));
  let n = 0;
  for (const c of data.contracts) {
    if (!billable(c, today)) continue;
    for (const e of invoiceSchedule(c)) {
      if (e.issueDate > today) break;
      if (periods.has(`${c.Id}|${e.periodStart}`)) continue;
      const rec = invoiceFromEntry(c, e, { id: newId("Invoice"), number: nextInvoiceNumber(data.invoices, n++), status: "Sent" });
      if (rec.DueDate < today) rec.Status = "Overdue";
      out.push({ op: "create", object: "Invoice", record: rec });
    }
  }
  for (const inv of data.invoices) {
    if (inv.External) continue;
    const s = effectiveStatus(inv, asOf);
    if (s !== inv.Status) out.push({ op: "update", object: "Invoice", id: inv.Id, changes: { Status: s } });
  }
  return out;
}

/* ------------------------------------------------------------ actions */

/** The account's billing contact: controller / CFO / accounting first, then the economic buyer */
export function billingContact(data: DataSnapshot, accountId: string): Contact | undefined {
  const cs = data.contacts.filter((c) => c.AccountId === accountId && c.Email && !c.HasOptedOutOfEmail);
  return (
    cs.find((c) => /controller|cfo|finance|accounting|bookkeep|office manager/i.test(c.Title)) ??
    cs.find((c) => c.Buying_Role__c === "Economic Buyer") ??
    cs[0]
  );
}

function emailTask(ctx: BillingContext, inv: Invoice, contact: Contact | undefined, subject: string, body: string): Task {
  return {
    Id: newId("Task"),
    Subject: `Email: ${subject}`,
    Type: "Email",
    TaskSubtype: "Email",
    Status: "Completed",
    Priority: "Normal",
    ActivityDate: isoOf(ctx.asOf),
    AccountId: inv.AccountId,
    WhatId: inv.AccountId,
    ...(contact ? { WhoId: contact.Id } : {}),
    OwnerId: ctx.userId,
    CreatedDate: stamp(ctx.asOf),
    CompletedDateTime: stamp(ctx.asOf),
    Description: `To: ${contact?.Email ?? "billing contact"}\n\n${body}`,
  };
}

const money = (n: number, ccy: string) => n.toLocaleString("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 });
const longDate = (s: string) => dateOf(s).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Draft → Sent: issued today (due date recalculated from today), logs the email */
export function sendInvoiceMutations(ctx: BillingContext, inv: Invoice): Mutation[] {
  if (inv.Status !== "Draft") return [];
  const contract = ctx.data.contracts.find((c) => c.Id === inv.ContractId);
  const today = isoOf(ctx.asOf);
  const issue = inv.IssueDate > today ? inv.IssueDate : today;
  const due = contract ? dueDateFor(contract, issue) : inv.DueDate;
  const contact = billingContact(ctx.data, inv.AccountId);
  const subject = `Invoice ${inv.InvoiceNumber} from ThiboLiSoft`;
  const body = `Hi ${contact?.FirstName ?? "there"},\n\nPlease find invoice ${inv.InvoiceNumber} for ${money(inv.Total, inv.CurrencyIsoCode)}, due ${longDate(due)}.${
    inv.HarvestTerms ? " As agreed, this invoice is on harvest payment terms." : ""
  }\n\nThank you,\n${ctx.senderName ?? "ThiboLiSoft Accounts Receivable"}`;
  return [
    { op: "update", object: "Invoice", id: inv.Id, changes: { Status: "Sent", IssueDate: issue, DueDate: due } },
    { op: "create", object: "Task", record: emailTask(ctx, inv, contact, subject, body) },
  ];
}

export function voidInvoiceMutations(inv: Invoice): Mutation[] {
  if (inv.Status === "Void" || inv.Status === "Paid" || inv.AmountPaid > 0) return [];
  return [{ op: "update", object: "Invoice", id: inv.Id, changes: { Status: "Void" } }];
}

export interface PaymentInput {
  amount: number;
  date: string;
  method: Payment["Method"];
  reference?: string;
}

/** Records a payment; the invoice becomes Paid once the balance reaches zero */
export function recordPaymentMutations(ctx: BillingContext, inv: Invoice, input: PaymentInput): Mutation[] {
  const amount = round2(input.amount);
  if (!(amount > 0) || inv.Status === "Void" || inv.Status === "Draft") return [];
  const payment: Payment = {
    Id: newId("Payment"),
    InvoiceId: inv.Id,
    AccountId: inv.AccountId,
    Amount: amount,
    PaymentDate: input.date,
    Method: input.method,
    Reference: input.reference?.trim() || "",
  };
  const paid = round2(inv.AmountPaid + amount);
  const full = paid >= inv.Total - 0.005;
  return [
    { op: "create", object: "Payment", record: payment },
    {
      op: "update",
      object: "Invoice",
      id: inv.Id,
      changes: full ? { AmountPaid: paid, Status: "Paid", PaidDate: input.date } : { AmountPaid: paid },
    },
  ];
}

/* ----------------------------------------------------------- reminders */

export interface ReminderTemplate {
  subject: string;
  body: string;
}

/**
 * Built-in "Payment reminders" sequence (friendly, firm, final). Sequence merge
 * fields work ({{contact.first_name}}, {{account.name}}, {{sender.name}}),
 * plus invoice fields: {{invoice.number}}, {{invoice.balance}},
 * {{invoice.due_date}}, {{invoice.days_overdue}}.
 */
export const DUNNING_SEQUENCE: { name: string; steps: (ReminderTemplate & { day: number })[] } = {
  name: "Payment reminders",
  steps: [
    {
      day: 1,
      subject: "Reminder: invoice {{invoice.number}} is past due",
      body: "Hi {{contact.first_name}},\n\nA quick reminder that invoice {{invoice.number}} for {{account.name}} ({{invoice.balance}}) was due {{invoice.due_date}}. If it's already on its way, thank you and please ignore this note.\n\nThanks,\n{{sender.name}}",
    },
    {
      day: 15,
      subject: "Second notice: invoice {{invoice.number}}, {{invoice.days_overdue}} days past due",
      body: "Hi {{contact.first_name}},\n\nInvoice {{invoice.number}} ({{invoice.balance}}) is now {{invoice.days_overdue}} days past due. Could you let me know when we can expect payment, or who I should follow up with?\n\nThanks,\n{{sender.name}}",
    },
    {
      day: 30,
      subject: "Final notice: invoice {{invoice.number}}",
      body: "Hi {{contact.first_name}},\n\nInvoice {{invoice.number}} for {{account.name}} ({{invoice.balance}}) is {{invoice.days_overdue}} days past due. Please arrange payment this week, or call me so we can agree a date.\n\nThanks,\n{{sender.name}}",
    },
  ],
};

/** The reminder step for the invoice's next reminder (first, second, final) */
export function reminderStep(inv: Pick<Invoice, "RemindersSent">, steps: ReminderTemplate[] = DUNNING_SEQUENCE.steps): ReminderTemplate {
  return steps[Math.min(inv.RemindersSent, steps.length - 1)];
}

export function renderReminder(ctx: BillingContext, inv: Invoice, template?: ReminderTemplate): { to?: Contact; subject: string; body: string } {
  const account = ctx.data.accounts.find((a) => a.Id === inv.AccountId);
  const contact = billingContact(ctx.data, inv.AccountId);
  const t = template ?? reminderStep(inv);
  const invoiceTokens: Record<string, string> = {
    "invoice.number": inv.InvoiceNumber,
    "invoice.balance": money(balanceOf(inv), inv.CurrencyIsoCode),
    "invoice.due_date": longDate(inv.DueDate),
    "invoice.days_overdue": String(daysOverdue(inv, ctx.asOf)),
  };
  const fill = (text: string) => {
    const pre = text.replace(/\{\{\s*(invoice\.[a-z_]+)\s*\}\}/g, (m, k: string) => invoiceTokens[k] ?? m);
    let values: Partial<MergeValues> = { "account.name": account?.Name ?? null, "contact.first_name": contact?.FirstName ?? null };
    try {
      if (account) values = mergeValues({ account: account as Account, contact, sender: { name: ctx.senderName ?? "" }, asOf: ctx.asOf, data: ctx.data });
    } catch {
      // Partial account data (e.g. NetSuite-only customers): keep the basic fields
    }
    const r = renderTemplate(pre, { ...values, "sender.name": ctx.senderName ?? "ThiboLiSoft Accounts Receivable" });
    return r.text.replace(/\{\{\s*contact\.first_name\s*\}\}/g, "there").replace(/\{\{\s*account\.name\s*\}\}/g, "your account");
  };
  return { to: contact, subject: fill(t.subject), body: fill(t.body) };
}

/** Sends the next reminder: logs an Email Task and increments RemindersSent */
export function sendReminderMutations(ctx: BillingContext, inv: Invoice, template?: ReminderTemplate): Mutation[] {
  if (!isOpen(inv)) return [];
  const r = renderReminder(ctx, inv, template);
  return [
    { op: "create", object: "Task", record: emailTask(ctx, inv, r.to, r.subject, r.body) },
    { op: "update", object: "Invoice", id: inv.Id, changes: { RemindersSent: inv.RemindersSent + 1, LastReminderDate: isoOf(ctx.asOf) } },
  ];
}

/* ---------------------------------------------------------------- aging */

export type AgingKey = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGING_LABEL: Record<AgingKey, string> = { current: "Not yet due", "1-30": "0–30", "31-60": "31–60", "61-90": "61–90", "90+": "90+" };
export const AGING_KEYS: AgingKey[] = ["current", "1-30", "31-60", "61-90", "90+"];

export function agingKey(days: number): AgingKey {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface AgingBucket {
  key: AgingKey;
  label: string;
  /** Open balance */
  amount: number;
  count: number;
}

/** Open receivables by days past due, as of a date (USD and CAD summed at face value unless `fx` given) */
export function agingBuckets(data: Pick<DataSnapshot, "invoices">, asOf: Date, fx: (ccy: string) => number = () => 1): AgingBucket[] {
  const buckets = AGING_KEYS.map((key) => ({ key, label: AGING_LABEL[key], amount: 0, count: 0 }));
  const today = isoOf(asOf);
  for (const inv of data.invoices) {
    if (!isOpen(inv) || inv.IssueDate > today) continue;
    const b = buckets.find((x) => x.key === agingKey(daysOverdue(inv, asOf)))!;
    b.amount += balanceOf(inv) * fx(inv.CurrencyIsoCode);
    b.count += 1;
  }
  return buckets.map((b) => ({ ...b, amount: round2(b.amount) }));
}
