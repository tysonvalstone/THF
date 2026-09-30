/**
 * Quote status changes as Salesforce-style mutations (pure). The UI commits
 * them with useCrud().run; the Demo Mode walkthrough can call them directly.
 *
 *   Draft → (submit) → Approved when within policy, else In Review
 *   In Review → Approved | Rejected (approver) | Draft (recall)
 *   Approved → Sent → Accepted | Declined
 *   Accepted → opportunity Closed Won;  Declined → Closed Lost
 *   Any status → Revise (a new Draft version, Q-01234-v2)
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { Opportunity, OpportunityLineItem, Quote, QuoteLineItem, QuoteStatus, Task } from "@/types/salesforce";
import { addDays, toISODate } from "@/lib/dates";
import { nextBoardMeeting } from "@/lib/seasonality";
import { entryFor, isRecurring, productMap } from "./catalog";
import { computeTotals, fmtCurrency, priceLine, rollupFields, round2, type QuoteTotals } from "./pricing";
import { approvalFor, approvalReasonText, canApprove, type ApprovalRequirement } from "./approvals";
import { DEFAULT_VALID_DAYS, revisionNumber, stamp, type QuoteContext } from "./build";

export const LOSS_REASONS = [
  "Chose competitor (HarvestCore 360)",
  "Incumbent offered a discounted upgrade",
  "Budget frozen after margin squeeze",
  "No decision: board deferred",
  "Timing: harvest started before a decision",
  "Went dark during harvest",
  "Price",
] as const;

/** Statuses whose line items and pricing can be edited */
export const EDITABLE_STATUSES: QuoteStatus[] = ["Draft", "In Review", "Approved", "Rejected"];
/** Statuses that expire when the expiration date passes */
const EXPIRING: QuoteStatus[] = ["Draft", "In Review", "Approved", "Sent"];

/** Status as of a date: open quotes past their expiration date show as Expired */
export function effectiveStatus(q: Pick<Quote, "Status" | "ExpirationDate">, asOf: Date): QuoteStatus {
  if (EXPIRING.includes(q.Status) && q.ExpirationDate < toISODate(asOf)) return "Expired";
  return q.Status;
}

export function isEditable(q: Pick<Quote, "Status" | "ExpirationDate">, asOf: Date): boolean {
  return EDITABLE_STATUSES.includes(effectiveStatus(q, asOf));
}

/** Days until expiration (negative when past) */
export function daysToExpiry(q: Pick<Quote, "ExpirationDate">, asOf: Date): number {
  return Math.round((Date.parse(`${q.ExpirationDate}T00:00:00Z`) - Date.parse(`${toISODate(asOf)}T00:00:00Z`)) / 86_400_000);
}

export function quoteLines(data: Pick<DataSnapshot, "quoteLineItems">, quoteId: string): QuoteLineItem[] {
  return data.quoteLineItems.filter((l) => l.QuoteId === quoteId).sort((a, b) => a.SortOrder - b.SortOrder);
}

export function quoteTotals(data: Pick<DataSnapshot, "quoteLineItems" | "products">, q: Quote): QuoteTotals {
  return computeTotals(q, quoteLines(data, q.Id), productMap(data.products));
}

export function quoteApproval(data: Pick<DataSnapshot, "quoteLineItems" | "products" | "pricebooks">, q: Quote): ApprovalRequirement {
  const ccy = data.pricebooks.find((b) => b.Id === q.Pricebook2Id)?.CurrencyIsoCode ?? "USD";
  return approvalFor(quoteTotals(data, q), ccy);
}

function find(ctx: QuoteContext, quoteId: string): Quote {
  const q = ctx.data.quotes.find((x) => x.Id === quoteId);
  if (!q) throw new Error(`Quote ${quoteId} not found`);
  return q;
}

/** Cleared with "" (not undefined) so the change survives the JSON change log */
const CLEAR_APPROVAL: Partial<Quote> = { Approval_Reason__c: "", Approved_By__c: "", Approved_Date__c: "" };

/**
 * Header changes after a pricing change (lines, header discount, tax, term):
 * new roll-ups, and a submitted or approved quote goes back to Draft.
 */
export function repriceChanges(q: Quote, linesAfter: QuoteLineItem[], data: Pick<DataSnapshot, "products">, headerAfter: Partial<Quote> = {}): Partial<Quote> {
  const merged = { ...q, ...headerAfter };
  const totals = computeTotals(merged, linesAfter, productMap(data.products));
  const reset = q.Status === "Approved" || q.Status === "In Review" || q.Status === "Rejected";
  return { ...headerAfter, ...rollupFields(totals), ...(reset ? { Status: "Draft" as const, ...CLEAR_APPROVAL } : {}) };
}

/**
 * Line-item edits (create / update / delete QuoteLineItem mutations) plus the
 * quote's roll-ups and approval reset, in one change.
 */
export function lineEditMutations(ctx: QuoteContext, quoteId: string, lineMutations: Mutation[]): Mutation[] {
  const q = find(ctx, quoteId);
  let lines = quoteLines(ctx.data, quoteId);
  for (const m of lineMutations) {
    if (m.object !== "QuoteLineItem") continue;
    if (m.op === "create") lines = [...lines, m.record as QuoteLineItem];
    else if (m.op === "update") lines = lines.map((l) => (l.Id === m.id ? ({ ...l, ...m.changes } as QuoteLineItem) : l));
    else lines = lines.filter((l) => l.Id !== m.id);
  }
  return [...lineMutations, { op: "update", object: "Quote", id: q.Id, changes: repriceChanges(q, lines, ctx.data) }];
}

/** A new line for a product (list price from the quote's price book) */
export function newLine(ctx: QuoteContext, quoteId: string, productId: string, quantity: number, discount = 0): QuoteLineItem {
  const q = find(ctx, quoteId);
  const product = ctx.data.products.find((p) => p.Id === productId);
  const entry = entryFor(ctx.data, q.Pricebook2Id, productId);
  const list = entry?.UnitPrice ?? product?.List_Price__c ?? 0;
  const order = quoteLines(ctx.data, quoteId).reduce((m, l) => Math.max(m, l.SortOrder), 0) + 1;
  return {
    Id: newId("QuoteLineItem"),
    QuoteId: quoteId,
    Product2Id: productId,
    PricebookEntryId: entry?.Id,
    Quantity: quantity,
    ListPrice: list,
    Discount: discount,
    ...priceLine(list, quantity, discount),
    SortOrder: order,
  };
}

/** Changes to a line's quantity, list price or discount, with the recomputed net and total */
export function lineChanges(line: QuoteLineItem, patch: Partial<Pick<QuoteLineItem, "Quantity" | "ListPrice" | "Discount" | "Description">>): Partial<QuoteLineItem> {
  const next = { ...line, ...patch };
  return { ...patch, ...priceLine(next.ListPrice, next.Quantity, next.Discount) };
}

/** Re-price every line from another price book (lines for products not in it keep their price) */
export function changePricebookMutations(ctx: QuoteContext, quoteId: string, pricebookId: string, headerChanges: Partial<Quote> = {}): Mutation[] {
  const q = find(ctx, quoteId);
  const lines = quoteLines(ctx.data, quoteId);
  const muts: Mutation[] = [];
  const after = lines.map((l) => {
    const entry = entryFor(ctx.data, pricebookId, l.Product2Id);
    if (!entry) return l;
    const changes = { PricebookEntryId: entry.Id, ...lineChanges(l, { ListPrice: entry.UnitPrice }) };
    muts.push({ op: "update", object: "QuoteLineItem", id: l.Id, changes });
    return { ...l, ...changes };
  });
  return [...muts, { op: "update", object: "Quote", id: q.Id, changes: repriceChanges(q, after, ctx.data, { ...headerChanges, Pricebook2Id: pricebookId }) }];
}

export interface SubmitResult {
  mutations: Mutation[];
  requirement: ApprovalRequirement;
  status: QuoteStatus;
}

/** Submit for approval: within the rep limit it's approved at once, else it goes to In Review */
export function submitForApprovalMutations(ctx: QuoteContext, quoteId: string, note?: string): SubmitResult {
  const q = find(ctx, quoteId);
  const requirement = quoteApproval(ctx.data, q);
  const auto = requirement.level === "auto";
  const status: QuoteStatus = auto ? "Approved" : "In Review";
  const changes: Partial<Quote> = auto
    ? { Status: status, Approval_Reason__c: approvalReasonText(requirement), Approved_By__c: "", Approved_Date__c: stamp(ctx.asOf) }
    : { Status: status, Approval_Reason__c: approvalReasonText(requirement, note), Approved_By__c: "", Approved_Date__c: "" };
  return { mutations: [{ op: "update", object: "Quote", id: q.Id, changes }], requirement, status };
}

/** Approve (the approver's business role must cover the level); `reason` is required at administrator level */
export function approveQuoteMutations(ctx: QuoteContext & { role?: string }, quoteId: string, reason?: string): Mutation[] {
  const q = find(ctx, quoteId);
  const req = quoteApproval(ctx.data, q);
  if (ctx.role !== undefined && !canApprove(req.level, ctx.role)) throw new Error(`Needs ${req.approver.toLowerCase()} approval`);
  if (req.reasonRequired && !reason?.trim()) throw new Error("Enter a reason");
  // Keep the rep's justification from the submit, if any
  const base = approvalReasonText(req);
  const prior = q.Approval_Reason__c ?? "";
  const repNote = prior.startsWith(`${base}. `) ? prior.slice(base.length + 2) : "";
  const main = approvalReasonText(req, reason);
  const text = repNote ? `${main.replace(/[.\s]*$/, "")}. Requested: ${repNote}` : main;
  return [{ op: "update", object: "Quote", id: q.Id, changes: { Status: "Approved", Approval_Reason__c: text, Approved_By__c: ctx.userId, Approved_Date__c: stamp(ctx.asOf) } }];
}

export function rejectQuoteMutations(ctx: QuoteContext, quoteId: string, reason: string): Mutation[] {
  const q = find(ctx, quoteId);
  return [{ op: "update", object: "Quote", id: q.Id, changes: { Status: "Rejected", Approval_Reason__c: `Rejected: ${reason.trim() || "no reason given"}`, Approved_By__c: ctx.userId, Approved_Date__c: stamp(ctx.asOf) } }];
}

/** Take a submitted quote back to Draft */
export function recallQuoteMutations(ctx: QuoteContext, quoteId: string): Mutation[] {
  const q = find(ctx, quoteId);
  return [{ op: "update", object: "Quote", id: q.Id, changes: { Status: "Draft", ...CLEAR_APPROVAL } }];
}

/** Mark sent, and log a completed Email task on the account */
export function markSentMutations(ctx: QuoteContext, quoteId: string): Mutation[] {
  const q = find(ctx, quoteId);
  const book = ctx.data.pricebooks.find((b) => b.Id === q.Pricebook2Id);
  const t = quoteTotals(ctx.data, q);
  const ccy = book?.CurrencyIsoCode ?? "USD";
  const now = stamp(ctx.asOf);
  const task: Task = {
    Id: newId("Task"),
    Subject: `Sent quote ${q.QuoteNumber}`,
    Type: "Email",
    TaskSubtype: "Email",
    Status: "Completed",
    Priority: "Normal",
    ActivityDate: toISODate(ctx.asOf),
    WhoId: q.ContactId,
    WhatId: q.OpportunityId,
    AccountId: q.AccountId,
    OwnerId: ctx.userId,
    Description: `${q.Name}. First year ${fmtCurrency(t.firstYear, ccy)}, TCV ${fmtCurrency(t.tcv, ccy)}. Valid to ${q.ExpirationDate}.`,
    CreatedDate: now,
    CompletedDateTime: now,
  };
  return [
    { op: "update", object: "Quote", id: q.Id, changes: { Status: "Sent", Sent_Date__c: now } },
    { op: "create", object: "Task", record: task },
  ];
}

/**
 * Accept: the quote becomes Accepted, the opportunity Amount becomes the
 * quote's first-year total (before tax), and the opportunity's products are
 * replaced by the quote's lines (recurring lines at their annual net price).
 */
export function acceptQuoteMutations(ctx: QuoteContext, quoteId: string): Mutation[] {
  const q = find(ctx, quoteId);
  const lines = quoteLines(ctx.data, quoteId);
  const byId = productMap(ctx.data.products);
  const t = computeTotals(q, lines, byId);
  const now = stamp(ctx.asOf);
  const h = (q.Discount__c ?? 0) / 100;
  const out: Mutation[] = [{ op: "update", object: "Quote", id: q.Id, changes: { Status: "Accepted", Accepted_Date__c: now } }];
  const opp = ctx.data.opportunities.find((o) => o.Id === q.OpportunityId);
  if (!opp) return out;
  for (const li of ctx.data.lineItems.filter((l) => l.OpportunityId === opp.Id)) out.push({ op: "delete", object: "OpportunityLineItem", id: li.Id });
  for (const l of lines) {
    const recurring = isRecurring(byId.get(l.Product2Id));
    const unit = recurring ? round2(l.UnitPrice * (1 - h)) : l.UnitPrice;
    const record: OpportunityLineItem = {
      Id: newId("OpportunityLineItem"),
      OpportunityId: opp.Id,
      Product2Id: l.Product2Id,
      Quantity: l.Quantity,
      UnitPrice: unit,
      TotalPrice: round2(unit * l.Quantity),
      Description: recurring ? `Annual subscription, ${q.Contract_Term_Months__c}-month term (${q.QuoteNumber})` : `One-time (${q.QuoteNumber})`,
    };
    out.push({ op: "create", object: "OpportunityLineItem", record });
  }
  out.push({ op: "update", object: "Opportunity", id: opp.Id, changes: { Amount: t.firstYearBeforeTax, LastModifiedDate: now } });
  return out;
}

export function declineQuoteMutations(ctx: QuoteContext, quoteId: string): Mutation[] {
  const q = find(ctx, quoteId);
  return [{ op: "update", object: "Quote", id: q.Id, changes: { Status: "Declined" } }];
}

/** Opportunity → Closed Won today (as of), probability 100, forecast Closed */
export function closeWonMutations(ctx: QuoteContext, opportunityId: string): Mutation[] {
  const changes: Partial<Opportunity> = {
    StageName: "Closed Won",
    IsClosed: true,
    IsWon: true,
    Probability: 100,
    CloseDate: toISODate(ctx.asOf),
    ForecastCategoryName: "Closed",
    NextStep: "Implementation kickoff",
    LastModifiedDate: stamp(ctx.asOf),
  };
  return [{ op: "update", object: "Opportunity", id: opportunityId, changes }];
}

/** Opportunity → Closed Lost with a loss reason */
export function closeLostMutations(ctx: QuoteContext, opportunityId: string, lossReason: string): Mutation[] {
  const changes: Partial<Opportunity> = {
    StageName: "Closed Lost",
    IsClosed: true,
    IsWon: false,
    Probability: 0,
    CloseDate: toISODate(ctx.asOf),
    ForecastCategoryName: "Omitted",
    Loss_Reason__c: lossReason,
    LastModifiedDate: stamp(ctx.asOf),
  };
  return [{ op: "update", object: "Opportunity", id: opportunityId, changes }];
}

/** Revise: a new Draft copy (Q-01234-v2) with fresh dates; the original keeps its status */
export function reviseQuoteMutations(ctx: QuoteContext, quoteId: string): { id: string; quoteNumber: string; mutations: Mutation[] } {
  const q = find(ctx, quoteId);
  const id = newId("Quote");
  const quoteNumber = revisionNumber(ctx.data.quotes, q.QuoteNumber);
  const copy: Quote = {
    ...q,
    ...CLEAR_APPROVAL,
    Id: id,
    QuoteNumber: quoteNumber,
    Status: "Draft",
    OwnerId: ctx.userId,
    CreatedDate: stamp(ctx.asOf),
    ExpirationDate: toISODate(addDays(ctx.asOf, DEFAULT_VALID_DAYS)),
  };
  delete copy.Sent_Date__c;
  delete copy.Accepted_Date__c;
  delete copy.Approval_Reason__c;
  delete copy.Approved_By__c;
  delete copy.Approved_Date__c;
  const lines = quoteLines(ctx.data, quoteId).map((l): QuoteLineItem => ({ ...l, Id: newId("QuoteLineItem"), QuoteId: id }));
  return {
    id,
    quoteNumber,
    mutations: [{ op: "create", object: "Quote", record: copy }, ...lines.map((record): Mutation => ({ op: "create", object: "QuoteLineItem", record }))],
  };
}

/** Line and quote deletes (for remove() cascade) */
export function deleteQuoteCascade(data: Pick<DataSnapshot, "quoteLineItems">, quoteId: string): Mutation[] {
  return quoteLines(data, quoteId).map((l): Mutation => ({ op: "delete", object: "QuoteLineItem", id: l.Id }));
}

export interface BoardCheck {
  /** Co-op account, or the deal is in Board Approval */
  needsBoard: boolean;
  meeting: Date | null;
  /** The quote expires before the next board meeting */
  expiresBefore: boolean;
}

export function boardCheck(data: Pick<DataSnapshot, "accounts" | "opportunities">, q: Quote, asOf: Date): BoardCheck {
  const a = data.accounts.find((x) => x.Id === q.AccountId);
  const o = data.opportunities.find((x) => x.Id === q.OpportunityId);
  const needsBoard = a?.Segment__c === "Multi-Location Co-op" || o?.StageName === "Board Approval";
  const meeting = needsBoard ? nextBoardMeeting(a?.Board_Meeting_Months__c, asOf) : null;
  return { needsBoard, meeting, expiresBefore: !!meeting && q.ExpirationDate < toISODate(meeting) };
}

/** Latest date anything happened to the quote */
export function quoteUpdated(q: Quote): string {
  return [q.CreatedDate, q.Approved_Date__c, q.Sent_Date__c, q.Accepted_Date__c].filter(Boolean).sort().at(-1)!;
}
