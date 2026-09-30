"use client";

/**
 * Create / edit drawers for every record type. Each drawer builds the full
 * Salesforce-style record on create and only the changed fields on edit, then
 * commits through useCrud (toast, highlight, local change log).
 */
import { useMemo } from "react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { USERS } from "@/data/reference/users";
import { ECONOMIC_BUYER_GATE, LOSS_REASONS, stageDefaults } from "@/lib/actions/outreach";
import { roleForTitle, segmentForFacility, stampAt } from "@/lib/new-builds/convert";
import { addDays, toISODate } from "@/lib/dates";
import { RecordDrawer, type FieldDef, type FieldValue } from "@/components/shared/record-drawer";
import { countryFor, geocode, regionFor, STATE_OPTIONS } from "./geo";
import {
  ALL_STAGES,
  COMMODITIES,
  FACILITY_TYPES,
  OPEN_STAGES,
  SEGMENTS,
  type Account,
  type BuyingRole,
  type Campaign,
  type CampaignStatus,
  type CampaignType,
  type Commodity,
  type Contact,
  type FacilityType,
  type Lead,
  type LeadRating,
  type LeadSource,
  type LeadStatus,
  type Opportunity,
  type OpportunityStage,
  type Segment,
  type Task,
  type TaskStatus,
  type TaskType,
} from "@/types/salesforce";

type Values = Record<string, FieldValue>;
const opts = (list: readonly string[]) => list.map((v) => ({ value: v, label: v }));
const str = (v: FieldValue) => (v === null || v === undefined ? "" : String(v));
const num = (v: FieldValue) => (v === null || v === undefined || v === "" ? undefined : Number(v));

export const OWNER_OPTIONS = USERS.map((u) => ({ value: u.Id, label: u.Name }));
const BUYING_ROLES: BuyingRole[] = ["Decision Maker", "Economic Buyer", "Champion", "Influencer", "End User", "Board Member"];
const LEAD_SOURCES: LeadSource[] = ["Web", "Trade Show", "Referral", "Purchased List", "Partner", "Webinar", "Direct Mail"];
const LEAD_STATUSES: LeadStatus[] = ["Open - Not Contacted", "Working - Contacted", "Nurturing", "Closed - Not Converted"];
const LEAD_RATINGS: LeadRating[] = ["Hot", "Warm", "Cold"];
const TASK_TYPES: TaskType[] = ["Call", "Email", "Mail Drop", "Meeting", "Follow-up", "Other"];
const TASK_STATUSES: TaskStatus[] = ["Not Started", "In Progress", "Completed"];
const CAMPAIGN_TYPES: CampaignType[] = ["Direct Mail", "Email", "Event", "Call Blitz", "Multi-Channel"];
const CAMPAIGN_STATUSES: CampaignStatus[] = ["Planned", "In Progress", "Completed", "Aborted"];

/** Only the fields that changed (edit mode) */
function diff<T extends object>(before: T, after: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(after) as [keyof T, T[keyof T]][]) {
    if (v === undefined) continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(v)) out[k] = v;
  }
  return out;
}

interface DrawerProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this record; omit to create */
  record?: T;
  /** Prefilled values for a new record */
  defaults?: Partial<T>;
  onSaved?: (id: string) => void;
  onDelete?: () => void;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export function AccountDrawer({ open, onOpenChange, record, defaults, onSaved, onDelete }: DrawerProps<Account>) {
  const { data, asOf } = useStore();
  const { create, update } = useCrud();
  const userId = useUserId();
  const a = record ?? defaults;
  const fields: FieldDef[] = [
    { name: "Name", label: "Account name", required: true, wide: true },
    { name: "Type", label: "Type", type: "select", required: true, options: opts(["Prospect", "Customer - Direct"]) },
    { name: "OwnerId", label: "Owner", type: "select", required: true, options: OWNER_OPTIONS },
    { name: "Facility_Type__c", label: "Facility type", type: "select", required: true, options: opts(FACILITY_TYPES) },
    { name: "Segment__c", label: "Segment", type: "select", required: true, options: opts(SEGMENTS) },
    { name: "Commodity", label: "Primary commodity", type: "select", required: true, options: opts(COMMODITIES) },
    { name: "Number_of_Locations__c", label: "Locations", type: "number", required: true, min: 1, step: 1 },
    { name: "BillingStreet", label: "Street", wide: true },
    { name: "BillingCity", label: "City", required: true },
    { name: "BillingState", label: "State / province", type: "select", required: true, options: STATE_OPTIONS },
    { name: "BillingPostalCode", label: "Postal code" },
    { name: "Phone", label: "Phone", type: "tel" },
    { name: "Website", label: "Website" },
    { name: "AnnualRevenue", label: "Annual revenue", type: "currency", min: 0, step: 100000 },
    { name: "NumberOfEmployees", label: "Employees", type: "number", min: 0, step: 1 },
    { name: "Storage_Capacity_Bu__c", label: "Storage capacity (bu)", type: "number", min: 0, step: 10000 },
    { name: "Current_Software__c", label: "Current software" },
    { name: "Software_Contract_End__c", label: "Software contract end", type: "date" },
    { name: "Description", label: "Description", type: "textarea" },
  ];
  const initial: Values = {
    Name: a?.Name ?? "",
    Type: a?.Type ?? "Prospect",
    OwnerId: a?.OwnerId ?? userId,
    Facility_Type__c: a?.Facility_Type__c ?? "",
    Segment__c: a?.Segment__c ?? "",
    Commodity: a?.Primary_Commodities__c?.[0] ?? "",
    Number_of_Locations__c: a?.Number_of_Locations__c ?? 1,
    BillingStreet: a?.BillingStreet ?? "",
    BillingCity: a?.BillingCity ?? "",
    BillingState: a?.BillingState ?? "",
    BillingPostalCode: a?.BillingPostalCode ?? "",
    Phone: a?.Phone ?? "",
    Website: a?.Website ?? "",
    AnnualRevenue: a?.AnnualRevenue ?? null,
    NumberOfEmployees: a?.NumberOfEmployees ?? null,
    Storage_Capacity_Bu__c: a?.Storage_Capacity_Bu__c ?? null,
    Current_Software__c: a?.Current_Software__c ?? "",
    Software_Contract_End__c: a?.Software_Contract_End__c ?? "",
    Description: a?.Description ?? "",
  };

  const submit = (v: Values) => {
    const state = str(v.BillingState);
    const city = str(v.BillingCity);
    const commodity = str(v.Commodity) as Commodity;
    const moved = !record || record.BillingCity !== city || record.BillingState !== state;
    const geo = moved ? geocode(city, state, data.accounts) : null;
    const fieldsOut: Partial<Account> = {
      Name: str(v.Name),
      Type: str(v.Type) as Account["Type"],
      OwnerId: str(v.OwnerId),
      Facility_Type__c: str(v.Facility_Type__c) as FacilityType,
      Segment__c: str(v.Segment__c) as Segment,
      Primary_Commodities__c: [commodity, ...(record?.Primary_Commodities__c ?? []).filter((c) => c !== commodity)],
      Number_of_Locations__c: num(v.Number_of_Locations__c) ?? 1,
      BillingStreet: str(v.BillingStreet),
      BillingCity: city,
      BillingState: state,
      BillingPostalCode: str(v.BillingPostalCode),
      BillingCountry: countryFor(state),
      Phone: str(v.Phone),
      Website: str(v.Website),
      AnnualRevenue: num(v.AnnualRevenue) ?? 0,
      NumberOfEmployees: num(v.NumberOfEmployees) ?? 0,
      Current_Software__c: str(v.Current_Software__c),
      Description: str(v.Description),
      ...(num(v.Storage_Capacity_Bu__c) !== undefined || record?.Storage_Capacity_Bu__c ? { Storage_Capacity_Bu__c: num(v.Storage_Capacity_Bu__c) ?? 0 } : {}),
      ...(str(v.Software_Contract_End__c) || record?.Software_Contract_End__c ? { Software_Contract_End__c: str(v.Software_Contract_End__c) } : {}),
      ...(geo ? { BillingLatitude: geo.lat, BillingLongitude: geo.lon, Region__c: regionFor(state) } : {}),
    };
    if (record) {
      update("Account", record.Id, diff(record, fieldsOut), "Account");
      onSaved?.(record.Id);
    } else {
      const id = create(
        "Account",
        {
          ...(fieldsOut as Account),
          Industry: "Agriculture",
          CreatedDate: stampAt(asOf),
          Rail_Served__c: false,
          River_Access__c: false,
          Shuttle_Loader__c: false,
          Fiscal_Year_End__c: "08-31",
          Board_Meeting_Months__c: [],
        },
        "Account",
      );
      onSaved?.(id);
    }
    onOpenChange(false);
  };

  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.Name}` : "New account"}
      fields={fields}
      initial={initial}
      submitLabel={record ? "Save" : "Create account"}
      onSubmit={submit}
      onDelete={onDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------
export function ContactDrawer({ open, onOpenChange, record, defaults, onSaved, onDelete }: DrawerProps<Contact>) {
  const { data, asOf } = useStore();
  const { create, update } = useCrud();
  const userId = useUserId();
  const c = record ?? defaults;
  const fixedAccount = !!c?.AccountId;
  const accountOptions = useMemo(
    () => [...data.accounts].sort((x, y) => x.Name.localeCompare(y.Name)).map((a) => ({ value: a.Id, label: `${a.Name} (${a.BillingCity}, ${a.BillingState})` })),
    [data.accounts],
  );
  const fields: FieldDef[] = [
    { name: "AccountId", label: "Account", type: "select", required: true, wide: true, options: accountOptions, disabled: fixedAccount && !record },
    { name: "FirstName", label: "First name" },
    { name: "LastName", label: "Last name", required: true },
    { name: "Title", label: "Title", required: true },
    { name: "Buying_Role__c", label: "Buying role", type: "select", required: true, options: opts(BUYING_ROLES) },
    { name: "Email", label: "Email", type: "email" },
    { name: "Phone", label: "Phone", type: "tel" },
    { name: "MobilePhone", label: "Mobile", type: "tel" },
    { name: "OwnerId", label: "Owner", type: "select", required: true, options: OWNER_OPTIONS },
    { name: "HasOptedOutOfEmail", label: "Opted out of email", type: "checkbox", wide: true },
  ];
  const initial: Values = {
    AccountId: c?.AccountId ?? "",
    FirstName: c?.FirstName ?? "",
    LastName: c?.LastName ?? "",
    Title: c?.Title ?? "",
    Buying_Role__c: c?.Buying_Role__c ?? "",
    Email: c?.Email ?? "",
    Phone: c?.Phone ?? "",
    MobilePhone: c?.MobilePhone ?? "",
    OwnerId: c?.OwnerId ?? userId,
    HasOptedOutOfEmail: c?.HasOptedOutOfEmail ?? false,
  };
  const submit = (v: Values) => {
    const account = data.accounts.find((a) => a.Id === str(v.AccountId));
    if (!account) return "Pick an account";
    const first = str(v.FirstName);
    const last = str(v.LastName);
    const out: Partial<Contact> = {
      AccountId: account.Id,
      FirstName: first,
      LastName: last,
      Name: `${first} ${last}`.trim(),
      Title: str(v.Title),
      Buying_Role__c: (str(v.Buying_Role__c) || roleForTitle(str(v.Title))) as BuyingRole,
      Email: str(v.Email),
      Phone: str(v.Phone),
      ...(str(v.MobilePhone) || record?.MobilePhone ? { MobilePhone: str(v.MobilePhone) } : {}),
      OwnerId: str(v.OwnerId),
      HasOptedOutOfEmail: !!v.HasOptedOutOfEmail,
    };
    if (record) {
      update("Contact", record.Id, diff(record, out), "Contact");
      onSaved?.(record.Id);
    } else {
      const id = create(
        "Contact",
        {
          ...(out as Contact),
          MailingStreet: account.BillingStreet,
          MailingCity: account.BillingCity,
          MailingState: account.BillingState,
          MailingPostalCode: account.BillingPostalCode,
          MailingCountry: account.BillingCountry,
          CreatedDate: stampAt(asOf),
        },
        "Contact",
      );
      onSaved?.(id);
    }
    onOpenChange(false);
  };
  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.Name}` : "New contact"}
      fields={fields}
      initial={initial}
      submitLabel={record ? "Save" : "Create contact"}
      onSubmit={submit}
      onDelete={onDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------
export function LeadDrawer({ open, onOpenChange, record, defaults, onSaved, onDelete }: DrawerProps<Lead>) {
  const { data, asOf } = useStore();
  const { create, update } = useCrud();
  const userId = useUserId();
  const l = record ?? defaults;
  const fields: FieldDef[] = [
    { name: "Company", label: "Company", required: true, wide: true },
    { name: "FirstName", label: "First name" },
    { name: "LastName", label: "Last name", required: true },
    { name: "Title", label: "Title" },
    { name: "Email", label: "Email", type: "email" },
    { name: "Phone", label: "Phone", type: "tel" },
    { name: "OwnerId", label: "Owner", type: "select", required: true, options: OWNER_OPTIONS },
    { name: "Street", label: "Street", wide: true },
    { name: "City", label: "City", required: true },
    { name: "State", label: "State / province", type: "select", required: true, options: STATE_OPTIONS },
    { name: "Facility_Type__c", label: "Facility type", type: "select", required: true, options: opts(FACILITY_TYPES) },
    { name: "Segment__c", label: "Segment", type: "select", options: opts(SEGMENTS) },
    { name: "Commodity", label: "Primary commodity", type: "select", required: true, options: opts(COMMODITIES) },
    { name: "LeadSource", label: "Lead source", type: "select", required: true, options: opts(LEAD_SOURCES) },
    { name: "Status", label: "Status", type: "select", required: true, options: opts(LEAD_STATUSES) },
    { name: "Rating", label: "Rating", type: "select", required: true, options: opts(LEAD_RATINGS) },
    { name: "AnnualRevenue", label: "Annual revenue", type: "currency", min: 0, step: 100000 },
    { name: "NumberOfEmployees", label: "Employees", type: "number", min: 0, step: 1 },
    { name: "Storage_Capacity_Bu__c", label: "Storage capacity (bu)", type: "number", min: 0, step: 10000 },
    { name: "Current_Software__c", label: "Current software" },
  ];
  const initial: Values = {
    Company: l?.Company ?? "",
    FirstName: l?.FirstName ?? "",
    LastName: l?.LastName ?? "",
    Title: l?.Title ?? "",
    Email: l?.Email ?? "",
    Phone: l?.Phone ?? "",
    OwnerId: l?.OwnerId ?? userId,
    Street: l?.Street ?? "",
    City: l?.City ?? "",
    State: l?.State ?? "",
    Facility_Type__c: l?.Facility_Type__c ?? "",
    Segment__c: l?.Segment__c ?? "",
    Commodity: l?.Primary_Commodities__c?.[0] ?? "",
    LeadSource: l?.LeadSource ?? "Web",
    Status: l?.Status ?? "Open - Not Contacted",
    Rating: l?.Rating ?? "Warm",
    AnnualRevenue: l?.AnnualRevenue ?? null,
    NumberOfEmployees: l?.NumberOfEmployees ?? null,
    Storage_Capacity_Bu__c: l?.Storage_Capacity_Bu__c ?? null,
    Current_Software__c: l?.Current_Software__c ?? "",
  };
  const submit = (v: Values) => {
    const state = str(v.State);
    const city = str(v.City);
    const first = str(v.FirstName);
    const last = str(v.LastName);
    const commodity = str(v.Commodity) as Commodity;
    const facility = str(v.Facility_Type__c) as FacilityType;
    const moved = !record || record.City !== city || record.State !== state;
    const geo = moved ? geocode(city, state, data.accounts) : null;
    const out: Partial<Lead> = {
      Company: str(v.Company),
      FirstName: first,
      LastName: last,
      Name: `${first} ${last}`.trim(),
      Title: str(v.Title),
      Email: str(v.Email),
      Phone: str(v.Phone),
      OwnerId: str(v.OwnerId),
      Street: str(v.Street),
      City: city,
      State: state,
      Country: countryFor(state),
      Facility_Type__c: facility,
      Segment__c: (str(v.Segment__c) || segmentForFacility(facility)) as Segment,
      Primary_Commodities__c: [commodity, ...(record?.Primary_Commodities__c ?? []).filter((c) => c !== commodity)],
      LeadSource: str(v.LeadSource) as LeadSource,
      Status: str(v.Status) as LeadStatus,
      Rating: str(v.Rating) as LeadRating,
      AnnualRevenue: num(v.AnnualRevenue) ?? 0,
      NumberOfEmployees: num(v.NumberOfEmployees) ?? 0,
      Current_Software__c: str(v.Current_Software__c),
      ...(num(v.Storage_Capacity_Bu__c) !== undefined || record?.Storage_Capacity_Bu__c ? { Storage_Capacity_Bu__c: num(v.Storage_Capacity_Bu__c) ?? 0 } : {}),
      ...(geo ? { Latitude: geo.lat, Longitude: geo.lon, Region__c: regionFor(state) } : {}),
    };
    if (record) {
      update("Lead", record.Id, diff(record, out), "Lead");
      onSaved?.(record.Id);
    } else {
      const id = create(
        "Lead",
        { ...(out as Lead), PostalCode: "", Industry: "Agriculture", CreatedDate: stampAt(asOf), IsConverted: false, Number_of_Locations__c: 1 },
        "Lead",
      );
      onSaved?.(id);
    }
    onOpenChange(false);
  };
  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.Company}` : "New lead"}
      fields={fields}
      initial={initial}
      submitLabel={record ? "Save" : "Create lead"}
      onSubmit={submit}
      onDelete={onDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// Opportunity
// ---------------------------------------------------------------------------
export function OpportunityDrawer({ open, onOpenChange, record, defaults, onSaved, onDelete }: DrawerProps<Opportunity>) {
  const { data, asOf } = useStore();
  const { create, update } = useCrud();
  const userId = useUserId();
  const o = record ?? defaults;
  const accountId = o?.AccountId;
  const contacts = accountId ? data.contacts.filter((c) => c.AccountId === accountId) : [];
  const accountOptions = useMemo(
    () => (accountId ? data.accounts.filter((a) => a.Id === accountId) : [...data.accounts].sort((x, y) => x.Name.localeCompare(y.Name))).map((a) => ({ value: a.Id, label: `${a.Name} (${a.BillingState})` })),
    [data.accounts, accountId],
  );
  const startStage = record?.StageName ?? "Prospecting";
  const gate = (stage: string, all: Values) => {
    if (!stage || stage === startStage || stage === "Prospecting" || stage === "Closed Lost") return null;
    const identified = !!all.Economic_Buyer_Identified__c || !!all.Economic_Buyer__c;
    const leaving = !record || startStage === "Prospecting" || record.IsClosed;
    return leaving && !identified ? ECONOMIC_BUYER_GATE : null;
  };
  const fields: FieldDef[] = [
    { name: "AccountId", label: "Account", type: "select", required: true, wide: true, options: accountOptions, disabled: !!accountId },
    { name: "Name", label: "Opportunity name", required: true, wide: true },
    { name: "Type", label: "Type", type: "select", required: true, options: opts(["New Business", "Add-On Business"]) },
    { name: "StageName", label: "Stage", type: "select", required: true, options: opts(record ? ALL_STAGES : OPEN_STAGES), validate: (v, all) => gate(str(v), all) },
    { name: "Amount", label: "Amount", type: "currency", required: true, min: 0, step: 1000 },
    { name: "CloseDate", label: "Close date", type: "date", required: true },
    { name: "Probability", label: "Probability", type: "percent", min: 0, max: 100, step: 5, help: "Leave blank for the stage default" },
    { name: "OwnerId", label: "Owner", type: "select", required: true, options: OWNER_OPTIONS },
    { name: "LeadSource", label: "Lead source", type: "select", options: opts(LEAD_SOURCES) },
    { name: "NextStep", label: "Next step", wide: true },
    ...(contacts.length
      ? [
          {
            name: "Economic_Buyer__c",
            label: "Economic buyer",
            type: "select" as const,
            options: contacts.map((c) => ({ value: c.Id, label: `${c.Name} · ${c.Title}` })),
          },
        ]
      : []),
    { name: "Economic_Buyer_Identified__c", label: "Economic buyer identified", type: "checkbox" },
    ...(record
      ? [
          {
            name: "Loss_Reason__c",
            label: "Loss reason",
            type: "select" as const,
            wide: true,
            options: opts(LOSS_REASONS),
            validate: (v: FieldValue, all: Values) => (all.StageName === "Closed Lost" && !v ? "Required for Closed Lost" : null),
          },
        ]
      : []),
  ];
  const initial: Values = {
    AccountId: o?.AccountId ?? "",
    Name: o?.Name ?? "",
    Type: o?.Type ?? "New Business",
    StageName: o?.StageName ?? "Prospecting",
    Amount: o?.Amount ?? null,
    CloseDate: o?.CloseDate ?? toISODate(addDays(asOf, 90)),
    Probability: record ? record.Probability : null,
    OwnerId: o?.OwnerId ?? userId,
    LeadSource: o?.LeadSource ?? "",
    NextStep: o?.NextStep ?? "",
    Economic_Buyer__c: o?.Economic_Buyer__c ?? "",
    Economic_Buyer_Identified__c: o?.Economic_Buyer_Identified__c ?? false,
    Loss_Reason__c: o?.Loss_Reason__c ?? "",
  };
  const submit = (v: Values) => {
    const account = data.accounts.find((a) => a.Id === str(v.AccountId));
    if (!account) return "Pick an account";
    const stage = str(v.StageName) as OpportunityStage;
    const stageChanged = !record || stage !== record.StageName;
    const def = stageDefaults(stage);
    const probability = num(v.Probability);
    const closed = stage === "Closed Won" || stage === "Closed Lost";
    const eb = str(v.Economic_Buyer__c);
    const out: Partial<Opportunity> = {
      AccountId: account.Id,
      Name: str(v.Name),
      Type: str(v.Type) as Opportunity["Type"],
      StageName: stage,
      Amount: num(v.Amount) ?? 0,
      CloseDate: stageChanged && closed ? toISODate(asOf) : str(v.CloseDate),
      Probability: stageChanged && (probability === undefined || probability === record?.Probability) ? def.Probability : (probability ?? def.Probability),
      ForecastCategoryName: stageChanged || !record ? def.ForecastCategoryName : record.ForecastCategoryName,
      IsClosed: closed,
      IsWon: stage === "Closed Won",
      OwnerId: str(v.OwnerId),
      NextStep: str(v.NextStep),
      ...(str(v.LeadSource) ? { LeadSource: str(v.LeadSource) as LeadSource } : {}),
      Economic_Buyer_Identified__c: !!v.Economic_Buyer_Identified__c || !!eb,
      ...(eb || record?.Economic_Buyer__c ? { Economic_Buyer__c: eb } : {}),
      ...(stage === "Closed Lost" ? { Loss_Reason__c: str(v.Loss_Reason__c) } : record?.Loss_Reason__c ? { Loss_Reason__c: "" } : {}),
      LastModifiedDate: stampAt(asOf),
    };
    if (record) {
      update("Opportunity", record.Id, diff(record, out), "Opportunity");
      onSaved?.(record.Id);
    } else {
      const id = create("Opportunity", { ...(out as Opportunity), LeadSource: (out.LeadSource ?? "Referral") as LeadSource, CreatedDate: stampAt(asOf) }, "Opportunity");
      onSaved?.(id);
    }
    onOpenChange(false);
  };
  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={record ? `Edit ${record.Name}` : "New opportunity"}
      fields={fields}
      initial={initial}
      submitLabel={record ? "Save" : "Create opportunity"}
      onSubmit={submit}
      onDelete={onDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// Task
// ---------------------------------------------------------------------------
export function TaskDrawer({ open, onOpenChange, record, defaults, onSaved, onDelete }: DrawerProps<Task>) {
  const { data, asOf } = useStore();
  const { create, update } = useCrud();
  const userId = useUserId();
  const t = record ?? defaults;
  const accountId = t?.AccountId;
  const people = accountId ? data.contacts.filter((c) => c.AccountId === accountId) : [];
  const lead = t?.WhoId?.startsWith("00Q") ? data.leads.find((l) => l.Id === t.WhoId) : undefined;
  const whoOptions = [...people.map((c) => ({ value: c.Id, label: `${c.Name} · ${c.Title}` })), ...(lead ? [{ value: lead.Id, label: `${lead.Name} (lead)` }] : [])];
  const fields: FieldDef[] = [
    { name: "Subject", label: "Subject", required: true, wide: true },
    { name: "Type", label: "Type", type: "select", required: true, options: opts(TASK_TYPES) },
    { name: "ActivityDate", label: "Due date", type: "date", required: true },
    { name: "Status", label: "Status", type: "select", required: true, options: opts(TASK_STATUSES) },
    { name: "Priority", label: "Priority", type: "select", required: true, options: opts(["High", "Normal", "Low"]) },
    ...(whoOptions.length ? [{ name: "WhoId", label: "Contact", type: "select" as const, options: whoOptions }] : []),
    { name: "OwnerId", label: "Assigned to", type: "select", required: true, options: OWNER_OPTIONS },
    { name: "Description", label: "Notes", type: "textarea" },
  ];
  const initial: Values = {
    Subject: t?.Subject ?? "",
    Type: t?.Type ?? "Follow-up",
    ActivityDate: t?.ActivityDate ?? toISODate(addDays(asOf, 1)),
    Status: t?.Status ?? "Not Started",
    Priority: t?.Priority ?? "Normal",
    WhoId: t?.WhoId ?? "",
    OwnerId: t?.OwnerId ?? userId,
    Description: t?.Description ?? "",
  };
  const submit = (v: Values) => {
    const type = str(v.Type) as TaskType;
    const status = str(v.Status) as TaskStatus;
    const who = str(v.WhoId);
    const out: Partial<Task> = {
      Subject: str(v.Subject),
      Type: type,
      TaskSubtype: type === "Call" ? "Call" : type === "Email" ? "Email" : "Task",
      ActivityDate: str(v.ActivityDate),
      Status: status,
      Priority: str(v.Priority) as Task["Priority"],
      OwnerId: str(v.OwnerId),
      Description: str(v.Description),
      ...(who || record?.WhoId ? { WhoId: who } : {}),
      ...(status === "Completed" && record?.Status !== "Completed" ? { CompletedDateTime: stampAt(asOf) } : {}),
    };
    if (record) {
      update("Task", record.Id, diff(record, out), "Task");
      onSaved?.(record.Id);
    } else {
      const id = create(
        "Task",
        {
          ...(out as Task),
          ...(t?.AccountId ? { AccountId: t.AccountId } : {}),
          ...(t?.WhatId ? { WhatId: t.WhatId } : {}),
          ...(!who && t?.WhoId ? { WhoId: t.WhoId } : {}),
          CreatedDate: stampAt(asOf),
        },
        "Task",
      );
      onSaved?.(id);
    }
    onOpenChange(false);
  };
  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={record ? "Edit task" : "New task"}
      fields={fields}
      initial={initial}
      submitLabel={record ? "Save" : "Create task"}
      onSubmit={submit}
      onDelete={onDelete}
    />
  );
}

// ---------------------------------------------------------------------------
// Campaign (edit; new campaigns use the campaign builder)
// ---------------------------------------------------------------------------
export function CampaignDrawer({ open, onOpenChange, record, onSaved, onDelete }: DrawerProps<Campaign> & { record: Campaign }) {
  const { update } = useCrud();
  const fields: FieldDef[] = [
    { name: "Name", label: "Campaign name", required: true, wide: true },
    { name: "Type", label: "Type", type: "select", required: true, options: opts(CAMPAIGN_TYPES) },
    { name: "Status", label: "Status", type: "select", required: true, options: opts(CAMPAIGN_STATUSES) },
    { name: "StartDate", label: "Start date", type: "date", required: true },
    { name: "EndDate", label: "End date", type: "date", required: true, validate: (v, all) => (str(v) && str(all.StartDate) && str(v) < str(all.StartDate) ? "Ends before it starts" : null) },
    { name: "BudgetedCost", label: "Budget", type: "currency", min: 0 },
    { name: "ActualCost", label: "Spent", type: "currency", min: 0 },
    { name: "ExpectedRevenue", label: "Expected pipeline", type: "currency", min: 0, step: 1000 },
    { name: "Description", label: "Description", type: "textarea" },
  ];
  const initial: Values = {
    Name: record.Name,
    Type: record.Type,
    Status: record.Status,
    StartDate: record.StartDate,
    EndDate: record.EndDate,
    BudgetedCost: record.BudgetedCost,
    ActualCost: record.ActualCost,
    ExpectedRevenue: record.ExpectedRevenue,
    Description: record.Description,
  };
  const submit = (v: Values) => {
    const status = str(v.Status) as CampaignStatus;
    const out: Partial<Campaign> = {
      Name: str(v.Name),
      Type: str(v.Type) as CampaignType,
      Status: status,
      IsActive: status === "Planned" || status === "In Progress",
      StartDate: str(v.StartDate),
      EndDate: str(v.EndDate),
      BudgetedCost: num(v.BudgetedCost) ?? 0,
      ActualCost: num(v.ActualCost) ?? 0,
      ExpectedRevenue: num(v.ExpectedRevenue) ?? 0,
      Description: str(v.Description),
    };
    update("Campaign", record.Id, diff(record, out), "Campaign");
    onSaved?.(record.Id);
    onOpenChange(false);
  };
  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${record.Name}`}
      fields={fields}
      initial={initial}
      onSubmit={submit}
      onDelete={onDelete}
    />
  );
}
