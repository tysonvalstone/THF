/**
 * Demo Mode walkthrough actions. Each one is built from the same pure helpers
 * the app's own buttons use (new-build conversion, campaigns, sequences, Call
 * Desk, quotes, contracts, billing, renewals, expansion) and returns the
 * mutations to commit through useCrud().run, plus the ids it created.
 *
 * Multi-part actions apply each part locally (applyMutations) before building
 * the next, so later helpers see the records earlier ones created.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { applyMutations } from "@/lib/data/local-repository";
import type { AppRole } from "@/lib/supabase/config";
import type { Enrollment, Sequence } from "@/lib/ai/types";
import type { Account, Contact, NewBuild, Opportunity } from "@/types/salesforce";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import { leadToAccountMutations, newBuildToLeadMutations } from "@/lib/new-builds/convert";
import { createCampaign, estimateOpportunity } from "@/lib/actions/outreach";
import { templateCampaignContent, type Sender } from "@/lib/content/templates";
import { enrollmentFor } from "@/lib/sequences/engine";
import { enrollmentTasks, nowStamp } from "@/components/sequences/sequence-store";
import { notesFromTranscript, saveCallMutations, scheduleCallMutations, simulatedTranscript, suggestedUpdates } from "@/lib/call-desk";
import { acceptQuoteMutations, buildQuoteFromOpportunity, closeWonMutations, markSentMutations, submitForApprovalMutations } from "@/lib/quotes";
import {
  clausesFor,
  contractFromQuoteMutations,
  customerSignerFor,
  decideClauseMutations,
  decidePaymentTermsMutations,
  editClauseMutations,
  harvestTermsMutations,
  sendForSignatureMutations,
  updateTermsMutations,
} from "@/lib/contracts";
import { signAndHandoffMutations } from "@/lib/contracts/handoff";
import { sendInvoiceMutations } from "@/lib/billing";
import { isSeasonalSegment } from "@/lib/seasonality";
import { renewalMutations, isRenewalOpportunity } from "@/lib/success/renewals";
import { expansionCandidates, startExpansionMutations } from "@/lib/success/expansion";
import type { RegionId } from "@/types/salesforce";

export interface DemoCtx {
  data: DataSnapshot;
  asOf: Date;
  userId: string;
  role?: AppRole;
}

/** Dates the walkthrough moves to */
export const DEMO_DATES = {
  seed: "2026-09-29",
  october: "2026-10-14",
  november: "2026-11-13",
  december: "2026-12-10",
} as const;

export const DEMO_NEW_BUILD_ID = "a0NHs000000000AAA";
export const DEMO_CAMPAIGN_NAME = "Year-Round Ethanol & Feed";
export const DEMO_SEQUENCE_ID = "seq-year-round-ethanol-feed";
export const DEMO_TRIP_REQUEST = "I'm going to Iowa in January, top 10 co-ops";
export const DEMO_CAMPAIGN_SIZE = 15;

/** The person the rep finds at the new plant (the plant controller: the economic buyer) */
export const DEMO_CONTACT = { FirstName: "Dana", LastName: "Kessler", Title: "Plant Controller", Email: "dana.kessler@fortdodgebioenergy.com", Phone: "(515) 555-0142" };

const iso = (d: Date) => toISODate(d);

/** The brand-new Iowa ethanol plant (Fort Dodge) */
export function findDemoNewBuild(data: Pick<DataSnapshot, "newBuilds">): NewBuild | undefined {
  return (
    data.newBuilds.find((n) => n.Id === DEMO_NEW_BUILD_ID) ??
    data.newBuilds.find((n) => n.Segment__c === "Ethanol Plant" && n.State === "IA" && n.City === "Fort Dodge") ??
    data.newBuilds.find((n) => n.Segment__c === "Ethanol Plant" && n.Status === "New" && n.State === "IA")
  );
}

/* ------------------------------------------------------------- step 2 */

/** New build → Lead (with the controller's name) → Account + Contact */
export function convertNewBuild(ctx: DemoCtx, nb: NewBuild): { leadId: string; accountId: string; contactId?: string; mutations: Mutation[] } {
  const toLead = newBuildToLeadMutations(nb, ctx);
  let data = applyMutations(ctx.data, toLead.mutations);
  const person: Mutation = {
    op: "update",
    object: "Lead",
    id: toLead.leadId,
    changes: { ...DEMO_CONTACT, Name: `${DEMO_CONTACT.FirstName} ${DEMO_CONTACT.LastName}`, Status: "Working - Contacted" },
  };
  data = applyMutations(data, [person]);
  const lead = data.leads.find((l) => l.Id === toLead.leadId)!;
  const conv = leadToAccountMutations(lead, { ...ctx, data }, { createContact: true });
  return { leadId: toLead.leadId, accountId: conv.accountId, contactId: conv.contactId, mutations: [...toLead.mutations, person, ...conv.mutations] };
}

/* ------------------------------------------------------------- step 3 */

/** Opportunity sized from product fit, with the controller as economic buyer */
export function createDemoOpportunity(ctx: DemoCtx, accountId: string, contactId?: string): { opportunityId: string; mutations: Mutation[] } {
  const account = ctx.data.accounts.find((a) => a.Id === accountId);
  if (!account) throw new Error("Account not found");
  const contact = contactId ? ctx.data.contacts.find((c) => c.Id === contactId) : undefined;
  const eb = contact?.Buying_Role__c === "Economic Buyer" ? contact : undefined;
  const { opp, lines } = estimateOpportunity(ctx, account, eb ? "Book a discovery call" : "Identify the economic buyer (controller or GM)", eb ? "Qualification" : "Prospecting");
  const record: Opportunity = {
    ...opp,
    CloseDate: iso(addDays(ctx.asOf, 75)),
    LeadSource: "Web",
    ...(contact ? { Primary_Contact__c: contact.Id } : {}),
    ...(eb ? { Economic_Buyer_Identified__c: true, Economic_Buyer__c: eb.Id } : {}),
  };
  return { opportunityId: record.Id, mutations: [{ op: "create", object: "Opportunity", record }, ...lines] };
}

/* ------------------------------------------------------------- step 4 */

export interface Recipient {
  account: Account;
  contact?: Contact;
}

/** Best contact at an account: economic buyer, then decision maker, then anyone emailable */
function bestContact(data: DataSnapshot, accountId: string): Contact | undefined {
  const cs = data.contacts.filter((c) => c.AccountId === accountId && c.Email && !c.HasOptedOutOfEmail);
  return cs.find((c) => c.Buying_Role__c === "Economic Buyer") ?? cs.find((c) => c.Buying_Role__c === "Decision Maker") ?? cs[0];
}

/**
 * 15 ethanol plant and feed mill contacts: the new plant first, then
 * prospects in `order` (ranked account ids), then by revenue.
 */
export function campaignRecipients(data: DataSnapshot, firstAccountId: string | undefined, order: string[] = [], size = DEMO_CAMPAIGN_SIZE): Recipient[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  const pool = data.accounts
    .filter((a) => (a.Segment__c === "Ethanol Plant" || a.Segment__c === "Feed Mill") && a.Type !== "Customer - Direct" && !a.ParentId && a.Id !== firstAccountId)
    .sort((a, b) => (rank.get(a.Id) ?? 1e9) - (rank.get(b.Id) ?? 1e9) || b.AnnualRevenue - a.AnnualRevenue || a.Name.localeCompare(b.Name));
  const out: Recipient[] = [];
  const first = firstAccountId ? data.accounts.find((a) => a.Id === firstAccountId) : undefined;
  if (first) out.push({ account: first, contact: bestContact(data, first.Id) });
  for (const a of pool) {
    if (out.length >= size) break;
    const contact = bestContact(data, a.Id);
    if (contact) out.push({ account: a, contact });
  }
  return out;
}

export function createDemoCampaign(ctx: DemoCtx, recipients: Recipient[], sender: Sender): { campaignId: string; mutations: Mutation[] } {
  const regions = [...new Set(recipients.map((r) => r.account.Region__c))] as RegionId[];
  const facilityTypes = ["Ethanol Plant", "Feed Mill"] as const;
  const content = templateCampaignContent({ play: "Year-round", regionIds: regions, facilityTypes: [...facilityTypes], asOf: ctx.asOf, sender });
  const { campaignId, result } = createCampaign(ctx, {
    name: DEMO_CAMPAIGN_NAME,
    type: "Email",
    startDate: iso(ctx.asOf),
    endDate: iso(addDays(ctx.asOf, 75)),
    budget: 2500,
    season: "Year-round",
    regions,
    facilityTypes: [...facilityTypes],
    commodity: "Corn",
    description: "Harvest doesn't stop ethanol plants and feed mills: reach them while elevators are in blackout.",
    content,
    expectedRevenue: Math.round(recipients.length * 38_000),
    members: recipients.map((r) => ({ targetId: r.account.Id, whoId: r.contact?.Id })),
  });
  return { campaignId, mutations: result.mutations };
}

/** Enrollments in the prebuilt sequence (blackout-aware schedule) and their Salesforce tasks */
export function enrollRecipients(ctx: DemoCtx, sequence: Sequence, recipients: Recipient[], sender: Pick<Sender, "name">): { enrollments: Enrollment[]; mutations: Mutation[] } {
  const enrollments = recipients.map((r) => enrollmentFor(sequence, r.account, r.contact, { sender, asOf: ctx.asOf, data: ctx.data, enrolledBy: ctx.userId }));
  const mutations = enrollments.flatMap((e) => enrollmentTasks(e, sequence, ctx.userId, nowStamp(ctx.asOf)));
  return { enrollments, mutations };
}

/* ------------------------------------------------------------- step 5 */

export function scheduleDemoCall(ctx: DemoCtx, input: { accountId: string; opportunityId?: string; contactId?: string; time: string }): { callId: string; mutations: Mutation[] } {
  return scheduleCallMutations(ctx, {
    accountId: input.accountId,
    opportunityId: input.opportunityId,
    contactIds: input.contactId ? [input.contactId] : [],
    callType: "Discovery",
    date: iso(ctx.asOf),
    time: input.time,
    durationMin: 30,
  });
}

export const DEMO_REP_NOTES = "Strong fit: scale tickets and corn receiving at startup\nSend proposal to Dana by Friday";

/**
 * End the simulated call: AI Notes from the full transcript, the suggested
 * stage change accepted (with the economic-buyer update it needs), next steps
 * as follow-up tasks, and the call saved.
 */
export function finishDemoCall(ctx: DemoCtx, callId: string): { mutations: Mutation[]; stage?: string; tasks: number } {
  const call = ctx.data.calls.find((c) => c.Id === callId);
  if (!call) throw new Error("Call not found");
  const transcript = simulatedTranscript({ ...call, Transcript: undefined }, ctx.data);
  const withCall = { ...call, Transcript: transcript, RepNotes: DEMO_REP_NOTES, QuestionsAsked: call.QuestionsAsked ?? [] };
  const notes = notesFromTranscript(withCall, transcript, DEMO_REP_NOTES, ctx.data);
  const updates = suggestedUpdates(withCall, notes, ctx.data);
  const stage = updates.find((u) => u.key === "stage");
  const chosen = updates.filter((u) => u.key === "stage" || u.key === "nextStep" || (stage?.requires && u.key === stage.requires));
  const mutations = saveCallMutations(ctx, withCall, notes, chosen);
  const tasks = mutations.filter((m) => m.op === "create" && m.object === "Task").length;
  const applied = mutations.some((m) => m.op === "update" && m.object === "Opportunity" && "StageName" in (m.changes as object));
  return { mutations, stage: applied && stage ? stage.to : undefined, tasks };
}

/* ------------------------------------------------------------- step 6 */

/** Quote from the catalog (products that fit), 12% off, submitted (auto-approved) and sent */
export function buildDemoQuote(ctx: DemoCtx, opportunityId: string): { quoteId: string; quoteNumber: string; status: string; mutations: Mutation[] } {
  const built = buildQuoteFromOpportunity(ctx, opportunityId, {
    discount: 12,
    termMonths: 12,
    lines: "fit",
    startDate: iso(addDays(ctx.asOf, 30)),
    expirationDate: iso(addDays(ctx.asOf, 45)),
  });
  let data = applyMutations(ctx.data, built.mutations);
  const submit = submitForApprovalMutations({ ...ctx, data }, built.quote.Id);
  data = applyMutations(data, submit.mutations);
  const sent = submit.status === "Approved" ? markSentMutations({ ...ctx, data }, built.quote.Id) : [];
  return { quoteId: built.quote.Id, quoteNumber: built.quote.QuoteNumber, status: sent.length ? "Sent" : submit.status, mutations: [...built.mutations, ...submit.mutations, ...sent] };
}

/* ------------------------------------------------------------- step 7 */

/** The customer accepts: quote Accepted, opportunity Closed Won */
export function acceptAndWin(ctx: DemoCtx, quoteId: string): Mutation[] {
  const q = ctx.data.quotes.find((x) => x.Id === quoteId);
  if (!q) return [];
  const accept = q.Status === "Accepted" ? [] : acceptQuoteMutations(ctx, quoteId);
  const opp = ctx.data.opportunities.find((o) => o.Id === q.OpportunityId);
  const won = opp && !opp.IsWon ? closeWonMutations(ctx, opp.Id) : [];
  return [...accept, ...won];
}

/* ------------------------------------------------------------- step 8 */

/** Draft contract from the accepted quote (service starts today if the quote's start date is still ahead) */
export function createDemoContract(ctx: DemoCtx, quoteId: string): { contractId: string; mutations: Mutation[] } {
  const r = contractFromQuoteMutations(ctx, quoteId);
  if (!r.mutations.length) return r;
  const data = applyMutations(ctx.data, r.mutations);
  const c = data.contracts.find((x) => x.Id === r.contractId)!;
  const today = iso(ctx.asOf);
  const start = c.StartDate > today ? updateTermsMutations({ ...ctx, data }, c.Id, { StartDate: today }) : [];
  return { contractId: r.contractId, mutations: [...r.mutations, ...start] };
}

export const DEMO_CLAUSE_TEXT =
  "ThiboLiSoft's total liability under this Agreement is limited to two times the fees paid in the twelve months before the claim (the standard cap is one times). Neither party is liable for indirect or consequential damages, including lost grain margin during plant startup.";

/** The rep edits the liability clause: non-standard, so it goes to Legal */
export function requestClauseChange(ctx: DemoCtx, contractId: string): { rowId: string; mutations: Mutation[] } {
  const rows = clausesFor(ctx.data, contractId);
  const row = rows.find((r) => r.Category === "Liability") ?? rows[0];
  if (!row) throw new Error("Contract has no clauses");
  return { rowId: row.Id, mutations: editClauseMutations({ ...ctx, role: ctx.role ?? "manager" }, row.Id, DEMO_CLAUSE_TEXT) };
}

/** Legal approves the clause (ctx.role must be legal) */
export function legalApproveClause(ctx: DemoCtx, rowId: string): Mutation[] {
  return decideClauseMutations(ctx, rowId, "Approved", "Two-times cap accepted for a new-build plant");
}

/** Out for signature and signed (simulated e-signature), handing off to Finance (first invoice, sent) and onboarding */
export function signDemoContract(ctx: DemoCtx, contractId: string, image: string): { mutations: Mutation[]; invoiceId?: string; signer: string } {
  const c = ctx.data.contracts.find((x) => x.Id === contractId);
  if (!c) throw new Error("Contract not found");
  const signer = customerSignerFor(ctx.data, c);
  const send = sendForSignatureMutations(ctx, contractId);
  let data = applyMutations(ctx.data, send);
  const sign = signAndHandoffMutations({ ...ctx, data }, contractId, { name: signer?.Name ?? "Dana Kessler", title: signer?.Title ?? "Plant Controller", image });
  data = applyMutations(data, sign);
  const inv = data.invoices.find((i) => i.ContractId === contractId);
  const issue = inv && inv.Status === "Draft" ? sendInvoiceMutations({ ...ctx, data }, inv) : [];
  return { mutations: [...send, ...sign, ...issue], invoiceId: inv?.Id, signer: signer?.Name ?? "Dana Kessler" };
}

/** A seeded seasonal contract still in Draft or Legal Review (co-op first) for the harvest-terms example */
export function harvestTermsContract(data: DataSnapshot, excludeIds: string[] = []) {
  const seg = new Map(data.accounts.map((a) => [a.Id, a.Segment__c]));
  const editable = data.contracts.filter((c) => (c.Status === "Draft" || c.Status === "Legal Review") && !c.HarvestTerms && !excludeIds.includes(c.Id));
  return editable.find((c) => seg.get(c.AccountId) === "Multi-Location Co-op") ?? editable.find((c) => isSeasonalSegment(seg.get(c.AccountId)));
}

/** Rep requests harvest payment terms; Finance approves (ctx.role is ignored: the request runs as a manager, the decision as Finance) */
export function harvestTermsDemo(ctx: DemoCtx, contractId: string): Mutation[] {
  const req = harvestTermsMutations({ ...ctx, role: "manager" }, contractId, true);
  if (!req.pending) return req.mutations;
  const data = applyMutations(ctx.data, req.mutations);
  return [...req.mutations, ...decidePaymentTermsMutations({ ...ctx, data, role: "finance" }, contractId, "Approved", "Harvest terms: annual invoice due Dec 15")];
}

/* ------------------------------------------------------------ step 12 */

/** "11 months from the contract start" */
export function renewalCheckDate(contractStart: string): string {
  const s = parseDate(contractStart);
  return iso(new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 11, s.getUTCDate())));
}

/** Renewal opportunities due (normally created by lifecycle automation; idempotent) */
export function demoRenewals(ctx: DemoCtx): Mutation[] {
  return renewalMutations(ctx.data, ctx.asOf);
}

export function renewalFor(data: DataSnapshot, contractId: string): Opportunity | undefined {
  const c = data.contracts.find((x) => x.Id === contractId);
  const byLink = c?.RenewalOpportunityId ? data.opportunities.find((o) => o.Id === c.RenewalOpportunityId) : undefined;
  return byLink ?? data.opportunities.find((o) => o.AccountId === c?.AccountId && isRenewalOpportunity(o));
}

/** The health score's top expansion candidate becomes an Add-On opportunity */
export function demoExpansion(ctx: DemoCtx): { opportunityId: string; accountName: string; mutations: Mutation[] } | null {
  const cand = expansionCandidates(ctx.data, ctx.asOf).find((c) => !c.openOpportunity);
  if (!cand) return null;
  const r = startExpansionMutations(ctx.data, cand.account.Id, ctx.asOf, ctx.userId);
  return r ? { ...r, accountName: cand.account.Name } : null;
}
