/**
 * Building a new quote from an opportunity: defaults (price book, contact,
 * term, go-live after harvest, expiration) and pre-filled line items.
 * Pure: returns the records and the mutations to commit.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { Account, BillingFrequency, Contact, Opportunity, Product2, Quote, QuoteLineItem } from "@/types/salesforce";
import { addDays, fmtShortDate, parseDate, toISODate } from "@/lib/dates";
import { blackoutStatus, isSeasonalSegment, nextBoardMeeting } from "@/lib/seasonality";
import { defaultPricebookFor, defaultQuantity, entryFor, isRecurring, productMap } from "./catalog";
import { computeTotals, impliedDiscount, priceLine, rollupFields, type QuoteTotals } from "./pricing";
import { approvalFor, type ApprovalRequirement } from "./approvals";

export interface QuoteContext {
  data: DataSnapshot;
  /** The app's "today" (time travel) */
  asOf: Date;
  /** Owner / acting user (Salesforce User Id) */
  userId: string;
}

export const TERM_OPTIONS = [12, 24, 36, 48, 60] as const;
export const BILLING_OPTIONS: BillingFrequency[] = ["Annual", "Quarterly", "Monthly"];
export const PAYMENT_TERMS: Quote["Payment_Terms__c"][] = ["Net 30", "Net 45", "Net 60", "Due on receipt"];
/** Days a quote stays valid by default */
export const DEFAULT_VALID_DAYS = 30;

/** "Q-01146": one more than the highest existing number */
export function nextQuoteNumber(quotes: Pick<Quote, "QuoteNumber">[]): string {
  const max = quotes.reduce((m, q) => Math.max(m, Number(/^Q-(\d+)/.exec(q.QuoteNumber)?.[1] ?? 0)), 1040);
  return `Q-${String(max + 1).padStart(5, "0")}`;
}

/** "Q-01041" → "Q-01041"; "Q-01041-v3" → "Q-01041" */
export function baseQuoteNumber(n: string): string {
  return n.replace(/-v\d+$/, "");
}

export function quoteVersion(n: string): number {
  return Number(/-v(\d+)$/.exec(n)?.[1] ?? 1);
}

/** Next version number for a revision of `n`: Q-01041 → Q-01041-v2 (or higher if taken) */
export function revisionNumber(quotes: Pick<Quote, "QuoteNumber">[], n: string): string {
  const base = baseQuoteNumber(n);
  const max = quotes.filter((q) => baseQuoteNumber(q.QuoteNumber) === base).reduce((m, q) => Math.max(m, quoteVersion(q.QuoteNumber)), 1);
  return `${base}-v${max + 1}`;
}

type SeasonalAccount = Pick<Account, "Segment__c" | "BillingLatitude" | "BillingCountry">;

/**
 * Go-live suggestion. Elevators and co-ops: the next Dec 1 or Feb 1 at least
 * 45 days out that isn't inside the account's harvest blackout. Year-round
 * segments: the first of the month at least 45 days out.
 */
export function suggestGoLive(account: SeasonalAccount | undefined, from: Date): Date {
  const earliest = addDays(from, 45);
  if (!account || !isSeasonalSegment(account.Segment__c)) {
    return new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth() + (earliest.getUTCDate() > 1 ? 1 : 0), 1));
  }
  const y = from.getUTCFullYear();
  const options: Date[] = [];
  for (const yr of [y - 1, y, y + 1, y + 2]) options.push(new Date(Date.UTC(yr, 11, 1)), new Date(Date.UTC(yr + 1, 1, 1)));
  return options.find((d) => d >= earliest && blackoutStatus(account, d).status !== "hard") ?? earliest;
}

/**
 * Go-live suggestion for a deal: co-ops and deals in Board Approval count from
 * the next board meeting (the board has to approve first), others from today.
 */
export function suggestGoLiveFor(
  account: (SeasonalAccount & Pick<Account, "Board_Meeting_Months__c">) | undefined,
  opp: Pick<Opportunity, "StageName"> | undefined,
  asOf: Date,
): Date {
  const needsBoard = account?.Segment__c === "Multi-Location Co-op" || opp?.StageName === "Board Approval";
  const meeting = needsBoard ? nextBoardMeeting(account?.Board_Meeting_Months__c, asOf) : null;
  return suggestGoLive(account, meeting && meeting > asOf ? meeting : asOf);
}

/** Warning when a go-live date falls inside the account's harvest (or planting) window */
export function goLiveWarning(account: SeasonalAccount | undefined, startISO: string | undefined): string | null {
  if (!account || !startISO) return null;
  const s = blackoutStatus(account, parseDate(startISO));
  if (s.status === "none" || !s.blackout) return null;
  if (s.status === "hard") return `Go-live is inside harvest (to ${fmtShortDate(s.blackout.end)}).`;
  return `Go-live is during spring planting (to ${fmtShortDate(s.blackout.end)}).`;
}

/** The account's economic buyer, else the opportunity's contacts, else anyone at the account */
export function defaultContactFor(data: Pick<DataSnapshot, "contacts">, opp: Pick<Opportunity, "AccountId" | "Economic_Buyer__c" | "Primary_Contact__c">): Contact | undefined {
  const at = data.contacts.filter((c) => c.AccountId === opp.AccountId);
  return (
    at.find((c) => c.Id === opp.Economic_Buyer__c) ??
    at.find((c) => c.Buying_Role__c === "Economic Buyer") ??
    at.find((c) => c.Id === opp.Primary_Contact__c) ??
    at.find((c) => c.Buying_Role__c === "Decision Maker") ??
    at[0]
  );
}

/** Products that fit a facility: up to 3 best-fit modules plus implementation */
export function fitProducts(products: Product2[], account: Pick<Account, "Facility_Type__c"> | undefined): Product2[] {
  const active = products.filter((p) => p.IsActive);
  const modules = active.filter((p) => isRecurring(p) && !!account && p.Best_Fit__c.includes(account.Facility_Type__c)).slice(0, 3);
  const impl = active.find((p) => p.ProductCode === "SVC-IMPL") ?? active.find((p) => !isRecurring(p) && !p.Unit_Label__c);
  return impl ? [...modules, impl] : modules;
}

export interface BuildQuoteOptions {
  quoteId?: string;
  name?: string;
  pricebookId?: string;
  contactId?: string;
  termMonths?: number;
  billingFrequency?: BillingFrequency;
  paymentTerms?: Quote["Payment_Terms__c"];
  /** Go-live, YYYY-MM-DD (default: suggestGoLive) */
  startDate?: string;
  /** YYYY-MM-DD (default: asOf + 30 days) */
  expirationDate?: string;
  /** Line discount % applied to every line (default: from the opportunity's prices) */
  discount?: number;
  /** Header discount % on recurring */
  headerDiscount?: number;
  taxRate?: number;
  description?: string;
  /** Line items: "opportunity" (default when it has lines), "fit", or "none" */
  lines?: "opportunity" | "fit" | "none";
}

export interface BuiltQuote {
  quote: Quote;
  lines: QuoteLineItem[];
  totals: QuoteTotals;
  approval: ApprovalRequirement;
  /** Create the quote and its lines */
  mutations: Mutation[];
}

/**
 * A new Draft quote for an opportunity, with defaults and line items
 * pre-filled from the opportunity's products (or product fit when it has none).
 */
export function buildQuoteFromOpportunity(ctx: QuoteContext, opportunityId: string, opts: BuildQuoteOptions = {}): BuiltQuote {
  const { data, asOf } = ctx;
  const opp = data.opportunities.find((o) => o.Id === opportunityId);
  if (!opp) throw new Error(`Opportunity ${opportunityId} not found`);
  const account = data.accounts.find((a) => a.Id === opp.AccountId);
  const book = (opts.pricebookId && data.pricebooks.find((b) => b.Id === opts.pricebookId)) || defaultPricebookFor(account, data.pricebooks);
  if (!book) throw new Error("No price book");
  const coop = account?.Segment__c === "Multi-Location Co-op";
  const term = opts.termMonths ?? 36;
  const quoteId = opts.quoteId ?? newId("Quote");
  const byId = productMap(data.products);

  const oppLines = data.lineItems.filter((l) => l.OpportunityId === opp.Id && byId.has(l.Product2Id));
  const source = opts.lines ?? (oppLines.length ? "opportunity" : "fit");
  const drafts: { product: Product2; qty: number; discount: number; description?: string }[] = [];
  if (source === "opportunity") {
    for (const l of oppLines) {
      const product = byId.get(l.Product2Id)!;
      const list = entryFor(data, book.Id, product.Id)?.UnitPrice ?? product.List_Price__c;
      // Negotiated prices on the opportunity become line discounts (capped at 30%)
      drafts.push({ product, qty: Math.max(1, l.Quantity), discount: impliedDiscount(list, l.UnitPrice, 30) });
    }
  } else if (source === "fit") {
    for (const product of fitProducts(data.products, account)) drafts.push({ product, qty: defaultQuantity(product, account), discount: 0 });
  }

  const lines: QuoteLineItem[] = drafts.map((d, i) => {
    const entry = entryFor(data, book.Id, d.product.Id);
    const list = entry?.UnitPrice ?? d.product.List_Price__c;
    const discount = opts.discount !== undefined ? opts.discount : d.discount;
    return {
      Id: newId("QuoteLineItem"),
      QuoteId: quoteId,
      Product2Id: d.product.Id,
      PricebookEntryId: entry?.Id,
      Quantity: d.qty,
      ListPrice: list,
      Discount: discount,
      ...priceLine(list, d.qty, discount),
      Description: d.description,
      SortOrder: i + 1,
    };
  });

  const header = { Discount__c: opts.headerDiscount ?? 0, Tax_Rate__c: opts.taxRate ?? 0, Contract_Term_Months__c: term };
  const totals = computeTotals(header, lines, byId);
  const quote: Quote = {
    Id: quoteId,
    QuoteNumber: nextQuoteNumber(data.quotes),
    Name: opts.name ?? `${account?.Name ?? opp.Name} · ${term}-month proposal`,
    OpportunityId: opp.Id,
    AccountId: opp.AccountId,
    ContactId: opts.contactId ?? defaultContactFor(data, opp)?.Id,
    Pricebook2Id: book.Id,
    Status: "Draft",
    OwnerId: ctx.userId,
    CreatedDate: stamp(asOf),
    ExpirationDate: opts.expirationDate ?? toISODate(addDays(asOf, DEFAULT_VALID_DAYS)),
    Billing_Frequency__c: opts.billingFrequency ?? "Annual",
    Payment_Terms__c: opts.paymentTerms ?? (coop ? "Net 45" : "Net 30"),
    Start_Date__c: opts.startDate ?? toISODate(suggestGoLiveFor(account, opp, asOf)),
    ...header,
    Description: opts.description ?? `Proposal for ${account?.Name ?? opp.Name}.`,
    ...rollupFields(totals),
  };
  return {
    quote,
    lines,
    totals,
    approval: approvalFor(totals, book.CurrencyIsoCode),
    mutations: [{ op: "create", object: "Quote", record: quote }, ...lines.map((record): Mutation => ({ op: "create", object: "QuoteLineItem", record }))],
  };
}

/** "Now" on the as-of date, keeping today's clock time so records sort naturally */
export function stamp(asOf: Date): string {
  const now = new Date();
  return new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds())).toISOString();
}
