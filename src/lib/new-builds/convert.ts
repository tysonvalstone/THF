/**
 * New build → Lead → Account (+ Contact, + Opportunity) conversions.
 *
 * Pure functions: they take the current data and return the mutations to
 * commit, so the New Builds page, the lead page and the Demo Mode walkthrough
 * all share one implementation.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import { REGION_BY_STATE } from "@/data/reference/regions";
import { ownerForRegion } from "@/data/reference/users";
import { businessDaysOut, estimateOpportunity } from "@/lib/actions/outreach";
import { addDays, toISODate } from "@/lib/dates";
import type { Account, BuyingRole, Commodity, Contact, FacilityType, Lead, NewBuild, Opportunity, RegionId, Segment, Task } from "@/types/salesforce";

export interface ConvertContext {
  data: DataSnapshot;
  asOf: Date;
  /** The rep doing the conversion (owner of follow-up tasks) */
  userId: string;
}

/** "Now" on the as-of date, Salesforce date-time format */
export function stampAt(asOf: Date): string {
  const now = new Date();
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
  return d.toISOString().replace(/\.\d{3}Z$/, ".000+0000");
}

const COMMODITIES_BY_SEGMENT: Partial<Record<Segment, Commodity[]>> = {
  "Ethanol Plant": ["Corn"],
  Processor: ["Soybeans"],
  "Feed Mill": ["Corn", "Soybeans"],
};

const EMPLOYEES_BY_SEGMENT: Partial<Record<Segment, number>> = {
  "Ethanol Plant": 45,
  Processor: 80,
  "Feed Mill": 30,
  "Multi-Location Co-op": 25,
  "Rail/Shuttle Loader": 12,
};

/** Segment implied by a facility type (for leads and accounts entered without one) */
export function segmentForFacility(t: FacilityType): Segment {
  switch (t) {
    case "Ethanol Plant":
      return "Ethanol Plant";
    case "Feed Mill":
      return "Feed Mill";
    case "Cooperative":
      return "Multi-Location Co-op";
    case "Oilseed Crusher":
    case "Flour Mill":
      return "Processor";
    case "Seed Processor":
      return "Seed Cleaner / Specialty Crop";
    default:
      return "Country Elevator";
  }
}

/** Buying role guessed from a title */
export function roleForTitle(title: string): BuyingRole {
  const t = title.toLowerCase();
  if (/controller|cfo|finance|treasurer/.test(t)) return "Economic Buyer";
  if (/general manager|\bgm\b|ceo|president|owner|plant manager/.test(t)) return "Decision Maker";
  if (/board|director/.test(t)) return "Board Member";
  if (/merchandis|grain buyer|origination/.test(t)) return "Champion";
  return "Influencer";
}

/**
 * A lead for a new build. The lead gets the company, place, facility type,
 * segment, region and capacity; the new build is marked Converted and linked
 * to the lead, and a follow-up call task is created.
 */
export function newBuildToLeadMutations(nb: NewBuild, ctx: ConvertContext): { leadId: string; mutations: Mutation[] } {
  const leadId = newId("Lead");
  const stamp = stampAt(ctx.asOf);
  const region = (nb.Region__c ?? REGION_BY_STATE[nb.State] ?? "western-corn-belt") as RegionId;
  const lead: Lead = {
    Id: leadId,
    FirstName: "",
    LastName: "Unknown",
    Name: "Unknown contact",
    Title: "",
    Company: nb.Company,
    Email: "",
    Phone: "",
    Street: "",
    City: nb.City,
    State: nb.State,
    PostalCode: "",
    Country: nb.Country,
    Latitude: nb.Latitude,
    Longitude: nb.Longitude,
    Industry: "Agriculture",
    LeadSource: "Web",
    Status: "Open - Not Contacted",
    Rating: nb.Stage === "Under Construction" || nb.Stage === "Commissioning" ? "Hot" : "Warm",
    NumberOfEmployees: EMPLOYEES_BY_SEGMENT[nb.Segment__c] ?? 8,
    AnnualRevenue: nb.Estimated_Investment,
    OwnerId: ownerForRegion(region),
    CreatedDate: stamp,
    IsConverted: false,
    Facility_Type__c: nb.Facility_Type__c,
    Primary_Commodities__c: COMMODITIES_BY_SEGMENT[nb.Segment__c] ?? ["Corn", "Soybeans"],
    ...(nb.Capacity_Unit === "bu" ? { Storage_Capacity_Bu__c: nb.Capacity } : {}),
    ...(nb.Capacity_Unit === "gal/yr" ? { Annual_Production_Gal__c: nb.Capacity } : {}),
    ...(nb.Capacity_Unit === "tons/yr" ? { Annual_Production_Tons__c: nb.Capacity } : {}),
    Number_of_Locations__c: 1,
    Current_Software__c: "None (new facility)",
    Region__c: region,
    Segment__c: nb.Segment__c,
  };
  const task: Task = {
    Id: newId("Task"),
    Subject: `Call about new build: ${nb.Name}`,
    Type: "Call",
    TaskSubtype: "Task",
    Status: "Not Started",
    Priority: nb.Stage === "Under Construction" || nb.Stage === "Commissioning" ? "High" : "Normal",
    ActivityDate: toISODate(businessDaysOut(ctx.asOf, 2)),
    WhoId: leadId,
    OwnerId: lead.OwnerId,
    CreatedDate: stamp,
    Description: `${nb.Summary}\n\nSource: ${nb.Source} (${nb.Source_Detail}).`,
  };
  return {
    leadId,
    mutations: [
      { op: "create", object: "Lead", record: lead },
      { op: "update", object: "NewBuild", id: nb.Id, changes: { Status: "Converted", Lead_Id__c: leadId } },
      { op: "create", object: "Task", record: task },
    ],
  };
}

export interface LeadConvertOptions {
  /** Defaults to the lead's company */
  accountName?: string;
  /** Create a contact from the lead's person (default: when the lead has a name) */
  createContact?: boolean;
  /** Also create an opportunity (Prospecting, estimated from best-fit products) */
  createOpportunity?: boolean;
  opportunityName?: string;
  /** YYYY-MM-DD; default 90 days out */
  closeDate?: string;
  ownerId?: string;
}

/** Whether the lead names a real person (new-build leads start as "Unknown") */
export function leadHasPerson(lead: Lead): boolean {
  return !!lead.LastName && lead.LastName !== "Unknown";
}

/**
 * Convert a lead: create the Account (and optionally a Contact and an
 * Opportunity), mark the lead converted, move its activity and campaign
 * memberships to the new account, and link any new build to the account.
 */
export function leadToAccountMutations(
  lead: Lead,
  ctx: ConvertContext,
  opts: LeadConvertOptions = {},
): { accountId: string; contactId?: string; opportunityId?: string; mutations: Mutation[] } {
  const stamp = stampAt(ctx.asOf);
  const accountId = newId("Account");
  const ownerId = opts.ownerId ?? lead.OwnerId;
  const account: Account = {
    Id: accountId,
    Name: opts.accountName?.trim() || lead.Company,
    Type: "Prospect",
    Industry: "Agriculture",
    Phone: lead.Phone,
    Website: "",
    BillingStreet: lead.Street,
    BillingCity: lead.City,
    BillingState: lead.State,
    BillingPostalCode: lead.PostalCode,
    BillingCountry: lead.Country,
    BillingLatitude: lead.Latitude,
    BillingLongitude: lead.Longitude,
    AnnualRevenue: lead.AnnualRevenue,
    NumberOfEmployees: lead.NumberOfEmployees,
    OwnerId: ownerId,
    CreatedDate: stamp,
    Description: "",
    Facility_Type__c: lead.Facility_Type__c,
    Primary_Commodities__c: lead.Primary_Commodities__c,
    ...(lead.Storage_Capacity_Bu__c ? { Storage_Capacity_Bu__c: lead.Storage_Capacity_Bu__c } : {}),
    ...(lead.Annual_Production_Gal__c ? { Annual_Production_Gal__c: lead.Annual_Production_Gal__c } : {}),
    ...(lead.Annual_Production_Tons__c ? { Annual_Production_Tons__c: lead.Annual_Production_Tons__c } : {}),
    Number_of_Locations__c: lead.Number_of_Locations__c || 1,
    Current_Software__c: lead.Current_Software__c,
    ...(lead.Software_Contract_End__c ? { Software_Contract_End__c: lead.Software_Contract_End__c } : {}),
    ...(lead.Livestock_Focus__c ? { Livestock_Focus__c: lead.Livestock_Focus__c } : {}),
    Region__c: lead.Region__c,
    Rail_Served__c: false,
    Segment__c: lead.Segment__c ?? segmentForFacility(lead.Facility_Type__c),
    River_Access__c: false,
    Shuttle_Loader__c: false,
    Fiscal_Year_End__c: "08-31",
    Board_Meeting_Months__c: [],
  };
  const mutations: Mutation[] = [{ op: "create", object: "Account", record: account }];

  let contact: Contact | undefined;
  if (opts.createContact ?? leadHasPerson(lead)) {
    contact = {
      Id: newId("Contact"),
      AccountId: accountId,
      FirstName: lead.FirstName,
      LastName: lead.LastName,
      Name: lead.Name || `${lead.FirstName} ${lead.LastName}`.trim(),
      Title: lead.Title,
      Email: lead.Email,
      Phone: lead.Phone,
      MailingStreet: lead.Street,
      MailingCity: lead.City,
      MailingState: lead.State,
      MailingPostalCode: lead.PostalCode,
      MailingCountry: lead.Country,
      OwnerId: ownerId,
      Buying_Role__c: roleForTitle(lead.Title),
      HasOptedOutOfEmail: false,
      CreatedDate: stamp,
    };
    mutations.push({ op: "create", object: "Contact", record: contact });
  }

  let opportunityId: string | undefined;
  if (opts.createOpportunity) {
    const eb = contact?.Buying_Role__c === "Economic Buyer" ? contact : undefined;
    const { opp, lines } = estimateOpportunity({ ...ctx, data: ctx.data }, account, eb ? "Book a discovery call" : "Identify the economic buyer (controller or GM)", eb ? "Qualification" : "Prospecting");
    const finalOpp: Opportunity = {
      ...opp,
      ...(opts.opportunityName?.trim() ? { Name: opts.opportunityName.trim() } : {}),
      CloseDate: opts.closeDate || toISODate(addDays(ctx.asOf, 90)),
      LeadSource: lead.LeadSource,
      OwnerId: ownerId,
      ...(contact ? { Primary_Contact__c: contact.Id } : {}),
      ...(eb ? { Economic_Buyer_Identified__c: true, Economic_Buyer__c: eb.Id } : {}),
    };
    opportunityId = finalOpp.Id;
    mutations.push({ op: "create", object: "Opportunity", record: finalOpp }, ...lines);
  }

  mutations.push({
    op: "update",
    object: "Lead",
    id: lead.Id,
    changes: {
      IsConverted: true,
      ConvertedDate: toISODate(ctx.asOf),
      ConvertedAccountId: accountId,
      ...(contact ? { ConvertedContactId: contact.Id } : {}),
      ...(opportunityId ? { ConvertedOpportunityId: opportunityId } : {}),
    },
  });

  // Activity and campaign history follow the lead to its account
  for (const t of ctx.data.tasks.filter((x) => x.WhoId === lead.Id)) {
    mutations.push({ op: "update", object: "Task", id: t.Id, changes: { AccountId: accountId, WhatId: opportunityId ?? accountId, ...(contact ? { WhoId: contact.Id } : {}) } });
  }
  for (const e of ctx.data.events.filter((x) => x.WhoId === lead.Id)) {
    mutations.push({ op: "update", object: "Event", id: e.Id, changes: { AccountId: accountId, WhatId: opportunityId ?? accountId, ...(contact ? { WhoId: contact.Id } : {}) } });
  }
  for (const m of ctx.data.campaignMembers.filter((x) => x.LeadId === lead.Id)) {
    mutations.push({ op: "update", object: "CampaignMember", id: m.Id, changes: { AccountId: accountId, ...(contact ? { ContactId: contact.Id } : {}) } });
  }
  for (const nb of ctx.data.newBuilds.filter((x) => x.Lead_Id__c === lead.Id)) {
    mutations.push({ op: "update", object: "NewBuild", id: nb.Id, changes: { Account_Id__c: accountId } });
  }

  return { accountId, contactId: contact?.Id, opportunityId, mutations };
}
