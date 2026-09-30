/**
 * Shared contracts for the AI assistant, export templates and email sequences.
 * Client and server both import these; keep this file free of runtime imports.
 */

/* ------------------------------------------------------------------ chat */

export type SourceKind = "Salesforce" | "Platform data" | "Web";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** What the user is looking at, so answers match the screen */
export interface ChatContext {
  /** Time-travel date, YYYY-MM-DD */
  asOf: string;
  /** Map commodity selected on the current page, if any */
  commodity?: string;
  /** Current pathname, e.g. "/prospects" */
  page: string;
  /** Human title of the current page, e.g. "Prospects" */
  pageTitle?: string;
  /** Demo Mode or guest: answer from the mock data */
  demo?: boolean;
  /** The browser's local changes (creates, edits, deletes) so answers match the screen */
  mutations?: unknown[];
}

export interface ChatRequest {
  kind: "chat";
  messages: ChatMessage[];
  context: ChatContext;
}

/** Newline-delimited JSON events streamed by POST /api/ai (kind "chat") */
export type ChatEvent =
  | { type: "text"; text: string }
  /** Short progress note while a tool runs, e.g. "Searching opportunities" */
  | { type: "status"; text: string }
  | {
      type: "done";
      sources: SourceKind[];
      /** true when answered by the no-key fallback */
      offline: boolean;
      /** Account Ids referenced by the answer (for "Start sequence") */
      accountIds: string[];
      /** Whether the answer is list-like enough to offer "Export this" */
      exportable: boolean;
    }
  | { type: "error"; message: string };

/* --------------------------------------------------------------- exports */

export type ExportSource = "opportunities" | "accounts" | "contacts" | "segments";
export type ExportFormat = "csv" | "xlsx" | "pdf";
export type FieldType = "string" | "number" | "currency" | "percent" | "date" | "boolean";

export type FilterOp = "eq" | "neq" | "in" | "contains" | "gt" | "gte" | "lt" | "lte" | "isTrue" | "isFalse";

export interface ExportFilter {
  field: string;
  op: FilterOp;
  /** Strings for eq/neq/contains, comma-separated list for "in", number or YYYY-MM-DD for comparisons */
  value?: string;
}

export interface ExportColumn {
  field: string;
  /** Header text; defaults to the field label */
  label?: string;
}

export interface ExportSort {
  field: string;
  dir: "asc" | "desc";
}

export interface ExportSpec {
  id: string;
  name: string;
  description?: string;
  source: ExportSource;
  filters: ExportFilter[];
  columns: ExportColumn[];
  /** Field to group rows by (subtotals per group); null for a flat list */
  groupBy: string | null;
  sort: ExportSort[];
  /** Fields summed in the totals row (number/currency only) */
  totals: string[];
  format: ExportFormat;
  prebuilt?: boolean;
  updatedAt?: string;
}

/* ------------------------------------------------------------- sequences */

export type StepType = "email" | "call" | "linkedin";

/** Normalized season phase used by merge fields and variant rules */
export type SeasonPhase = "planting" | "growing" | "harvest" | "post-harvest" | "off-season";
export const SEASON_PHASES: SeasonPhase[] = ["planting", "growing", "harvest", "post-harvest", "off-season"];

export type VariantField = "season_phase" | "commodity" | "region" | "state" | "segment";
export const VARIANT_FIELDS: VariantField[] = ["season_phase", "commodity", "region", "state", "segment"];

export interface VariantRule {
  field: VariantField;
  op: "eq" | "neq";
  /**
   * Compared case-insensitively. `commodity` matches any of the account's
   * commodities by substring ("wheat" matches Winter Wheat and Spring Wheat);
   * `region` matches the region id or name; `state` the 2-letter code.
   */
  value: string;
}

/** Alternate text for a step, used when all its rules match. First matching variant wins; otherwise the step's default text. */
export interface StepVariant {
  id: string;
  name: string;
  rules: VariantRule[];
  subject?: string;
  body: string;
}

export interface SequenceStep {
  id: string;
  type: StepType;
  /** Day offset from enrollment, 1-based ("Day 1, Day 3, Day 8") */
  day: number;
  /** Email only */
  subject?: string;
  /** Email body, or call/LinkedIn task notes */
  body: string;
  variants: StepVariant[];
}

export interface Sequence {
  id: string;
  name: string;
  description?: string;
  /** Target segment, informational */
  segment?: string;
  /** Suggested start month, 1–12, informational */
  month?: number;
  steps: SequenceStep[];
  prebuilt?: boolean;
  updatedAt?: string;
}

export const MERGE_FIELDS = [
  "contact.first_name",
  "contact.title",
  "account.name",
  "account.locations",
  "region",
  "state",
  "commodity",
  "season_phase",
  "blackout_end_date",
  "fiscal_year_end",
  "next_board_meeting",
  "sender.name",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export interface ScheduledStep {
  stepId: string;
  type: StepType;
  /** YYYY-MM-DD after blackout adjustment */
  date: string;
  /** Set when the step was moved out of a no-contact period */
  originalDate?: string;
  variantId?: string;
  subject?: string;
  body: string;
}

export interface Enrollment {
  id: string;
  sequenceId: string;
  sequenceName: string;
  accountId: string;
  contactId?: string;
  enrolledAt: string;
  /** YYYY-MM-DD, the time-travel date when enrolled */
  startDate: string;
  enrolledBy: string;
  steps: ScheduledStep[];
}

/* ---------------------------------------------------------- JSON AI calls */

export type AiJsonRequest =
  | { kind: "export-spec"; prompt: string; context: ChatContext }
  | { kind: "draft-sequence"; goal: string; segment: string; season: string; context: ChatContext }
  | { kind: "rewrite-step"; step: { type: StepType; subject?: string; body: string }; instruction: string; context: ChatContext }
  | CallBriefRequest
  | CallNotesRequest;

export type ExportSpecResponse = { ok: true; spec: Omit<ExportSpec, "id"> } | { ok: false; reason: string };
export type DraftSequenceResponse = { ok: true; sequence: Omit<Sequence, "id"> } | { ok: false; reason: string };
export type RewriteStepResponse = { ok: true; subject?: string; body: string } | { ok: false; reason: string };

/* ----------------------------------------------------------- trip planner */

export interface TripRequest {
  /** 2-letter state/province code, or a region id such as "eastern-corn-belt" */
  destination: string;
  /** First travel day, YYYY-MM-DD */
  startDate: string;
  /** Number of stops to plan */
  stops: number;
  /** A Segment name, or "any" */
  segment: string;
  /** Optional starting city, e.g. "Peoria, IL" */
  startCity?: string;
}

export type TripParseRequest = { kind: "trip-parse"; prompt: string; context: ChatContext };
export type TripParseResponse = { ok: true; trip: TripRequest } | { ok: false; reason: string };

/* -------------------------------------------------------------- call desk */

/** Pre-call brief parts written by the model from a digest of the account's store data */
export interface CallBriefAi {
  /** 2–3 short lines: where things stand and what this call must achieve */
  summary: string[];
  /** 5–7 tailored questions */
  questions: string[];
  talkingPoints: string[];
  objections: { objection: string; response: string }[];
}

export type CallBriefRequest = { kind: "call-brief"; digest: string; context: ChatContext };
export type CallBriefResponse = { ok: true; brief: CallBriefAi } | { ok: false; reason: string };

/** AI Notes from a call transcript and the rep's rough notes */
export interface CallNotesAi {
  summary: string[];
  keyPoints: string[];
  painPoints: string[];
  objections: { objection: string; response: string }[];
  qualification: { budget: string | null; decisionMaker: string | null; timeline: string | null; competitors: string | null; locations: number | null };
  nextSteps: { text: string; owner: "rep" | "customer"; ownerName: string; due: string | null }[];
  sentiment: "Positive" | "Neutral" | "Concerned";
  followUpEmail: { subject: string; body: string };
  /** Suggested CRM changes; nothing is applied until the rep confirms */
  updates: { stage: string | null; closeDate: string | null; economicBuyerName: string | null };
}

export type CallNotesRequest = { kind: "call-notes"; meta: string; transcript: string; repNotes: string; context: ChatContext };
export type CallNotesResponse = { ok: true; notes: CallNotesAi } | { ok: false; reason: string };
