import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { applyMutations } from "@/lib/data/local-repository";
import type { DataSnapshot } from "@/lib/data/types";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import { blackoutsFor } from "@/lib/seasonality";
import type { Account, Contract, Invoice, SupportTicket } from "@/types/salesforce";
import { bandFor, healthAll, healthFor, paymentStanding, renewalsAtRisk, scoreAt, ticketLoad } from "./health";
import { markLiveMutations, onboardingForContractMutations, onboardingPlan, projectProgress, projectTasks, toggleTaskMutations, workStartFor } from "./onboarding";
import { noticeDeadline, renewalAmount, renewalCloseDate, renewalMutations, upcomingRenewals } from "./renewals";
import { expansionCandidates, startExpansionMutations } from "./expansion";

const ASOF = parseDate("2026-09-29");
const data = SEED as unknown as DataSnapshot;
const customers = data.accounts.filter((a) => a.Type === "Customer - Direct");
const elevator = customers.find((a) => a.Segment__c === "Country Elevator")!;
const feedMill = customers.find((a) => a.Segment__c === "Feed Mill")!;

function contract(account: Account, patch: Partial<Contract> = {}): Contract {
  return {
    Id: `800Test${account.Id.slice(-6)}${patch.EndDate ?? ""}`,
    ContractNumber: "C-TEST",
    Name: `${account.Name} subscription`,
    AccountId: account.Id,
    Status: "Active",
    OwnerId: account.OwnerId,
    CreatedDate: "2025-12-01T12:00:00.000+0000",
    StartDate: "2025-12-01",
    EndDate: "2026-11-30",
    TermMonths: 12,
    AutoRenew: false,
    NoticeDays: 60,
    PriceIncreasePct: 5,
    PaymentTerms: "Net 30",
    HarvestTerms: false,
    BillingFrequency: "Annual",
    ARR: 40000,
    OneTimeFees: 0,
    TCV: 40000,
    CurrencyIsoCode: "USD",
    DPA: false,
    NonStandard: false,
    SignedDate: "2025-11-20T12:00:00.000+0000",
    ...patch,
  };
}

const ticket = (accountId: string, daysAgo: number, priority: SupportTicket["Priority"], open = false): SupportTicket => ({
  Id: `500T${accountId}${daysAgo}${priority}`,
  AccountId: accountId,
  Subject: "Test",
  Priority: priority,
  Status: open ? "Open" : "Closed",
  CreatedDate: `${toISODate(addDays(ASOF, -daysAgo))}T12:00:00.000+0000`,
  ClosedDate: open ? undefined : `${toISODate(addDays(ASOF, -daysAgo + 1))}T12:00:00.000+0000`,
});

/* ------------------------------------------------------------ health */

test("bands: Healthy ≥ 70, Watch 45–69, At Risk < 45", () => {
  assert.equal(bandFor(100), "Healthy");
  assert.equal(bandFor(70), "Healthy");
  assert.equal(bandFor(69), "Watch");
  assert.equal(bandFor(45), "Watch");
  assert.equal(bandFor(44), "At Risk");
});

test("score: perfect inputs are 100 and each part has its weight", () => {
  const r = scoreAt({ usage: 100, csat: 10, stakeholderChange: false, tickets: [], fallbackTickets90d: 0, invoices: [] }, ASOF);
  assert.equal(r.score, 100);
  assert.deepEqual(
    r.parts.map((p) => [p.key, p.max]),
    [
      ["usage", 30],
      ["support", 20],
      ["csat", 25],
      ["payments", 15],
      ["stakeholder", 10],
    ],
  );
  const worst = scoreAt({ usage: 0, csat: 0, stakeholderChange: true, tickets: [], fallbackTickets90d: 20, invoices: [] }, ASOF);
  assert.equal(worst.score, 15); // payments still on time
});

test("tickets: 90-day window, priority weights, open tickets weigh more", () => {
  const ts = [ticket("A", 10, "Urgent", true), ticket("A", 30, "Low"), ticket("A", 120, "Urgent")];
  const l = ticketLoad(ts, ASOF);
  assert.equal(l.count, 2);
  assert.equal(l.open, 1);
  assert.equal(l.load, 3 * 1.25 + 0.5);
});

test("payments: overdue days and late history lower the score", () => {
  const inv = (patch: Partial<Invoice>): Invoice => ({
    Id: "a0I1",
    InvoiceNumber: "INV-1",
    ContractId: "800",
    AccountId: "A",
    Status: "Sent",
    IssueDate: "2026-06-01",
    DueDate: "2026-07-01",
    PeriodStart: "2026-06-01",
    PeriodEnd: "2027-05-31",
    Recurring: 10000,
    OneTime: 0,
    Tax: 0,
    Total: 10000,
    AmountPaid: 0,
    HarvestTerms: false,
    RemindersSent: 0,
    CurrencyIsoCode: "USD",
    ...patch,
  });
  const overdue = paymentStanding([inv({})], ASOF);
  assert.equal(overdue.overdueCount, 1);
  assert.equal(overdue.maxDaysLate, 90);
  assert.equal(overdue.points, 3);
  const paidLate = paymentStanding([inv({ Status: "Paid", AmountPaid: 10000, PaidDate: "2026-07-20" })], ASOF);
  assert.equal(paidLate.overdueCount, 0);
  assert.equal(paidLate.points, 13.5);
  // 90 days ago the invoice wasn't due yet
  assert.equal(paymentStanding([inv({})], addDays(ASOF, -90)).overdueCount, 0);
});

test("seed: every customer has a signal and the band mix is roughly 65 / 22 / 13", () => {
  const all = healthAll(data, ASOF);
  assert.equal(all.size, customers.length);
  const n = { Healthy: 0, Watch: 0, "At Risk": 0 };
  for (const h of all.values()) n[h.band]++;
  assert.ok(n.Healthy / all.size > 0.55 && n.Healthy / all.size < 0.75, JSON.stringify(n));
  assert.ok(n.Watch / all.size > 0.12, JSON.stringify(n));
  assert.ok(n["At Risk"] / all.size > 0.06, JSON.stringify(n));
  for (const a of customers) {
    const tickets = data.supportTickets.filter((t) => t.AccountId === a.Id);
    assert.ok(tickets.length >= 2 && tickets.length <= 6, `${a.Name}: ${tickets.length} tickets`);
  }
});

test("trend: new urgent tickets turn the trend down", () => {
  const base = healthFor(data, elevator.Id, ASOF);
  const withTickets = { ...data, supportTickets: [...data.supportTickets, ticket(elevator.Id, 5, "Urgent", true), ticket(elevator.Id, 8, "Urgent", true)] };
  const after = healthFor(withTickets, elevator.Id, ASOF);
  assert.ok(after.score < base.score);
  assert.ok(after.delta < base.delta);
  assert.equal(after.previous, base.previous);
});

/* -------------------------------------------------------- onboarding */

test("onboarding plan: signed in harvest starts after harvest and goes live before planting", () => {
  const plan = onboardingPlan(elevator, ASOF);
  const [planting2027] = blackoutsFor(elevator, 2027);
  const harvest2026 = blackoutsFor(elevator, 2026)[1];
  assert.ok(parseDate(plan.start) > harvest2026.end, plan.start);
  assert.ok(parseDate(plan.target) < planting2027.start, plan.target);
  assert.deepEqual(
    plan.tasks.map((t) => t.Phase),
    ["Kickoff", "Data migration", "Configuration", "Training", "Go-live"],
  );
  const dues = plan.tasks.map((t) => t.DueDate);
  assert.deepEqual([...dues].sort(), dues);
  assert.equal(dues[4], plan.target);
});

test("onboarding plan: spring signing too close to planting goes live before harvest; year-round starts now", () => {
  const march = parseDate("2027-03-01");
  const plan = onboardingPlan(elevator, march);
  assert.equal(plan.start, "2027-03-01");
  const [planting, harvest] = blackoutsFor(elevator, 2027);
  assert.ok(parseDate(plan.target) > planting.end && parseDate(plan.target) < harvest.start, plan.target);
  assert.equal(toISODate(workStartFor(feedMill, ASOF)), "2026-09-29");
  assert.equal(onboardingPlan(feedMill, ASOF).target, "2027-01-01");
});

test("onboarding mutations: project + five tasks, once per contract; check off and mark Live", () => {
  const c = contract(elevator, { Status: "Signed", SignedDate: "2026-09-29T12:00:00.000+0000" });
  const d0 = { ...data, contracts: [...data.contracts, c] };
  const muts = onboardingForContractMutations({ data: d0, asOf: ASOF, userId: "005Hs00000000001AA" }, c);
  assert.equal(muts.length, 6);
  const d1 = applyMutations(d0, muts);
  assert.equal(onboardingForContractMutations({ data: d1, asOf: ASOF, userId: "x" }, c).length, 0);
  const project = d1.onboardingProjects.find((p) => p.ContractId === c.Id)!;
  assert.equal(project.Status, "Not Started");
  const tasks = projectTasks(d1, project.Id);
  const d2 = applyMutations(d1, toggleTaskMutations(d1, tasks[0].Id, true, ASOF));
  assert.equal(d2.onboardingProjects.find((p) => p.Id === project.Id)!.Status, "In Progress");
  assert.equal(projectProgress(project, projectTasks(d2, project.Id), ASOF).pct, 20);
  const d3 = applyMutations(d2, markLiveMutations(d2, project, ASOF));
  const live = d3.onboardingProjects.find((p) => p.Id === project.Id)!;
  assert.equal(live.Status, "Live");
  assert.equal(live.GoLiveDate, "2026-09-29");
  assert.ok(projectTasks(d3, project.Id).every((t) => t.Done));
});

/* ---------------------------------------------------------- renewals */

test("renewals: one renewal opportunity per contract ending within 120 days (idempotent)", () => {
  const soon = contract(elevator, { EndDate: "2026-12-31" });
  const later = contract(feedMill, { EndDate: "2027-06-30" });
  const d0 = { ...data, contracts: [soon, later] };
  const muts = renewalMutations(d0, ASOF);
  const creates = muts.filter((m) => m.op === "create");
  assert.equal(creates.length, 1);
  const d1 = applyMutations(d0, muts);
  const linked = d1.contracts.find((c) => c.Id === soon.Id)!;
  const opp = d1.opportunities.find((o) => o.Id === linked.RenewalOpportunityId)!;
  assert.equal(opp.Name, `Renewal: ${elevator.Name} 2026`);
  assert.equal(opp.Type, "Add-On Business");
  assert.equal(opp.StageName, "Qualification");
  assert.equal(opp.Amount, renewalAmount(soon));
  assert.equal(opp.Amount, 42000);
  assert.equal(opp.CloseDate, toISODate(noticeDeadline(soon)));
  assert.equal(opp.CloseDate, "2026-11-01");
  assert.equal(opp.OwnerId, soon.OwnerId);
  const band = healthFor(d1, elevator.Id, ASOF).band;
  assert.equal(opp.ForecastCategoryName, band === "Healthy" ? "Best Case" : "Pipeline");
  assert.equal(renewalMutations(d1, ASOF).length, 0);
  // Notice deadline already passed: close a week out
  assert.equal(toISODate(renewalCloseDate({ EndDate: "2026-10-20", NoticeDays: 60 }, ASOF)), "2026-10-06");
  // A same-named opportunity is linked, not duplicated
  const d2 = { ...d1, contracts: d1.contracts.map((c) => (c.Id === soon.Id ? { ...c, RenewalOpportunityId: undefined } : c)) };
  const relink = renewalMutations(d2, ASOF);
  assert.deepEqual(relink.map((m) => m.op), ["update"]);
});

test("renewals at risk: At Risk customers with contracts ending within 180 days", () => {
  const all = healthAll(data, ASOF);
  const risky = customers.find((a) => all.get(a.Id)?.band === "At Risk")!;
  const healthy = customers.find((a) => all.get(a.Id)?.band === "Healthy")!;
  const d = { ...data, contracts: [...data.contracts, contract(risky, { EndDate: "2027-01-15", ARR: 55000 }), contract(healthy, { EndDate: "2027-01-10" })] };
  const list = renewalsAtRisk(d, ASOF);
  const mine = list.filter((r) => r.account.Id === risky.Id || r.account.Id === healthy.Id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].account.Id, risky.Id);
  assert.equal(mine[0].arr, 55000);
  assert.equal(mine[0].daysToEnd, 108);
  const rows = upcomingRenewals(d, ASOF).filter((r) => r.account?.Id === risky.Id || r.account?.Id === healthy.Id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].atRisk, true);
});

/* --------------------------------------------------------- expansion */

test("expansion: healthy co-ops with CSAT ≥ 8 and locations not live; opportunity priced from the co-op book", () => {
  const list = expansionCandidates(data, ASOF);
  assert.ok(list.length >= 3, `${list.length} candidates`);
  for (const c of list) {
    assert.equal(c.health.band, "Healthy");
    assert.ok(c.health.csat >= 8);
    assert.ok(c.locationsLive < c.locations);
  }
  const first = list[0];
  const res = startExpansionMutations(data, first.account.Id, ASOF, "005Hs00000000001AA")!;
  const d1 = applyMutations(data, res.mutations);
  const opp = d1.opportunities.find((o) => o.Id === res.opportunityId)!;
  assert.equal(opp.Type, "Add-On Business");
  const lines = d1.lineItems.filter((l) => l.OpportunityId === opp.Id);
  assert.ok(lines.length >= 1);
  for (const l of lines) assert.equal(l.Quantity, first.remaining);
  assert.equal(opp.Amount, Math.round(lines.reduce((s, l) => s + l.TotalPrice, 0)));
  if (first.account.Number_of_Locations__c >= 5 && first.account.BillingCountry !== "Canada") {
    const scaletrac = lines.find((l) => l.Product2Id === "01tHs00000000003AA");
    if (scaletrac) assert.ok(scaletrac.UnitPrice < 9600, "co-op book is below list");
  }
  const after = expansionCandidates(d1, ASOF).find((c) => c.account.Id === first.account.Id)!;
  assert.equal(after.openOpportunity?.Id, opp.Id);
});
