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
};

export const PRICES = prices as unknown as PriceSeries[];

/** The date the seed data was generated around (activity history ends here). */
export const SEED_ANCHOR_DATE = "2026-09-29";
