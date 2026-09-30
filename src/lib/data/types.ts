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
  productTypes: ProductType[];
  products: Product2[];
  pricebooks: Pricebook2[];
  pricebookEntries: PricebookEntry[];
  quotes: Quote[];
  quoteLineItems: QuoteLineItem[];
  newBuilds: NewBuild[];
  contracts: Contract[];
  contractClauses: ContractClause[];
  clauses: Clause[];
  invoices: Invoice[];
  payments: Payment[];
  onboardingProjects: OnboardingProject[];
  onboardingTasks: OnboardingTask[];
  healthSignals: HealthSignal[];
  supportTickets: SupportTicket[];
  quotas: Quota[];
  commissionPlans: CommissionPlan[];
  approvals: ApprovalRequest[];
  auditLog: AuditEntry[];
  calls: Call[];
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
  ProductType: ProductType;
  Product2: Product2;
  Pricebook2: Pricebook2;
  PricebookEntry: PricebookEntry;
  Quote: Quote;
  QuoteLineItem: QuoteLineItem;
  NewBuild: NewBuild;
  Contract: Contract;
  ContractClause: ContractClause;
  Clause: Clause;
  Invoice: Invoice;
  Payment: Payment;
  OnboardingProject: OnboardingProject;
  OnboardingTask: OnboardingTask;
  HealthSignal: HealthSignal;
  SupportTicket: SupportTicket;
  Quota: Quota;
  CommissionPlan: CommissionPlan;
  ApprovalRequest: ApprovalRequest;
  AuditEntry: AuditEntry;
  Call: Call;
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
  ProductType: "productTypes",
  Product2: "products",
  Pricebook2: "pricebooks",
  PricebookEntry: "pricebookEntries",
  Quote: "quotes",
  QuoteLineItem: "quoteLineItems",
  NewBuild: "newBuilds",
  Contract: "contracts",
  ContractClause: "contractClauses",
  Clause: "clauses",
  Invoice: "invoices",
  Payment: "payments",
  OnboardingProject: "onboardingProjects",
  OnboardingTask: "onboardingTasks",
  HealthSignal: "healthSignals",
  SupportTicket: "supportTickets",
  Quota: "quotas",
  CommissionPlan: "commissionPlans",
  ApprovalRequest: "approvals",
  AuditEntry: "auditLog",
  Call: "calls",
};

/**
 * A change to the data, expressed the way the Salesforce REST API would
 * receive it (insert / update by Id). The local repository stores these in
 * localStorage; a Salesforce repository would POST/PATCH them.
 */
export type Mutation =
  | { [K in ObjectName]: { op: "create"; object: K; record: ObjectMap[K] } }[ObjectName]
  | { [K in ObjectName]: { op: "update"; object: K; id: string; changes: Partial<ObjectMap[K]> } }[ObjectName]
  | { op: "delete"; object: ObjectName; id: string };

/** The single data-access seam. Swap the implementation to go live. */
export interface SalesRepository {
  /** Current data (seed + any local changes) */
  load(): DataSnapshot;
  /** Persist changes; returns the updated snapshot */
  commit(mutations: Mutation[]): DataSnapshot;
  /** Discard local changes */
  reset(): DataSnapshot;
  /** Drop the last `count` changes (Undo) */
  undo(count: number): DataSnapshot;
  /** The stored change log (sent to the assistant so answers include local changes) */
  log(): Mutation[];
  /** Number of locally stored changes */
  pendingChanges(): number;
}
