/**
 * Shared customer-success lookups: which accounts are customers, their
 * contracts and ARR. Pure functions over the store's data.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Contract } from "@/types/salesforce";
import { diffDays, parseDate } from "@/lib/dates";

/** Contracts that count as a live customer relationship */
export const LIVE_CONTRACT: Contract["Status"][] = ["Signed", "Active"];

/** Customer accounts: Type "Customer - Direct", or any account with a live contract */
export function customerAccounts(data: Pick<DataSnapshot, "accounts" | "contracts">): Account[] {
  const withContract = new Set(data.contracts.filter((c) => LIVE_CONTRACT.includes(c.Status)).map((c) => c.AccountId));
  return data.accounts.filter((a) => a.Type === "Customer - Direct" || withContract.has(a.Id));
}

/** Live contracts for an account, soonest end first */
export function liveContracts(data: Pick<DataSnapshot, "contracts">, accountId: string): Contract[] {
  return data.contracts.filter((c) => c.AccountId === accountId && LIVE_CONTRACT.includes(c.Status)).sort((a, b) => a.EndDate.localeCompare(b.EndDate));
}

/** Annual recurring revenue: live contracts, else won deals in the last 3 years (before contracts exist) */
export function arrFor(data: Pick<DataSnapshot, "contracts" | "opportunities">, accountId: string, asOf: Date): number {
  const live = liveContracts(data, accountId);
  if (live.length) return live.reduce((s, c) => s + c.ARR, 0);
  return data.opportunities
    .filter((o) => o.AccountId === accountId && o.IsWon && diffDays(asOf, parseDate(o.CloseDate)) <= 3 * 365 && parseDate(o.CloseDate) <= asOf)
    .reduce((s, o) => s + o.Amount, 0);
}

/** The next contract end (renewal date) on or after asOf, else the latest end */
export function renewalDateFor(data: Pick<DataSnapshot, "contracts">, accountId: string, asOf: Date): string | undefined {
  const live = liveContracts(data, accountId);
  return (live.find((c) => parseDate(c.EndDate) >= asOf) ?? live[live.length - 1])?.EndDate;
}

export const round0 = (n: number) => Math.round(n);
