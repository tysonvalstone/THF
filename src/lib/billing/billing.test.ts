import { test } from "node:test";
import assert from "node:assert/strict";

import type { Contract, Invoice } from "@/types/salesforce";
import type { DataSnapshot } from "@/lib/data/types";
import { applyMutations } from "@/lib/data/local-repository";
import { parseDate } from "@/lib/dates";
import {
  agingBuckets,
  billingMutations,
  daysOverdue,
  effectiveStatus,
  firstInvoiceMutations,
  harvestDueDate,
  invoiceSchedule,
  recordPaymentMutations,
  sendInvoiceMutations,
  sendReminderMutations,
  voidInvoiceMutations,
  renderReminder,
} from "./index";

function contract(over: Partial<Contract> = {}): Contract {
  return {
    Id: "800C1",
    ContractNumber: "C-0001",
    Name: "Test contract",
    AccountId: "001A1",
    Status: "Active",
    OwnerId: "005U1",
    CreatedDate: "2025-01-01T00:00:00.000+0000",
    StartDate: "2025-01-01",
    EndDate: "2027-12-31",
    TermMonths: 36,
    AutoRenew: true,
    NoticeDays: 60,
    PriceIncreasePct: 5,
    PaymentTerms: "Net 30",
    HarvestTerms: false,
    BillingFrequency: "Annual",
    ARR: 12000,
    OneTimeFees: 3000,
    TCV: 12000 + 12600 + 13230 + 3000,
    CurrencyIsoCode: "USD",
    DPA: false,
    NonStandard: false,
    SignedDate: "2024-12-15T00:00:00.000+0000",
    ...over,
  };
}

function snapshot(over: Partial<DataSnapshot> = {}): DataSnapshot {
  const empty = Object.fromEntries(
    ["accounts", "contacts", "leads", "opportunities", "lineItems", "campaigns", "campaignMembers", "tasks", "events", "productTypes", "products", "pricebooks", "pricebookEntries", "quotes", "quoteLineItems", "newBuilds", "contracts", "contractClauses", "clauses", "invoices", "payments", "onboardingProjects", "onboardingTasks", "healthSignals", "supportTickets", "quotas", "commissionPlans", "approvals", "auditLog", "calls"].map((k) => [k, []]),
  ) as unknown as DataSnapshot;
  return { ...empty, ...over };
}

test("annual schedule: price increase per contract year, one-time fees on the first invoice", () => {
  const s = invoiceSchedule(contract());
  assert.equal(s.length, 3);
  assert.deepEqual(
    s.map((e) => [e.periodStart, e.periodEnd, e.recurring, e.oneTime, e.dueDate]),
    [
      ["2025-01-01", "2025-12-31", 12000, 3000, "2025-01-31"],
      ["2026-01-01", "2026-12-31", 12600, 0, "2026-01-31"],
      ["2027-01-01", "2027-12-31", 13230, 0, "2027-01-31"],
    ],
  );
});

test("quarterly and monthly schedules split the year and keep the yearly increase", () => {
  const q = invoiceSchedule(contract({ BillingFrequency: "Quarterly", PaymentTerms: "Net 45" }));
  assert.equal(q.length, 12);
  assert.equal(q[0].recurring, 3000);
  assert.equal(q[4].recurring, 3150);
  assert.equal(q[0].dueDate, "2025-02-15");
  const m = invoiceSchedule(contract({ BillingFrequency: "Monthly", StartDate: "2025-01-31", EndDate: "2026-01-30", TermMonths: 12 }));
  assert.equal(m.length, 12);
  assert.equal(m[1].periodStart, "2025-02-28");
  assert.equal(m[0].recurring, 1000);
});

test("harvest terms bill annually, due Dec 15 after harvest", () => {
  const s = invoiceSchedule(contract({ HarvestTerms: true, BillingFrequency: "Monthly", StartDate: "2025-04-01", EndDate: "2027-03-31" }));
  assert.equal(s.length, 2);
  assert.equal(s[0].dueDate, "2025-12-15");
  assert.equal(harvestDueDate("2025-12-10"), "2026-12-15");
  assert.equal(harvestDueDate("2025-11-20"), "2025-12-15");
});

test("termination cuts the schedule and prorates the last period", () => {
  const s = invoiceSchedule(contract({ BillingFrequency: "Quarterly", TerminatedDate: "2025-05-16", Status: "Terminated" }));
  assert.equal(s.length, 2);
  assert.equal(s[1].periodEnd, "2025-05-15");
  assert.ok(s[1].recurring < 3000 && s[1].recurring > 1000);
});

test("first invoice: Sent when started with standard terms, Draft for harvest terms or future start", () => {
  const asOf = parseDate("2025-01-10");
  const data = snapshot();
  const [m] = firstInvoiceMutations({ data, asOf, userId: "u" }, contract());
  assert.equal(m.op, "create");
  const inv = (m as { record: Invoice }).record;
  assert.equal(inv.Status, "Sent");
  assert.equal(inv.IssueDate, "2025-01-10");
  assert.equal(inv.Total, 15000);
  assert.equal(inv.InvoiceNumber, "INV-10001");
  const [h] = firstInvoiceMutations({ data, asOf, userId: "u" }, contract({ HarvestTerms: true }));
  assert.equal((h as { record: Invoice }).record.Status, "Draft");
  assert.equal((h as { record: Invoice }).record.DueDate, "2025-12-15");
  const [f] = firstInvoiceMutations({ data, asOf, userId: "u" }, contract({ StartDate: "2025-03-01" }));
  assert.equal((f as { record: Invoice }).record.Status, "Draft");
  // Already invoiced: nothing
  const after = applyMutations(data, [m]);
  assert.deepEqual(firstInvoiceMutations({ data: after, asOf, userId: "u" }, contract()), []);
});

test("billing run issues due invoices, flags overdue, and is idempotent", () => {
  const asOf = parseDate("2026-03-15");
  let data = snapshot({ contracts: [contract(), contract({ Id: "800C2", Status: "Draft" })] });
  const first = billingMutations(data, asOf);
  const created = first.filter((m) => m.op === "create").map((m) => (m as { record: Invoice }).record);
  assert.equal(created.length, 2);
  assert.equal(created[0].Status, "Overdue");
  assert.equal(created[1].Status, "Overdue");
  assert.notEqual(created[0].InvoiceNumber, created[1].InvoiceNumber);
  data = applyMutations(data, first);
  assert.deepEqual(billingMutations(data, asOf), []);
  // Time travel back: the second invoice isn't due yet, so it returns to Sent
  const back = billingMutations(data, parseDate("2026-01-20"));
  assert.ok(back.some((m) => m.op === "update" && (m.changes as Partial<Invoice>).Status === "Sent"));
});

test("payments: partial keeps it open, full marks Paid", () => {
  const asOf = parseDate("2025-02-20");
  let data = snapshot({ contracts: [contract()] });
  data = applyMutations(data, billingMutations(data, asOf));
  let inv = data.invoices[0];
  assert.equal(effectiveStatus(inv, asOf), "Overdue");
  assert.equal(daysOverdue(inv, asOf), 20);
  const ctx = { data, asOf, userId: "u" };
  data = applyMutations(data, recordPaymentMutations(ctx, inv, { amount: 5000, date: "2025-02-20", method: "ACH" }));
  inv = data.invoices[0];
  assert.equal(inv.AmountPaid, 5000);
  assert.equal(inv.Status, "Overdue");
  data = applyMutations(data, recordPaymentMutations({ ...ctx, data }, inv, { amount: 10000, date: "2025-02-21", method: "Check", reference: "CHK 1" }));
  inv = data.invoices[0];
  assert.equal(inv.Status, "Paid");
  assert.equal(inv.PaidDate, "2025-02-21");
  assert.equal(data.payments.length, 2);
  assert.deepEqual(voidInvoiceMutations(inv), []);
});

test("reminders log an email task, increment the count and escalate the template", () => {
  const asOf = parseDate("2025-03-20");
  let data = snapshot({
    contracts: [contract()],
    accounts: [{ Id: "001A1", Name: "Prairie Co-op" } as DataSnapshot["accounts"][number]],
    contacts: [{ Id: "003C1", AccountId: "001A1", FirstName: "Dana", Name: "Dana Ruiz", Title: "Controller", Email: "dana@example.com", HasOptedOutOfEmail: false } as DataSnapshot["contacts"][number]],
  });
  data = applyMutations(data, billingMutations(data, asOf));
  const ctx = { data, asOf, userId: "u", senderName: "Sam" };
  const r = renderReminder(ctx, data.invoices[0]);
  assert.match(r.subject, /INV-10001/);
  assert.match(r.body, /Hi Dana/);
  assert.doesNotMatch(r.body, /\{\{/);
  data = applyMutations(data, sendReminderMutations(ctx, data.invoices[0]));
  assert.equal(data.invoices[0].RemindersSent, 1);
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].Type, "Email");
  assert.equal(data.tasks[0].WhoId, "003C1");
  const second = renderReminder({ ...ctx, data }, data.invoices[0]);
  assert.match(second.subject, /Second notice/);
});

test("send draft issues it today and recalculates the due date", () => {
  const asOf = parseDate("2025-01-10");
  let data = snapshot({ contracts: [contract({ HarvestTerms: true })] });
  data = applyMutations(data, firstInvoiceMutations({ data, asOf, userId: "u" }, data.contracts[0]));
  const later = parseDate("2025-01-20");
  data = applyMutations(data, sendInvoiceMutations({ data, asOf: later, userId: "u" }, data.invoices[0]));
  assert.equal(data.invoices[0].Status, "Sent");
  assert.equal(data.invoices[0].IssueDate, "2025-01-20");
  assert.equal(data.invoices[0].DueDate, "2025-12-15");
});

test("aging buckets group open balances by days past due", () => {
  const asOf = parseDate("2026-06-30");
  const base = { ContractId: "c", AccountId: "a", PeriodStart: "2026-01-01", PeriodEnd: "2026-12-31", Recurring: 0, OneTime: 0, Tax: 0, AmountPaid: 0, HarvestTerms: false, RemindersSent: 0, CurrencyIsoCode: "USD", IssueDate: "2026-01-01" } as const;
  const inv = (id: string, due: string, total: number, status: Invoice["Status"] = "Sent", paid = 0): Invoice => ({ ...base, Id: id, InvoiceNumber: id, DueDate: due, Total: total, Status: status, AmountPaid: paid });
  const b = agingBuckets(
    {
      invoices: [
        inv("1", "2026-07-15", 100),
        inv("2", "2026-06-10", 200),
        inv("3", "2026-05-10", 300, "Overdue", 100),
        inv("4", "2026-04-10", 400, "Overdue"),
        inv("5", "2026-01-10", 500, "Overdue"),
        inv("6", "2026-01-10", 999, "Paid", 999),
        inv("7", "2026-01-10", 999, "Void"),
      ],
    },
    asOf,
  );
  assert.deepEqual(
    b.map((x) => [x.key, x.amount, x.count]),
    [
      ["current", 100, 1],
      ["1-30", 200, 1],
      ["31-60", 200, 1],
      ["61-90", 400, 1],
      ["90+", 500, 1],
    ],
  );
});
