import { test } from "node:test";
import assert from "node:assert/strict";

import type { Contract, Invoice, Opportunity, Payment } from "@/types/salesforce";
import { parseDate } from "@/lib/dates";
import {
  acv,
  arrAt,
  arrBridge,
  billings,
  bookings,
  cashCollected,
  contractArrAt,
  deferredRevenue,
  financeSummary,
  mrrAt,
  payback,
  periodFor,
  retention,
  revenue,
  upcomingRenewals,
} from "./metrics";

let n = 0;
function contract(over: Partial<Contract> = {}): Contract {
  n++;
  return {
    Id: `800C${n}`,
    ContractNumber: `C-${n}`,
    Name: `Contract ${n}`,
    AccountId: `001A${n}`,
    Status: "Active",
    OwnerId: "005U1",
    CreatedDate: "2025-01-01T00:00:00.000+0000",
    StartDate: "2025-01-01",
    EndDate: "2027-12-31",
    TermMonths: 36,
    AutoRenew: true,
    NoticeDays: 60,
    PriceIncreasePct: 0,
    PaymentTerms: "Net 30",
    HarvestTerms: false,
    BillingFrequency: "Annual",
    ARR: 36500,
    OneTimeFees: 0,
    TCV: 109500,
    CurrencyIsoCode: "USD",
    DPA: false,
    NonStandard: false,
    SignedDate: "2024-12-15T00:00:00.000+0000",
    ...over,
  };
}

const D = parseDate;
const data = (contracts: Contract[], extra: { invoices?: Invoice[]; payments?: Payment[]; opportunities?: Opportunity[] } = {}) => ({
  contracts,
  invoices: extra.invoices ?? [],
  payments: extra.payments ?? [],
  opportunities: extra.opportunities ?? [],
  onboardingProjects: [],
});

test("ARR applies the yearly price increase and ignores unsigned, expired and future contracts", () => {
  const c = contract({ PriceIncreasePct: 10 });
  assert.equal(contractArrAt(c, D("2025-06-01")), 36500);
  assert.ok(Math.abs(contractArrAt(c, D("2026-06-01")) - 40150) < 0.01);
  const all = [
    c,
    contract({ Status: "Draft" }),
    contract({ Status: "Expired", EndDate: "2025-12-31", TermMonths: 12 }),
    contract({ StartDate: "2026-09-01", EndDate: "2027-08-31" }),
    contract({ CurrencyIsoCode: "CAD", ARR: 10000 }),
  ];
  assert.equal(arrAt(data(all), D("2025-06-01")), 36500 + 36500 + 7300);
  assert.equal(arrAt(data(all), D("2026-06-01")), 40150 + 7300);
  assert.equal(mrrAt(data(all), D("2026-06-01")), Math.round(((40150 + 7300) / 12) * 100) / 100);
});

test("terminated contracts stop counting on the termination date", () => {
  const c = contract({ Status: "Terminated", TerminatedDate: "2025-07-01" });
  assert.equal(contractArrAt(c, D("2025-06-30")), 36500);
  assert.equal(contractArrAt(c, D("2025-07-01")), 0);
});

test("ARR bridge: new, expansion, contraction and churn reconcile opening to closing", () => {
  const kept = contract({ AccountId: "A" });
  const churned = contract({ AccountId: "B", EndDate: "2026-03-31", TermMonths: 15 });
  const grownOld = contract({ AccountId: "C", EndDate: "2026-01-31", TermMonths: 13, ARR: 10000 });
  const grownNew = contract({ AccountId: "C", StartDate: "2026-02-01", EndDate: "2027-01-31", ARR: 15000, RenewedFromId: grownOld.Id });
  const shrunkOld = contract({ AccountId: "D", EndDate: "2026-02-28", TermMonths: 14, ARR: 20000 });
  const shrunkNew = contract({ AccountId: "D", StartDate: "2026-03-01", EndDate: "2027-02-28", ARR: 12000 });
  const fresh = contract({ AccountId: "E", StartDate: "2026-02-15", EndDate: "2027-02-14", ARR: 5000, SignedDate: "2026-02-10T00:00:00.000+0000" });
  const b = arrBridge(data([kept, churned, grownOld, grownNew, shrunkOld, shrunkNew, fresh]), D("2026-01-01"), D("2026-06-30"));
  assert.equal(b.opening, 36500 + 36500 + 10000 + 20000);
  assert.equal(b.newArr, 5000);
  assert.equal(b.expansion, 5000);
  assert.equal(b.contraction, 8000);
  assert.equal(b.churn, 36500);
  assert.equal(b.closing, 36500 + 15000 + 12000 + 5000);
  assert.ok(Math.abs(b.opening + b.newArr + b.expansion - b.contraction - b.churn - b.closing) < 0.01);
  assert.deepEqual(b.counts, { new: 1, expansion: 1, contraction: 1, churn: 1 });
});

test("NRR and GRR over the trailing 12 months", () => {
  const a = contract({ AccountId: "A", ARR: 100, PriceIncreasePct: 20 });
  const b = contract({ AccountId: "B", ARR: 100, EndDate: "2025-12-31", TermMonths: 12 });
  const later = contract({ AccountId: "C", StartDate: "2026-01-01", ARR: 500 });
  const r = retention(data([a, b, later]), D("2026-03-01"));
  assert.equal(r.baseArr, 200);
  assert.ok(Math.abs((r.nrr ?? 0) - 0.6) < 1e-9);
  assert.ok(Math.abs((r.grr ?? 0) - 0.5) < 1e-9);
  assert.deepEqual(retention(data([]), D("2026-03-01")), { nrr: null, grr: null, baseArr: 0 });
});

test("bookings, ACV and payback", () => {
  const a = contract({ SignedDate: "2026-09-10T00:00:00.000+0000", StartDate: "2026-10-01", EndDate: "2029-09-30", ARR: 20000, OneTimeFees: 5000, TCV: 65000 });
  const b = contract({ SignedDate: "2026-08-10T00:00:00.000+0000", StartDate: "2026-08-15", EndDate: "2027-08-14", TermMonths: 12, ARR: 10000, TCV: 10000, RenewedFromId: "x" });
  const d = data([a, b], {
    opportunities: [{ Id: "o1", OwnerId: "U1", IsClosed: true, IsWon: true, CloseDate: "2026-09-10", Amount: 65000 } as Opportunity],
  });
  const bk = bookings(d, D("2026-09-01"), D("2026-09-30"));
  assert.deepEqual(bk, { tcv: 65000, firstYear: 25000, count: 1, renewals: 0 });
  assert.equal(acv(d, D("2026-09-29")), (20000 + 10000) / 2);
  const p = payback(d, D("2026-09-29"), { costPerRep: 120000, grossMargin: 0.8 });
  // New ARR in the window: b (10,000) started; a hasn't started yet
  assert.equal(p.newArr, 10000);
  assert.equal(p.reps, 1);
  assert.equal(p.months, (120000 / (10000 * 0.8)) * 12);
});

test("revenue is ratable per day; deferred = billed − earned; billings and cash by date", () => {
  const c = contract({ StartDate: "2026-01-01", EndDate: "2026-12-31", TermMonths: 12, ARR: 36500, OneTimeFees: 1000 });
  const inv: Invoice = {
    Id: "i1",
    InvoiceNumber: "INV-1",
    ContractId: c.Id,
    AccountId: c.AccountId,
    Status: "Paid",
    IssueDate: "2026-01-01",
    DueDate: "2026-01-31",
    PeriodStart: "2026-01-01",
    PeriodEnd: "2026-12-31",
    Recurring: 36500,
    OneTime: 1000,
    Tax: 0,
    Total: 37500,
    AmountPaid: 37500,
    HarvestTerms: false,
    RemindersSent: 0,
    CurrencyIsoCode: "USD",
  };
  const pay: Payment = { Id: "p1", InvoiceId: "i1", AccountId: c.AccountId, Amount: 37500, PaymentDate: "2026-01-20", Method: "ACH", Reference: "" };
  const d = data([c], { invoices: [inv], payments: [pay] });
  // January: 31 days × 100/day + one-time at go-live (start date, no onboarding project)
  assert.equal(revenue(d, D("2026-01-01"), D("2026-01-31")), 3100 + 1000);
  assert.equal(revenue(d, D("2026-02-01"), D("2026-02-28")), 2800);
  // After January: billed 37,500, earned 4,100
  assert.equal(deferredRevenue(d, D("2026-01-31")), 37500 - 4100);
  assert.equal(billings(d, D("2026-01-01"), D("2026-01-31")).amount, 37500);
  assert.equal(billings(d, D("2026-02-01"), D("2026-02-28")).amount, 0);
  assert.equal(cashCollected(d, D("2026-01-01"), D("2026-01-31")).amount, 37500);
});

test("periods, renewals and the summary", () => {
  const asOf = D("2026-09-29");
  assert.equal(periodFor("quarter", asOf).start.toISOString().slice(0, 10), "2026-07-01");
  assert.equal(periodFor("ytd", asOf).start.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(periodFor("month", asOf).label, "September 2026");
  const ending = contract({ StartDate: "2025-11-01", EndDate: "2026-10-31", TermMonths: 12, AutoRenew: false, NoticeDays: 60 });
  const rows = upcomingRenewals(data([ending, contract()]), asOf);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].risks, ["No auto-renew", "Notice date passed"]);
  const s = financeSummary(data([ending]), asOf, "quarter");
  assert.equal(s.arr, 36500);
  assert.equal(s.period.label, "Q3 2026");
});
