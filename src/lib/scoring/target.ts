import type { Account, Commodity, FacilityType, Lead, LivestockFocus, RegionId } from "@/types/salesforce";

/** A scoreable prospect: either an Account or an unconverted Lead, normalized. */
export interface Target {
  id: string;
  kind: "account" | "lead";
  name: string;
  city: string;
  state: string;
  country: string;
  regionId: RegionId;
  facilityType: FacilityType;
  commodities: Commodity[];
  storageBu?: number;
  gallons?: number;
  tons?: number;
  locations: number;
  software: string;
  softwareEnd?: string;
  livestock?: LivestockFocus;
  revenue: number;
  employees: number;
  ownerId: string;
  isCustomer: boolean;
  leadRating?: Lead["Rating"];
  leadStatus?: Lead["Status"];
  lat: number;
  lon: number;
}

export function targetFromAccount(a: Account): Target {
  return {
    id: a.Id,
    kind: "account",
    name: a.Name,
    city: a.BillingCity,
    state: a.BillingState,
    country: a.BillingCountry,
    regionId: a.Region__c,
    facilityType: a.Facility_Type__c,
    commodities: a.Primary_Commodities__c,
    storageBu: a.Storage_Capacity_Bu__c,
    gallons: a.Annual_Production_Gal__c,
    tons: a.Annual_Production_Tons__c,
    locations: a.Number_of_Locations__c,
    software: a.Current_Software__c,
    softwareEnd: a.Software_Contract_End__c,
    livestock: a.Livestock_Focus__c,
    revenue: a.AnnualRevenue,
    employees: a.NumberOfEmployees,
    ownerId: a.OwnerId,
    isCustomer: a.Type === "Customer - Direct",
    lat: a.BillingLatitude,
    lon: a.BillingLongitude,
  };
}

export function targetFromLead(l: Lead): Target {
  return {
    id: l.Id,
    kind: "lead",
    name: l.Company,
    city: l.City,
    state: l.State,
    country: l.Country,
    regionId: l.Region__c,
    facilityType: l.Facility_Type__c,
    commodities: l.Primary_Commodities__c,
    storageBu: l.Storage_Capacity_Bu__c,
    gallons: l.Annual_Production_Gal__c,
    tons: l.Annual_Production_Tons__c,
    locations: l.Number_of_Locations__c,
    software: l.Current_Software__c,
    softwareEnd: l.Software_Contract_End__c,
    livestock: l.Livestock_Focus__c,
    revenue: l.AnnualRevenue,
    employees: l.NumberOfEmployees,
    ownerId: l.OwnerId,
    isCustomer: false,
    leadRating: l.Rating,
    leadStatus: l.Status,
    lat: l.Latitude,
    lon: l.Longitude,
  };
}

/** "14.5M bu", "110M gal/yr", "240K tons/yr" */
export function sizeLabel(t: Pick<Target, "storageBu" | "gallons" | "tons" | "facilityType">): string {
  if (t.gallons) return `${Math.round(t.gallons / 1e6)}M gal/yr`;
  if (t.storageBu && (t.facilityType === "Grain Elevator" || t.facilityType === "Cooperative"))
    return t.storageBu >= 1e6 ? `${(t.storageBu / 1e6).toFixed(1)}M bu` : `${Math.round(t.storageBu / 1000)}K bu`;
  if (t.tons) return t.tons >= 1e6 ? `${(t.tons / 1e6).toFixed(1)}M tons/yr` : `${Math.round(t.tons / 1000)}K tons/yr`;
  if (t.storageBu) return `${(t.storageBu / 1e6).toFixed(1)}M bu`;
  return "—";
}
