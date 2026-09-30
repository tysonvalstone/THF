/**
 * Typed access to the generated seed files. Regenerate with `npm run seed`,
 * or hand-edit the JSON — the shapes are enforced by src/types.
 */
import type {
  Account,
  Campaign,
  CampaignMember,
  Contact,
  Event,
  Lead,
  Opportunity,
  OpportunityLineItem,
  Task,
  ProductType,
  Product2,
  Pricebook2,
  PricebookEntry,
  Quote,
  QuoteLineItem,
  NewBuild,
  Contract,
  ContractClause,
  Clause,
  Invoice,
  Payment,
  OnboardingProject,
  OnboardingTask,
  HealthSignal,
  SupportTicket,
  Quota,
  CommissionPlan,
  ApprovalRequest,
  AuditEntry,
  Call,
} from "@/types/salesforce";
import type { PriceSeries } from "@/types/reference";

import accounts from "./accounts.json";
import contacts from "./contacts.json";
import leads from "./leads.json";
import opportunities from "./opportunities.json";
import lineItems from "./opportunity-line-items.json";
import campaigns from "./campaigns.json";
import campaignMembers from "./campaign-members.json";
import tasks from "./tasks.json";
import events from "./events.json";
import prices from "./prices.json";
import productTypes from "./product-types.json";
import products from "./products.json";
import pricebooks from "./pricebooks.json";
import pricebookEntries from "./pricebook-entries.json";
import quotes from "./quotes.json";
import quoteLineItems from "./quote-line-items.json";
import newBuilds from "./new-builds.json";
import contracts from "./contracts.json";
import contractClauses from "./contract-clauses.json";
import clauses from "./clauses.json";
import invoices from "./invoices.json";
import payments from "./payments.json";
import onboardingProjects from "./onboarding-projects.json";
import onboardingTasks from "./onboarding-tasks.json";
import healthSignals from "./health-signals.json";
import supportTickets from "./support-tickets.json";
import quotas from "./quotas.json";
import commissionPlans from "./commission-plans.json";
import approvals from "./approvals.json";
import auditLog from "./audit-log.json";
import calls from "./calls.json";

export const SEED = {
  accounts: accounts as unknown as Account[],
  contacts: contacts as unknown as Contact[],
  leads: leads as unknown as Lead[],
  opportunities: opportunities as unknown as Opportunity[],
  lineItems: lineItems as unknown as OpportunityLineItem[],
  campaigns: campaigns as unknown as Campaign[],
  campaignMembers: campaignMembers as unknown as CampaignMember[],
  tasks: tasks as unknown as Task[],
  events: events as unknown as Event[],
  productTypes: productTypes as unknown as ProductType[],
  products: products as unknown as Product2[],
  pricebooks: pricebooks as unknown as Pricebook2[],
  pricebookEntries: pricebookEntries as unknown as PricebookEntry[],
  quotes: quotes as unknown as Quote[],
  quoteLineItems: quoteLineItems as unknown as QuoteLineItem[],
  newBuilds: newBuilds as unknown as NewBuild[],
  contracts: contracts as unknown as Contract[],
  contractClauses: contractClauses as unknown as ContractClause[],
  clauses: clauses as unknown as Clause[],
  invoices: invoices as unknown as Invoice[],
  payments: payments as unknown as Payment[],
  onboardingProjects: onboardingProjects as unknown as OnboardingProject[],
  onboardingTasks: onboardingTasks as unknown as OnboardingTask[],
  healthSignals: healthSignals as unknown as HealthSignal[],
  supportTickets: supportTickets as unknown as SupportTicket[],
  quotas: quotas as unknown as Quota[],
  commissionPlans: commissionPlans as unknown as CommissionPlan[],
  approvals: approvals as unknown as ApprovalRequest[],
  auditLog: auditLog as unknown as AuditEntry[],
  calls: calls as unknown as Call[],
};

export const PRICES = prices as unknown as PriceSeries[];

/** The date the seed data was generated around (activity history ends here). */
export const SEED_ANCHOR_DATE = "2026-09-29";
