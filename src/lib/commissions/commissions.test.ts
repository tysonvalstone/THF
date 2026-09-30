import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import type { DataSnapshot } from "@/lib/data/types";
import type { CommissionPlan, Contract, Invoice, Opportunity, Quote } from "@/types/salesforce";
import { commissionReport, payoutDateFor, planFor, repCommission, DEFAULT_PLAN } from "./index";

const REP = "005Hs00000000005AA";

function empty(): DataSnapshot {
  const keys = Object.keys(SEED) as (keyof DataSnapshot)[];
  return Object.fromEntries(keys.map((k) => [k, []])) as unknown as DataSnapshot;
}

let n = 0;
function won(p: Partial<Opportunity>): Opportunity {
  n++;
  return {
    Id: `006C${n}`,
    AccountId: "A1",
    Name: `Deal ${n}`,
    Type: "New Business",
    StageName: "Closed Won",
    Amount: 100_000,
    CloseDate: "2026-03-01",
    Probability: 100,
    ForecastCategoryName: "Closed",
    NextStep: "",
    LeadSource: "Web",
    OwnerId: REP,
    IsClosed: true,
    IsWon: true,
    CreatedDate: "2025-12-01T00:00:00.000+0000",
    LastModifiedDate: "2026-03-01T00:00:00.000+0000",
    Economic_Buyer_Identified__c: true,
    ...p,
  };
}

const plan: CommissionPlan = { Id: "P1", OwnerId: REP, Year: 2026, BaseRatePct: 10, AcceleratorPct: 15, MultiYearBonusPct: 2, AnnualQuota: 250_000 };

function contract(id: string, oppId: string, p: Partial<Contract> = {}): Contract {
  return { Id: id, OpportunityId: oppId, AccountId: "A1", Status: "Active", StartDate: "2026-04-01", TermMonths: 36, ARR: 90_000, OneTimeFees: 10_000, ...p } as unknown as Contract;
}

function invoice(id: string, contractId: string, p: Partial<Invoice> = {}): Invoice {
  return { Id: id, ContractId: contractId, AccountId: "A1", Status: "Sent", IssueDate: "2026-04-01", DueDate: "2026-05-01", Total: 100_000, AmountPaid: 0, ...p } as unknown as Invoice;
}

test("base, marginal accelerator above quota, multi-year bonus", () => {
  const d = empty();
  d.commissionPlans = [plan];
  d.opportunities = [
    won({ CloseDate: "2026-02-01", Amount: 200_000 }), // all below quota
    won({ CloseDate: "2026-05-01", Amount: 100_000 }), // 50k below, 50k above
    won({ CloseDate: "2026-08-01", Amount: 40_000 }), // all above
    won({ CloseDate: "2025-12-01", Amount: 999_000 }), // other year
    won({ CloseDate: "2026-11-01", Amount: 999_000 }), // after as-of
  ];
  d.quotes = [{ Id: "Q1", OpportunityId: d.opportunities[1].Id, Status: "Accepted", Contract_Term_Months__c: 36, CreatedDate: "2026-04-01" } as unknown as Quote];
  const r = repCommission(d, REP, 2026, new Date(Date.UTC(2026, 8, 29)));
  assert.equal(r.lines.length, 3);
  assert.equal(r.bookings, 340_000);
  assert.ok(Math.abs(r.attainmentPct - 136) < 1e-9);
  const [a, b, c] = r.lines;
  assert.deepEqual([a.base, a.accelerator, a.bonus, a.total], [20_000, 0, 0, 20_000]);
  assert.equal(b.belowQuota, 50_000);
  assert.equal(b.aboveQuota, 50_000);
  assert.equal(b.termSource, "Quote");
  assert.deepEqual([b.base, b.accelerator, b.bonus, b.total], [5_000, 7_500, 2_000, 14_500]);
  assert.deepEqual([c.base, c.accelerator, c.total], [0, 6_000, 6_000]);
  assert.equal(r.earned, 40_500);
  // No contracts or invoices yet: nothing payable
  assert.equal(r.payable, 0);
  assert.equal(r.pending, 40_500);
  assert.ok(r.lines.every((l) => l.status === "Awaiting invoice"));
});

test("contract first-year value and term; payable once the first invoice is paid; paid after payroll", () => {
  const d = empty();
  d.commissionPlans = [{ ...plan, AnnualQuota: 1_000_000 }];
  const o1 = won({ CloseDate: "2026-03-15", Amount: 123_456 });
  const o2 = won({ CloseDate: "2026-06-15" });
  const o3 = won({ CloseDate: "2026-07-15" });
  d.opportunities = [o1, o2, o3];
  d.contracts = [contract("K1", o1.Id), contract("K2", o2.Id, { TermMonths: 12, ARR: 50_000, OneTimeFees: 0 }), contract("K3", o3.Id)];
  d.invoices = [
    invoice("I1b", "K1", { IssueDate: "2027-04-01" }),
    invoice("I1", "K1", { Status: "Paid", AmountPaid: 100_000, PaidDate: "2026-04-20" }),
    invoice("I2", "K2", { Status: "Paid", AmountPaid: 50_000, Total: 50_000, PaidDate: "2026-09-10", IssueDate: "2026-07-01" }),
    invoice("I3", "K3", { IssueDate: "2026-08-01" }),
  ];
  const r = repCommission(d, REP, 2026, new Date(Date.UTC(2026, 8, 29)));
  const [l1, l2, l3] = r.lines;
  assert.equal(l1.firstYearValue, 100_000);
  assert.equal(l1.valueSource, "Contract");
  assert.equal(l1.termMonths, 36);
  assert.equal(l1.bonus, 2_000);
  assert.equal(l1.firstInvoice?.Id, "I1");
  assert.equal(l1.payoutDate, "2026-05-31");
  assert.equal(l1.status, "Paid");
  assert.equal(l2.multiYear, false);
  assert.equal(l2.total, 5_000);
  assert.equal(l2.payoutDate, "2026-10-31");
  assert.equal(l2.status, "Payable");
  assert.equal(l3.status, "Awaiting payment");
  assert.equal(r.paid, 12_000);
  assert.equal(r.payable, 5_000);
  assert.equal(r.pending, 12_000);
  assert.equal(r.earned, r.paid + r.payable + r.pending);
});

test("payout date is the last day of the following month", () => {
  assert.equal(payoutDateFor("2026-01-31"), "2026-02-28");
  assert.equal(payoutDateFor("2026-12-05"), "2027-01-31");
});

test("no plan: default rates with the year's quotas as the annual quota", () => {
  const d = empty();
  d.quotas = [
    { Id: "q1", OwnerId: REP, Period: "2026-Q1", Amount: 100 },
    { Id: "q2", OwnerId: REP, Period: "2026-Q2", Amount: 200 },
    { Id: "q3", OwnerId: REP, Period: "2027-Q1", Amount: 999 },
  ];
  const p = planFor(d, REP, 2026);
  assert.equal(p.hasPlan, false);
  assert.equal(p.plan.AnnualQuota, 300);
  assert.equal(p.plan.BaseRatePct, DEFAULT_PLAN.BaseRatePct);
});

test("seed: every territory rep has a plan per year and realistic attainment", () => {
  const asOf = new Date(Date.UTC(2026, 8, 29));
  assert.equal(SEED.commissionPlans.length, 18);
  assert.equal(SEED.quotas.length, 72);
  const report2025 = commissionReport(SEED, 2025, new Date(Date.UTC(2025, 11, 31)));
  assert.equal(report2025.length, 6);
  for (const r of report2025) {
    assert.ok(r.hasPlan);
    assert.ok(r.attainmentPct >= 65 && r.attainmentPct <= 130, `${r.name} 2025 attainment ${r.attainmentPct.toFixed(0)}%`);
    assert.ok(r.plan.BaseRatePct >= 8 && r.plan.BaseRatePct <= 10);
    assert.equal(r.plan.AcceleratorPct, r.plan.BaseRatePct * 1.5);
    assert.ok(Math.abs(r.earned - (r.paid + r.payable + r.pending)) < 0.05);
  }
  const report2026 = commissionReport(SEED, 2026, asOf);
  assert.ok(report2026.every((r) => r.earned > 0));
});

test("an invoice paid before the deal closed makes it payable from the close date, not earlier", () => {
  const d = empty();
  d.commissionPlans = [plan];
  const o = won({ CloseDate: "2026-08-31" });
  d.opportunities = [o];
  d.contracts = [contract("K9", o.Id, { StartDate: "2025-08-23" })];
  d.invoices = [invoice("I9", "K9", { IssueDate: "2025-08-23", Status: "Paid", AmountPaid: 100_000, PaidDate: "2025-09-15" })];
  const l = repCommission(d, REP, 2026, new Date(Date.UTC(2026, 8, 30))).lines[0];
  assert.equal(l.firstInvoicePaidDate, "2026-08-31");
  assert.equal(l.payoutDate, "2026-09-30");
  assert.equal(l.status, "Paid");
  const earlier = repCommission(d, REP, 2026, new Date(Date.UTC(2026, 8, 29))).lines[0];
  assert.equal(earlier.status, "Payable");
});
