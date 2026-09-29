/**
 * Export engine: builds rows per data source, applies a template spec
 * (filters, sort, groups, totals) and formats cells. Pure functions, no React.
 *
 * Row values: currency/number are numbers, percent is a 0–1 fraction, date is
 * "YYYY-MM-DD", boolean is true/false, missing values are null. Each row also
 * carries a hidden `_href` link for its record (and `_account_href` for
 * opportunities and contacts).
 *
 * Account `blackout` values: "Harvest" (hard no-contact), "Planting" (light
 * no-contact) or "None". `blackout_until` is the window's last day, or null.
 */
import type { ExportColumn, ExportFilter, ExportSource, ExportSpec, FieldType } from "@/lib/ai/types";
import { EXPORT_FIELDS, fieldDef } from "@/lib/exports/fields";
import type { DataSnapshot } from "@/lib/data/types";
import type { Prioritization } from "@/lib/prioritization";
import type { ScoredTarget } from "@/lib/scoring";
import { rateForMonth, type SegmentStats } from "@/lib/stats";
import { blackoutStatus } from "@/lib/seasonality";
import { isCovered } from "@/lib/facilities";
import { isOpenAsOf } from "@/lib/data/selectors";
import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { STATE_NAMES } from "@/data/reference/geo";
import { USER_BY_ID } from "@/data/reference/users";
import { PREBUILT_EXPORTS } from "@/data/seed/export-templates";
import { opportunityHref, recordHref } from "@/lib/links";
import { diffDays, fmtDate, parseDate, toISODate } from "@/lib/dates";
import { fmtMoney, fmtNumber, fmtPct } from "@/lib/format";
import type { RegionId, Segment } from "@/types/salesforce";

export type ExportRow = Record<string, unknown>;

export interface BuildContext {
  data: DataSnapshot;
  asOf: Date;
  prio: Prioritization;
  ranked: ScoredTarget[];
  lightningBaseUrl?: string;
}

export const BLACKOUT_VALUES = ["Harvest", "Planting", "None"] as const;

const regionName = (id?: string) => (id ? (REGION_BY_ID[id as RegionId]?.name ?? null) : null);
const ownerName = (id?: string) => (id ? (USER_BY_ID[id]?.Name ?? null) : null);

/* ------------------------------------------------------------------ rows */

export function buildRows(source: ExportSource, ctx: BuildContext): ExportRow[] {
  const { data, asOf, prio } = ctx;
  const accById = new Map(data.accounts.map((a) => [a.Id, a]));
  const segStats = new Map<string, SegmentStats>(prio.segments.map((s) => [s.segment, s.stats]));

  if (source === "opportunities") {
    return data.opportunities
      .filter((o) => parseDate(o.CreatedDate) <= asOf)
      .map((o) => {
        const a = accById.get(o.AccountId);
        const st = a ? segStats.get(a.Segment__c) : undefined;
        const open = isOpenAsOf(o, asOf);
        const seasonal = st ? rateForMonth(st, parseDate(o.CreatedDate).getUTCMonth()).rate : null;
        return {
          id: o.Id,
          name: o.Name,
          account_id: o.AccountId,
          account: a?.Name ?? null,
          segment: a?.Segment__c ?? null,
          state: a?.BillingState ?? null,
          region: regionName(a?.Region__c),
          stage: o.StageName,
          type: o.Type,
          amount: o.Amount,
          probability: o.Probability / 100,
          expected_value: open && seasonal !== null ? Math.round(seasonal * o.Amount) : null,
          win_rate: st ? st.closeRate.rate : null,
          close_date: o.CloseDate.slice(0, 10),
          created_date: o.CreatedDate.slice(0, 10),
          days_open: open ? Math.max(0, diffDays(asOf, parseDate(o.CreatedDate))) : null,
          lead_source: o.LeadSource ?? null,
          next_step: o.NextStep || null,
          owner_id: o.OwnerId,
          owner: ownerName(o.OwnerId),
          economic_buyer: !!o.Economic_Buyer_Identified__c,
          is_open: open,
          is_won: o.IsWon && !open,
          _href: opportunityHref(o.Id, ctx.lightningBaseUrl),
          _account_href: recordHref(o.AccountId),
        };
      });
  }

  if (source === "accounts") {
    const openByAcc = new Map<string, { n: number; amount: number }>();
    for (const o of data.opportunities) {
      if (!isOpenAsOf(o, asOf)) continue;
      const cur = openByAcc.get(o.AccountId) ?? { n: 0, amount: 0 };
      openByAcc.set(o.AccountId, { n: cur.n + 1, amount: cur.amount + o.Amount });
    }
    const score = new Map(ctx.ranked.filter((s) => s.target.kind === "account").map((s) => [s.target.id, Math.round(s.total)]));
    return data.accounts.map((a) => {
      const b = blackoutStatus(a, asOf);
      const open = openByAcc.get(a.Id);
      return {
        id: a.Id,
        name: a.Name,
        account_type: a.Type,
        is_customer: isCovered(a),
        segment: a.Segment__c,
        facility_type: a.Facility_Type__c,
        parent: a.ParentId ? (accById.get(a.ParentId)?.Name ?? null) : null,
        city: a.BillingCity,
        county: a.County__c ?? null,
        state: a.BillingState,
        region: regionName(a.Region__c),
        commodities: (a.Primary_Commodities__c ?? []).join(", "),
        locations: a.Number_of_Locations__c ?? null,
        revenue: a.AnnualRevenue ?? null,
        employees: a.NumberOfEmployees ?? null,
        storage_bu: a.Storage_Capacity_Bu__c ?? null,
        current_software: a.Current_Software__c || null,
        contract_end: a.Software_Contract_End__c ?? null,
        fiscal_year_end: a.Fiscal_Year_End__c || null,
        blackout: b.status === "hard" ? "Harvest" : b.status === "light" ? "Planting" : "None",
        blackout_until: b.blackout ? toISODate(b.blackout.end) : null,
        open_deals: open?.n ?? 0,
        open_pipeline: open?.amount ?? 0,
        score: score.get(a.Id) ?? null,
        owner: ownerName(a.OwnerId),
        _href: recordHref(a.Id),
      };
    });
  }

  if (source === "contacts") {
    return data.contacts
      .filter((c) => parseDate(c.CreatedDate) <= asOf)
      .map((c) => {
        const a = accById.get(c.AccountId);
        return {
          id: c.Id,
          name: c.Name,
          first_name: c.FirstName,
          last_name: c.LastName,
          title: c.Title || null,
          buying_role: c.Buying_Role__c ?? null,
          email: c.Email || null,
          phone: c.Phone || null,
          opted_out: !!c.HasOptedOutOfEmail,
          account_id: c.AccountId,
          account: a?.Name ?? null,
          segment: a?.Segment__c ?? null,
          state: a?.BillingState ?? c.MailingState ?? null,
          region: regionName(a?.Region__c),
          is_customer: a ? isCovered(a) : false,
          _href: recordHref(c.AccountId),
          _account_href: recordHref(c.AccountId),
        };
      });
  }

  // segments
  const customers = new Map<Segment, number>();
  for (const a of data.accounts) if (isCovered(a)) customers.set(a.Segment__c, (customers.get(a.Segment__c) ?? 0) + 1);
  return prio.segments.map((s) => ({
    segment: s.segment,
    rank: s.rank,
    priority_score: s.score,
    accounts: s.accounts,
    customers: customers.get(s.segment) ?? 0,
    open_deals: s.openDeals,
    open_pipeline: s.openPipeline,
    won: s.stats.won,
    lost: s.stats.lost,
    win_rate: s.stats.closeRate.rate,
    win_rate_low: s.stats.closeRate.low,
    win_rate_high: s.stats.closeRate.high,
    confidence: s.stats.closeRate.tag,
    median_days: s.stats.medianDaysToClose,
    median_won_amount: s.stats.medianWonAmount,
    _href: "/segments",
  }));
}

/* ----------------------------------------------------------------- apply */

export interface ExportGroup {
  key: string;
  rows: ExportRow[];
  subtotals: Record<string, number>;
}

export interface ExportResult {
  rows: ExportRow[];
  groups?: ExportGroup[];
  totals: Record<string, number>;
}

const isNumericType = (t?: FieldType) => t === "number" || t === "currency" || t === "percent";

function truthy(v: string | undefined): boolean {
  return /^(true|yes|y|1)$/i.test((v ?? "").trim());
}

function matches(row: ExportRow, f: ExportFilter, type: FieldType | undefined): boolean {
  const v = row[f.field];
  const want = (f.value ?? "").trim();
  if (f.op === "isTrue") return v === true;
  if (f.op === "isFalse") return !v;
  if (type === "boolean" && (f.op === "eq" || f.op === "neq")) {
    const eq = !!v === truthy(want);
    return f.op === "eq" ? eq : !eq;
  }
  // Salesforce Ids are case-sensitive; everything else compares case-insensitively
  const fold = (x: string) => (f.field === "id" || f.field.endsWith("_id") ? x : x.toLowerCase());
  const s = v === null || v === undefined ? "" : fold(String(v));
  switch (f.op) {
    case "eq":
      if (isNumericType(type) && want !== "" && typeof v === "number") return v === Number(want);
      return s === fold(want);
    case "neq":
      if (isNumericType(type) && want !== "" && typeof v === "number") return v !== Number(want);
      return s !== fold(want);
    case "in": {
      const list = want
        .split(",")
        .map((x) => fold(x.trim()))
        .filter(Boolean);
      return list.length === 0 || list.includes(s);
    }
    case "contains":
      return s.includes(fold(want));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (v === null || v === undefined || want === "") return false;
      let cmp: number;
      if (typeof v === "number") {
        let n = Number(want.replace(/[$,%\s]/g, ""));
        if (!Number.isFinite(n)) return false;
        if (type === "percent" && (want.includes("%") || n > 1)) n = n / 100;
        cmp = v - n;
      } else cmp = String(v).localeCompare(want);
      return f.op === "gt" ? cmp > 0 : f.op === "gte" ? cmp >= 0 : f.op === "lt" ? cmp < 0 : cmp <= 0;
    }
  }
  return true;
}

function compare(a: unknown, b: unknown): number {
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an || bn) return an && bn ? 0 : an ? 1 : -1; // blanks last
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(b) - Number(a);
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

function sumFields(rows: ExportRow[], fields: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of fields) out[f] = rows.reduce((s, r) => s + (typeof r[f] === "number" ? (r[f] as number) : 0), 0);
  return out;
}

export function applySpec(spec: Pick<ExportSpec, "source" | "filters" | "sort" | "groupBy" | "totals">, rows: ExportRow[]): ExportResult {
  const filtered = rows.filter((r) => spec.filters.every((f) => !f.field || matches(r, f, fieldDef(spec.source, f.field)?.type)));
  const sorted = [...filtered].sort((a, b) => {
    for (const s of spec.sort) {
      if (!s.field) continue;
      const blankA = a[s.field] === null || a[s.field] === undefined || a[s.field] === "";
      const blankB = b[s.field] === null || b[s.field] === undefined || b[s.field] === "";
      const c = compare(a[s.field], b[s.field]);
      if (c) return blankA || blankB ? c : s.dir === "desc" ? -c : c;
    }
    return 0;
  });
  const totals = sumFields(sorted, spec.totals);
  if (!spec.groupBy) return { rows: sorted, totals };

  const g = spec.groupBy;
  const map = new Map<string, ExportRow[]>();
  for (const r of sorted) {
    const v = r[g];
    const key = v === null || v === undefined || v === "" ? "(blank)" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const groups: ExportGroup[] = [...map.entries()].map(([key, rs]) => ({ key, rows: rs, subtotals: sumFields(rs, spec.totals) }));

  // Group order: by the key when sorting on the group field; by the group's sum when the first sort is numeric; else A–Z
  const first = spec.sort.find((s) => s.field);
  const firstType = first ? fieldDef(spec.source, first.field)?.type : undefined;
  if (first && first.field === g) groups.sort((x, y) => (first.dir === "desc" ? -1 : 1) * compare(x.key, y.key));
  else if (first && isNumericType(firstType) && firstType !== "percent") {
    const sum = (x: ExportGroup) => sumFields(x.rows, [first.field])[first.field];
    groups.sort((x, y) => (first.dir === "desc" ? sum(y) - sum(x) : sum(x) - sum(y)));
  } else groups.sort((x, y) => compare(x.key, y.key));

  return { rows: groups.flatMap((x) => x.rows), groups, totals };
}

/* ------------------------------------------------------------ formatting */

export function formatCell(value: unknown, type: FieldType | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "currency":
      return typeof value === "number" ? fmtMoney(value, { compact: false }) : String(value);
    case "percent":
      return typeof value === "number" ? fmtPct(value, value < 0.1 && value > 0 ? 1 : 0) : String(value);
    case "number":
      return typeof value === "number" ? fmtNumber(value) : String(value);
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? fmtDate(value.slice(0, 10)) : String(value);
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
}

export function columnLabel(source: ExportSource, col: ExportColumn): string {
  return col.label?.trim() || fieldDef(source, col.field)?.label || col.field;
}

/** Sensible starting columns when the data source changes */
export const DEFAULT_COLUMNS: Record<ExportSource, string[]> = {
  opportunities: ["name", "account", "stage", "amount", "close_date", "owner"],
  accounts: ["name", "segment", "state", "county", "is_customer", "open_pipeline"],
  contacts: ["name", "title", "account", "email", "phone", "state"],
  segments: ["segment", "rank", "accounts", "open_pipeline", "win_rate", "median_won_amount"],
};

export function blankSpec(source: ExportSource = "opportunities"): Omit<ExportSpec, "id"> {
  return {
    name: "Untitled export",
    source,
    filters: [],
    columns: DEFAULT_COLUMNS[source].map((field) => ({ field })),
    groupBy: null,
    sort: [],
    totals: [],
    format: "xlsx",
  };
}

/** Keep only fields that exist for the spec's source (AI output may drift) */
export function sanitizeSpec<T extends Omit<ExportSpec, "id">>(spec: T): T {
  const source: ExportSource = EXPORT_FIELDS[spec.source] ? spec.source : "opportunities";
  const ok = (f: string) => !!fieldDef(source, f);
  const columns = (spec.columns ?? []).filter((c) => ok(c.field));
  const numericCols = new Set(columns.filter((c) => isNumericType(fieldDef(source, c.field)?.type)).map((c) => c.field));
  return {
    ...spec,
    source,
    name: spec.name?.trim() || "Untitled export",
    filters: (spec.filters ?? []).filter((f) => ok(f.field)),
    columns: columns.length ? columns : DEFAULT_COLUMNS[source].map((field) => ({ field })),
    groupBy: spec.groupBy && ok(spec.groupBy) ? spec.groupBy : null,
    sort: (spec.sort ?? []).filter((s) => ok(s.field)).slice(0, 3),
    totals: (spec.totals ?? []).filter((t) => numericCols.has(t) && fieldDef(source, t)?.type !== "percent"),
    format: spec.format === "csv" || spec.format === "pdf" ? spec.format : "xlsx",
  };
}

/* --------------------------------------------------- no-key prompt match */

const SEGMENT_WORDS: [RegExp, Segment][] = [
  [/\bcountry elevators?\b|\belevators?\b/i, "Country Elevator"],
  [/\bco-?ops?\b|\bcooperatives?\b/i, "Multi-Location Co-op"],
  [/\briver terminals?\b|\bbarge\b/i, "River Terminal"],
  [/\bshuttle|\brail loaders?\b/i, "Rail/Shuttle Loader"],
  [/\bethanol\b/i, "Ethanol Plant"],
  [/\bfeed ?mills?\b/i, "Feed Mill"],
  [/\bprocessors?\b|\bcrushers?\b/i, "Processor"],
  [/\bseed cleaners?\b|\bspecialty crops?\b/i, "Seed Cleaner / Specialty Crop"],
];

/** State/province codes mentioned by name (case-insensitive) or 2-letter code (upper case) */
export function statesInPrompt(prompt: string): string[] {
  const found = new Set<string>();
  let text = ` ${prompt} `;
  const names = Object.entries(STATE_NAMES).sort((a, b) => b[1].length - a[1].length);
  for (const [code, name] of names) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(text)) {
      found.add(code);
      text = text.replace(re, " ");
    }
  }
  if (/\bquebec\b/i.test(text)) found.add("QC");
  for (const m of text.matchAll(/\b([A-Z]{2})\b/g)) if (STATE_NAMES[m[1]]) found.add(m[1]);
  return [...found];
}

export function regionsInPrompt(prompt: string): string[] {
  return REGIONS.filter((r) => new RegExp(`\\b(${r.name}|${r.shortName.replace(/\./g, "\\.")})`, "i").test(prompt)).map((r) => r.name);
}

function nameFromPrompt(prompt: string, fallback: string): string {
  let s = prompt
    .trim()
    .replace(/[.?!]+$/, "")
    .replace(/^(please\s+)?(can you\s+|could you\s+)?(export|create|build|make|generate|show( me)?|give me|get( me)?|i need|i want|list)\s+/i, "")
    .replace(/^(an?|the)\s+/i, "")
    .trim();
  if (!s) return fallback;
  if (s.length > 60) s = `${s.slice(0, 57).replace(/\s+\S*$/, "")}…`;
  return s[0].toUpperCase() + s.slice(1);
}

export function localSpecFromPrompt(prompt: string): Omit<ExportSpec, "id"> {
  const p = prompt.toLowerCase();
  const pick = (id: string) => PREBUILT_EXPORTS.find((t) => t.id === id);
  let base: Omit<ExportSpec, "id"> | undefined;
  if (/blackout|no[- ]contact|dark|harvest window/.test(p)) base = pick("tpl-accounts-in-blackout");
  else if (/\bimport\b|salesforce|data ?loader|\bsfdc\b/.test(p)) base = pick("tpl-sf-opportunity-import");
  else if (/territor|coverage|count(y|ies)|penetration|white ?space/.test(p)) base = pick("tpl-territory-coverage");
  else if (/segment|win rate|board|by type/.test(p)) base = pick("tpl-pipeline-by-segment");
  else if (/\bcontacts?\b|email list|people|buyers?\b/.test(p))
    base = {
      name: "Contacts",
      source: "contacts",
      filters: [{ field: "opted_out", op: "isFalse" }],
      columns: ["name", "title", "buying_role", "account", "email", "phone", "state"].map((field) => ({ field })),
      groupBy: null,
      sort: [
        { field: "account", dir: "asc" },
        { field: "name", dir: "asc" },
      ],
      totals: [],
      format: "xlsx",
    };
  else if (/\baccounts?\b|facilit|prospects?\b|customers?\b/.test(p) && !/pipeline|deals?|opportunit/.test(p))
    base = {
      name: "Accounts",
      source: "accounts",
      filters: [],
      columns: ["name", "segment", "city", "state", "is_customer", "score", "open_pipeline"].map((field) => ({ field })),
      groupBy: null,
      sort: [{ field: "score", dir: "desc" }],
      totals: ["open_pipeline"],
      format: "xlsx",
    };
  base ??= {
    name: "Open opportunities",
    source: "opportunities",
    filters: [{ field: "is_open", op: "isTrue" }],
    columns: ["name", "account", "state", "stage", "amount", "expected_value", "close_date", "owner"].map((field) => ({ field })),
    groupBy: null,
    sort: [{ field: "close_date", dir: "asc" }],
    totals: ["amount", "expected_value"],
    format: "xlsx",
  };

  const spec = structuredClone(base) as Partial<ExportSpec> & Omit<ExportSpec, "id">;
  delete spec.id;
  delete spec.prebuilt;
  delete spec.updatedAt;
  delete spec.description;
  spec.name = nameFromPrompt(prompt, base.name);

  const hasField = (f: string) => !!fieldDef(spec.source, f);
  const states = statesInPrompt(prompt);
  const regions = regionsInPrompt(prompt);
  if (states.length && hasField("state")) spec.filters.push({ field: "state", op: "in", value: states.join(",") });
  else if (regions.length && hasField("region")) spec.filters.push({ field: "region", op: "in", value: regions.join(",") });

  const segs = SEGMENT_WORDS.filter(([re]) => re.test(prompt)).map(([, s]) => s);
  if (segs.length && hasField("segment") && spec.groupBy !== "segment") spec.filters.push({ field: "segment", op: "in", value: segs.join(",") });

  if (spec.source === "accounts") {
    if (/\bcustomers?\b/.test(p) && !/prospect/.test(p)) spec.filters.push({ field: "is_customer", op: "isTrue" });
    else if (/\bprospects?\b/.test(p) && !/customer/.test(p)) spec.filters.push({ field: "is_customer", op: "isFalse" });
  }
  if (/\bpdf\b/.test(p)) spec.format = "pdf";
  else if (/\bcsv\b/.test(p)) spec.format = "csv";
  else if (/\bexcel\b|\bxlsx\b|spreadsheet/.test(p)) spec.format = "xlsx";
  return spec;
}

/** Restrict a spec to specific accounts (hand-offs from chat or the map) */
export function withAccountIds<T extends Omit<ExportSpec, "id">>(spec: T, ids: string[]): T {
  if (!ids.length) return spec;
  const field = spec.source === "accounts" ? "id" : spec.source === "segments" ? null : "account_id";
  if (!field) return spec;
  return { ...spec, filters: [...spec.filters.filter((f) => !(f.field === field && f.op === "in")), { field, op: "in", value: ids.join(",") }] };
}
