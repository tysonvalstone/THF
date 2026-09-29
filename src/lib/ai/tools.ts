import "server-only";
import { searchHelp } from "@/lib/help/content";

/**
 * Read-only tools for the AI assistant. Each tool works on the loaded
 * DataSnapshot (mock or live) as of the time-travel date and returns compact
 * JSON with in-app hrefs for every record. `run_soql` is the only tool that
 * talks to Salesforce directly, and only runs single SELECT statements.
 */
import { REGIONS, REGION_BY_ID, REGION_BY_STATE } from "@/data/reference/regions";
import { STATE_NAMES, CANADIAN_PROVINCES } from "@/data/reference/geo";
import type { DataSnapshot } from "@/lib/data/types";
import type { DataMode } from "@/lib/data/server";
import { getSalesforceConnection } from "@/lib/data/salesforce";
import { prioritize, type Prioritization } from "@/lib/prioritization";
import { rankProspects, type ScoredTarget } from "@/lib/scoring";
import { rateForMonth } from "@/lib/stats";
import { areaName, computeAreaInsights, type Area } from "@/lib/regionInsights";
import { blackoutStatus, blackoutsFor, isSeasonalSegment, sellingWindowAt, windowRange } from "@/lib/seasonality";
import { harvestWindow, isGrownIn, MAP_COMMODITIES, phaseLabel, phaseValue, plantingWindow, type MapCommodity } from "@/lib/cropCalendar";
import { opportunityHref } from "@/lib/links";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import { OPEN_STAGES, SEGMENTS, type Account, type Opportunity, type RegionId, type Segment } from "@/types/salesforce";
import type { SourceKind } from "@/lib/ai/types";

export interface ToolContext {
  data: DataSnapshot;
  asOf: Date;
  mode: DataMode;
  lightningBaseUrl?: string;
  /** Commodity selected on the current page, if any */
  commodity?: string;
}

export interface ToolRun {
  result: unknown;
  accountIds: string[];
  source: Extract<SourceKind, "Salesforce" | "Platform data">;
}

const MAX_ROWS = 25;
const SOQL_MAX_ROWS = 200;

/* ------------------------------------------------------------ definitions */

const AREA_DESC =
  "Region id (e.g. western-corn-belt), region name (e.g. Eastern Corn Belt), 2-letter state/province code (IA, SK) or full state/province name (Iowa).";
const SEGMENT_DESC = `Account segment, one of: ${SEGMENTS.join(", ")}. Partial names are matched case-insensitively.`;

/** Anthropic client tool definitions (JSON Schema inputs) */
export const TOOL_DEFINITIONS = [
  {
    name: "get_pipeline_summary",
    description:
      "Open sales pipeline as of the current (time-travel) date: total open amount and count, expected value (amount x segment win rate), breakdown by stage and by segment, the top 10 open deals by expected value, and won/lost deals in the last 90 days. Use for any question about pipeline totals or health.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "search_opportunities",
    description:
      "Search opportunities (deals) with filters. Returns up to `limit` rows (max 25) with account, segment, state, stage, amount, probability, close date, expected value and an href to link each record. Also returns the total match count and matched amount.",
    input_schema: {
      type: "object",
      properties: {
        state: { type: "string", description: "2-letter state/province code or full name." },
        region: { type: "string", description: AREA_DESC },
        segment: { type: "string", description: SEGMENT_DESC },
        stage: { type: "string", description: `Stage name: ${[...OPEN_STAGES, "Closed Won", "Closed Lost"].join(", ")}.` },
        open_only: { type: "boolean", description: "Only deals open as of the current date. Default true." },
        min_amount: { type: "number", description: "Minimum deal amount in USD." },
        close_before: { type: "string", description: "Close date on or before, YYYY-MM-DD." },
        close_after: { type: "string", description: "Close date on or after, YYYY-MM-DD." },
        name_contains: { type: "string", description: "Substring of the opportunity or account name." },
        sort_by: { type: "string", enum: ["expected_value", "amount", "close_date"], description: "Default expected_value (descending); close_date sorts soonest first." },
        limit: { type: "integer", description: "Rows to return, 1-25. Default 10." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_accounts",
    description:
      "Search accounts (grain elevators, co-ops, ethanol plants, feed mills, processors) with filters. Returns up to `limit` rows (max 25) with segment, facility type, location, commodities, number of locations, prospect score (prospects only), harvest/planting blackout status and end date, open deals and an href. By default only top-level accounts are returned (co-op location records are excluded unless include_locations is true).",
    input_schema: {
      type: "object",
      properties: {
        state: { type: "string", description: "2-letter state/province code or full name." },
        region: { type: "string", description: AREA_DESC },
        segment: { type: "string", description: SEGMENT_DESC },
        facility_type: { type: "string", description: "Facility type, e.g. Grain Elevator, Cooperative, Ethanol Plant, Feed Mill, Oilseed Crusher, Flour Mill, Seed Processor, Agronomy Retailer." },
        commodity: { type: "string", description: "Primary commodity substring, e.g. Corn, Wheat, Soybeans, Canola." },
        customer: { type: "boolean", description: "true = customers only, false = prospects only." },
        in_blackout: { type: "boolean", description: "true = only accounts in the harvest no-contact blackout now; false = only accounts not in it." },
        blackout_ends_before: { type: "string", description: "Only accounts whose current harvest blackout ends on or before this date, YYYY-MM-DD." },
        name_contains: { type: "string", description: "Substring of the account name." },
        include_locations: { type: "boolean", description: "Include co-op location (child) accounts. Default false." },
        sort_by: { type: "string", enum: ["score", "revenue", "blackout_end", "name"], description: "Default score (best prospects first). blackout_end sorts accounts leaving blackout soonest first." },
        limit: { type: "integer", description: "Rows to return, 1-25. Default 10." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_segment_stats",
    description:
      "Segment prioritization for the current month: rank, priority score, win rate with Wilson 95% interval and a Measured/Blended/Prior tag, decided (won/lost) counts, median days to close, median won deal, accounts and open pipeline per segment.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_region_insights",
    description:
      "Area summary for a region, state or province: facilities, customers and coverage, open pipeline, current crop phase for a commodity, top potential customers with estimated deal size and blackout status, and key insights.",
    input_schema: {
      type: "object",
      properties: {
        region: { type: "string", description: AREA_DESC },
        commodity: { type: "string", enum: MAP_COMMODITIES, description: "Crop used for the phase. Default Corn or the page's commodity." },
      },
      required: ["region"],
      additionalProperties: false,
    },
  },
  {
    name: "get_season_status",
    description:
      "Crop season status for a commodity in an area on a date: phase (planting / growing / harvest), planting and harvest windows, the elevator/co-op no-contact blackout windows at that latitude and whether one is in effect, and the current selling window on the sales calendar.",
    input_schema: {
      type: "object",
      properties: {
        region: { type: "string", description: AREA_DESC },
        commodity: { type: "string", enum: MAP_COMMODITIES, description: "Crop. Default Corn." },
        date: { type: "string", description: "YYYY-MM-DD. Default the current (time-travel) date." },
      },
      required: ["region"],
      additionalProperties: false,
    },
  },
  {
    name: "search_help",
    description:
      "Search the HarvestSignal Help Center articles (how to use the app: navigation, time travel, map, trip planner, segment prioritization, seasonality rules, campaigns and sequences, exports and column presets, the assistant, Salesforce connection). Returns up to 3 articles with title, href and a snippet. Use for any how-do-I or what-does-this-mean question about the app, and link the articles in the answer.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What the user wants to know, in a few words." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "run_soql",
    description:
      "Run one read-only SOQL SELECT against the connected Salesforce org (live mode only). Use only when the other tools cannot answer. Results are capped at 200 rows. Standard objects: Account, Opportunity, Contact, Task, Event, Campaign, CampaignMember.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "A single SOQL SELECT statement." } },
      required: ["query"],
      additionalProperties: false,
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];
export const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name) as ToolName[];

/** Short progress text shown while a tool runs */
export const TOOL_STATUS: Record<ToolName, string> = {
  get_pipeline_summary: "Summarizing pipeline",
  search_opportunities: "Searching opportunities",
  search_accounts: "Searching accounts",
  get_segment_stats: "Checking segment stats",
  get_region_insights: "Reviewing the area",
  get_season_status: "Checking the crop calendar",
  run_soql: "Querying Salesforce",
  search_help: "Searching help",
};

/* ---------------------------------------------------------------- helpers */

const lc = (s: string) => s.trim().toLowerCase();

function str(v: unknown, max = 200): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
}
function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}
function date(v: unknown): Date | undefined {
  const s = str(v, 30);
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return undefined;
  const d = parseDate(s.slice(0, 10));
  return Number.isNaN(d.getTime()) ? undefined : d;
}
function limitOf(v: unknown, dflt = 10, max = MAX_ROWS): number {
  const n = num(v);
  return n === undefined ? dflt : Math.max(1, Math.min(max, Math.round(n)));
}
const round = (n: number) => Math.round(n);

/** A state/province code from a code or full name */
export function parseState(v: string | undefined): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  if (/^[a-z]{2}$/i.test(t) && STATE_NAMES[t.toUpperCase()]) return t.toUpperCase();
  const n = lc(t).replace(/^quebec$/, "québec");
  return Object.keys(STATE_NAMES).find((k) => lc(STATE_NAMES[k]) === n);
}

/** A region from an id, name or short name */
export function parseRegion(v: string | undefined): RegionId | undefined {
  if (!v) return undefined;
  const n = lc(v).replace(/\bregion\b/, "").replace(/\s+/g, " ").trim();
  return REGIONS.find((r) => r.id === n || lc(r.name) === n || lc(r.shortName) === n || r.id === n.replace(/\s+/g, "-"))?.id;
}

/** An Area from a region id/name or state code/name. Region names win over the Manitoba province/region clash. */
export function parseArea(v: string | undefined): Area | undefined {
  if (!v) return undefined;
  const regionId = parseRegion(v);
  const state = parseState(v);
  if (state && (!regionId || /^[a-z]{2}$/i.test(v.trim()))) return { level: "state", regionId: REGION_BY_STATE[state] as RegionId, state };
  if (regionId) return { level: "region", regionId };
  if (state) return { level: "state", regionId: REGION_BY_STATE[state] as RegionId, state };
  return undefined;
}

function areaStates(a: Area): string[] {
  if (a.level === "state" && a.state) return [a.state];
  if (a.level === "region" && a.regionId) return REGION_BY_ID[a.regionId].states;
  return [];
}

function parseSegment(v: string | undefined): Segment | undefined {
  if (!v) return undefined;
  const n = lc(v).replace(/s$/, "");
  return SEGMENTS.find((s) => lc(s) === lc(v)) ?? SEGMENTS.find((s) => lc(s).includes(n));
}

export function toMapCommodity(v: string | undefined): MapCommodity | undefined {
  if (!v) return undefined;
  const n = lc(v);
  if (n.includes("wheat")) return "Wheat";
  if (n.startsWith("soy") || n === "beans") return "Soybeans";
  if (n.includes("lentil") || n.includes("pulse")) return "Lentils";
  return MAP_COMMODITIES.find((c) => lc(c) === n);
}

export function isOpenAt(o: Opportunity, asOf: Date): boolean {
  return parseDate(o.CreatedDate) <= asOf && !(o.IsClosed && parseDate(o.CloseDate) <= asOf);
}

/* Derived data is cached per snapshot and date; the chat may call several tools per turn */
interface Derived {
  prio: Prioritization;
  ranked: ScoredTarget[];
  scoreById: Map<string, ScoredTarget>;
  accountById: Map<string, Account>;
}
const derivedCache = new WeakMap<DataSnapshot, Map<string, Derived>>();

function derived(ctx: ToolContext): Derived {
  const key = toISODate(ctx.asOf);
  let perData = derivedCache.get(ctx.data);
  if (!perData) derivedCache.set(ctx.data, (perData = new Map()));
  let d = perData.get(key);
  if (!d) {
    const ranked = rankProspects(ctx.data, ctx.asOf);
    d = {
      prio: prioritize(ctx.data, ctx.asOf),
      ranked,
      scoreById: new Map(ranked.map((s) => [s.target.id, s])),
      accountById: new Map(ctx.data.accounts.map((a) => [a.Id, a])),
    };
    if (perData.size > 8) perData.clear();
    perData.set(key, d);
  }
  return d;
}

/** Deal amount x the segment's win rate for deals created in that month */
function expectedValue(o: Opportunity, segment: Segment | undefined, prio: Prioritization): number {
  const st = prio.stats.segments.find((s) => s.segment === segment);
  const rate = st ? rateForMonth(st, parseDate(o.CreatedDate).getUTCMonth()).rate : prio.stats.company.rate;
  return rate * o.Amount;
}

function oppRow(o: Opportunity, ctx: ToolContext, d: Derived) {
  const a = d.accountById.get(o.AccountId);
  return {
    id: o.Id,
    name: o.Name,
    href: opportunityHref(o.Id, ctx.lightningBaseUrl),
    account: a?.Name ?? "",
    account_id: o.AccountId,
    account_href: `/accounts/${o.AccountId}`,
    segment: a?.Segment__c ?? null,
    state: a?.BillingState ?? null,
    stage: o.StageName,
    amount: round(o.Amount),
    probability: o.Probability,
    close_date: o.CloseDate.slice(0, 10),
    expected_value: round(expectedValue(o, a?.Segment__c, d.prio)),
  };
}

function blackoutInfo(a: Account, asOf: Date) {
  const b = blackoutStatus(a, asOf);
  return {
    blackout: b.status === "hard" ? "harvest no-contact" : b.status === "light" ? "planting (light)" : isSeasonalSegment(a.Segment__c) ? "open" : "year-round segment",
    blackout_ends: b.blackout ? toISODate(b.blackout.end) : null,
    resume_date: b.resumeDate ? toISODate(b.resumeDate) : null,
  };
}

/* ------------------------------------------------------------------ tools */

function getPipelineSummary(ctx: ToolContext) {
  const d = derived(ctx);
  const { asOf, data } = ctx;
  const open = data.opportunities.filter((o) => isOpenAt(o, asOf) && d.accountById.has(o.AccountId));
  const rows = open.map((o) => oppRow(o, ctx, d));
  const byStage = OPEN_STAGES.map((stage) => {
    const s = rows.filter((r) => r.stage === stage);
    return { stage, count: s.length, amount: s.reduce((x, r) => x + r.amount, 0) };
  }).filter((s) => s.count);
  const bySegment = SEGMENTS.map((segment) => {
    const s = rows.filter((r) => r.segment === segment);
    return { segment, count: s.length, amount: s.reduce((x, r) => x + r.amount, 0), expected_value: s.reduce((x, r) => x + r.expected_value, 0) };
  })
    .filter((s) => s.count)
    .sort((a, b) => b.amount - a.amount);
  const top = [...rows].sort((a, b) => b.expected_value - a.expected_value).slice(0, 10);

  const since = addDays(asOf, -90);
  const closed = data.opportunities.filter((o) => o.IsClosed && parseDate(o.CloseDate) <= asOf && parseDate(o.CloseDate) > since);
  const won = closed.filter((o) => o.IsWon);
  const lost = closed.filter((o) => !o.IsWon);
  return {
    result: {
      as_of: toISODate(asOf),
      open_count: rows.length,
      open_amount: rows.reduce((x, r) => x + r.amount, 0),
      open_expected_value: rows.reduce((x, r) => x + r.expected_value, 0),
      by_stage: byStage,
      by_segment: bySegment,
      top_open_by_expected_value: top,
      last_90_days: {
        won_count: won.length,
        won_amount: round(won.reduce((x, o) => x + o.Amount, 0)),
        lost_count: lost.length,
        lost_amount: round(lost.reduce((x, o) => x + o.Amount, 0)),
      },
      note: "Expected value = amount x the segment's win rate for deals created in the same month.",
    },
    accountIds: top.map((r) => r.account_id),
  };
}

function searchOpportunities(input: Record<string, unknown>, ctx: ToolContext) {
  const d = derived(ctx);
  const state = parseState(str(input.state));
  const area = parseArea(str(input.region));
  const states = area ? new Set(areaStates(area)) : null;
  const segment = parseSegment(str(input.segment));
  const stage = str(input.stage);
  const openOnly = bool(input.open_only) ?? true;
  const minAmount = num(input.min_amount);
  const before = date(input.close_before);
  const after = date(input.close_after);
  const nameQ = str(input.name_contains);
  const sortBy = str(input.sort_by) ?? "expected_value";
  const limit = limitOf(input.limit);

  if (str(input.state) && !state) return { result: { error: `Unknown state or province "${str(input.state)}".` }, accountIds: [] };
  if (str(input.region) && !area) return { result: { error: `Unknown region "${str(input.region)}". Regions: ${REGIONS.map((r) => r.name).join(", ")}.` }, accountIds: [] };

  const matches = ctx.data.opportunities.filter((o) => {
    const a = d.accountById.get(o.AccountId);
    if (!a) return false;
    if (parseDate(o.CreatedDate) > ctx.asOf) return false;
    if (openOnly && !isOpenAt(o, ctx.asOf)) return false;
    if (state && a.BillingState !== state) return false;
    if (states && !states.has(a.BillingState)) return false;
    if (segment && a.Segment__c !== segment) return false;
    if (stage && lc(o.StageName) !== lc(stage)) return false;
    if (minAmount !== undefined && o.Amount < minAmount) return false;
    const close = parseDate(o.CloseDate.slice(0, 10));
    if (before && close > before) return false;
    if (after && close < after) return false;
    if (nameQ && !lc(o.Name).includes(lc(nameQ)) && !lc(a.Name).includes(lc(nameQ))) return false;
    return true;
  });
  const rows = matches.map((o) => oppRow(o, ctx, d));
  rows.sort((a, b) =>
    sortBy === "amount" ? b.amount - a.amount : sortBy === "close_date" ? a.close_date.localeCompare(b.close_date) : b.expected_value - a.expected_value,
  );
  const shown = rows.slice(0, limit);
  return {
    result: {
      total_matches: rows.length,
      total_amount: rows.reduce((x, r) => x + r.amount, 0),
      total_expected_value: rows.reduce((x, r) => x + r.expected_value, 0),
      rows: shown,
    },
    accountIds: shown.map((r) => r.account_id),
  };
}

function searchAccounts(input: Record<string, unknown>, ctx: ToolContext) {
  const d = derived(ctx);
  const state = parseState(str(input.state));
  const area = parseArea(str(input.region));
  const states = area ? new Set(areaStates(area)) : null;
  const segment = parseSegment(str(input.segment));
  const facility = str(input.facility_type);
  const commodity = str(input.commodity);
  const customer = bool(input.customer);
  const inBlackout = bool(input.in_blackout);
  const endsBefore = date(input.blackout_ends_before);
  const nameQ = str(input.name_contains);
  const includeLocations = bool(input.include_locations) ?? false;
  const sortBy = str(input.sort_by) ?? "score";
  const limit = limitOf(input.limit);

  if (str(input.state) && !state) return { result: { error: `Unknown state or province "${str(input.state)}".` }, accountIds: [] };
  if (str(input.region) && !area) return { result: { error: `Unknown region "${str(input.region)}". Regions: ${REGIONS.map((r) => r.name).join(", ")}.` }, accountIds: [] };

  const openByAccount = new Map<string, { count: number; amount: number }>();
  for (const o of ctx.data.opportunities) {
    if (!isOpenAt(o, ctx.asOf)) continue;
    const x = openByAccount.get(o.AccountId) ?? { count: 0, amount: 0 };
    openByAccount.set(o.AccountId, { count: x.count + 1, amount: x.amount + o.Amount });
  }

  const matches = ctx.data.accounts.filter((a) => {
    if (!includeLocations && a.ParentId) return false;
    if (state && a.BillingState !== state) return false;
    if (states && !states.has(a.BillingState)) return false;
    if (segment && a.Segment__c !== segment) return false;
    if (facility && !lc(a.Facility_Type__c).includes(lc(facility))) return false;
    if (commodity && !a.Primary_Commodities__c.some((c) => lc(c).includes(lc(commodity)))) return false;
    if (customer !== undefined && (a.Type === "Customer - Direct") !== customer) return false;
    if (nameQ && !lc(a.Name).includes(lc(nameQ))) return false;
    if (inBlackout !== undefined || endsBefore) {
      const b = blackoutStatus(a, ctx.asOf);
      const hard = b.status === "hard";
      if (inBlackout !== undefined && hard !== inBlackout) return false;
      if (endsBefore && !(hard && b.blackout!.end <= endsBefore)) return false;
    }
    return true;
  });

  const rows = matches.map((a) => {
    const s = d.scoreById.get(a.Id);
    const open = openByAccount.get(a.Id);
    return {
      id: a.Id,
      name: a.Name,
      href: `/accounts/${a.Id}`,
      customer: a.Type === "Customer - Direct",
      segment: a.Segment__c,
      facility_type: a.Facility_Type__c,
      city: a.BillingCity,
      state: a.BillingState,
      region: REGION_BY_ID[a.Region__c]?.name ?? a.Region__c,
      locations: a.Number_of_Locations__c,
      commodities: a.Primary_Commodities__c,
      revenue: a.AnnualRevenue,
      current_software: a.Current_Software__c,
      score: s ? Math.round(s.total) : null,
      tier: s?.tier ?? null,
      ...blackoutInfo(a, ctx.asOf),
      open_deals: open?.count ?? 0,
      open_pipeline: round(open?.amount ?? 0),
    };
  });
  rows.sort((a, b) => {
    if (sortBy === "revenue") return b.revenue - a.revenue;
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "blackout_end") return (a.blackout_ends ?? "9999").localeCompare(b.blackout_ends ?? "9999") || (b.score ?? -1) - (a.score ?? -1);
    return (b.score ?? -1) - (a.score ?? -1) || b.revenue - a.revenue;
  });
  const shown = rows.slice(0, limit);
  return {
    result: { total_matches: rows.length, rows: shown, note: "score is the 0-100 prospect score (prospects only); customers have null." },
    accountIds: shown.map((r) => r.id),
  };
}

function getSegmentStats(ctx: ToolContext) {
  const { prio } = derived(ctx);
  const pct = (x: number) => Math.round(x * 1000) / 10;
  return {
    result: {
      month: prio.month + 1,
      segments: prio.segments.map((s) => ({
        rank: s.rank,
        segment: s.segment,
        priority_score: s.score,
        win_rate_pct: pct(s.stats.closeRate.rate),
        win_rate_low_pct: pct(s.stats.closeRate.low),
        win_rate_high_pct: pct(s.stats.closeRate.high),
        confidence: s.stats.closeRate.tag,
        this_month_win_rate_pct: pct(s.seasonalRate.rate),
        won: s.stats.won,
        lost: s.stats.lost,
        decided: s.stats.decided,
        median_days_to_close: s.stats.medianDaysToClose,
        median_won_amount: s.stats.medianWonAmount,
        accounts: s.accounts,
        open_deals: s.openDeals,
        open_pipeline: round(s.openPipeline),
      })),
      note: "Priority = this month's win rate x a blend of deal size, cycle speed, product fit and expansion. Win-rate interval is Wilson 95%. Tags: Measured (>=10 decided deals), Blended (fewer, mixed with the company rate), Prior (no history).",
    },
    accountIds: [],
  };
}

function getRegionInsights(input: Record<string, unknown>, ctx: ToolContext) {
  const area = parseArea(str(input.region));
  if (!area) return { result: { error: `Unknown region or state "${str(input.region) ?? ""}". Regions: ${REGIONS.map((r) => r.name).join(", ")}.` }, accountIds: [] };
  const commodity = toMapCommodity(str(input.commodity)) ?? toMapCommodity(ctx.commodity) ?? "Corn";
  const d = derived(ctx);
  const x = computeAreaInsights(ctx.data, area, ctx.asOf, commodity, d.ranked, d.prio);
  return {
    result: {
      area: x.name,
      level: area.level,
      states: areaStates(area),
      summary: x.summary,
      facilities: x.facilities,
      customers: x.customers,
      coverage: `${x.penetration.covered} of ${x.penetration.total} ${x.penetration.label}`,
      open_pipeline: round(x.openPipeline),
      open_deals: x.openDeals,
      commodity,
      crop_phase: x.phase,
      top_prospects: x.top.map((t) => ({
        id: t.account.Id,
        name: t.account.Name,
        href: `/accounts/${t.account.Id}`,
        segment: t.account.Segment__c,
        city: t.account.BillingCity,
        state: t.account.BillingState,
        score: Math.round(t.score),
        est_deal: round(t.estDeal),
        contact_status: t.blackout,
      })),
      insights: x.insights,
    },
    accountIds: x.top.map((t) => t.account.Id),
  };
}

function getSeasonStatus(input: Record<string, unknown>, ctx: ToolContext) {
  const area = parseArea(str(input.region));
  if (!area) return { result: { error: `Unknown region or state "${str(input.region) ?? ""}".` }, accountIds: [] };
  const commodity = toMapCommodity(str(input.commodity)) ?? toMapCommodity(ctx.commodity) ?? "Corn";
  const on = date(input.date) ?? ctx.asOf;
  const states = areaStates(area);
  const inArea = ctx.data.accounts.filter((a) => states.includes(a.BillingState));
  // Representative state: the one requested, else the area's state with the most facilities
  const counts = new Map<string, number>();
  for (const a of inArea) counts.set(a.BillingState, (counts.get(a.BillingState) ?? 0) + 1);
  const lead = area.state ?? [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? states[0];
  const canada = CANADIAN_PROVINCES.includes(lead);
  const pts = inArea.filter((a) => a.BillingState === lead);
  const lat = pts.length ? pts.reduce((s, a) => s + a.BillingLatitude, 0) / pts.length : canada ? 50.5 : 41;
  const v = phaseValue(commodity, lead, lat, on);
  const y = on.getUTCFullYear();
  const win = (w: { start: Date; end: Date } | null) => (w ? { start: toISODate(w.start), end: toISODate(w.end) } : null);
  const entity = { Segment__c: "Country Elevator" as Segment, BillingLatitude: lat, BillingCountry: canada ? "Canada" : "United States" };
  const status = blackoutStatus(entity, on);
  const sell = sellingWindowAt(on);
  const range = windowRange(sell, on);
  return {
    result: {
      area: areaName(area),
      representative_state: lead,
      latitude: Math.round(lat * 10) / 10,
      commodity,
      date: toISODate(on),
      grown_here: isGrownIn(commodity, lead),
      phase: phaseLabel(v),
      phase_value: v === null ? null : Math.round(v * 100) / 100,
      phase_scale: "-1 planting peak, 0 growing/off-season, +1 harvest peak",
      planting_window: win(plantingWindow(commodity, lead, lat, y)),
      harvest_window: win(harvestWindow(commodity, lead, lat, y)),
      elevator_blackouts: blackoutsFor(entity, y).map((b) => ({ label: b.label, kind: b.kind === "hard" ? "no-contact" : "light no-contact", start: toISODate(b.start), end: toISODate(b.end) })),
      blackout_now: status.status === "none" ? null : { label: status.blackout!.label, ends: toISODate(status.blackout!.end), resume_date: toISODate(status.resumeDate!) },
      selling_window: { name: sell.name, start: toISODate(range.start), end: toISODate(range.end), sell_to_grain: sell.sellToGrain, summary: sell.summary },
      note: "Elevator and co-op buyers go dark during harvest (hard) and lightly during spring planting; ethanol plants, feed mills and processors are year-round.",
    },
    accountIds: [],
  };
}

/** Validates and caps a SOQL SELECT. Returns the query to run or an error. */
export function sanitizeSoql(raw: string): { query: string } | { error: string } {
  const q = raw.trim().replace(/;\s*$/, "").trim();
  if (!/^select\s/i.test(q)) return { error: "Only a single SOQL SELECT statement is allowed." };
  if (q.includes(";")) return { error: "Only a single statement is allowed (no semicolons)." };
  // Write keywords (and FOR UPDATE) outside string literals are rejected
  if (/\b(insert|update|delete|upsert|merge|undelete)\b/i.test(q.replace(/'(?:[^'\\]|\\.)*'/g, "''"))) {
    return { error: "Only read-only SELECT queries are allowed." };
  }
  // Cap the outer LIMIT (a LIMIT inside a subquery doesn't count); results are also truncated after the query
  const m = q.match(/\blimit\s+(\d+)(\s+offset\s+\d+)?\s*$/i);
  if (m) return { query: `${q.slice(0, m.index)}LIMIT ${Math.min(Number(m[1]), SOQL_MAX_ROWS)}${m[2] ?? ""}` };
  return { query: `${q} LIMIT ${SOQL_MAX_ROWS}` };
}

function stripAttributes(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripAttributes);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "attributes") out[k] = stripAttributes(x);
    return out;
  }
  return v;
}

async function runSoql(input: Record<string, unknown>, ctx: ToolContext) {
  if (ctx.mode !== "live") return { result: { error: "run_soql is only available with a live Salesforce connection" }, accountIds: [] };
  const raw = str(input.query, 4000);
  if (!raw) return { result: { error: "query is required" }, accountIds: [] };
  const s = sanitizeSoql(raw);
  if ("error" in s) return { result: { error: s.error }, accountIds: [] };
  try {
    const conn = await getSalesforceConnection();
    // Read-only: conn.query only; autoFetch off so the row cap holds
    const res = await conn.query<Record<string, unknown>>(s.query, { autoFetch: false, maxFetch: SOQL_MAX_ROWS });
    const records = (res.records ?? []).slice(0, SOQL_MAX_ROWS).map((r) => stripAttributes(r) as Record<string, unknown>);
    const accountIds = records
      .map((r) => (typeof r.AccountId === "string" ? r.AccountId : typeof r.Id === "string" && r.Id.startsWith("001") ? r.Id : null))
      .filter((x): x is string => !!x);
    return { result: { query: s.query, total_size: res.totalSize, returned: records.length, records }, accountIds };
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0].slice(0, 300) : "query failed";
    return { result: { error: `SOQL error: ${msg}` }, accountIds: [] };
  }
}

/* ---------------------------------------------------------------- dispatch */

const PLATFORM_ONLY = new Set<string>(["get_segment_stats", "get_season_status", "search_help"]);

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as string[]).includes(name);
}

/** Runs one tool. Never throws: failures come back as `{ error }` results. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolRun> {
  const args = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const source: ToolRun["source"] = ctx.mode === "live" && !PLATFORM_ONLY.has(name) ? "Salesforce" : "Platform data";
  try {
    let out: { result: unknown; accountIds: string[] };
    switch (name) {
      case "get_pipeline_summary":
        out = getPipelineSummary(ctx);
        break;
      case "search_opportunities":
        out = searchOpportunities(args, ctx);
        break;
      case "search_accounts":
        out = searchAccounts(args, ctx);
        break;
      case "get_segment_stats":
        out = getSegmentStats(ctx);
        break;
      case "get_region_insights":
        out = getRegionInsights(args, ctx);
        break;
      case "get_season_status":
        out = getSeasonStatus(args, ctx);
        break;
      case "run_soql":
        out = await runSoql(args, ctx);
        break;
      case "search_help": {
        const query = str(args.query, 300);
        out = { result: query ? { articles: await searchHelp(query, 3) } : { error: "query is required" }, accountIds: [] };
        break;
      }
      default:
        return { result: { error: `Unknown tool "${name}"` }, accountIds: [], source };
    }
    return { ...out, accountIds: [...new Set(out.accountIds)], source };
  } catch (err) {
    console.error(`[ai] tool ${name} failed:`, err instanceof Error ? err.message : err);
    return { result: { error: `Tool ${name} failed` }, accountIds: [], source };
  }
}

/* Result shapes, for the offline fallback that formats them */
export type PipelineSummaryResult = ReturnType<typeof getPipelineSummary>["result"];
export type OpportunitySearchResult = Extract<ReturnType<typeof searchOpportunities>["result"], { rows: unknown }>;
export type AccountSearchResult = Extract<ReturnType<typeof searchAccounts>["result"], { rows: unknown }>;
export type SegmentStatsResult = ReturnType<typeof getSegmentStats>["result"];
export type RegionInsightsResult = Extract<ReturnType<typeof getRegionInsights>["result"], { area: string }>;
export type SeasonStatusResult = Extract<ReturnType<typeof getSeasonStatus>["result"], { phase: string }>;
