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

export interface Account {
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
  IsConverted: false;

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
