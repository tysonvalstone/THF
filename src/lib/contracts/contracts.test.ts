import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { applyMutations } from "@/lib/data/local-repository";
import { decideApproval } from "@/lib/approvals";
import { parseDate } from "@/lib/dates";
import { computeTotals } from "@/lib/quotes/pricing";
import { productMap } from "@/lib/quotes/catalog";
import { quoteLines } from "@/lib/quotes/lifecycle";
import type { Contract } from "@/types/salesforce";
import {
  CLAUSE_KEYS,
  clausesFor,
  contractAlerts,
  contractApprovalEffects,
  contractFromQuoteMutations,
  contractStatusMutations,
  decideClauseMutations,
  editClauseMutations,
  endDateFor,
  harvestTermsMutations,
  libraryClause,
  nextContractNumber,
  noticeDeadline,
  orderFormLines,
  revertClauseMutations,
  sendForSignatureMutations,
  signContractMutations,
  signatureBlockers,
  tcvFor,
  terminateMutations,
} from "./index";

const ASOF = parseDate("2026-09-29");
const BASE = SEED as unknown as DataSnapshot;
const REP = "005Hs00000000005AA";
const LEGAL = "005Hs00000000001AA";

const apply = (data: DataSnapshot, m: Mutation[]) => applyMutations(data, m);
const contract = (data: DataSnapshot, id: string) => data.contracts.find((c) => c.Id === id)!;

function quoteWithoutContract() {
  const have = new Set(BASE.contracts.map((c) => c.QuoteId));
  const q = BASE.quotes.find((x) => x.Status === "Accepted" && !have.has(x.Id));
  assert.ok(q, "seed has an accepted quote without a contract");
  return q;
}

test("seed: a contract per customer, library, statuses", () => {
  const customers = BASE.accounts.filter((a) => a.Type === "Customer - Direct");
  assert.equal(BASE.contracts.length, customers.length);
  assert.ok(BASE.clauses.length >= 12);
  const statuses = new Set(BASE.contracts.map((c) => c.Status));
  for (const s of ["Draft", "Legal Review", "Sent for Signature", "Signed", "Active", "Expired", "Terminated"] as const) assert.ok(statuses.has(s), s);
  for (const c of BASE.contracts) {
    assert.ok(clausesFor(BASE, c.Id).length >= 5, `${c.ContractNumber} has clauses`);
    assert.equal(c.EndDate, endDateFor(c.StartDate, c.TermMonths), `${c.ContractNumber} end date`);
  }
});

test("term math", () => {
  assert.equal(endDateFor("2026-12-01", 12), "2027-11-30");
  assert.equal(endDateFor("2026-12-01", 36), "2029-11-30");
  assert.equal(tcvFor(30000, 12500, 36), 102500);
  assert.equal(tcvFor(30000, 0, 18), 45000);
  assert.equal(noticeDeadline({ EndDate: "2027-11-30", NoticeDays: 60 }), "2027-10-01");
  assert.equal(nextContractNumber([{ ContractNumber: "CTR-01009" }, { ContractNumber: "CTR-01231" }]), "CTR-01232");
});

test("contract from an accepted quote: Order Form, ARR, TCV, default clauses", () => {
  const q = quoteWithoutContract();
  const ctx = { data: BASE, asOf: ASOF, userId: REP };
  const { contractId, mutations } = contractFromQuoteMutations(ctx, q.Id);
  const data = apply(BASE, mutations);
  const c = contract(data, contractId);
  const t = computeTotals(q, quoteLines(BASE, q.Id), productMap(BASE.products));
  assert.equal(c.Status, "Draft");
  assert.equal(c.QuoteId, q.Id);
  assert.equal(c.AccountId, q.AccountId);
  assert.equal(c.OpportunityId, q.OpportunityId);
  assert.equal(c.ARR, t.arr);
  assert.equal(c.OneTimeFees, t.oneTime);
  assert.equal(c.TCV, t.tcv);
  assert.equal(c.TermMonths, q.Contract_Term_Months__c);
  assert.equal(c.StartDate, q.Start_Date__c);
  assert.equal(c.BillingFrequency, q.Billing_Frequency__c);
  assert.equal(c.PaymentTerms, q.Payment_Terms__c);
  assert.equal(c.EndDate, endDateFor(q.Start_Date__c, q.Contract_Term_Months__c));
  const lines = orderFormLines(data, c);
  assert.equal(lines.length, quoteLines(BASE, q.Id).length);
  assert.equal(Math.round(lines.filter((l) => l.recurring).reduce((s, l) => s + l.total, 0)), Math.round(t.arr));
  const rows = clausesFor(data, contractId);
  const defaults = BASE.clauses.filter((x) => x.IsDefault && x.IsActive).length;
  assert.equal(rows.length, defaults);
  assert.ok(rows.every((r) => r.Standard && r.ApprovalStatus === "Not required"));
  // Idempotent: a second click returns the same contract
  const again = contractFromQuoteMutations({ ...ctx, data }, q.Id);
  assert.equal(again.contractId, contractId);
  assert.equal(again.mutations.length, 0);
});

test("non-standard clause → Legal Review → approve → send → sign", () => {
  const q = quoteWithoutContract();
  const rep = { data: BASE, asOf: ASOF, userId: REP, role: "rep" as const };
  const created = contractFromQuoteMutations(rep, q.Id);
  let data = apply(BASE, created.mutations);
  const id = created.contractId;
  const liability = clausesFor(data, id).find((r) => r.ClauseId === libraryClause(data, CLAUSE_KEYS.liability)!.Id)!;

  data = apply(data, editClauseMutations({ ...rep, data }, liability.Id, "Liability is capped at 24 months of fees."));
  assert.equal(contract(data, id).Status, "Legal Review");
  assert.equal(contract(data, id).NonStandard, true);
  const row = data.contractClauses.find((r) => r.Id === liability.Id)!;
  assert.equal(row.Standard, false);
  assert.equal(row.ApprovalStatus, "Pending");
  const req = data.approvals.find((a) => a.RecordId === id && a.Type === "Non-standard clause");
  assert.ok(req && req.Status === "Pending" && req.ApproverRole === "legal");
  assert.ok(signatureBlockers(data, contract(data, id)).length > 0);
  assert.throws(() => sendForSignatureMutations({ ...rep, data }, id));
  assert.throws(() => decideClauseMutations({ ...rep, data }, liability.Id, "Approved"), /Legal/);

  const legal = { data, asOf: ASOF, userId: LEGAL, role: "legal" as const };
  data = apply(data, decideClauseMutations(legal, liability.Id, "Approved"));
  assert.equal(data.contractClauses.find((r) => r.Id === liability.Id)!.ApprovalStatus, "Approved");
  assert.equal(data.approvals.find((a) => a.Id === req.Id)!.Status, "Approved");
  assert.deepEqual(signatureBlockers(data, contract(data, id)), []);

  data = apply(data, sendForSignatureMutations({ ...rep, data }, id));
  assert.equal(contract(data, id).Status, "Sent for Signature");
  data = apply(data, signContractMutations({ ...rep, data }, id, { name: "Pat Buyer", title: "General Manager", image: "data:image/png;base64,AAAA" }));
  const signed = contract(data, id);
  assert.equal(signed.Status, q.Start_Date__c <= "2026-09-29" ? "Active" : "Signed");
  assert.equal(signed.SignedByName, "Pat Buyer");
  assert.ok(signed.SignedDate?.startsWith("2026-09-29"));
  assert.ok(signed.SignatureImage);
  assert.throws(() => signContractMutations({ ...rep, data }, id, { name: "x", title: "", image: "y" }));
});

test("rejected clause sends the contract back to Draft; revert makes it standard again", () => {
  const q = quoteWithoutContract();
  const rep = { data: BASE, asOf: ASOF, userId: REP, role: "rep" as const };
  const created = contractFromQuoteMutations(rep, q.Id);
  let data = apply(BASE, created.mutations);
  const id = created.contractId;
  const sla = clausesFor(data, id).find((r) => r.Category === "SLA")!;
  data = apply(data, editClauseMutations({ ...rep, data }, sla.Id, "99.99% uptime."));
  data = apply(data, decideClauseMutations({ data, asOf: ASOF, userId: LEGAL, role: "legal" }, sla.Id, "Rejected", "Too aggressive"));
  assert.equal(contract(data, id).Status, "Draft");
  assert.equal(data.contractClauses.find((r) => r.Id === sla.Id)!.ApprovalStatus, "Rejected");
  assert.ok(signatureBlockers(data, contract(data, id)).some((b) => /rejected/.test(b)));

  data = apply(data, revertClauseMutations({ ...rep, data }, sla.Id));
  const row = data.contractClauses.find((r) => r.Id === sla.Id)!;
  assert.equal(row.Standard, true);
  assert.equal(row.Body, libraryClause(data, CLAUSE_KEYS.sla)!.Body);
  assert.equal(contract(data, id).NonStandard, false);
  assert.deepEqual(signatureBlockers(data, contract(data, id)), []);
});

test("Legal's own edit is approved at once; editing back to library text reverts", () => {
  const q = quoteWithoutContract();
  const legal = { data: BASE, asOf: ASOF, userId: LEGAL, role: "legal" as const };
  const created = contractFromQuoteMutations(legal, q.Id);
  let data = apply(BASE, created.mutations);
  const row = clausesFor(data, created.contractId)[0];
  data = apply(data, editClauseMutations({ ...legal, data }, row.Id, "Custom text."));
  assert.equal(data.contractClauses.find((r) => r.Id === row.Id)!.ApprovalStatus, "Approved");
  assert.equal(contract(data, created.contractId).Status, "Draft");
  assert.equal(data.approvals.filter((a) => a.RecordId === created.contractId).length, 0);
  data = apply(data, editClauseMutations({ ...legal, data }, row.Id, row.Body));
  assert.equal(data.contractClauses.find((r) => r.Id === row.Id)!.Standard, true);
});

test("harvest payment terms need Finance; inbox decision applies once", () => {
  const q = quoteWithoutContract();
  const rep = { data: BASE, asOf: ASOF, userId: REP, role: "rep" as const };
  const created = contractFromQuoteMutations(rep, q.Id);
  let data = apply(BASE, created.mutations);
  const id = created.contractId;
  const r = harvestTermsMutations({ ...rep, data }, id, true);
  assert.equal(r.pending, true);
  data = apply(data, r.mutations);
  assert.equal(contract(data, id).HarvestTerms, false);
  const req = data.approvals.find((a) => a.RecordId === id && a.Type === "Payment terms")!;
  assert.equal(req.ApproverRole, "finance");
  assert.ok(signatureBlockers(data, contract(data, id)).some((b) => /Finance/.test(b)));
  // Decided in the header inbox
  data = apply(data, decideApproval(req, "Approved", "005Hs00000000002AA", ASOF));
  const effects = contractApprovalEffects(data, id);
  assert.ok(effects.length >= 2);
  data = apply(data, effects);
  assert.equal(contract(data, id).HarvestTerms, true);
  assert.ok(clausesFor(data, id).some((x) => x.ClauseId === libraryClause(data, CLAUSE_KEYS.harvest)!.Id));
  assert.deepEqual(contractApprovalEffects(data, id), []);
  // Turning it off withdraws the approval, so it isn't re-applied
  data = apply(data, harvestTermsMutations({ ...rep, data }, id, false).mutations);
  assert.equal(contract(data, id).HarvestTerms, false);
  assert.deepEqual(contractApprovalEffects(data, id), []);
  // Finance turns it on directly
  const fin = harvestTermsMutations({ data, asOf: ASOF, userId: REP, role: "finance" }, id, true);
  assert.equal(fin.pending, false);
  assert.equal(contract(apply(data, fin.mutations), id).HarvestTerms, true);
});

function mk(over: Partial<Contract>): Contract {
  return {
    Id: "800T",
    ContractNumber: "CTR-09999",
    Name: "Test",
    AccountId: BASE.accounts[0].Id,
    Status: "Active",
    OwnerId: REP,
    CreatedDate: "2025-01-01T00:00:00.000Z",
    StartDate: "2025-10-01",
    EndDate: "2026-09-30",
    TermMonths: 12,
    AutoRenew: false,
    NoticeDays: 60,
    PriceIncreasePct: 5,
    PaymentTerms: "Net 30",
    HarvestTerms: false,
    BillingFrequency: "Annual",
    ARR: 10000,
    OneTimeFees: 0,
    TCV: 10000,
    CurrencyIsoCode: "USD",
    DPA: true,
    NonStandard: false,
    ...over,
  };
}

test("date-driven status: activate, expire, auto-renew, idempotent", () => {
  const data = {
    contracts: [
      mk({ Id: "a", Status: "Signed", StartDate: "2026-09-01", EndDate: "2027-08-31" }),
      mk({ Id: "b", Status: "Active", EndDate: "2026-09-15" }),
      mk({ Id: "c", Status: "Active", EndDate: "2026-09-15", AutoRenew: true }),
      mk({ Id: "d", Status: "Signed", StartDate: "2026-12-01", EndDate: "2027-11-30" }),
      mk({ Id: "e", Status: "Draft", EndDate: "2020-01-01" }),
      mk({ Id: "f", Status: "Active", EndDate: "2026-09-29" }),
    ],
  } as DataSnapshot;
  const m = contractStatusMutations(data, ASOF);
  const by = (id: string) => m.find((x) => x.op === "update" && x.id === id);
  assert.deepEqual((by("a") as { changes: object }).changes, { Status: "Active" });
  assert.deepEqual((by("b") as { changes: object }).changes, { Status: "Expired" });
  assert.deepEqual((by("c") as { changes: object }).changes, { EndDate: "2027-09-15", ARR: 10500, TermMonths: 24, TCV: 20500 });
  assert.equal(by("d"), undefined);
  assert.equal(by("e"), undefined);
  assert.equal(by("f"), undefined, "still in force on its last day");
  const after = applyMutations({ ...data, accounts: [] } as unknown as DataSnapshot, m);
  assert.deepEqual(contractStatusMutations(after, ASOF), []);
});

test("terminate", () => {
  const data = { ...BASE, contracts: [mk({ Id: "t1", AutoRenew: true })] } as DataSnapshot;
  const m = terminateMutations({ data, asOf: ASOF, userId: REP }, "t1", { date: "2026-10-31", reason: "Facility sold" });
  const after = applyMutations(data, m);
  assert.equal(after.contracts[0].Status, "Terminated");
  assert.equal(after.contracts[0].TerminatedDate, "2026-10-31");
  assert.equal(after.contracts[0].AutoRenew, false);
  assert.throws(() => terminateMutations({ data, asOf: ASOF, userId: REP }, "t1", { date: "2026-10-31", reason: " " }));
});

test("alerts: notice deadline, expiring, unsigned > 14 days", () => {
  const data = {
    accounts: BASE.accounts.slice(0, 1),
    contracts: [
      // End in 105 days, 60-day notice → notice due in 45 days
      mk({ Id: "n", EndDate: "2027-01-12", AutoRenew: true }),
      // Ends in 20 days, no auto-renew
      mk({ Id: "x", EndDate: "2026-10-19", NoticeDays: 0 }),
      mk({ Id: "u", Status: "Sent for Signature", SentForSignatureDate: "2026-09-08T15:00:00.000Z", EndDate: "2029-01-01" }),
      mk({ Id: "fresh", Status: "Sent for Signature", SentForSignatureDate: "2026-09-25T15:00:00.000Z", EndDate: "2029-01-01" }),
      mk({ Id: "far", EndDate: "2028-01-01" }),
      mk({ Id: "gone", Status: "Expired", EndDate: "2026-10-01" }),
    ],
  } as unknown as DataSnapshot;
  const alerts = contractAlerts(data, ASOF);
  const of = (id: string) => alerts.filter((a) => a.contractId === id);
  assert.deepEqual(of("n").map((a) => a.message), ["Renewal notice due in 45 days"]);
  assert.deepEqual(of("x").map((a) => a.message).sort(), ["Expires in 20 days", "Renewal notice due in 20 days"]);
  assert.deepEqual(of("u").map((a) => a.message), ["Unsigned for 21 days"]);
  assert.equal(of("fresh").length, 0);
  assert.equal(of("far").length, 0);
  assert.equal(of("gone").length, 0);
  assert.equal(alerts[0].severity, "critical");
});

test("seed alerts exist for the demo", () => {
  const alerts = contractAlerts(BASE, ASOF);
  for (const k of ["notice", "expiring", "unsigned"] as const) assert.ok(alerts.some((a) => a.kind === k), k);
});
