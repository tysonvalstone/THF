import type { Account, Segment } from "@/types/salesforce";
import { parseCSV, toCSV } from "@/lib/csv";
import type { Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import { REGION_BY_STATE } from "@/data/reference/regions";

/** Core-market facilities: Illinois and Iowa */
export const CORE_STATES = ["IL", "IA"] as const;

export function isCovered(a: Account): boolean {
  return a.Type === "Customer - Direct";
}

export interface Penetration {
  label: string;
  covered: number;
  total: number;
}

/** "12 of 132 Iowa co-op locations" style coverage figures */
export function penetration(accounts: Account[], filter: (a: Account) => boolean, label: string): Penetration {
  const list = accounts.filter(filter);
  return { label, covered: list.filter(isCovered).length, total: list.length };
}

export function corePenetration(accounts: Account[]): Penetration[] {
  const inState = (s: string) => (a: Account) => a.BillingState === s;
  const seg = (s: Segment) => (a: Account) => a.Segment__c === s;
  const coopLocation = (a: Account) => a.Segment__c === "Multi-Location Co-op" || !!a.ParentId;
  return [
    penetration(accounts, (a) => a.BillingState === "IA" && coopLocation(a), "Iowa co-op locations"),
    penetration(accounts, (a) => a.BillingState === "IL" && coopLocation(a), "Illinois co-op locations"),
    penetration(accounts, (a) => inState("IL")(a) && seg("Country Elevator")(a), "Illinois country elevators"),
    penetration(accounts, (a) => (a.BillingState === "IL" || a.BillingState === "IA") && seg("Feed Mill")(a), "IL + IA feed mills"),
    penetration(accounts, (a) => (a.BillingState === "IL" || a.BillingState === "IA") && seg("Ethanol Plant")(a), "IL + IA ethanol plants"),
    penetration(accounts, (a) => (a.BillingState === "IL" || a.BillingState === "IA") && (seg("River Terminal")(a) || seg("Rail/Shuttle Loader")(a)), "IL + IA terminals & shuttle loaders"),
    penetration(accounts, inState("IL"), "All Illinois facilities"),
    penetration(accounts, inState("IA"), "All Iowa facilities"),
  ];
}

export interface CountyCoverage {
  fips: string;
  county: string;
  state: string;
  facilities: number;
  covered: number;
  prospects: number;
}

/** IL/IA counties with facilities, and how many are covered */
export function countyCoverage(accounts: Account[]): CountyCoverage[] {
  const map = new Map<string, CountyCoverage>();
  for (const a of accounts) {
    if (!a.County_FIPS__c) continue;
    const c = map.get(a.County_FIPS__c) ?? { fips: a.County_FIPS__c, county: a.County__c ?? "", state: a.BillingState, facilities: 0, covered: 0, prospects: 0 };
    c.facilities++;
    if (isCovered(a)) c.covered++;
    else c.prospects++;
    map.set(a.County_FIPS__c, c);
  }
  return [...map.values()].sort((x, y) => y.prospects - x.prospects || x.county.localeCompare(y.county));
}

/** Whitespace: counties with facilities but zero coverage */
export function whitespaceCounties(accounts: Account[]): CountyCoverage[] {
  return countyCoverage(accounts).filter((c) => c.covered === 0);
}

// ---------------------------------------------------------------------------
// Salesforce-ready CSV (headers are Account API field names)
// ---------------------------------------------------------------------------
export const ACCOUNT_CSV_FIELDS = [
  "Id",
  "Name",
  "ParentId",
  "Type",
  "Segment__c",
  "Facility_Type__c",
  "BillingStreet",
  "BillingCity",
  "BillingState",
  "BillingPostalCode",
  "BillingCountry",
  "County__c",
  "County_FIPS__c",
  "BillingLatitude",
  "BillingLongitude",
  "Railroad__c",
  "River_Access__c",
  "Shuttle_Loader__c",
  "Rail_Served__c",
  "Storage_Capacity_Bu__c",
  "Number_of_Locations__c",
  "Current_Software__c",
  "Fiscal_Year_End__c",
  "Board_Meeting_Months__c",
  "Region__c",
] as const;

export function accountsToCsv(accounts: Account[]): string {
  return toCSV(
    accounts,
    ACCOUNT_CSV_FIELDS.map((field) => ({
      header: field,
      value: (a: Account) => {
        const v = (a as unknown as Record<string, unknown>)[field];
        if (Array.isArray(v)) return v.join(";");
        if (typeof v === "boolean") return v ? "true" : "false";
        return v === undefined || v === null ? "" : (v as string | number);
      },
    })),
  );
}

// ---------------------------------------------------------------------------
// CSV import (mock mode): rows with an existing Id update that Account; rows
// without one create a new Account. Live Salesforce stays read-only.
// ---------------------------------------------------------------------------
export interface ImportResult {
  mutations: Mutation[];
  created: number;
  updated: number;
  skipped: { line: number; reason: string }[];
}

const NUMERIC = new Set(["BillingLatitude", "BillingLongitude", "Storage_Capacity_Bu__c", "Number_of_Locations__c"]);
const BOOLEAN = new Set(["River_Access__c", "Shuttle_Loader__c", "Rail_Served__c"]);

export function importAccountsCsv(text: string, existing: Account[]): ImportResult {
  const rows = parseCSV(text);
  const out: ImportResult = { mutations: [], created: 0, updated: 0, skipped: [] };
  if (rows.length < 2) return { ...out, skipped: [{ line: 1, reason: "No data rows" }] };
  const header = rows[0].map((h) => h.trim());
  const byId = new Map(existing.map((a) => [a.Id, a]));
  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const rec: Record<string, unknown> = {};
    header.forEach((h, j) => {
      if (!(ACCOUNT_CSV_FIELDS as readonly string[]).includes(h)) return;
      const raw = (cells[j] ?? "").trim();
      if (raw === "") return;
      if (NUMERIC.has(h)) rec[h] = Number(raw);
      else if (BOOLEAN.has(h)) rec[h] = /^(true|1|yes)$/i.test(raw);
      else if (h === "Board_Meeting_Months__c") rec[h] = raw.split(/[;,]/).map(Number).filter((n) => n >= 1 && n <= 12);
      else rec[h] = raw;
    });
    const id = rec.Id as string | undefined;
    if (id && byId.has(id)) {
      const { Id: _id, ...changes } = rec;
      void _id;
      out.mutations.push({ op: "update", object: "Account", id, changes: changes as Partial<Account> });
      out.updated++;
      return;
    }
    if (!rec.Name || !rec.BillingState) {
      out.skipped.push({ line, reason: "Name and BillingState are required" });
      return;
    }
    const state = String(rec.BillingState);
    const segment = (rec.Segment__c as Segment) ?? "Country Elevator";
    const account: Account = {
      Id: newId("Account"),
      Name: String(rec.Name),
      Type: rec.Type === "Customer - Direct" ? "Customer - Direct" : "Prospect",
      Industry: "Agriculture",
      Phone: "",
      Website: "",
      BillingStreet: (rec.BillingStreet as string) ?? "",
      BillingCity: (rec.BillingCity as string) ?? "",
      BillingState: state,
      BillingPostalCode: (rec.BillingPostalCode as string) ?? "",
      BillingCountry: rec.BillingCountry === "Canada" ? "Canada" : "United States",
      BillingLatitude: (rec.BillingLatitude as number) ?? 41.9,
      BillingLongitude: (rec.BillingLongitude as number) ?? -93.6,
      AnnualRevenue: 0,
      NumberOfEmployees: 0,
      OwnerId: "005Hs00000000001AA",
      CreatedDate: new Date().toISOString(),
      Description: "Imported from CSV.",
      Facility_Type__c: (rec.Facility_Type__c as Account["Facility_Type__c"]) ?? "Grain Elevator",
      Primary_Commodities__c: ["Corn", "Soybeans"],
      Storage_Capacity_Bu__c: rec.Storage_Capacity_Bu__c as number | undefined,
      Number_of_Locations__c: (rec.Number_of_Locations__c as number) ?? 1,
      Current_Software__c: (rec.Current_Software__c as string) ?? "Unknown",
      Region__c: (rec.Region__c as Account["Region__c"]) ?? REGION_BY_STATE[state] ?? "western-corn-belt",
      Rail_Served__c: (rec.Rail_Served__c as boolean) ?? false,
      Segment__c: segment,
      ParentId: rec.ParentId as string | undefined,
      County__c: rec.County__c as string | undefined,
      County_FIPS__c: rec.County_FIPS__c as string | undefined,
      Railroad__c: rec.Railroad__c as string | undefined,
      River_Access__c: (rec.River_Access__c as boolean) ?? false,
      Shuttle_Loader__c: (rec.Shuttle_Loader__c as boolean) ?? false,
      Fiscal_Year_End__c: (rec.Fiscal_Year_End__c as string) ?? "08-31",
      Board_Meeting_Months__c: (rec.Board_Meeting_Months__c as number[]) ?? [],
    };
    out.mutations.push({ op: "create", object: "Account", record: account });
    out.created++;
  });
  return out;
}
