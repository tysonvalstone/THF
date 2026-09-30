import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { PREBUILT_SEQUENCES } from "@/data/seed/sequences";
import { applyMutations } from "@/lib/data/local-repository";
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { parseDate } from "@/lib/dates";
import { contractStatusMutations } from "@/lib/contracts/core";
import { billingMutations } from "@/lib/billing";
import { renewalMutations } from "@/lib/success/renewals";
import { arrAt, arrBridge, periodFor } from "@/lib/finance/metrics";
import { simSummary, simulateWindow } from "./simulate";
import {
  acceptAndWin,
  buildDemoQuote,
  campaignRecipients,
  convertNewBuild,
  createDemoCampaign,
  createDemoContract,
  createDemoOpportunity,
  DEMO_DATES,
  DEMO_SEQUENCE_ID,
  demoExpansion,
  enrollRecipients,
  findDemoNewBuild,
  finishDemoCall,
  harvestTermsContract,
  harvestTermsDemo,
  legalApproveClause,
  renewalCheckDate,
  renewalFor,
  requestClauseChange,
  scheduleDemoCall,
  signDemoContract,
} from "./scenario";

const LUKE = "005Hs00000000005AA";
const SENDER = { name: "Luke Brenneman", title: "Account Executive", email: "luke@example.com" };
const SIG = "data:image/png;base64,iVBORw0KGgo=";

/** Commits like the app: the change, then lifecycle automation for the date */
function commit(data: DataSnapshot, muts: Mutation[], asOf: string): DataSnapshot {
  let d = applyMutations(data, muts);
  const at = parseDate(asOf);
  const auto = [...contractStatusMutations(d, at), ...billingMutations(d, at), ...renewalMutations(d, at)];
  if (auto.length) d = applyMutations(d, auto);
  return d;
}

test("simulation is deterministic for a seed and date window", () => {
  const a = simulateWindow(SEED, "2026-10-14", "2026-11-13", { seed: "run-1", userId: LUKE });
  const b = simulateWindow(SEED, "2026-10-14", "2026-11-13", { seed: "run-1", userId: LUKE });
  assert.deepEqual(a.counts, b.counts);
  assert.ok(a.counts.opens > 0);
  assert.ok(a.counts.payments >= 0);
  assert.match(simSummary(a.counts), /^Fast-forwarded 30 days · \d+ opens?, /);
  const week = simulateWindow(SEED, "2026-10-14", "2026-10-21", { seed: "run-1", userId: LUKE });
  assert.ok(week.counts.opens <= a.counts.opens);
});

test("the 13-step walkthrough runs end to end on the seed data", () => {
  let asOf: string = DEMO_DATES.october;
  const ctx = (role?: "manager" | "legal" | "finance") => ({ data, asOf: parseDate(asOf), userId: LUKE, role });
  let data = commit(SEED, [], asOf);

  // 2. New build → lead → account + contact
  const nb = findDemoNewBuild(data)!;
  assert.equal(nb.City, "Fort Dodge");
  const conv = convertNewBuild(ctx(), nb);
  data = commit(data, conv.mutations, asOf);
  const account = data.accounts.find((a) => a.Id === conv.accountId)!;
  assert.equal(account.Segment__c, "Ethanol Plant");
  const contact = data.contacts.find((c) => c.Id === conv.contactId)!;
  assert.equal(contact.Buying_Role__c, "Economic Buyer");
  assert.equal(data.newBuilds.find((n) => n.Id === nb.Id)?.Status, "Converted");

  // 3. Opportunity
  const opp = createDemoOpportunity(ctx(), conv.accountId, conv.contactId);
  data = commit(data, opp.mutations, asOf);
  assert.ok(data.opportunities.find((o) => o.Id === opp.opportunityId)!.Amount > 0);

  // 4. Campaign + sequence
  const recips = campaignRecipients(data, conv.accountId);
  assert.equal(recips.length, 15);
  assert.equal(recips[0].account.Id, conv.accountId);
  const camp = createDemoCampaign(ctx(), recips, SENDER);
  data = commit(data, camp.mutations, asOf);
  const seq = PREBUILT_SEQUENCES.find((s) => s.id === DEMO_SEQUENCE_ID)!;
  const enr = enrollRecipients(ctx(), seq, recips, SENDER);
  assert.equal(enr.enrollments.length, 15);
  data = commit(data, enr.mutations, asOf);

  // 5. Call Desk
  const call = scheduleDemoCall(ctx(), { accountId: conv.accountId, opportunityId: opp.opportunityId, contactId: conv.contactId, time: "15:00" });
  data = commit(data, call.mutations, asOf);
  const before = data.opportunities.find((o) => o.Id === opp.opportunityId)!.StageName;
  const done = finishDemoCall(ctx(), call.callId);
  data = commit(data, done.mutations, asOf);
  assert.equal(data.calls.find((c) => c.Id === call.callId)?.Status, "Completed");
  assert.ok(done.tasks >= 1);
  const after = data.opportunities.find((o) => o.Id === opp.opportunityId)!.StageName;
  assert.ok(done.stage ? after !== before : true, `stage ${before} → ${after}`);

  // 6. Quote: 12% off, auto-approved, sent
  const quote = buildDemoQuote(ctx(), opp.opportunityId);
  data = commit(data, quote.mutations, asOf);
  assert.equal(data.quotes.find((q) => q.Id === quote.quoteId)?.Status, "Sent");

  // 7. Fast-forward 30 days: simulated activity, quote accepted, Closed Won
  const sim = simulateWindow(data, asOf, DEMO_DATES.november, { seed: "run-1", userId: LUKE, skipOpportunityIds: [opp.opportunityId] });
  asOf = DEMO_DATES.november;
  data = commit(data, sim.mutations, asOf);
  data = commit(data, acceptAndWin(ctx(), quote.quoteId), asOf);
  assert.equal(data.quotes.find((q) => q.Id === quote.quoteId)?.Status, "Accepted");
  const won = data.opportunities.find((o) => o.Id === opp.opportunityId)!;
  assert.equal(won.StageName, "Closed Won");
  const members = data.campaignMembers.filter((m) => m.CampaignId === camp.campaignId);
  assert.ok(members.some((m) => m.Status === "Opened" || m.Status === "Responded"));

  // 8. Contract: Legal approves a clause, signed, first invoice
  const arrBefore = arrAt(data, parseDate(asOf));
  const ctr = createDemoContract(ctx("manager"), quote.quoteId);
  data = commit(data, ctr.mutations, asOf);
  const clause = requestClauseChange(ctx("manager"), ctr.contractId);
  data = commit(data, clause.mutations, asOf);
  assert.equal(data.contracts.find((c) => c.Id === ctr.contractId)?.Status, "Legal Review");
  data = commit(data, legalApproveClause(ctx("legal"), clause.rowId), asOf);
  const signed = signDemoContract(ctx("manager"), ctr.contractId, SIG);
  data = commit(data, signed.mutations, asOf);
  const contract = data.contracts.find((c) => c.Id === ctr.contractId)!;
  assert.ok(contract.Status === "Signed" || contract.Status === "Active", contract.Status);
  const invoice = data.invoices.find((i) => i.ContractId === ctr.contractId);
  assert.ok(invoice, "first invoice");
  assert.equal(invoice!.Status, "Sent");
  const ht = harvestTermsContract(data, [ctr.contractId]);
  if (ht) {
    data = commit(data, harvestTermsDemo(ctx(), ht.Id), asOf);
    assert.equal(data.contracts.find((c) => c.Id === ht.Id)?.HarvestTerms, true);
  }

  // 9. ARR up; the bridge counts the new customer
  assert.ok(arrAt(data, parseDate(asOf)) > arrBefore);
  const p = periodFor("month", parseDate(asOf));
  assert.ok(arrBridge(data, p.start, p.end).counts.new >= 1);

  // 12. Eleven months after the start: renewal opportunity, expansion flagged
  asOf = renewalCheckDate(contract.StartDate);
  data = commit(data, [], asOf);
  assert.ok(renewalFor(data, ctr.contractId), "renewal opportunity");
  const exp = demoExpansion(ctx());
  assert.ok(exp, "expansion candidate");
});
