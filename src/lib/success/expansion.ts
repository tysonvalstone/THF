/**
 * Expansion signals: happy multi-location co-ops that haven't rolled the
 * software out to every location yet, and the Add-On opportunity for the rest.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { Account, Opportunity, OpportunityLineItem, Product2 } from "@/types/salesforce";
import { addDays, toISODate } from "@/lib/dates";
import { blackoutStatus } from "@/lib/seasonality";
import { defaultPricebookFor, entryFor, standardPrice } from "@/lib/quotes/catalog";
import { healthAll, type HealthResult } from "./health";
import { arrFor } from "./common";

export const EXPANSION_MIN_CSAT = 8;
export const EXPANSION_SUFFIX = "Expansion";

export interface ExpansionCandidate {
  account: Account;
  health: HealthResult;
  locations: number;
  locationsLive: number;
  remaining: number;
  arr: number;
  /** An open expansion opportunity already exists */
  openOpportunity?: Opportunity;
}

export function isMultiLocationCoop(a: Pick<Account, "Segment__c" | "Facility_Type__c" | "Number_of_Locations__c">): boolean {
  return (a.Segment__c === "Multi-Location Co-op" || a.Facility_Type__c === "Cooperative") && a.Number_of_Locations__c > 1;
}

export function isExpansionOpportunity(o: Pick<Opportunity, "Name" | "Type">): boolean {
  return o.Type === "Add-On Business" && o.Name.includes(`${EXPANSION_SUFFIX} (`);
}

/** Healthy multi-location co-ops with CSAT ≥ 8 and locations not yet live, most remaining first */
export function expansionCandidates(data: DataSnapshot, asOf: Date): ExpansionCandidate[] {
  const health = healthAll(data, asOf);
  const out: ExpansionCandidate[] = [];
  for (const a of data.accounts) {
    const h = health.get(a.Id);
    if (!h || !isMultiLocationCoop(a)) continue;
    if (h.band !== "Healthy" || h.csat < EXPANSION_MIN_CSAT || h.locationsLive >= h.locations) continue;
    const openOpportunity = data.opportunities.find((o) => o.AccountId === a.Id && !o.IsClosed && isExpansionOpportunity(o));
    out.push({ account: a, health: h, locations: h.locations, locationsLive: h.locationsLive, remaining: h.locations - h.locationsLive, arr: arrFor(data, a.Id, asOf), openOpportunity });
  }
  return out.sort((x, y) => y.remaining - x.remaining || y.arr - x.arr);
}

const perLocation = (p: Product2 | undefined): p is Product2 => !!p && p.IsActive && p.Pricing_Unit__c === "per location / year";

/** Per-location products the customer already has (contract quote, won deals), else the ones that fit the facility */
export function expansionProducts(data: DataSnapshot, account: Account): Product2[] {
  const byId = new Map(data.products.map((p) => [p.Id, p]));
  const owned = new Set<string>();
  const quoteIds = new Set(data.contracts.filter((c) => c.AccountId === account.Id && c.QuoteId).map((c) => c.QuoteId!));
  for (const l of data.quoteLineItems) if (quoteIds.has(l.QuoteId)) owned.add(l.Product2Id);
  const won = new Set(data.opportunities.filter((o) => o.AccountId === account.Id && o.IsWon).map((o) => o.Id));
  for (const l of data.lineItems) if (won.has(l.OpportunityId)) owned.add(l.Product2Id);
  const mine = [...owned].map((id) => byId.get(id)).filter(perLocation);
  if (mine.length) return mine;
  return data.products.filter((p) => perLocation(p) && p.Best_Fit__c.includes(account.Facility_Type__c));
}

/** Close date 60 days out, moved past harvest when it lands inside it */
export function expansionCloseDate(account: Account, asOf: Date): string {
  const d = addDays(asOf, 60);
  const s = blackoutStatus(account, d);
  return toISODate(s.status === "hard" && s.resumeDate ? s.resumeDate : d);
}

/**
 * Add-On opportunity for the remaining locations: one line per per-location
 * product, priced from the account's default price book.
 */
export function startExpansionMutations(data: DataSnapshot, accountId: string, asOf: Date, userId: string): { opportunityId: string; mutations: Mutation[] } | null {
  const account = data.accounts.find((a) => a.Id === accountId);
  if (!account) return null;
  const h = healthAll(data, asOf).get(accountId);
  const locations = Math.max(1, account.Number_of_Locations__c);
  const remaining = Math.max(1, locations - (h?.locationsLive ?? locations - 1));
  const book = defaultPricebookFor(account, data.pricebooks);
  const products = expansionProducts(data, account);
  const oppId = newId("Opportunity");
  const lines: OpportunityLineItem[] = products.map((p) => {
    const unit = (book && entryFor(data, book.Id, p.Id)?.UnitPrice) ?? standardPrice(data, p);
    return { Id: newId("OpportunityLineItem"), OpportunityId: oppId, Product2Id: p.Id, Quantity: remaining, UnitPrice: unit, TotalPrice: Math.round(unit * remaining * 100) / 100, Description: `${remaining} more locations` };
  });
  const stamp = `${toISODate(asOf)}T12:00:00.000+0000`;
  const opp: Opportunity = {
    Id: oppId,
    AccountId: accountId,
    Name: `${account.Name} - ${EXPANSION_SUFFIX} (${remaining} location${remaining === 1 ? "" : "s"})`,
    Type: "Add-On Business",
    StageName: "Qualification",
    Amount: Math.round(lines.reduce((s, l) => s + l.TotalPrice, 0)),
    CloseDate: expansionCloseDate(account, asOf),
    Probability: 20,
    ForecastCategoryName: "Pipeline",
    NextStep: `Scope rollout to the remaining ${remaining} locations`,
    LeadSource: "Referral",
    OwnerId: account.OwnerId || userId,
    IsClosed: false,
    IsWon: false,
    CreatedDate: stamp,
    LastModifiedDate: stamp,
    Economic_Buyer_Identified__c: true,
  };
  return {
    opportunityId: oppId,
    mutations: [{ op: "create", object: "Opportunity", record: opp }, ...lines.map((record): Mutation => ({ op: "create", object: "OpportunityLineItem", record }))],
  };
}
