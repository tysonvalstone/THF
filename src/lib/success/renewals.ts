/**
 * Renewal automation and the renewals list. `renewalMutations` is idempotent:
 * run it whenever the date or data changes.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { Account, Contract, Opportunity } from "@/types/salesforce";
import { addDays, diffDays, parseDate, toISODate } from "@/lib/dates";
import { healthAll, RENEWAL_HORIZON_DAYS, type HealthResult } from "./health";

/** Active contracts ending within this many days get a renewal opportunity */
export const RENEWAL_LEAD_DAYS = 120;
export const RENEWAL_PREFIX = "Renewal:";

export function renewalName(account: Pick<Account, "Name"> | undefined, contract: Pick<Contract, "EndDate" | "Name">): string {
  return `${RENEWAL_PREFIX} ${account?.Name ?? contract.Name} ${contract.EndDate.slice(0, 4)}`;
}

export function isRenewalOpportunity(o: Pick<Opportunity, "Name">): boolean {
  return o.Name.startsWith(RENEWAL_PREFIX);
}

/** Renewal amount: ARR plus the contract's yearly price increase */
export function renewalAmount(c: Pick<Contract, "ARR" | "PriceIncreasePct">): number {
  return Math.round(c.ARR * (1 + (c.PriceIncreasePct || 0) / 100));
}

/** Notice deadline: EndDate − NoticeDays */
export function noticeDeadline(c: Pick<Contract, "EndDate" | "NoticeDays">): Date {
  return addDays(parseDate(c.EndDate), -(c.NoticeDays || 0));
}

/** Close date: the notice deadline, or a week out when the deadline has already passed */
export function renewalCloseDate(c: Pick<Contract, "EndDate" | "NoticeDays">, asOf: Date): Date {
  const notice = noticeDeadline(c);
  return notice < asOf ? addDays(asOf, 7) : notice;
}

/**
 * For each Active contract ending within 120 days without a renewal
 * opportunity: create "Renewal: <Account> <year>" (Add-On Business,
 * Qualification, ARR × (1 + price increase), close on the notice deadline
 * (a week out if it already passed),
 * owned by the contract owner, Best Case when the customer is Healthy, else
 * Pipeline) and link it on Contract.RenewalOpportunityId. An existing open
 * opportunity with the same name on the account is linked instead of duplicated.
 */
export function renewalMutations(data: DataSnapshot, asOf: Date): Mutation[] {
  const due = data.contracts.filter((c) => {
    if (c.Status !== "Active" || c.RenewalOpportunityId) return false;
    const days = diffDays(parseDate(c.EndDate), asOf);
    return days >= 0 && days <= RENEWAL_LEAD_DAYS;
  });
  if (!due.length) return [];
  const health = healthAll(data, asOf);
  const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
  const stamp = `${toISODate(asOf)}T12:00:00.000+0000`;
  const out: Mutation[] = [];
  for (const c of due) {
    const account = accounts.get(c.AccountId);
    const name = renewalName(account, c);
    const existing = data.opportunities.find((o) => o.AccountId === c.AccountId && o.Name === name);
    if (existing) {
      out.push({ op: "update", object: "Contract", id: c.Id, changes: { RenewalOpportunityId: existing.Id } });
      continue;
    }
    const band = health.get(c.AccountId)?.band;
    const id = newId("Opportunity");
    const opp: Opportunity = {
      Id: id,
      AccountId: c.AccountId,
      Name: name,
      Type: "Add-On Business",
      StageName: "Qualification",
      Amount: renewalAmount(c),
      CloseDate: toISODate(renewalCloseDate(c, asOf)),
      Probability: 20,
      ForecastCategoryName: band === "Healthy" ? "Best Case" : "Pipeline",
      NextStep: `Confirm renewal before the notice deadline`,
      LeadSource: "Referral",
      OwnerId: c.OwnerId,
      IsClosed: false,
      IsWon: false,
      CreatedDate: stamp,
      LastModifiedDate: stamp,
      Economic_Buyer_Identified__c: true,
    };
    out.push({ op: "create", object: "Opportunity", record: opp }, { op: "update", object: "Contract", id: c.Id, changes: { RenewalOpportunityId: id } });
  }
  return out;
}

export interface RenewalRow {
  contract: Contract;
  account?: Account;
  health?: HealthResult;
  opportunity?: Opportunity;
  arr: number;
  daysToEnd: number;
  noticeDeadline: string;
  daysToNotice: number;
  atRisk: boolean;
}

/**
 * Active contracts ending within 180 days (or already past their end), with
 * health and the renewal opportunity. At risk: At Risk health, Watch trending
 * down or within 90 days, or the notice deadline passed with no renewal won.
 */
export function upcomingRenewals(data: DataSnapshot, asOf: Date, horizonDays = RENEWAL_HORIZON_DAYS): RenewalRow[] {
  const health = healthAll(data, asOf);
  const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
  const opps = new Map(data.opportunities.map((o) => [o.Id, o]));
  return data.contracts
    .filter((c) => c.Status === "Active")
    .map((c): RenewalRow => {
      const daysToEnd = diffDays(parseDate(c.EndDate), asOf);
      const notice = noticeDeadline(c);
      const h = health.get(c.AccountId);
      const opportunity = c.RenewalOpportunityId ? opps.get(c.RenewalOpportunityId) : undefined;
      const won = !!opportunity?.IsWon;
      const daysToNotice = diffDays(notice, asOf);
      const atRisk =
        !won &&
        (h?.band === "At Risk" || (h?.band === "Watch" && (h.trend === "down" || daysToEnd <= 90)) || (daysToNotice < 0 && !opportunity) || !!(opportunity?.IsClosed && !opportunity.IsWon));
      return { contract: c, account: accounts.get(c.AccountId), health: h, opportunity, arr: c.ARR, daysToEnd, noticeDeadline: toISODate(notice), daysToNotice, atRisk };
    })
    .filter((r) => r.daysToEnd <= horizonDays && r.daysToEnd >= -30)
    .sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || a.daysToEnd - b.daysToEnd);
}
