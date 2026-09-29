/**
 * Live Salesforce data loader (server only).
 *
 * READ-ONLY BY DESIGN: this module only ever authenticates, describes objects
 * and runs SOQL SELECT queries (`conn.query` / `conn.describe`). It never
 * inserts, updates, upserts, deletes or otherwise writes to Salesforce. Keep
 * it that way — the integration user should also be granted Read-only access
 * (see docs/salesforce-setup.md).
 *
 * The SOQL sent here matches the hand-runnable queries in /soql when every
 * custom field exists. Fields that don't exist in the connected org are
 * dropped from the SELECT (via describe()) and filled with sensible defaults,
 * with a warning recorded in the result.
 */
import "server-only";

import { Connection } from "jsforce";

import { REGIONS, REGION_BY_ID, REGION_BY_STATE } from "@/data/reference/regions";
import { CANADIAN_PROVINCES, STATE_NAMES } from "@/data/reference/geo";
import { TOWNS } from "@/data/reference/towns";
import type { DataSnapshot } from "@/lib/data/types";
import {
  ALL_STAGES,
  COMMODITIES,
  FACILITY_TYPES,
  SEGMENTS,
  type Account,
  type AccountType,
  type BuyingRole,
  type Campaign,
  type CampaignContent,
  type CampaignMember,
  type CampaignMemberStatus,
  type CampaignStatus,
  type CampaignType,
  type Commodity,
  type Contact,
  type Country,
  type Event,
  type EventType,
  type FacilityType,
  type ForecastCategory,
  type LeadSource,
  type Opportunity,
  type OpportunityStage,
  type RegionId,
  type Segment,
  type Task,
  type TaskStatus,
  type TaskType,
} from "@/types/salesforce";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const SF_ENV_VARS = ["SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET", "SF_USERNAME", "SF_PASSWORD"] as const;

/** True when all five SF_* env vars are present and non-empty. */
export function isLiveConfigured(): boolean {
  return SF_ENV_VARS.every((name) => (process.env[name] ?? "").trim().length > 0);
}

export interface LiveLoadResult {
  snapshot: DataSnapshot;
  /** e.g. https://acme.my.salesforce.com */
  instanceUrl: string;
  /** e.g. https://acme.lightning.force.com */
  lightningBaseUrl: string;
  /** ISO timestamp */
  loadedAt: string;
  warnings: string[];
}

export function opportunityUrl(lightningBaseUrl: string, id: string): string {
  return `${lightningBaseUrl.replace(/\/+$/, "")}/lightning/r/Opportunity/${id}/view`;
}

/** Max rows fetched per object. */
const MAX_ROWS = 20_000;

export async function loadSalesforceSnapshot(): Promise<LiveLoadResult> {
  if (!isLiveConfigured()) {
    const missing = SF_ENV_VARS.filter((n) => !(process.env[n] ?? "").trim());
    throw new Error(`Salesforce is not configured. Missing env vars: ${missing.join(", ")}`);
  }
  const loginUrl = process.env.SF_LOGIN_URL!.trim().replace(/\/+$/, "");
  const conn = new Connection({
    loginUrl,
    oauth2: {
      clientId: process.env.SF_CLIENT_ID!.trim(),
      clientSecret: process.env.SF_CLIENT_SECRET!.trim(),
      loginUrl,
    },
  });

  try {
    // With clientId + clientSecret set, jsforce v3 uses the OAuth 2.0
    // username-password flow (not SOAP).
    await conn.login(process.env.SF_USERNAME!.trim(), process.env.SF_PASSWORD!);
  } catch (err) {
    throw new Error(`Salesforce login failed (${safeErrorCode(err)}). Check SF_LOGIN_URL, the connected app and the integration user's credentials/security token.`);
  }

  const warnings: string[] = [];
  const instanceUrl = (conn.instanceUrl ?? "").replace(/\/+$/, "");
  const lightningBaseUrl = instanceUrl.includes(".my.salesforce.com")
    ? instanceUrl.replace(".my.salesforce.com", ".lightning.force.com")
    : instanceUrl;

  const ctx: Ctx = { conn, warnings, fieldCache: new Map() };

  // Core objects: failure here is fatal.
  const accountFields = (await describeFields(ctx, "Account", true))!;
  const oppFields = (await describeFields(ctx, "Opportunity", true))!; // required=true throws instead of returning null

  const rawAccounts = await runQuery(ctx, "Account", buildAccountSoql(ctx, accountFields), true);
  const rawOpps = await runQuery(ctx, "Opportunity", buildOpportunitySoql(ctx, oppFields, accountFields), true);

  const opportunities = rawOpps.map((r) => mapOpportunity(r, ctx));
  const wonAccountIds = new Set(opportunities.filter((o) => o.IsWon).map((o) => o.AccountId));
  const accounts = rawAccounts.map((r) => mapAccount(r, wonAccountIds));
  reportAccountDefaults(ctx, accountFields, accounts);

  // Supporting objects: best effort.
  const contacts = (await bestEffort(ctx, "Contact", buildContactSoql)).map(mapContact);
  const campaigns = (await bestEffort(ctx, "Campaign", buildCampaignSoql)).map(mapCampaign);
  const campaignMembers = (await bestEffort(ctx, "CampaignMember", buildCampaignMemberSoql)).map(mapCampaignMember);
  const tasks = (await bestEffort(ctx, "Task", buildTaskSoql)).map(mapTask);
  const events = (await bestEffort(ctx, "Event", buildEventSoql)).map(mapEvent);

  if (ctx.unmappedStages?.size) {
    warnings.push(`Opportunity stages not in HarvestSignal's list were mapped by probability: ${[...ctx.unmappedStages].join(", ")}`);
  }

  return {
    snapshot: {
      accounts,
      contacts,
      leads: [],
      opportunities,
      lineItems: [],
      campaigns,
      campaignMembers,
      tasks,
      events,
    },
    instanceUrl,
    lightningBaseUrl,
    loadedAt: new Date().toISOString(),
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Query plumbing (read-only)
// ---------------------------------------------------------------------------

type SfRecord = { [field: string]: unknown };

interface Ctx {
  conn: Connection;
  warnings: string[];
  fieldCache: Map<string, Set<string>>;
  unmappedStages?: Set<string>;
}

/** Returns the lower-cased set of field API names on an object. */
async function describeFields(ctx: Ctx, object: string, required: boolean): Promise<Set<string> | null> {
  const cached = ctx.fieldCache.get(object);
  if (cached) return cached;
  try {
    const d = await ctx.conn.describe(object);
    const set = new Set(d.fields.map((f) => f.name.toLowerCase()));
    ctx.fieldCache.set(object, set);
    return set;
  } catch (err) {
    const msg = `Could not describe ${object} (${safeErrorCode(err)})`;
    if (required) throw new Error(`${msg}. Does the integration user have Read access to ${object}?`);
    ctx.warnings.push(`${msg}; ${object} data skipped.`);
    return null;
  }
}

/**
 * Keeps the desired fields that exist on the object. Relationship fields
 * ("Account.Name") are passed through unchanged. Missing fields listed in
 * `important` produce a warning.
 */
function pick(ctx: Ctx, object: string, fields: Set<string>, desired: string[], important: string[] = []): string[] {
  const out: string[] = [];
  for (const f of desired) {
    if (f.includes(".") || fields.has(f.toLowerCase())) out.push(f);
    else if (important.includes(f)) ctx.warnings.push(`${object}.${f} not found in this org; using defaults.`);
  }
  return out;
}

async function runQuery(ctx: Ctx, object: string, soql: string, required: boolean): Promise<SfRecord[]> {
  try {
    const res = await ctx.conn.query<SfRecord>(soql, { autoFetch: true, maxFetch: MAX_ROWS });
    const records = res.records;
    if (records.length >= MAX_ROWS || res.totalSize > records.length) {
      ctx.warnings.push(`${object}: row cap of ${MAX_ROWS.toLocaleString()} reached (${res.totalSize.toLocaleString()} matched); some records were not loaded.`);
    }
    return records;
  } catch (err) {
    const msg = `${object} query failed (${safeErrorCode(err)})`;
    if (required) throw new Error(msg);
    ctx.warnings.push(`${msg}; ${object} data skipped.`);
    return [];
  }
}

async function bestEffort(ctx: Ctx, object: string, build: (ctx: Ctx, fields: Set<string>) => string): Promise<SfRecord[]> {
  const fields = await describeFields(ctx, object, false);
  if (!fields) return [];
  return runQuery(ctx, object, build(ctx, fields), false);
}

/** Error name/code only — never echo request bodies (they could contain secrets). */
function safeErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { errorCode?: unknown; name?: unknown; message?: unknown };
    if (typeof e.errorCode === "string") return e.errorCode;
    if (typeof e.name === "string" && e.name !== "Error") return e.name;
    if (typeof e.message === "string") {
      // Messages from Salesforce like "INVALID_LOGIN: ..." or "invalid_grant: ..." — keep the code part.
      const m = e.message.match(/^([A-Za-z_]+)(?::|\s|$)/);
      if (m) return m[1];
    }
  }
  return "unknown error";
}

// ---------------------------------------------------------------------------
// SOQL builders (keep in sync with /soql/*.soql)
// ---------------------------------------------------------------------------

function buildAccountSoql(ctx: Ctx, fields: Set<string>): string {
  const cols = pick(
    ctx,
    "Account",
    fields,
    [
      "Id", "Name", "Type", "Industry", "Phone", "Website", "Description",
      "BillingStreet", "BillingCity", "BillingState", "BillingPostalCode", "BillingCountry",
      "BillingLatitude", "BillingLongitude", "AnnualRevenue", "NumberOfEmployees",
      "ParentId", "OwnerId", "CreatedDate",
      "Segment__c", "Facility_Type__c", "Primary_Commodities__c", "Storage_Capacity_Bu__c",
      "Annual_Production_Gal__c", "Annual_Production_Tons__c", "Livestock_Focus__c",
      "Number_of_Locations__c", "Current_Software__c", "Software_Contract_End__c",
      "Region__c", "County__c", "County_FIPS__c", "Railroad__c", "River_Access__c",
      "Shuttle_Loader__c", "Fiscal_Year_End__c", "Board_Meeting_Months__c", "Rail_Served__c",
    ],
    ["Segment__c", "Facility_Type__c", "Region__c", "Fiscal_Year_End__c", "Board_Meeting_Months__c", "Current_Software__c"],
  );
  return `SELECT ${cols.join(", ")} FROM Account ORDER BY Name`;
}

function buildOpportunitySoql(ctx: Ctx, fields: Set<string>, accountFields: Set<string> | null): string {
  const desired = [
    "Id", "AccountId", "Account.Name", "Name", "Type", "StageName", "Amount", "CloseDate",
    "Probability", "ForecastCategoryName", "NextStep", "LeadSource", "OwnerId",
    "IsClosed", "IsWon", "CreatedDate", "LastModifiedDate",
    "Economic_Buyer_Identified__c", "Economic_Buyer__c", "Loss_Reason__c", "Primary_Contact__c",
  ];
  if (accountFields?.has("segment__c")) desired.splice(3, 0, "Account.Segment__c");
  const cols = pick(ctx, "Opportunity", fields, desired, ["Economic_Buyer_Identified__c"]);
  return `SELECT ${cols.join(", ")} FROM Opportunity WHERE IsClosed = false OR CreatedDate = LAST_N_YEARS:3 ORDER BY CloseDate DESC`;
}

function buildContactSoql(ctx: Ctx, fields: Set<string>): string {
  const cols = pick(
    ctx,
    "Contact",
    fields,
    [
      "Id", "AccountId", "FirstName", "LastName", "Name", "Title", "Email", "Phone", "MobilePhone",
      "MailingStreet", "MailingCity", "MailingState", "MailingPostalCode", "MailingCountry",
      "OwnerId", "HasOptedOutOfEmail", "CreatedDate", "Buying_Role__c",
    ],
    ["Buying_Role__c"],
  );
  return `SELECT ${cols.join(", ")} FROM Contact WHERE AccountId != null ORDER BY LastName`;
}

function buildCampaignSoql(ctx: Ctx, fields: Set<string>): string {
  const cols = pick(ctx, "Campaign", fields, [
    "Id", "Name", "Type", "Status", "IsActive", "StartDate", "EndDate", "BudgetedCost", "ActualCost",
    "ExpectedRevenue", "ExpectedResponse", "NumberSent", "Description", "OwnerId", "CreatedDate",
    "Season__c", "Target_Regions__c", "Target_Facility_Types__c", "Target_Commodity__c", "Content__c",
  ]);
  return `SELECT ${cols.join(", ")} FROM Campaign ORDER BY StartDate DESC`;
}

function buildCampaignMemberSoql(ctx: Ctx, fields: Set<string>): string {
  const cols = pick(ctx, "CampaignMember", fields, [
    "Id", "CampaignId", "ContactId", "LeadId", "Contact.AccountId", "Status", "HasResponded",
    "FirstRespondedDate", "CreatedDate",
  ]);
  return `SELECT ${cols.join(", ")} FROM CampaignMember WHERE CreatedDate = LAST_N_YEARS:3 ORDER BY CreatedDate DESC`;
}

function buildTaskSoql(ctx: Ctx, fields: Set<string>): string {
  const cols = pick(ctx, "Task", fields, [
    "Id", "Subject", "Type", "TaskSubtype", "Status", "IsClosed", "Priority", "ActivityDate",
    "WhoId", "WhatId", "AccountId", "OwnerId", "Description", "CallDisposition",
    "CallDurationInSeconds", "CreatedDate", "CompletedDateTime",
  ]);
  return (
    `SELECT ${cols.join(", ")} FROM Task ` +
    `WHERE ActivityDate = LAST_N_DAYS:365 OR ActivityDate > TODAY OR (ActivityDate = null AND CreatedDate = LAST_N_DAYS:365) ` +
    `ORDER BY ActivityDate DESC NULLS LAST`
  );
}

function buildEventSoql(ctx: Ctx, fields: Set<string>): string {
  const cols = pick(ctx, "Event", fields, [
    "Id", "Subject", "Type", "StartDateTime", "EndDateTime", "Location", "WhoId", "WhatId",
    "AccountId", "OwnerId", "Description", "CreatedDate",
  ]);
  return `SELECT ${cols.join(", ")} FROM Event WHERE StartDateTime = LAST_N_DAYS:365 OR StartDateTime > TODAY ORDER BY StartDateTime DESC`;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function str(v: unknown, fallback = ""): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}
function optStr(v: unknown): string | undefined {
  return v === null || v === undefined || v === "" ? undefined : String(v);
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
function optNum(v: unknown): number | undefined {
  const n = num(v, NaN);
  return Number.isFinite(n) ? n : undefined;
}
function bool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return /^(true|yes|y|1)$/i.test(v.trim());
  return fallback;
}
function multi(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v !== "string" || !v.trim()) return [];
  return v.split(";").map((s) => s.trim()).filter(Boolean);
}
/** YYYY-MM-DD */
function dateOnly(v: unknown, fallback = ""): string {
  const s = str(v);
  return s ? s.slice(0, 10) : fallback;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  const s = str(v).trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === s);
}
function field(r: SfRecord, path: string): unknown {
  let cur: unknown = r;
  for (const part of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as SfRecord)[part];
  }
  return cur;
}

const REGION_IDS = REGIONS.map((r) => r.id);
const STATE_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).flatMap(([code, name]) => [
    [name.toLowerCase(), code],
    [name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(), code],
  ]),
);

function stateCode(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "";
  if (s.length === 2) return s.toUpperCase();
  return STATE_CODE_BY_NAME[s.toLowerCase()] ?? s;
}

function country(v: unknown, state: string): Country {
  const s = str(v).trim().toLowerCase();
  if (s === "canada" || s === "ca") return "Canada";
  if (!s && CANADIAN_PROVINCES.includes(state)) return "Canada";
  return "United States";
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_END = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function monthNumber(s: string): number | undefined {
  const t = s.trim().toLowerCase();
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  const i = MONTHS.findIndex((m) => t.startsWith(m));
  return i >= 0 ? i + 1 : undefined;
}

/** Normalizes to "MM-DD". Accepts "08-31", "2025-08-31", "8/31", "August". */
function fiscalYearEnd(v: unknown): string {
  const s = str(v).trim();
  if (!s) return "12-31";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const month = monthNumber(s);
  if (month) return `${String(month).padStart(2, "0")}-${MONTH_END[month - 1]}`;
  return "12-31";
}

// ---------------------------------------------------------------------------
// Heuristics for missing custom fields
// ---------------------------------------------------------------------------

/** Derives a segment when Account.Segment__c is missing or has an unknown value. */
export function deriveSegment(name: string, industry = "", type = ""): Segment {
  const t = `${name} ${industry} ${type}`.toLowerCase();
  if (/co-?op|cooperative/.test(t)) return "Multi-Location Co-op";
  if (/ethanol|energy/.test(t)) return "Ethanol Plant";
  if (/feed/.test(t)) return "Feed Mill";
  if (/terminal/.test(t)) return "River Terminal";
  if (/shuttle|rail/.test(t)) return "Rail/Shuttle Loader";
  if (/mill|crush|processing/.test(t)) return "Processor";
  if (/seed/.test(t)) return "Seed Cleaner / Specialty Crop";
  return "Country Elevator";
}

function facilityFromSegment(segment: Segment, name: string): FacilityType {
  switch (segment) {
    case "Multi-Location Co-op":
      return "Cooperative";
    case "Ethanol Plant":
      return "Ethanol Plant";
    case "Feed Mill":
      return "Feed Mill";
    case "Processor":
      return /flour/i.test(name) ? "Flour Mill" : "Oilseed Crusher";
    case "Seed Cleaner / Specialty Crop":
      return "Seed Processor";
    default:
      return "Grain Elevator";
  }
}

function regionFallbackCommodities(region: RegionId): Commodity[] {
  const r = REGION_BY_ID[region];
  if (!r) return ["Corn", "Soybeans"];
  return [...r.crops].sort((a, b) => b.importance - a.importance).slice(0, 2).map((c) => c.commodity);
}

const STATE_CENTROID: Record<string, [number, number]> = (() => {
  const acc: Record<string, [number, number, number]> = {};
  for (const t of TOWNS) {
    const a = (acc[t.state] ??= [0, 0, 0]);
    a[0] += t.lat;
    a[1] += t.lon;
    a[2] += 1;
  }
  return Object.fromEntries(Object.entries(acc).map(([s, [la, lo, n]]) => [s, [la / n, lo / n]]));
})();

function coordinates(lat: unknown, lon: unknown, city: string, state: string): [number, number] {
  const la = optNum(lat);
  const lo = optNum(lon);
  if (la !== undefined && lo !== undefined) return [la, lo];
  const town = TOWNS.find((t) => t.state === state && t.name.toLowerCase() === city.toLowerCase());
  if (town) return [town.lat, town.lon];
  return STATE_CENTROID[state] ?? [41.6, -93.6]; // central Iowa
}

// ---------------------------------------------------------------------------
// Record mappers
// ---------------------------------------------------------------------------

function mapAccount(r: SfRecord, wonAccountIds: Set<string>): Account {
  const id = str(r.Id);
  const name = str(r.Name);
  const state = stateCode(r.BillingState);
  const city = str(r.BillingCity);
  const segment = oneOf(r.Segment__c, SEGMENTS) ?? deriveSegment(name, str(r.Industry), str(r.Type));
  const region: RegionId =
    oneOf(r.Region__c, REGION_IDS) ?? REGION_BY_STATE[state] ?? "western-corn-belt";
  const rawType = str(r.Type);
  const type: AccountType = /customer/i.test(rawType) || (!rawType && wonAccountIds.has(id)) ? "Customer - Direct" : "Prospect";
  const commodities = multi(r.Primary_Commodities__c)
    .map((c) => oneOf(c, COMMODITIES))
    .filter((c): c is Commodity => !!c);
  const railroad = optStr(r.Railroad__c);
  const shuttle = r.Shuttle_Loader__c === undefined || r.Shuttle_Loader__c === null ? segment === "Rail/Shuttle Loader" : bool(r.Shuttle_Loader__c);
  const [lat, lon] = coordinates(r.BillingLatitude, r.BillingLongitude, city, state);
  const livestock = oneOf(r.Livestock_Focus__c, ["Swine", "Poultry", "Dairy", "Beef Cattle", "Mixed"] as const);

  return {
    Id: id,
    Name: name,
    Type: type,
    Industry: "Agriculture",
    Phone: str(r.Phone),
    Website: str(r.Website),
    BillingStreet: str(r.BillingStreet),
    BillingCity: city,
    BillingState: state,
    BillingPostalCode: str(r.BillingPostalCode),
    BillingCountry: country(r.BillingCountry, state),
    BillingLatitude: lat,
    BillingLongitude: lon,
    AnnualRevenue: num(r.AnnualRevenue),
    NumberOfEmployees: num(r.NumberOfEmployees),
    OwnerId: str(r.OwnerId),
    CreatedDate: str(r.CreatedDate),
    Description: str(r.Description),

    Facility_Type__c: oneOf(r.Facility_Type__c, FACILITY_TYPES) ?? facilityFromSegment(segment, name),
    Primary_Commodities__c: commodities.length ? commodities : regionFallbackCommodities(region),
    Storage_Capacity_Bu__c: optNum(r.Storage_Capacity_Bu__c),
    Annual_Production_Gal__c: optNum(r.Annual_Production_Gal__c),
    Annual_Production_Tons__c: optNum(r.Annual_Production_Tons__c),
    Number_of_Locations__c: Math.max(1, num(r.Number_of_Locations__c, 1)),
    Current_Software__c: str(r.Current_Software__c, "Unknown") || "Unknown",
    Software_Contract_End__c: optStr(r.Software_Contract_End__c) ? dateOnly(r.Software_Contract_End__c) : undefined,
    Livestock_Focus__c: livestock,
    Region__c: region,
    Rail_Served__c: bool(r.Rail_Served__c) || shuttle || !!railroad,
    Segment__c: segment,
    ParentId: optStr(r.ParentId),
    County__c: optStr(r.County__c),
    County_FIPS__c: optStr(r.County_FIPS__c),
    Railroad__c: railroad,
    River_Access__c: r.River_Access__c === undefined || r.River_Access__c === null ? segment === "River Terminal" : bool(r.River_Access__c),
    Shuttle_Loader__c: shuttle,
    Fiscal_Year_End__c: fiscalYearEnd(r.Fiscal_Year_End__c),
    Board_Meeting_Months__c: [...new Set(multi(r.Board_Meeting_Months__c).map(monthNumber).filter((n): n is number => !!n))].sort((a, b) => a - b),
  };
}

function reportAccountDefaults(ctx: Ctx, fields: Set<string> | null, accounts: Account[]) {
  if (!fields) return;
  if (!fields.has("segment__c")) {
    ctx.warnings.push("Segments derived from account Name/Industry/Type because Account.Segment__c is missing.");
  }
  if (!fields.has("region__c")) {
    ctx.warnings.push("Regions derived from BillingState because Account.Region__c is missing.");
  }
  const noState = accounts.filter((a) => !REGION_BY_STATE[a.BillingState] && !fields.has("region__c")).length;
  if (noState) ctx.warnings.push(`${noState} account(s) have no recognizable BillingState; defaulted to the Western Corn Belt region.`);
}

const STAGE_KEYWORDS: [RegExp, OpportunityStage][] = [
  [/board|approv/i, "Board Approval"],
  [/negot|review|contract/i, "Negotiation"],
  [/propos|quote|price|value/i, "Proposal"],
  [/needs|analysis|discover|demo|solution/i, "Needs Analysis"],
  [/qualif/i, "Qualification"],
  [/prospect/i, "Prospecting"],
];

function mapStage(r: SfRecord, ctx: Ctx): OpportunityStage {
  const exact = oneOf(r.StageName, ALL_STAGES);
  if (exact) return exact;
  const isClosed = bool(r.IsClosed);
  if (isClosed) return bool(r.IsWon) ? "Closed Won" : "Closed Lost";
  const raw = str(r.StageName);
  (ctx.unmappedStages ??= new Set()).add(raw || "(blank)");
  for (const [re, stage] of STAGE_KEYWORDS) if (re.test(raw)) return stage;
  const p = num(r.Probability);
  if (p <= 10) return "Prospecting";
  if (p <= 20) return "Qualification";
  if (p <= 40) return "Needs Analysis";
  if (p <= 60) return "Proposal";
  if (p <= 80) return "Negotiation";
  return "Board Approval";
}

function mapForecast(v: unknown, stage: OpportunityStage): ForecastCategory {
  const s = str(v).toLowerCase();
  if (s === "pipeline") return "Pipeline";
  if (s === "best case" || s === "bestcase") return "Best Case";
  if (s === "commit" || s === "most likely" || s === "forecast") return "Commit";
  if (s === "closed") return "Closed";
  if (s === "omitted") return "Omitted";
  if (stage === "Closed Won") return "Closed";
  if (stage === "Closed Lost") return "Omitted";
  return "Pipeline";
}

function mapLeadSource(v: unknown): LeadSource {
  const s = str(v).toLowerCase();
  if (/trade|show|conference|event/.test(s)) return "Trade Show";
  if (/referr|word of mouth|employee/.test(s)) return "Referral";
  if (/list/.test(s)) return "Purchased List";
  if (/partner/.test(s)) return "Partner";
  if (/webinar|seminar/.test(s)) return "Webinar";
  if (/mail/.test(s)) return "Direct Mail";
  return "Web";
}

function mapOpportunity(r: SfRecord, ctx: Ctx): Opportunity {
  const stage = mapStage(r, ctx);
  const isClosed = r.IsClosed === undefined ? stage.startsWith("Closed") : bool(r.IsClosed);
  const isWon = r.IsWon === undefined ? stage === "Closed Won" : bool(r.IsWon);
  const created = str(r.CreatedDate);
  return {
    Id: str(r.Id),
    AccountId: str(r.AccountId),
    Name: str(r.Name),
    Type: /add|upsell|upgrade|existing|renewal|expan/i.test(str(r.Type)) ? "Add-On Business" : "New Business",
    StageName: stage,
    Amount: num(r.Amount),
    CloseDate: dateOnly(r.CloseDate, created.slice(0, 10)),
    Probability: num(r.Probability),
    ForecastCategoryName: mapForecast(r.ForecastCategoryName, stage),
    NextStep: str(r.NextStep),
    LeadSource: mapLeadSource(r.LeadSource),
    OwnerId: str(r.OwnerId),
    IsClosed: isClosed,
    IsWon: isWon,
    CreatedDate: created,
    LastModifiedDate: str(r.LastModifiedDate, created),
    Loss_Reason__c: optStr(r.Loss_Reason__c),
    Primary_Contact__c: optStr(r.Primary_Contact__c),
    // Missing field → assume identified once a deal is past Prospecting.
    Economic_Buyer_Identified__c:
      r.Economic_Buyer_Identified__c === undefined || r.Economic_Buyer_Identified__c === null
        ? stage !== "Prospecting"
        : bool(r.Economic_Buyer_Identified__c),
    Economic_Buyer__c: optStr(r.Economic_Buyer__c),
  };
}

function buyingRole(v: unknown, title: string): BuyingRole {
  const exact = oneOf(v, ["Decision Maker", "Economic Buyer", "Champion", "Influencer", "End User", "Board Member"] as const);
  if (exact) return exact;
  const t = title.toLowerCase();
  if (/board|chair/.test(t)) return "Board Member";
  if (/cfo|controller|finance|treasurer/.test(t)) return "Economic Buyer";
  if (/ceo|president|general manager|\bgm\b|owner/.test(t)) return "Decision Maker";
  if (/manager|director|\bit\b|operations/.test(t)) return "Influencer";
  return "End User";
}

function mapContact(r: SfRecord): Contact {
  const state = stateCode(r.MailingState);
  const title = str(r.Title);
  const first = str(r.FirstName);
  const last = str(r.LastName);
  return {
    Id: str(r.Id),
    AccountId: str(r.AccountId),
    FirstName: first,
    LastName: last,
    Name: str(r.Name, `${first} ${last}`.trim()),
    Title: title,
    Email: str(r.Email),
    Phone: str(r.Phone),
    MobilePhone: optStr(r.MobilePhone),
    MailingStreet: str(r.MailingStreet),
    MailingCity: str(r.MailingCity),
    MailingState: state,
    MailingPostalCode: str(r.MailingPostalCode),
    MailingCountry: country(r.MailingCountry, state),
    OwnerId: str(r.OwnerId),
    Buying_Role__c: buyingRole(r.Buying_Role__c, title),
    HasOptedOutOfEmail: bool(r.HasOptedOutOfEmail),
    CreatedDate: str(r.CreatedDate),
  };
}

function campaignType(v: unknown): CampaignType {
  const exact = oneOf(v, ["Direct Mail", "Email", "Event", "Call Blitz", "Multi-Channel"] as const);
  if (exact) return exact;
  const s = str(v).toLowerCase();
  if (/mail/.test(s)) return "Direct Mail";
  if (/email/.test(s)) return "Email";
  if (/tele|call|phone/.test(s)) return "Call Blitz";
  if (/event|conference|trade|show|webinar|seminar/.test(s)) return "Event";
  return "Multi-Channel";
}

function campaignStatus(v: unknown): CampaignStatus {
  const exact = oneOf(v, ["Planned", "In Progress", "Completed", "Aborted"] as const);
  if (exact) return exact;
  const s = str(v).toLowerCase();
  if (/progress|active/.test(s)) return "In Progress";
  if (/complete|done|closed/.test(s)) return "Completed";
  if (/abort|cancel/.test(s)) return "Aborted";
  return "Planned";
}

function parseContent(v: unknown): CampaignContent | undefined {
  if (typeof v !== "string" || !v.trim().startsWith("{")) return undefined;
  try {
    const c = JSON.parse(v) as CampaignContent;
    return c && typeof c === "object" && c.letter && Array.isArray(c.emails) && c.callScript ? c : undefined;
  } catch {
    return undefined;
  }
}

function mapCampaign(r: SfRecord): Campaign {
  const start = dateOnly(r.StartDate, dateOnly(r.CreatedDate));
  return {
    Id: str(r.Id),
    Name: str(r.Name),
    Type: campaignType(r.Type),
    Status: campaignStatus(r.Status),
    IsActive: bool(r.IsActive),
    StartDate: start,
    EndDate: dateOnly(r.EndDate, start),
    BudgetedCost: num(r.BudgetedCost),
    ActualCost: num(r.ActualCost),
    ExpectedRevenue: num(r.ExpectedRevenue),
    ExpectedResponse: num(r.ExpectedResponse),
    NumberSent: num(r.NumberSent),
    Description: str(r.Description),
    OwnerId: str(r.OwnerId),
    CreatedDate: str(r.CreatedDate),
    Season__c: str(r.Season__c),
    Target_Regions__c: multi(r.Target_Regions__c).map((x) => oneOf(x, REGION_IDS)).filter((x): x is RegionId => !!x),
    Target_Facility_Types__c: multi(r.Target_Facility_Types__c)
      .map((x) => oneOf(x, FACILITY_TYPES))
      .filter((x): x is FacilityType => !!x),
    Target_Commodity__c: oneOf(r.Target_Commodity__c, COMMODITIES),
    Content__c: parseContent(r.Content__c),
  };
}

function mapCampaignMember(r: SfRecord): CampaignMember {
  const responded = bool(r.HasResponded);
  const status: CampaignMemberStatus =
    oneOf(r.Status, ["Planned", "Sent", "Opened", "Responded"] as const) ?? (responded ? "Responded" : /open/i.test(str(r.Status)) ? "Opened" : "Sent");
  return {
    Id: str(r.Id),
    CampaignId: str(r.CampaignId),
    ContactId: optStr(r.ContactId),
    LeadId: optStr(r.LeadId),
    AccountId: optStr(field(r, "Contact.AccountId")),
    Status: status,
    HasResponded: responded || status === "Responded",
    FirstRespondedDate: optStr(r.FirstRespondedDate) ? dateOnly(r.FirstRespondedDate) : undefined,
    CreatedDate: str(r.CreatedDate),
  };
}

function taskType(v: unknown, subtype: string): TaskType {
  const exact = oneOf(v, ["Call", "Email", "Mail Drop", "Meeting", "Follow-up", "Other"] as const);
  if (exact) return exact;
  const s = `${str(v)} ${subtype}`.toLowerCase();
  if (/call/.test(s)) return "Call";
  if (/email/.test(s)) return "Email";
  if (/mail|letter/.test(s)) return "Mail Drop";
  if (/meet/.test(s)) return "Meeting";
  if (/follow/.test(s)) return "Follow-up";
  return "Other";
}

function mapTask(r: SfRecord): Task {
  const rawSubtype = str(r.TaskSubtype);
  const subtype: Task["TaskSubtype"] = /call/i.test(rawSubtype) ? "Call" : /email/i.test(rawSubtype) ? "Email" : "Task";
  const closed = bool(r.IsClosed) || /complete/i.test(str(r.Status));
  const status: TaskStatus = closed ? "Completed" : /progress/i.test(str(r.Status)) ? "In Progress" : "Not Started";
  const priority = oneOf(r.Priority, ["High", "Normal", "Low"] as const) ?? "Normal";
  return {
    Id: str(r.Id),
    Subject: str(r.Subject),
    Type: taskType(r.Type, rawSubtype),
    TaskSubtype: subtype,
    Status: status,
    Priority: priority,
    ActivityDate: dateOnly(r.ActivityDate, dateOnly(r.CreatedDate)),
    WhoId: optStr(r.WhoId),
    WhatId: optStr(r.WhatId),
    AccountId: optStr(r.AccountId),
    OwnerId: str(r.OwnerId),
    Description: str(r.Description),
    CallDisposition: optStr(r.CallDisposition),
    CallDurationInSeconds: optNum(r.CallDurationInSeconds),
    CreatedDate: str(r.CreatedDate),
    CompletedDateTime: optStr(r.CompletedDateTime),
  };
}

function eventType(v: unknown): EventType {
  const exact = oneOf(v, ["Meeting", "Demo", "Site Visit", "Trade Show", "Webinar"] as const);
  if (exact) return exact;
  const s = str(v).toLowerCase();
  if (/demo/.test(s)) return "Demo";
  if (/site|visit|onsite/.test(s)) return "Site Visit";
  if (/trade|show|conference/.test(s)) return "Trade Show";
  if (/webinar/.test(s)) return "Webinar";
  return "Meeting";
}

function mapEvent(r: SfRecord): Event {
  const start = str(r.StartDateTime, str(r.CreatedDate));
  return {
    Id: str(r.Id),
    Subject: str(r.Subject),
    Type: eventType(r.Type),
    StartDateTime: start,
    EndDateTime: str(r.EndDateTime, start),
    Location: str(r.Location),
    WhoId: optStr(r.WhoId),
    WhatId: optStr(r.WhatId),
    AccountId: optStr(r.AccountId),
    OwnerId: str(r.OwnerId),
    Description: str(r.Description),
    CreatedDate: str(r.CreatedDate),
  };
}
