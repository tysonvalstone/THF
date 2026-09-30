/**
 * Salesforce-style data model.
 *
 * Field names follow Salesforce standard object/field API names so the mock
 * data can later be swapped for a real Salesforce org (see src/lib/data).
 * Custom fields use the `__c` suffix. Multi-select picklists are modelled as
 * string arrays for convenience (Salesforce stores them as "A;B;C").
 */

export type Id = string;
/** ISO date, YYYY-MM-DD */
export type DateString = string;
/** ISO date-time */
export type DateTimeString = string;

export type Country = "United States" | "Canada";

export type FacilityType =
  | "Grain Elevator"
  | "Cooperative"
  | "Ethanol Plant"
  | "Feed Mill"
  | "Oilseed Crusher"
  | "Flour Mill"
  | "Seed Processor"
  | "Agronomy Retailer";

export const FACILITY_TYPES: FacilityType[] = [
  "Grain Elevator",
  "Cooperative",
  "Ethanol Plant",
  "Feed Mill",
  "Oilseed Crusher",
  "Flour Mill",
  "Seed Processor",
  "Agronomy Retailer",
];

/**
 * Market segments used for prioritization (Account.Segment__c).
 * "Seed Cleaner / Specialty Crop" is deliberately new: it has no deal history.
 */
export type Segment =
  | "Country Elevator"
  | "Multi-Location Co-op"
  | "River Terminal"
  | "Rail/Shuttle Loader"
  | "Ethanol Plant"
  | "Feed Mill"
  | "Processor"
  | "Seed Cleaner / Specialty Crop";

export const SEGMENTS: Segment[] = [
  "Country Elevator",
  "Multi-Location Co-op",
  "River Terminal",
  "Rail/Shuttle Loader",
  "Ethanol Plant",
  "Feed Mill",
  "Processor",
  "Seed Cleaner / Specialty Crop",
];

/** Segments whose buyers go dark during harvest and spring planting */
export const SEASONAL_SEGMENTS: Segment[] = ["Country Elevator", "Multi-Location Co-op", "River Terminal", "Rail/Shuttle Loader", "Seed Cleaner / Specialty Crop"];

export type Commodity =
  | "Corn"
  | "Soybeans"
  | "Winter Wheat"
  | "Spring Wheat"
  | "Canola"
  | "Sorghum"
  | "Barley"
  | "Pulses"
  | "Rice";

export const COMMODITIES: Commodity[] = [
  "Corn",
  "Soybeans",
  "Winter Wheat",
  "Spring Wheat",
  "Canola",
  "Sorghum",
  "Barley",
  "Pulses",
  "Rice",
];

export type LivestockFocus = "Swine" | "Poultry" | "Dairy" | "Beef Cattle" | "Mixed";

export type RegionId =
  | "southern-plains"
  | "northern-plains"
  | "western-corn-belt"
  | "eastern-corn-belt"
  | "great-lakes"
  | "delta"
  | "southeast"
  | "mid-atlantic"
  | "pacific-northwest"
  | "western-prairies"
  | "manitoba"
  | "central-canada";

export interface User {
  Id: Id;
  Name: string;
  Title: string;
  Email: string;
  Territory__c: string;
  Regions__c: RegionId[];
}

export type AccountType = "Prospect" | "Customer - Direct";

export interface Account extends ReceivingProfile {
  Id: Id;
  Name: string;
  Type: AccountType;
  Industry: "Agriculture";
  Phone: string;
  Website: string;
  BillingStreet: string;
  BillingCity: string;
  BillingState: string;
  BillingPostalCode: string;
  BillingCountry: Country;
  BillingLatitude: number;
  BillingLongitude: number;
  AnnualRevenue: number;
  NumberOfEmployees: number;
  OwnerId: Id;
  CreatedDate: DateTimeString;
  Description: string;

  Facility_Type__c: FacilityType;
  Primary_Commodities__c: Commodity[];
  Storage_Capacity_Bu__c?: number;
  Annual_Production_Gal__c?: number;
  Annual_Production_Tons__c?: number;
  Number_of_Locations__c: number;
  Current_Software__c: string;
  Software_Contract_End__c?: DateString;
  Livestock_Focus__c?: LivestockFocus;
  Region__c: RegionId;
  Rail_Served__c: boolean;
  Segment__c: Segment;
  /** Parent co-op for location accounts (Salesforce standard ParentId) */
  ParentId?: Id;
  County__c?: string;
  /** 5-digit county FIPS code (US only) */
  County_FIPS__c?: string;
  Railroad__c?: string;
  River_Access__c: boolean;
  Shuttle_Loader__c: boolean;
  /** Month-day the fiscal year ends, e.g. "08-31" */
  Fiscal_Year_End__c: string;
  /** Months (1–12) the board meets */
  Board_Meeting_Months__c: number[];
}

export type BuyingRole = "Decision Maker" | "Economic Buyer" | "Champion" | "Influencer" | "End User" | "Board Member";

export interface Contact {
  Id: Id;
  AccountId: Id;
  FirstName: string;
  LastName: string;
  Name: string;
  Title: string;
  Email: string;
  Phone: string;
  MobilePhone?: string;
  MailingStreet: string;
  MailingCity: string;
  MailingState: string;
  MailingPostalCode: string;
  MailingCountry: Country;
  OwnerId: Id;
  Buying_Role__c: BuyingRole;
  HasOptedOutOfEmail: boolean;
  CreatedDate: DateTimeString;
}

export type LeadStatus =
  | "Open - Not Contacted"
  | "Working - Contacted"
  | "Nurturing"
  | "Closed - Not Converted";
export type LeadRating = "Hot" | "Warm" | "Cold";
export type LeadSource =
  | "Web"
  | "Trade Show"
  | "Referral"
  | "Purchased List"
  | "Partner"
  | "Webinar"
  | "Direct Mail";

export interface Lead {
  Id: Id;
  FirstName: string;
  LastName: string;
  Name: string;
  Title: string;
  Company: string;
  Email: string;
  Phone: string;
  Street: string;
  City: string;
  State: string;
  PostalCode: string;
  Country: Country;
  Latitude: number;
  Longitude: number;
  Industry: "Agriculture";
  LeadSource: LeadSource;
  Status: LeadStatus;
  Rating: LeadRating;
  NumberOfEmployees: number;
  AnnualRevenue: number;
  OwnerId: Id;
  CreatedDate: DateTimeString;
  IsConverted: boolean;
  /** Set when the lead is converted (Salesforce standard fields) */
  ConvertedDate?: DateString;
  ConvertedAccountId?: Id;
  ConvertedContactId?: Id;
  ConvertedOpportunityId?: Id;

  Facility_Type__c: FacilityType;
  Primary_Commodities__c: Commodity[];
  Storage_Capacity_Bu__c?: number;
  Annual_Production_Gal__c?: number;
  Annual_Production_Tons__c?: number;
  Number_of_Locations__c: number;
  Current_Software__c: string;
  Software_Contract_End__c?: DateString;
  Livestock_Focus__c?: LivestockFocus;
  Region__c: RegionId;
  Segment__c?: Segment;
}

export type OpportunityStage =
  | "Prospecting"
  | "Qualification"
  | "Needs Analysis"
  | "Proposal"
  | "Negotiation"
  | "Board Approval"
  | "Closed Won"
  | "Closed Lost";

export const OPEN_STAGES: OpportunityStage[] = [
  "Prospecting",
  "Qualification",
  "Needs Analysis",
  "Proposal",
  "Negotiation",
  "Board Approval",
];

export const ALL_STAGES: OpportunityStage[] = [...OPEN_STAGES, "Closed Won", "Closed Lost"];

export type ForecastCategory = "Pipeline" | "Best Case" | "Commit" | "Closed" | "Omitted";

export interface Opportunity {
  Id: Id;
  AccountId: Id;
  Name: string;
  Type: "New Business" | "Add-On Business";
  StageName: OpportunityStage;
  Amount: number;
  CloseDate: DateString;
  Probability: number;
  ForecastCategoryName: ForecastCategory;
  Manager_Forecast_Category__c?: ForecastCategory;
  NextStep: string;
  LeadSource: LeadSource;
  OwnerId: Id;
  IsClosed: boolean;
  IsWon: boolean;
  CreatedDate: DateTimeString;
  LastModifiedDate: DateTimeString;
  Loss_Reason__c?: string;
  Primary_Contact__c?: Id;
  /** Required before a deal can move past Prospecting */
  Economic_Buyer_Identified__c: boolean;
  Economic_Buyer__c?: Id;
}

export type ProductFamily =
  | "Financials"
  | "Grain Operations"
  | "Commodity Management"
  | "Customer Engagement"
  | "Feed"
  | "Agronomy"
  | "Processing"
  | "Services";

export interface Product2 {
  Id: Id;
  Name: string;
  ProductCode: string;
  Family: ProductFamily;
  Description: string;
  IsActive: boolean;
  /** Standard price book list price */
  List_Price__c: number;
  Pricing_Unit__c: "per year" | "per location / year" | "one-time";
  Best_Fit__c: FacilityType[];
  /** Product type (ProductType record) */
  Product_Type__c?: Id;
  /** Quoted per unit (e.g. per kiosk) rather than per location */
  Unit_Label__c?: string;
}

export interface OpportunityLineItem {
  Id: Id;
  OpportunityId: Id;
  Product2Id: Id;
  Quantity: number;
  UnitPrice: number;
  TotalPrice: number;
  Description?: string;
}

export type CampaignType = "Direct Mail" | "Email" | "Event" | "Call Blitz" | "Multi-Channel";
export type CampaignStatus = "Planned" | "In Progress" | "Completed" | "Aborted";

export interface CampaignContent {
  source: "ai" | "template";
  letter: { subject: string; body: string };
  emails: { subject: string; body: string; sendOffsetDays: number }[];
  callScript: { opener: string; discovery: string[]; valuePoints: string[]; objections: { objection: string; response: string }[]; close: string };
}

export interface Campaign {
  Id: Id;
  Name: string;
  Type: CampaignType;
  Status: CampaignStatus;
  IsActive: boolean;
  StartDate: DateString;
  EndDate: DateString;
  BudgetedCost: number;
  ActualCost: number;
  ExpectedRevenue: number;
  ExpectedResponse: number;
  NumberSent: number;
  Description: string;
  OwnerId: Id;
  CreatedDate: DateTimeString;
  Season__c: string;
  Target_Regions__c: RegionId[];
  Target_Facility_Types__c: FacilityType[];
  Target_Commodity__c?: Commodity;
  Content__c?: CampaignContent;
}

export type CampaignMemberStatus = "Planned" | "Sent" | "Opened" | "Responded";

export interface CampaignMember {
  Id: Id;
  CampaignId: Id;
  ContactId?: Id;
  LeadId?: Id;
  /** Helper (Salesforce exposes this as CompanyOrAccount) */
  AccountId?: Id;
  Status: CampaignMemberStatus;
  HasResponded: boolean;
  FirstRespondedDate?: DateString;
  CreatedDate: DateTimeString;
}

export type TaskType = "Call" | "Email" | "Mail Drop" | "Meeting" | "Follow-up" | "Other";
export type TaskStatus = "Not Started" | "In Progress" | "Completed";

export interface Task {
  Id: Id;
  Subject: string;
  Type: TaskType;
  TaskSubtype: "Call" | "Email" | "Task";
  Status: TaskStatus;
  Priority: "High" | "Normal" | "Low";
  ActivityDate: DateString;
  /** Contact or Lead */
  WhoId?: Id;
  /** Account, Opportunity or Campaign */
  WhatId?: Id;
  AccountId?: Id;
  OwnerId: Id;
  Description: string;
  CallDisposition?: string;
  CallDurationInSeconds?: number;
  CreatedDate: DateTimeString;
  CompletedDateTime?: DateTimeString;
}

export type EventType = "Meeting" | "Demo" | "Site Visit" | "Trade Show" | "Webinar";

export interface Event {
  Id: Id;
  Subject: string;
  Type: EventType;
  StartDateTime: DateTimeString;
  EndDateTime: DateTimeString;
  Location: string;
  WhoId?: Id;
  WhatId?: Id;
  AccountId?: Id;
  OwnerId: Id;
  Description: string;
  CreatedDate: DateTimeString;
}

// ---------------------------------------------------------------------------
// Harvest-day facility attributes (Account), quoting, catalog and new builds
// ---------------------------------------------------------------------------

/** Receiving equipment used by the Harvest Day Simulator (on Account) */
export interface ReceivingProfile {
  /** Truck scales */
  Scales__c?: number;
  /** Dump pits (receiving pits) */
  Dump_Pits__c?: number;
  /** Maximum receiving rate per pit, bushels per hour */
  Dump_Pit_Rate_Bph__c?: number;
  /** This year's expected county yield vs. normal (1.00 = normal) */
  County_Yield_Factor__c?: number;
  /** Modeled harvest-season dollars at risk from the simulator */
  Harvest_At_Risk__c?: number;
  Harvest_At_Risk_Modeled__c?: DateTimeString;
}

export interface ProductType {
  Id: Id;
  Name: string;
  Description: string;
  IsActive: boolean;
  SortOrder: number;
}

export interface Pricebook2 {
  Id: Id;
  Name: string;
  Description: string;
  IsActive: boolean;
  IsStandard: boolean;
  CurrencyIsoCode: "USD" | "CAD";
}

export interface PricebookEntry {
  Id: Id;
  Pricebook2Id: Id;
  Product2Id: Id;
  UnitPrice: number;
  IsActive: boolean;
}

export type QuoteStatus = "Draft" | "In Review" | "Approved" | "Rejected" | "Sent" | "Accepted" | "Declined" | "Expired";
export const QUOTE_STATUSES: QuoteStatus[] = ["Draft", "In Review", "Approved", "Rejected", "Sent", "Accepted", "Declined", "Expired"];

export type BillingFrequency = "Annual" | "Quarterly" | "Monthly";

export interface Quote {
  Id: Id;
  QuoteNumber: string;
  Name: string;
  OpportunityId: Id;
  AccountId: Id;
  /** Who the quote is addressed to */
  ContactId?: Id;
  Pricebook2Id: Id;
  Status: QuoteStatus;
  OwnerId: Id;
  CreatedDate: DateTimeString;
  ExpirationDate: DateString;
  /** Subscription term in months */
  Contract_Term_Months__c: number;
  Billing_Frequency__c: BillingFrequency;
  Payment_Terms__c: "Net 30" | "Net 45" | "Net 60" | "Due on receipt";
  /** Start of service (go-live), often timed around harvest */
  Start_Date__c: DateString;
  /** Header discount on recurring fees, percent 0–100 (on top of line discounts) */
  Discount__c: number;
  Tax_Rate__c: number;
  Description: string;
  /** Rolled up from line items */
  Subtotal: number;
  TotalPrice: number;
  Approval_Reason__c?: string;
  Approved_By__c?: Id;
  Approved_Date__c?: DateTimeString;
  Sent_Date__c?: DateTimeString;
  Accepted_Date__c?: DateTimeString;
}

export interface QuoteLineItem {
  Id: Id;
  QuoteId: Id;
  Product2Id: Id;
  PricebookEntryId?: Id;
  Quantity: number;
  /** List price per unit from the price book */
  ListPrice: number;
  /** Line discount, percent 0–100 */
  Discount: number;
  /** Price per unit after discount */
  UnitPrice: number;
  TotalPrice: number;
  Description?: string;
  SortOrder: number;
}

export type NewBuildStage = "Announced" | "Permitting" | "Under Construction" | "Commissioning";
export type NewBuildStatus = "New" | "Converted" | "Dismissed";

/** A new or expanding facility found in public sources (mock) */
export interface NewBuild {
  Id: Id;
  Name: string;
  Company: string;
  Facility_Type__c: FacilityType;
  Segment__c: Segment;
  City: string;
  State: string;
  Country: Country;
  Latitude: number;
  Longitude: number;
  Region__c: RegionId;
  Stage: NewBuildStage;
  Status: NewBuildStatus;
  /** Storage (bu) for elevators, gallons/year for ethanol, tons/year for feed/processing */
  Capacity: number;
  Capacity_Unit: "bu" | "gal/yr" | "tons/yr";
  Estimated_Investment: number;
  Announced_Date: DateString;
  Expected_Completion: DateString;
  Source: string;
  Source_Detail: string;
  Summary: string;
  Lead_Id__c?: Id;
  Account_Id__c?: Id;
}

// ---------------------------------------------------------------------------
// Contract → cash → renewal, approvals, audit and Call Desk
// ---------------------------------------------------------------------------

export type ContractStatus = "Draft" | "Legal Review" | "Sent for Signature" | "Signed" | "Active" | "Expired" | "Terminated";
export const CONTRACT_STATUSES: ContractStatus[] = ["Draft", "Legal Review", "Sent for Signature", "Signed", "Active", "Expired", "Terminated"];

export interface Contract {
  Id: Id;
  ContractNumber: string;
  Name: string;
  AccountId: Id;
  OpportunityId?: Id;
  QuoteId?: Id;
  /** Previous contract when this is a renewal */
  RenewedFromId?: Id;
  Status: ContractStatus;
  OwnerId: Id;
  CreatedDate: DateTimeString;
  StartDate: DateString;
  EndDate: DateString;
  TermMonths: number;
  AutoRenew: boolean;
  /** Days before EndDate by which either side must give notice */
  NoticeDays: number;
  /** Yearly price increase, percent */
  PriceIncreasePct: number;
  PaymentTerms: "Net 30" | "Net 45" | "Net 60" | "Due on receipt";
  /** Harvest payment terms: annual invoice due after harvest (needs Finance approval) */
  HarvestTerms: boolean;
  BillingFrequency: BillingFrequency;
  /** Annual recurring revenue at signing */
  ARR: number;
  OneTimeFees: number;
  TCV: number;
  CurrencyIsoCode: "USD" | "CAD";
  DPA: boolean;
  /** Any clause edited from the library text */
  NonStandard: boolean;
  SentForSignatureDate?: DateTimeString;
  SignedDate?: DateTimeString;
  SignedByName?: string;
  SignedByTitle?: string;
  /** PNG data URL of the drawn signature (simulated e-signature) */
  SignatureImage?: string;
  TerminatedDate?: DateString;
  RenewalOpportunityId?: Id;
}

export type ClauseCategory = "Liability" | "Data privacy" | "SLA" | "Auto-renew" | "Price increase" | "Termination" | "Payment" | "General";

/** Clause library entry (Settings → Legal) */
export interface Clause {
  Id: Id;
  Name: string;
  Category: ClauseCategory;
  Body: string;
  IsActive: boolean;
  /** Included on every new contract */
  IsDefault: boolean;
  Version: number;
  LastModifiedDate: DateTimeString;
}

export interface ContractClause {
  Id: Id;
  ContractId: Id;
  ClauseId?: Id;
  Name: string;
  Category: ClauseCategory;
  Body: string;
  /** false once the text differs from the library clause */
  Standard: boolean;
  ApprovalStatus: "Not required" | "Pending" | "Approved" | "Rejected";
  ApprovedById?: Id;
  SortOrder: number;
}

export type InvoiceStatus = "Draft" | "Sent" | "Paid" | "Overdue" | "Void";
export const INVOICE_STATUSES: InvoiceStatus[] = ["Draft", "Sent", "Paid", "Overdue", "Void"];

export interface Invoice {
  Id: Id;
  InvoiceNumber: string;
  ContractId: Id;
  AccountId: Id;
  Status: InvoiceStatus;
  IssueDate: DateString;
  DueDate: DateString;
  PeriodStart: DateString;
  PeriodEnd: DateString;
  /** Recurring portion for the period */
  Recurring: number;
  OneTime: number;
  Tax: number;
  Total: number;
  AmountPaid: number;
  PaidDate?: DateString;
  HarvestTerms: boolean;
  RemindersSent: number;
  LastReminderDate?: DateString;
  CurrencyIsoCode: "USD" | "CAD";
  /** Read from NetSuite (live, read-only) */
  External?: boolean;
}

export interface Payment {
  Id: Id;
  InvoiceId: Id;
  AccountId: Id;
  Amount: number;
  PaymentDate: DateString;
  Method: "ACH" | "Check" | "Wire" | "Card";
  Reference: string;
}

export interface OnboardingProject {
  Id: Id;
  Name: string;
  ContractId: Id;
  AccountId: Id;
  OwnerId: Id;
  Status: "Not Started" | "In Progress" | "Live" | "At Risk";
  StartDate: DateString;
  TargetGoLive: DateString;
  GoLiveDate?: DateString;
}

export interface OnboardingTask {
  Id: Id;
  ProjectId: Id;
  Name: string;
  Phase: "Kickoff" | "Data migration" | "Configuration" | "Training" | "Go-live";
  DueDate: DateString;
  Done: boolean;
  CompletedDate?: DateString;
  SortOrder: number;
}

/** Inputs to the customer health score (mock usage and survey data) */
export interface HealthSignal {
  Id: Id;
  AccountId: Id;
  /** Product usage, 0–100 (share of licensed modules/locations in weekly use) */
  UsageScore: number;
  /** Rolling 90-day open + closed tickets */
  SupportTickets90d: number;
  /** Customer satisfaction, 0–10 */
  CSAT: number;
  /** A key contact (GM, controller) changed recently */
  StakeholderChange: boolean;
  /** Locations licensed vs. total locations (co-ops) */
  LocationsLive: number;
  AsOfDate: DateString;
}

export interface SupportTicket {
  Id: Id;
  AccountId: Id;
  Subject: string;
  Priority: "Low" | "Normal" | "High" | "Urgent";
  Status: "Open" | "Pending" | "Closed";
  Product2Id?: Id;
  CreatedDate: DateTimeString;
  ClosedDate?: DateTimeString;
}

export interface Quota {
  Id: Id;
  OwnerId: Id;
  /** e.g. "2026-Q4" */
  Period: string;
  Amount: number;
}

export interface CommissionPlan {
  Id: Id;
  OwnerId: Id;
  Year: number;
  /** Percent of first-year contract value */
  BaseRatePct: number;
  /** Rate above 100% of annual quota */
  AcceleratorPct: number;
  /** Extra percent for multi-year (24+ month) deals */
  MultiYearBonusPct: number;
  AnnualQuota: number;
}

export type ApprovalType = "Discount" | "Non-standard clause" | "Payment terms";

export interface ApprovalRequest {
  Id: Id;
  Type: ApprovalType;
  Object: "Quote" | "Contract" | "ContractClause";
  RecordId: Id;
  RecordName: string;
  /** Role that must decide */
  ApproverRole: "manager" | "finance" | "legal" | "admin";
  Status: "Pending" | "Approved" | "Rejected";
  Detail: string;
  RequestedById: Id;
  RequestedDate: DateTimeString;
  DecidedById?: Id;
  DecidedDate?: DateTimeString;
  DecisionNote?: string;
}

export interface AuditEntry {
  Id: Id;
  At: DateTimeString;
  UserId: Id;
  UserName: string;
  Role: string;
  Action: "Create" | "Update" | "Delete" | "Approve" | "Reject" | "Sign" | "Send" | "Other";
  Object: string;
  RecordId: Id;
  RecordName: string;
  Changes: { field: string; old: unknown; new: unknown }[];
}

export type CallType = "Discovery" | "Demo" | "Follow-up" | "Negotiation" | "Renewal" | "Check-in";
export const CALL_TYPES: CallType[] = ["Discovery", "Demo", "Follow-up", "Negotiation", "Renewal", "Check-in"];

export interface CallCommitment {
  text: string;
  owner: "us" | "them";
  due?: DateString;
  done: boolean;
}

export interface CallNotes {
  summary: string;
  keyPoints: string[];
  painPoints: string[];
  objections: { objection: string; response: string }[];
  qualification: { budget?: string; decisionMaker?: string; timeline?: string; competitors?: string; locations?: string };
  nextSteps: { text: string; owner: string; due?: DateString }[];
  sentiment: "Positive" | "Neutral" | "Concerned";
  followUpEmail?: { subject: string; body: string };
  source: "ai" | "rules";
}

export interface Call {
  Id: Id;
  Subject: string;
  AccountId: Id;
  OpportunityId?: Id;
  ContactIds: Id[];
  OwnerId: Id;
  CallType: CallType;
  /** Local wall-clock time, ISO without zone ("2026-10-14T09:30") */
  Start: string;
  DurationMin: number;
  Status: "Scheduled" | "Completed" | "Canceled";
  /** Seeded transcript script id (lib/callScripts) */
  ScriptId?: string;
  Transcript?: { speaker: string; text: string; atSec: number }[];
  RepNotes?: string;
  Notes?: CallNotes;
  NotesStatus: "Pending" | "Saved";
  Commitments?: CallCommitment[];
  /** Brief questions checked off during the call */
  QuestionsAsked?: string[];
  CreatedDate: DateTimeString;
}
