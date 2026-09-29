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

export interface DataSnapshot {
  accounts: Account[];
  contacts: Contact[];
  leads: Lead[];
  opportunities: Opportunity[];
  lineItems: OpportunityLineItem[];
  campaigns: Campaign[];
  campaignMembers: CampaignMember[];
  tasks: Task[];
  events: Event[];
}

export interface ObjectMap {
  Account: Account;
  Contact: Contact;
  Lead: Lead;
  Opportunity: Opportunity;
  OpportunityLineItem: OpportunityLineItem;
  Campaign: Campaign;
  CampaignMember: CampaignMember;
  Task: Task;
  Event: Event;
}

export type ObjectName = keyof ObjectMap;

export const COLLECTION: Record<ObjectName, keyof DataSnapshot> = {
  Account: "accounts",
  Contact: "contacts",
  Lead: "leads",
  Opportunity: "opportunities",
  OpportunityLineItem: "lineItems",
  Campaign: "campaigns",
  CampaignMember: "campaignMembers",
  Task: "tasks",
  Event: "events",
};

/**
 * A change to the data, expressed the way the Salesforce REST API would
 * receive it (insert / update by Id). The local repository stores these in
 * localStorage; a Salesforce repository would POST/PATCH them.
 */
export type Mutation =
  | { [K in ObjectName]: { op: "create"; object: K; record: ObjectMap[K] } }[ObjectName]
  | { [K in ObjectName]: { op: "update"; object: K; id: string; changes: Partial<ObjectMap[K]> } }[ObjectName];

/** The single data-access seam. Swap the implementation to go live. */
export interface SalesRepository {
  /** Current data (seed + any local changes) */
  load(): DataSnapshot;
  /** Persist changes; returns the updated snapshot */
  commit(mutations: Mutation[]): DataSnapshot;
  /** Discard local changes */
  reset(): DataSnapshot;
  /** Number of locally stored changes */
  pendingChanges(): number;
}
