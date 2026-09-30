/**
 * Seed data for contract → cash → renewal, customer success, forecasting,
 * commissions and Call Desk. Each module owns one builder file; this file
 * only composes them. Builders must be deterministic (hash-based, see
 * hash01 in ./quoting.ts) so they never change existing records.
 */
import type { Account, Contact, Opportunity, OpportunityLineItem, Product2, Quote, QuoteLineItem, User } from "../../src/types/salesforce";
import type { DataSnapshot } from "../../src/lib/data/types";
import { buildContracts, contractSeedApprovals } from "./contracts";
import { buildFinance } from "./finance";
import { buildSuccess } from "./success";
import { buildSales } from "./sales-ops";
import { buildCalls } from "./calls";

export interface SeedContext {
  anchor: Date;
  users: User[];
  accounts: Account[];
  contacts: Contact[];
  opportunities: Opportunity[];
  lineItems: OpportunityLineItem[];
  quotes: Quote[];
  quoteLineItems: QuoteLineItem[];
  products: Product2[];
}

export type PlatformSeed = Pick<
  DataSnapshot,
  "contracts" | "contractClauses" | "clauses" | "invoices" | "payments" | "onboardingProjects" | "onboardingTasks" | "healthSignals" | "supportTickets" | "quotas" | "commissionPlans" | "approvals" | "auditLog" | "calls"
>;

export function buildPlatform(ctx: SeedContext): PlatformSeed {
  const contracts = buildContracts(ctx);
  const finance = buildFinance(ctx, contracts);
  const success = buildSuccess(ctx, contracts);
  const sales = buildSales(ctx);
  const calls = buildCalls(ctx);
  return { ...contracts, ...finance, ...success, ...sales, ...calls, approvals: contractSeedApprovals(contracts, ctx), auditLog: [] };
}
