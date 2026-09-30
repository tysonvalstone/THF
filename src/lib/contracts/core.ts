/**
 * Contracts (pure): building a contract from an accepted quote, key-term
 * math, clause editing with Legal approval, the signature lifecycle,
 * date-driven status changes and alerts. Every change is returned as
 * Salesforce-style mutations; the UI commits them with useCrud().run and the
 * Demo Mode walkthrough / lifecycle automation can call them directly.
 *
 *   Draft → Legal Review (non-standard clause, or on request)
 *   Draft | Legal Review → Sent for Signature (nothing pending) → Signed
 *   Signed → Active on the Start Date → Expired after the End Date
 *     (auto-renew instead extends the term by 12 months with the price increase)
 *   Signed | Active → Terminated
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { ApprovalRequest, Clause, Contract, ContractClause, ContractStatus, Task } from "@/types/salesforce";
import type { AppRole } from "@/lib/supabase/config";
import { can } from "@/lib/roles";
import { requestApproval } from "@/lib/approvals";
import { addDays, addMonths, diffDays, parseDate, toISODate } from "@/lib/dates";
import { stamp } from "@/lib/quotes/build";
import { productMap, isRecurring } from "@/lib/quotes/catalog";
import { computeTotals, round2 } from "@/lib/quotes/pricing";
import { quoteLines } from "@/lib/quotes/lifecycle";
import { CLAUSE_KEYS, CLAUSE_TEMPLATES, clauseSeedId } from "./library";

export interface ContractContext {
  data: DataSnapshot;
  /** The app's "today" */
  asOf: Date;
  /** Acting user (Salesforce User Id) */
  userId: string;
  /** Business role of the acting user (decides self-approval) */
  role?: AppRole;
}

/** Statuses whose key terms and clauses can still be edited */
export const EDITABLE_CONTRACT: ContractStatus[] = ["Draft", "Legal Review"];
/** Signed paper in force (or about to be) */
export const LIVE_CONTRACT: ContractStatus[] = ["Signed", "Active"];
export const DEFAULT_NOTICE_DAYS = 60;
export const DEFAULT_PRICE_INCREASE = 5;
export const PRICE_INCREASE_CAP = 5;
/** Alert windows */
export const NOTICE_ALERT_DAYS = 60;
export const EXPIRING_ALERT_DAYS = 90;
export const UNSIGNED_ALERT_DAYS = 14;

const WITHDRAWN = "Withdrawn";

/* ------------------------------------------------------------ helpers */

function find(data: DataSnapshot, id: string): Contract {
  const c = data.contracts.find((x) => x.Id === id);
  if (!c) throw new Error(`Contract ${id} not found`);
  return c;
}

/** "CTR-01001": one more than the highest existing number */
export function nextContractNumber(contracts: Pick<Contract, "ContractNumber">[]): string {
  const max = contracts.reduce((m, c) => Math.max(m, Number(/^CTR-(\d+)/.exec(c.ContractNumber)?.[1] ?? 0)), 1000);
  return `CTR-${String(max + 1).padStart(5, "0")}`;
}

/** Last day of the term: start + term months − 1 day */
export function endDateFor(start: string, termMonths: number): string {
  return toISODate(addDays(addMonths(parseDate(start), Math.max(1, Math.round(termMonths))), -1));
}

/** ARR × term years + one-time */
export function tcvFor(arr: number, oneTime: number, termMonths: number): number {
  return round2((arr * termMonths) / 12 + oneTime);
}

/** Last day either side can give notice: End Date − notice days */
export function noticeDeadline(c: Pick<Contract, "EndDate" | "NoticeDays">): string {
  return toISODate(addDays(parseDate(c.EndDate), -Math.max(0, c.NoticeDays || 0)));
}

const today = (asOf: Date) => toISODate(asOf);
const daysUntil = (iso: string, asOf: Date) => diffDays(parseDate(iso.slice(0, 10)), parseDate(today(asOf)));

export function accountNameFor(data: Pick<DataSnapshot, "accounts">, c: Pick<Contract, "AccountId">): string {
  return data.accounts.find((a) => a.Id === c.AccountId)?.Name ?? "";
}

/** "CTR-01001 · Prairie Gold Co-op" (approval requests, audit) */
export function contractLabel(data: Pick<DataSnapshot, "accounts">, c: Pick<Contract, "ContractNumber" | "AccountId">): string {
  const a = accountNameFor(data, c);
  return a ? `${c.ContractNumber} · ${a}` : c.ContractNumber;
}

/* ------------------------------------------------------------ clauses */

/** Library clause for a template key (seed Id first, then by name) */
export function libraryClause(data: Pick<DataSnapshot, "clauses">, key: string): Clause | undefined {
  const id = clauseSeedId(key);
  const t = CLAUSE_TEMPLATES.find((x) => x.key === key);
  return data.clauses.find((c) => c.Id === id) ?? (t ? data.clauses.find((c) => c.Name === t.Name) : undefined);
}

const libraryOrder = (id?: string) => {
  const i = id ? CLAUSE_TEMPLATES.findIndex((t) => clauseSeedId(t.key) === id) : -1;
  return i < 0 ? 999 : i;
};

/** Active default clauses for a new contract (DPA / auto-renew / harvest terms follow the key terms) */
export function defaultClauses(data: Pick<DataSnapshot, "clauses">, opts: { dpa: boolean; autoRenew: boolean; harvestTerms?: boolean }): Clause[] {
  const dpa = libraryClause(data, CLAUSE_KEYS.dpa)?.Id;
  const auto = libraryClause(data, CLAUSE_KEYS.autoRenew)?.Id;
  const harvest = libraryClause(data, CLAUSE_KEYS.harvest);
  const out = data.clauses.filter((c) => c.IsActive && c.IsDefault && (opts.dpa || c.Id !== dpa) && (opts.autoRenew || c.Id !== auto));
  if (opts.harvestTerms && harvest?.IsActive && !out.includes(harvest)) out.push(harvest);
  return out.sort((a, b) => libraryOrder(a.Id) - libraryOrder(b.Id));
}

export function contractClauseFrom(contractId: string, clause: Clause, sortOrder: number, id = newId("ContractClause")): ContractClause {
  return {
    Id: id,
    ContractId: contractId,
    ClauseId: clause.Id,
    Name: clause.Name,
    Category: clause.Category,
    Body: clause.Body,
    Standard: true,
    ApprovalStatus: "Not required",
    SortOrder: sortOrder,
  };
}

export function clausesFor(data: Pick<DataSnapshot, "contractClauses">, contractId: string): ContractClause[] {
  return data.contractClauses.filter((c) => c.ContractId === contractId).sort((a, b) => a.SortOrder - b.SortOrder);
}

/** Library clauses a contract doesn't have yet */
export function addableClauses(data: Pick<DataSnapshot, "clauses" | "contractClauses">, contractId: string): Clause[] {
  const have = new Set(clausesFor(data, contractId).map((c) => c.ClauseId));
  return data.clauses.filter((c) => c.IsActive && !have.has(c.Id)).sort((a, b) => libraryOrder(a.Id) - libraryOrder(b.Id));
}

/** Contracts using a library clause (a used clause can't be deleted) */
export function clauseUsage(data: Pick<DataSnapshot, "contractClauses">, clauseId: string): number {
  return new Set(data.contractClauses.filter((c) => c.ClauseId === clauseId).map((c) => c.ContractId)).size;
}

/* ------------------------------------------------------- order form */

export interface OrderLine {
  key: string;
  productId?: string;
  name: string;
  quantity: number;
  listPrice: number;
  /** Effective discount, percent */
  discount: number;
  unitPrice: number;
  total: number;
  recurring: boolean;
}

/**
 * Order Form lines: the quote's lines (header discount applied to recurring
 * lines), else the opportunity's products, else one line per fee type.
 */
export function orderFormLines(data: DataSnapshot, c: Contract): OrderLine[] {
  const products = productMap(data.products);
  const q = c.QuoteId ? data.quotes.find((x) => x.Id === c.QuoteId) : undefined;
  if (q) {
    const lines = quoteLines(data, q.Id);
    if (lines.length) {
      const h = (q.Discount__c ?? 0) / 100;
      return lines.map((l) => {
        const recurring = isRecurring(products.get(l.Product2Id) ?? { Pricing_Unit__c: "per year" });
        const unit = recurring ? round2(l.UnitPrice * (1 - h)) : l.UnitPrice;
        return {
          key: l.Id,
          productId: l.Product2Id,
          name: products.get(l.Product2Id)?.Name ?? l.Product2Id,
          quantity: l.Quantity,
          listPrice: l.ListPrice,
          discount: l.ListPrice ? Math.max(0, Math.round((1 - unit / l.ListPrice) * 1000) / 10) : 0,
          unitPrice: unit,
          total: round2(unit * l.Quantity),
          recurring,
        };
      });
    }
  }
  const oppLines = c.OpportunityId ? data.lineItems.filter((l) => l.OpportunityId === c.OpportunityId) : [];
  if (oppLines.length) {
    return oppLines.map((l) => {
      const p = products.get(l.Product2Id);
      const list = p?.List_Price__c ?? l.UnitPrice;
      return {
        key: l.Id,
        productId: l.Product2Id,
        name: p?.Name ?? l.Product2Id,
        quantity: l.Quantity,
        listPrice: list,
        discount: list ? Math.max(0, Math.round((1 - l.UnitPrice / list) * 1000) / 10) : 0,
        unitPrice: l.UnitPrice,
        total: l.TotalPrice,
        recurring: isRecurring(p ?? { Pricing_Unit__c: "per year" }),
      };
    });
  }
  const out: OrderLine[] = [];
  if (c.ARR) out.push({ key: "arr", name: "Annual subscription", quantity: 1, listPrice: c.ARR, discount: 0, unitPrice: c.ARR, total: c.ARR, recurring: true });
  if (c.OneTimeFees) out.push({ key: "one", name: "Implementation and onboarding", quantity: 1, listPrice: c.OneTimeFees, discount: 0, unitPrice: c.OneTimeFees, total: c.OneTimeFees, recurring: false });
  return out;
}

/** The person who signs for the customer: the quote's contact, else the account's economic buyer */
export function customerSignerFor(data: DataSnapshot, c: Contract) {
  const q = c.QuoteId ? data.quotes.find((x) => x.Id === c.QuoteId) : undefined;
  const byQuote = q?.ContactId ? data.contacts.find((x) => x.Id === q.ContactId) : undefined;
  return byQuote ?? data.contacts.find((x) => x.AccountId === c.AccountId && x.Buying_Role__c === "Economic Buyer") ?? data.contacts.find((x) => x.AccountId === c.AccountId);
}

/* ---------------------------------------------------------- creation */

function newContractRecord(ctx: ContractContext, base: Omit<Contract, "Id" | "ContractNumber" | "Status" | "CreatedDate" | "EndDate" | "TCV" | "NonStandard">): Contract {
  return {
    ...base,
    Id: newId("Contract"),
    ContractNumber: nextContractNumber(ctx.data.contracts),
    Status: "Draft",
    CreatedDate: stamp(ctx.asOf),
    EndDate: endDateFor(base.StartDate, base.TermMonths),
    TCV: tcvFor(base.ARR, base.OneTimeFees, base.TermMonths),
    NonStandard: false,
  };
}

function withClauses(ctx: ContractContext, c: Contract): Mutation[] {
  const clauses = defaultClauses(ctx.data, { dpa: c.DPA, autoRenew: c.AutoRenew, harvestTerms: c.HarvestTerms });
  return [{ op: "create", object: "Contract", record: c }, ...clauses.map((cl, i): Mutation => ({ op: "create", object: "ContractClause", record: contractClauseFrom(c.Id, cl, i + 1) }))];
}

/** The contract created from a quote, if any */
export function contractForQuote(data: Pick<DataSnapshot, "contracts">, quoteId: string): Contract | undefined {
  return data.contracts.find((c) => c.QuoteId === quoteId);
}

/**
 * One click from an accepted quote: a Draft contract whose Order Form comes
 * from the quote (customer, products and prices, term, start date, billing
 * frequency, payment terms, currency; ARR = recurring total, one-time, TCV)
 * with the library's default clauses. A quote that already has a contract
 * returns that contract and no mutations.
 */
export function contractFromQuoteMutations(
  ctx: ContractContext,
  quoteId: string,
  opts: { ownerId?: string; noticeDays?: number; priceIncreasePct?: number; autoRenew?: boolean; dpa?: boolean } = {},
): { contractId: string; mutations: Mutation[] } {
  const q = ctx.data.quotes.find((x) => x.Id === quoteId);
  if (!q) throw new Error(`Quote ${quoteId} not found`);
  const existing = contractForQuote(ctx.data, quoteId);
  if (existing) return { contractId: existing.Id, mutations: [] };
  const lines = quoteLines(ctx.data, quoteId);
  const t = computeTotals(q, lines, productMap(ctx.data.products));
  const a = ctx.data.accounts.find((x) => x.Id === q.AccountId);
  const ccy = ctx.data.pricebooks.find((b) => b.Id === q.Pricebook2Id)?.CurrencyIsoCode ?? (a?.BillingCountry === "Canada" ? "CAD" : "USD");
  const coop = a?.Segment__c === "Multi-Location Co-op";
  const c = newContractRecord(ctx, {
    Name: `${a?.Name ?? q.Name} · ${q.Contract_Term_Months__c}-month subscription`,
    AccountId: q.AccountId,
    OpportunityId: q.OpportunityId,
    QuoteId: q.Id,
    OwnerId: opts.ownerId ?? q.OwnerId,
    StartDate: q.Start_Date__c,
    TermMonths: q.Contract_Term_Months__c,
    AutoRenew: opts.autoRenew ?? true,
    NoticeDays: opts.noticeDays ?? (coop ? 90 : DEFAULT_NOTICE_DAYS),
    PriceIncreasePct: opts.priceIncreasePct ?? DEFAULT_PRICE_INCREASE,
    PaymentTerms: q.Payment_Terms__c,
    HarvestTerms: false,
    BillingFrequency: q.Billing_Frequency__c,
    ARR: t.arr,
    OneTimeFees: t.oneTime,
    CurrencyIsoCode: ccy,
    DPA: opts.dpa ?? true,
  });
  return { contractId: c.Id, mutations: withClauses(ctx, c) };
}

export interface BlankContractInput {
  accountId: string;
  opportunityId?: string;
  startDate: string;
  termMonths: number;
  arr: number;
  oneTime?: number;
  billingFrequency?: Contract["BillingFrequency"];
  paymentTerms?: Contract["PaymentTerms"];
  autoRenew?: boolean;
  noticeDays?: number;
  priceIncreasePct?: number;
  dpa?: boolean;
  ownerId?: string;
}

/** A Draft contract typed in by hand (no quote) */
export function blankContractMutations(ctx: ContractContext, input: BlankContractInput): { contractId: string; mutations: Mutation[] } {
  const a = ctx.data.accounts.find((x) => x.Id === input.accountId);
  if (!a) throw new Error("Choose an account");
  const c = newContractRecord(ctx, {
    Name: `${a.Name} · ${input.termMonths}-month subscription`,
    AccountId: a.Id,
    OpportunityId: input.opportunityId || undefined,
    OwnerId: input.ownerId ?? ctx.userId,
    StartDate: input.startDate,
    TermMonths: input.termMonths,
    AutoRenew: input.autoRenew ?? true,
    NoticeDays: input.noticeDays ?? (a.Segment__c === "Multi-Location Co-op" ? 90 : DEFAULT_NOTICE_DAYS),
    PriceIncreasePct: input.priceIncreasePct ?? DEFAULT_PRICE_INCREASE,
    PaymentTerms: input.paymentTerms ?? "Net 30",
    HarvestTerms: false,
    BillingFrequency: input.billingFrequency ?? "Annual",
    ARR: round2(input.arr || 0),
    OneTimeFees: round2(input.oneTime || 0),
    CurrencyIsoCode: a.BillingCountry === "Canada" ? "CAD" : "USD",
    DPA: input.dpa ?? true,
  });
  return { contractId: c.Id, mutations: withClauses(ctx, c) };
}

/** Clause and pending-approval deletes for removing a Draft contract */
export function deleteContractCascade(data: DataSnapshot, contractId: string): Mutation[] {
  return clausesFor(data, contractId).map((c): Mutation => ({ op: "delete", object: "ContractClause", id: c.Id }));
}

/* ------------------------------------------------------- key terms */

export type TermChanges = Partial<
  Pick<Contract, "Name" | "OwnerId" | "StartDate" | "TermMonths" | "AutoRenew" | "NoticeDays" | "PriceIncreasePct" | "PaymentTerms" | "BillingFrequency" | "DPA" | "ARR" | "OneTimeFees">
>;

function assertEditable(c: Contract) {
  if (!EDITABLE_CONTRACT.includes(c.Status)) throw new Error(`${c.ContractNumber} is ${c.Status}; terms are locked`);
}

/** Adds or removes the library clause that follows a key-term toggle */
function toggleClause(data: DataSnapshot, c: Contract, key: string, on: boolean): Mutation[] {
  const lib = libraryClause(data, key);
  if (!lib) return [];
  const rows = clausesFor(data, c.Id);
  const row = rows.find((r) => r.ClauseId === lib.Id);
  if (on && !row) {
    const order = rows.reduce((m, r) => Math.max(m, r.SortOrder), 0) + 1;
    return [{ op: "create", object: "ContractClause", record: contractClauseFrom(c.Id, lib, order) }];
  }
  if (!on && row) return [{ op: "delete", object: "ContractClause", id: row.Id }];
  return [];
}

/** Key-term edits (Draft / Legal Review): End Date and TCV follow; DPA and auto-renew add or drop their clauses */
export function updateTermsMutations(ctx: ContractContext, contractId: string, changes: TermChanges): Mutation[] {
  const c = find(ctx.data, contractId);
  assertEditable(c);
  const next = { ...c, ...changes };
  if (next.TermMonths < 1) throw new Error("Term must be at least 1 month");
  if (next.PriceIncreasePct < 0 || next.PriceIncreasePct > PRICE_INCREASE_CAP) throw new Error(`Price increase must be 0–${PRICE_INCREASE_CAP}%`);
  const derived: Partial<Contract> = {
    ...changes,
    EndDate: endDateFor(next.StartDate, next.TermMonths),
    TCV: tcvFor(next.ARR, next.OneTimeFees, next.TermMonths),
  };
  return [
    { op: "update", object: "Contract", id: c.Id, changes: derived },
    ...(changes.DPA !== undefined && changes.DPA !== c.DPA ? toggleClause(ctx.data, c, CLAUSE_KEYS.dpa, changes.DPA) : []),
    ...(changes.AutoRenew !== undefined && changes.AutoRenew !== c.AutoRenew ? toggleClause(ctx.data, c, CLAUSE_KEYS.autoRenew, changes.AutoRenew) : []),
  ];
}

/* ------------------------------------------------------- approvals */

/** Latest approval request of a type for a contract */
export function latestApproval(data: Pick<DataSnapshot, "approvals">, contractId: string, type: ApprovalRequest["Type"]): ApprovalRequest | undefined {
  return data.approvals
    .filter((a) => a.RecordId === contractId && a.Type === type)
    .sort((a, b) => b.RequestedDate.localeCompare(a.RequestedDate))[0];
}

export function pendingApproval(data: Pick<DataSnapshot, "approvals">, contractId: string, type: ApprovalRequest["Type"]): ApprovalRequest | undefined {
  const a = latestApproval(data, contractId, type);
  return a?.Status === "Pending" ? a : undefined;
}

function withdraw(req: ApprovalRequest, ctx: ContractContext, why: string): Mutation {
  return {
    op: "update",
    object: "ApprovalRequest",
    id: req.Id,
    changes: req.Status === "Pending" ? { Status: "Rejected", DecidedById: ctx.userId, DecidedDate: stamp(ctx.asOf), DecisionNote: `${WITHDRAWN}: ${why}` } : { DecisionNote: `${WITHDRAWN}: ${why}` },
  };
}

const clauseDetail = (rows: ContractClause[]) => `Non-standard ${rows.length === 1 ? "clause" : "clauses"}: ${rows.map((r) => r.Name).join(", ")}`;

/**
 * After clause rows change: the contract's NonStandard flag, a pending Legal
 * request for unapproved edits (or withdrawn when none remain), and the
 * status (Draft → Legal Review when approval is needed; back to Draft when
 * nothing non-standard is left).
 */
function reconcile(ctx: ContractContext, c: Contract, rowsAfter: ContractClause[], opts: { request?: boolean } = {}): Mutation[] {
  const out: Mutation[] = [];
  const nonStandard = rowsAfter.some((r) => !r.Standard);
  const pending = rowsAfter.filter((r) => r.ApprovalStatus === "Pending");
  const open = pendingApproval(ctx.data, c.Id, "Non-standard clause");
  const changes: Partial<Contract> = {};
  if (nonStandard !== c.NonStandard) changes.NonStandard = nonStandard;
  if (pending.length && opts.request) {
    const r = requestApproval({
      type: "Non-standard clause",
      object: "Contract",
      recordId: c.Id,
      recordName: contractLabel(ctx.data, c),
      approverRole: "legal",
      detail: clauseDetail(pending),
      requestedById: ctx.userId,
      asOf: ctx.asOf,
      data: ctx.data,
    });
    out.push(...r.mutations);
    if (c.Status === "Draft") changes.Status = "Legal Review";
  } else if (!pending.length && open && !opts.request) {
    out.push(withdraw(open, ctx, "no clauses awaiting review"));
  }
  if (!nonStandard && c.Status === "Legal Review" && !pending.length) changes.Status = "Draft";
  if (Object.keys(changes).length) out.unshift({ op: "update", object: "Contract", id: c.Id, changes });
  return out;
}

function findRow(data: DataSnapshot, rowId: string): { row: ContractClause; contract: Contract; rows: ContractClause[] } {
  const row = data.contractClauses.find((r) => r.Id === rowId);
  if (!row) throw new Error("Clause not found");
  const contract = find(data, row.ContractId);
  return { row, contract, rows: clausesFor(data, contract.Id) };
}

const mayApproveClauses = (ctx: ContractContext) => !!ctx.role && can(ctx.role, "approve:clauses");

/**
 * Edit a clause's text. Different from the library → non-standard: Legal's
 * own edits are approved at once; anyone else's go to Legal (the contract
 * moves to Legal Review). Text equal to the library reverts it to standard.
 */
export function editClauseMutations(ctx: ContractContext, rowId: string, body: string, name?: string): Mutation[] {
  const { row, contract, rows } = findRow(ctx.data, rowId);
  assertEditable(contract);
  const lib = row.ClauseId ? ctx.data.clauses.find((c) => c.Id === row.ClauseId) : undefined;
  const text = body.trim();
  if (!text) throw new Error("Clause text is required");
  if (lib && text === lib.Body.trim() && (!name || name === lib.Name)) return revertClauseMutations(ctx, rowId);
  const approved = mayApproveClauses(ctx);
  const changes: Partial<ContractClause> = {
    Body: text,
    ...(name ? { Name: name } : {}),
    Standard: false,
    ApprovalStatus: approved ? "Approved" : "Pending",
    ApprovedById: approved ? ctx.userId : "",
  };
  const after = rows.map((r) => (r.Id === rowId ? { ...r, ...changes } : r));
  return [{ op: "update", object: "ContractClause", id: rowId, changes }, ...reconcile(ctx, contract, after, { request: !approved })];
}

/** Put the library text back */
export function revertClauseMutations(ctx: ContractContext, rowId: string): Mutation[] {
  const { row, contract, rows } = findRow(ctx.data, rowId);
  assertEditable(contract);
  const lib = row.ClauseId ? ctx.data.clauses.find((c) => c.Id === row.ClauseId) : undefined;
  if (!lib) throw new Error("This clause isn't from the library");
  const changes: Partial<ContractClause> = { Body: lib.Body, Name: lib.Name, Category: lib.Category, Standard: true, ApprovalStatus: "Not required", ApprovedById: "" };
  const after = rows.map((r) => (r.Id === rowId ? { ...r, ...changes } : r));
  return [{ op: "update", object: "ContractClause", id: rowId, changes }, ...reconcile(ctx, contract, after)];
}

export function addClauseMutations(ctx: ContractContext, contractId: string, clauseId: string): Mutation[] {
  const c = find(ctx.data, contractId);
  assertEditable(c);
  const lib = ctx.data.clauses.find((x) => x.Id === clauseId);
  if (!lib) throw new Error("Clause not found");
  const order = clausesFor(ctx.data, contractId).reduce((m, r) => Math.max(m, r.SortOrder), 0) + 1;
  return [{ op: "create", object: "ContractClause", record: contractClauseFrom(contractId, lib, order) }];
}

export function removeClauseMutations(ctx: ContractContext, rowId: string): Mutation[] {
  const { contract, rows } = findRow(ctx.data, rowId);
  assertEditable(contract);
  return [{ op: "delete", object: "ContractClause", id: rowId }, ...reconcile(ctx, contract, rows.filter((r) => r.Id !== rowId))];
}

/** Send to Legal (no-op request detail when nothing is non-standard: Legal reviews the whole contract) */
export function submitLegalReviewMutations(ctx: ContractContext, contractId: string, note?: string): Mutation[] {
  const c = find(ctx.data, contractId);
  if (c.Status !== "Draft") throw new Error(`${c.ContractNumber} is ${c.Status}`);
  const pending = clausesFor(ctx.data, c.Id).filter((r) => r.ApprovalStatus === "Pending" || r.ApprovalStatus === "Rejected");
  const r = requestApproval({
    type: "Non-standard clause",
    object: "Contract",
    recordId: c.Id,
    recordName: contractLabel(ctx.data, c),
    approverRole: "legal",
    detail: pending.length ? clauseDetail(pending) : `Contract review requested${note ? `: ${note}` : ""}`,
    requestedById: ctx.userId,
    asOf: ctx.asOf,
    data: ctx.data,
  });
  const reset = pending.filter((p) => p.ApprovalStatus === "Rejected").map((p): Mutation => ({ op: "update", object: "ContractClause", id: p.Id, changes: { ApprovalStatus: "Pending" } }));
  return [{ op: "update", object: "Contract", id: c.Id, changes: { Status: "Legal Review" } }, ...reset, ...r.mutations];
}

function decideRequest(req: ApprovalRequest, decision: "Approved" | "Rejected", ctx: ContractContext, note?: string): Mutation {
  return { op: "update", object: "ApprovalRequest", id: req.Id, changes: { Status: decision, DecidedById: ctx.userId, DecidedDate: stamp(ctx.asOf), DecisionNote: note } };
}

/**
 * Legal decides one clause inline. When no clause is left pending, the
 * contract's Legal request is decided too (Rejected if any clause was), and
 * a rejection sends the contract back to Draft.
 */
export function decideClauseMutations(ctx: ContractContext, rowId: string, decision: "Approved" | "Rejected", note?: string): Mutation[] {
  if (ctx.role !== undefined && !mayApproveClauses(ctx)) throw new Error("Only Legal can approve clauses");
  const { row, contract, rows } = findRow(ctx.data, rowId);
  if (row.ApprovalStatus !== "Pending") throw new Error("This clause isn't awaiting approval");
  const changes: Partial<ContractClause> = { ApprovalStatus: decision, ApprovedById: ctx.userId };
  const out: Mutation[] = [{ op: "update", object: "ContractClause", id: rowId, changes }];
  const after = rows.map((r) => (r.Id === rowId ? { ...r, ...changes } : r));
  if (!after.some((r) => r.ApprovalStatus === "Pending")) {
    const anyRejected = after.some((r) => r.ApprovalStatus === "Rejected");
    const req = pendingApproval(ctx.data, contract.Id, "Non-standard clause");
    if (req) out.push(decideRequest(req, anyRejected ? "Rejected" : "Approved", ctx, note));
    if (anyRejected && contract.Status === "Legal Review") out.push({ op: "update", object: "Contract", id: contract.Id, changes: { Status: "Draft" } });
  }
  return out;
}

/** Legal decides the whole review (all pending clauses at once) */
export function decideLegalReviewMutations(ctx: ContractContext, contractId: string, decision: "Approved" | "Rejected", note?: string): Mutation[] {
  if (ctx.role !== undefined && !mayApproveClauses(ctx)) throw new Error("Only Legal can approve contracts");
  const c = find(ctx.data, contractId);
  const out: Mutation[] = clausesFor(ctx.data, c.Id)
    .filter((r) => r.ApprovalStatus === "Pending")
    .map((r): Mutation => ({ op: "update", object: "ContractClause", id: r.Id, changes: { ApprovalStatus: decision, ApprovedById: ctx.userId } }));
  const req = pendingApproval(ctx.data, c.Id, "Non-standard clause");
  if (req) out.push(decideRequest(req, decision, ctx, note));
  if (decision === "Rejected" && c.Status === "Legal Review") out.push({ op: "update", object: "Contract", id: c.Id, changes: { Status: "Draft" } });
  return out;
}

/**
 * Harvest payment terms (annual invoice due Dec 15 after harvest). Turning
 * them on needs Finance: Finance and admins apply it at once, anyone else
 * creates a Payment terms request and the change applies when approved.
 */
export function harvestTermsMutations(ctx: ContractContext, contractId: string, on: boolean): { mutations: Mutation[]; pending: boolean } {
  const c = find(ctx.data, contractId);
  assertEditable(c);
  const open = latestApproval(ctx.data, c.Id, "Payment terms");
  if (!on) {
    const out: Mutation[] = [];
    if (c.HarvestTerms) out.push({ op: "update", object: "Contract", id: c.Id, changes: { HarvestTerms: false } }, ...toggleClause(ctx.data, c, CLAUSE_KEYS.harvest, false));
    if (open && !open.DecisionNote?.startsWith(WITHDRAWN) && open.Status !== "Rejected") out.push(withdraw(open, ctx, "harvest terms turned off"));
    return { mutations: out, pending: false };
  }
  if (c.HarvestTerms) return { mutations: [], pending: false };
  if (ctx.role && can(ctx.role, "approve:payment-terms")) {
    return { mutations: [{ op: "update", object: "Contract", id: c.Id, changes: { HarvestTerms: true } }, ...toggleClause(ctx.data, c, CLAUSE_KEYS.harvest, true)], pending: false };
  }
  const r = requestApproval({
    type: "Payment terms",
    object: "Contract",
    recordId: c.Id,
    recordName: contractLabel(ctx.data, c),
    approverRole: "finance",
    detail: `Harvest payment terms: annual invoice due Dec 15 after harvest (${c.PaymentTerms} otherwise)`,
    requestedById: ctx.userId,
    asOf: ctx.asOf,
    data: ctx.data,
  });
  return { mutations: r.mutations, pending: true };
}

/** Finance decides a pending harvest-terms request inline */
export function decidePaymentTermsMutations(ctx: ContractContext, contractId: string, decision: "Approved" | "Rejected", note?: string): Mutation[] {
  if (ctx.role !== undefined && !can(ctx.role, "approve:payment-terms")) throw new Error("Only Finance can approve payment terms");
  const c = find(ctx.data, contractId);
  const req = pendingApproval(ctx.data, c.Id, "Payment terms");
  if (!req) throw new Error("Nothing awaiting Finance");
  const out: Mutation[] = [decideRequest(req, decision, ctx, note)];
  if (decision === "Approved" && !c.HarvestTerms) out.push({ op: "update", object: "Contract", id: c.Id, changes: { HarvestTerms: true } }, ...toggleClause(ctx.data, c, CLAUSE_KEYS.harvest, true));
  return out;
}

/**
 * Applies decisions made elsewhere (the header Approvals inbox) to the
 * contract: approved or rejected clauses, a rejected review back to Draft,
 * approved harvest terms switched on. Idempotent: returns [] once applied.
 */
export function contractApprovalEffects(data: DataSnapshot, contractId: string): Mutation[] {
  const c = data.contracts.find((x) => x.Id === contractId);
  if (!c) return [];
  const out: Mutation[] = [];
  const legal = latestApproval(data, c.Id, "Non-standard clause");
  if (legal && legal.Status !== "Pending" && !legal.DecisionNote?.startsWith(WITHDRAWN)) {
    const pending = clausesFor(data, c.Id).filter((r) => r.ApprovalStatus === "Pending");
    for (const r of pending) out.push({ op: "update", object: "ContractClause", id: r.Id, changes: { ApprovalStatus: legal.Status, ApprovedById: legal.DecidedById ?? "" } });
    if (pending.length && legal.Status === "Rejected" && c.Status === "Legal Review") out.push({ op: "update", object: "Contract", id: c.Id, changes: { Status: "Draft" } });
  }
  const pay = latestApproval(data, c.Id, "Payment terms");
  if (pay?.Status === "Approved" && !pay.DecisionNote?.startsWith(WITHDRAWN) && !c.HarvestTerms && EDITABLE_CONTRACT.includes(c.Status)) {
    out.push({ op: "update", object: "Contract", id: c.Id, changes: { HarvestTerms: true } }, ...toggleClause(data, c, CLAUSE_KEYS.harvest, true));
  }
  return out;
}

/* ------------------------------------------------------- signature */

/** Why a contract can't go out for signature yet ([] when it can) */
export function signatureBlockers(data: DataSnapshot, c: Contract): string[] {
  const out: string[] = [];
  if (!EDITABLE_CONTRACT.includes(c.Status)) out.push(`Contract is ${c.Status}`);
  const rows = clausesFor(data, c.Id);
  const pending = rows.filter((r) => r.ApprovalStatus === "Pending").length;
  const rejected = rows.filter((r) => r.ApprovalStatus === "Rejected").length;
  if (pending) out.push(`${pending} ${pending === 1 ? "clause" : "clauses"} awaiting Legal`);
  if (rejected) out.push(`${rejected} rejected ${rejected === 1 ? "clause" : "clauses"}: revert or edit`);
  if (!pending && pendingApproval(data, c.Id, "Non-standard clause")) out.push("Awaiting Legal review");
  if (pendingApproval(data, c.Id, "Payment terms")) out.push("Harvest terms awaiting Finance");
  if (!rows.length) out.push("No clauses");
  if (!(c.ARR > 0) && !(c.OneTimeFees > 0)) out.push("No fees on the Order Form");
  return out;
}

function task(ctx: ContractContext, c: Contract, subject: string, description: string, type: "Email" | "Task" = "Task"): Task {
  const now = stamp(ctx.asOf);
  return {
    Id: newId("Task"),
    Subject: subject,
    Type: type === "Email" ? "Email" : "Other",
    TaskSubtype: type,
    Status: "Completed",
    Priority: "Normal",
    ActivityDate: toISODate(ctx.asOf),
    WhatId: c.OpportunityId ?? c.AccountId,
    AccountId: c.AccountId,
    OwnerId: ctx.userId,
    Description: description,
    CreatedDate: now,
    CompletedDateTime: now,
  };
}

export function sendForSignatureMutations(ctx: ContractContext, contractId: string): Mutation[] {
  const c = find(ctx.data, contractId);
  const blockers = signatureBlockers(ctx.data, c);
  if (blockers.length) throw new Error(blockers[0]);
  const signer = customerSignerFor(ctx.data, c);
  return [
    { op: "update", object: "Contract", id: c.Id, changes: { Status: "Sent for Signature", SentForSignatureDate: stamp(ctx.asOf) } },
    { op: "create", object: "Task", record: task(ctx, c, `Sent contract ${c.ContractNumber} for signature`, `${c.Name}${signer ? `, to ${signer.Name}` : ""}.`, "Email") },
  ];
}

/** Take a contract out for signature back to Draft */
export function recallSignatureMutations(ctx: ContractContext, contractId: string): Mutation[] {
  const c = find(ctx.data, contractId);
  if (c.Status !== "Sent for Signature") throw new Error(`${c.ContractNumber} is ${c.Status}`);
  return [{ op: "update", object: "Contract", id: c.Id, changes: { Status: "Draft", SentForSignatureDate: "" } }];
}

export interface SignatureInput {
  name: string;
  title: string;
  /** PNG data URL of the drawn signature */
  image: string;
  /** ISO timestamp (default: now on the app date) */
  signedAt?: string;
}

/** Simulated e-signature: Signed, with the drawn signature, name, title and timestamp (Active at once when the Start Date has passed) */
export function signContractMutations(ctx: ContractContext, contractId: string, sig: SignatureInput): Mutation[] {
  const c = find(ctx.data, contractId);
  if (c.Status !== "Sent for Signature") throw new Error(`${c.ContractNumber} isn't out for signature`);
  if (!sig.name.trim()) throw new Error("Enter the signer's name");
  if (!sig.image) throw new Error("Draw a signature");
  const at = sig.signedAt ?? stamp(ctx.asOf);
  const out: Mutation[] = [
    { op: "update", object: "Contract", id: c.Id, changes: { Status: "Signed", SignedDate: at, SignedByName: sig.name.trim(), SignedByTitle: sig.title.trim(), SignatureImage: sig.image } },
  ];
  if (c.StartDate <= today(ctx.asOf)) out.push({ op: "update", object: "Contract", id: c.Id, changes: { Status: "Active" } });
  out.push({ op: "create", object: "Task", record: task(ctx, c, `Contract ${c.ContractNumber} signed`, `Signed electronically by ${sig.name.trim()}${sig.title.trim() ? `, ${sig.title.trim()}` : ""}.`) });
  return out;
}

export function activateMutations(ctx: ContractContext, contractId: string): Mutation[] {
  const c = find(ctx.data, contractId);
  if (c.Status !== "Signed") throw new Error(`${c.ContractNumber} is ${c.Status}`);
  return [{ op: "update", object: "Contract", id: c.Id, changes: { Status: "Active" } }];
}

export function terminateMutations(ctx: ContractContext, contractId: string, input: { date: string; reason: string }): Mutation[] {
  const c = find(ctx.data, contractId);
  if (!LIVE_CONTRACT.includes(c.Status)) throw new Error(`${c.ContractNumber} is ${c.Status}`);
  if (!input.reason.trim()) throw new Error("Enter a reason");
  return [
    { op: "update", object: "Contract", id: c.Id, changes: { Status: "Terminated", TerminatedDate: input.date, AutoRenew: false } },
    { op: "create", object: "Task", record: task(ctx, c, `Contract ${c.ContractNumber} terminated`, `Effective ${input.date}. Reason: ${input.reason.trim()}`) },
  ];
}

/* ----------------------------------------------- date-driven status */

/**
 * Status changes due as of a date (idempotent — run it on every date change):
 * Signed → Active on/after the Start Date; past the End Date an auto-renewing
 * contract extends 12 months at a time (ARR up by its price increase), any
 * other becomes Expired.
 */
export function contractStatusMutations(data: Pick<DataSnapshot, "contracts">, asOf: Date): Mutation[] {
  const t = today(asOf);
  const out: Mutation[] = [];
  for (const c of data.contracts) {
    if (!LIVE_CONTRACT.includes(c.Status)) continue;
    const changes: Partial<Contract> = {};
    if (c.Status === "Signed" && c.StartDate <= t) changes.Status = "Active";
    if (c.EndDate < t) {
      if (c.AutoRenew) {
        let end = c.EndDate;
        let arr = c.ARR;
        let term = c.TermMonths;
        let tcv = c.TCV;
        while (end < t) {
          end = endDateFor(toISODate(addDays(parseDate(end), 1)), 12);
          arr = round2(arr * (1 + (c.PriceIncreasePct || 0) / 100));
          term += 12;
          tcv = round2(tcv + arr);
        }
        Object.assign(changes, { EndDate: end, ARR: arr, TermMonths: term, TCV: tcv });
        if (c.Status === "Signed" && c.StartDate <= t) changes.Status = "Active";
      } else {
        changes.Status = "Expired";
      }
    }
    if (Object.keys(changes).length) out.push({ op: "update", object: "Contract", id: c.Id, changes });
  }
  return out;
}

/* ------------------------------------------------------------ alerts */

export interface ContractInfo {
  noticeDeadline: string;
  daysToNotice: number;
  daysToEnd: number;
  /** Days since it went out for signature (Sent for Signature only) */
  unsignedDays: number | null;
  nonStandard: boolean;
  unsigned: boolean;
  expiring: boolean;
  /** Notice deadline within the alert window */
  noticeDue: boolean;
}

export function contractInfo(c: Contract, asOf: Date): ContractInfo {
  const live = LIVE_CONTRACT.includes(c.Status);
  const deadline = noticeDeadline(c);
  const daysToNotice = daysUntil(deadline, asOf);
  const daysToEnd = daysUntil(c.EndDate, asOf);
  const unsignedDays = c.Status === "Sent for Signature" && c.SentForSignatureDate ? -daysUntil(c.SentForSignatureDate, asOf) : null;
  return {
    noticeDeadline: deadline,
    daysToNotice,
    daysToEnd,
    unsignedDays,
    nonStandard: c.NonStandard,
    unsigned: unsignedDays !== null && unsignedDays > UNSIGNED_ALERT_DAYS,
    expiring: live && daysToEnd >= 0 && daysToEnd <= EXPIRING_ALERT_DAYS,
    noticeDue: live && daysToNotice >= 0 && daysToNotice <= NOTICE_ALERT_DAYS,
  };
}

export interface ContractAlert {
  kind: "notice" | "expiring" | "unsigned";
  contractId: string;
  contractNumber: string;
  accountId: string;
  accountName: string;
  ownerId: string;
  message: string;
  /** Days until the deadline / end (notice, expiring) or since sending (unsigned) */
  days: number;
  date: string;
  severity: "critical" | "warning";
}

const inDays = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`);

/**
 * Contract alerts as of a date:
 * - notice: Signed/Active, End Date − notice days within 60 days ("Renewal notice due in 45 days")
 * - expiring: Signed/Active, End Date within 90 days
 * - unsigned: Sent for Signature more than 14 days ago
 * Sorted most urgent first.
 */
export function contractAlerts(data: Pick<DataSnapshot, "contracts" | "accounts">, asOf: Date): ContractAlert[] {
  const names = new Map(data.accounts.map((a) => [a.Id, a.Name]));
  const out: ContractAlert[] = [];
  for (const c of data.contracts) {
    const i = contractInfo(c, asOf);
    const base = { contractId: c.Id, contractNumber: c.ContractNumber, accountId: c.AccountId, accountName: names.get(c.AccountId) ?? "", ownerId: c.OwnerId };
    if (i.noticeDue) {
      out.push({ ...base, kind: "notice", days: i.daysToNotice, date: i.noticeDeadline, severity: i.daysToNotice <= 14 ? "critical" : "warning", message: `Renewal notice due ${inDays(i.daysToNotice)}` });
    }
    if (i.expiring) {
      out.push({
        ...base,
        kind: "expiring",
        days: i.daysToEnd,
        date: c.EndDate,
        severity: !c.AutoRenew && i.daysToEnd <= 30 ? "critical" : "warning",
        message: c.AutoRenew ? `Auto-renews ${inDays(i.daysToEnd)}` : `Expires ${inDays(i.daysToEnd)}`,
      });
    }
    if (i.unsigned && i.unsignedDays !== null) {
      out.push({ ...base, kind: "unsigned", days: i.unsignedDays, date: c.SentForSignatureDate!.slice(0, 10), severity: i.unsignedDays > 30 ? "critical" : "warning", message: `Unsigned for ${i.unsignedDays} days` });
    }
  }
  const rank = (a: ContractAlert) => (a.kind === "unsigned" ? -a.days : a.days);
  return out.sort((a, b) => (a.severity === b.severity ? rank(a) - rank(b) : a.severity === "critical" ? -1 : 1));
}
