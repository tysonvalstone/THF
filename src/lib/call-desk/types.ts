/**
 * Call Desk shared types. The records themselves (Call, CallNotes,
 * CallCommitment) live in src/types/salesforce.ts.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { CallCommitment, CallType, OpportunityStage } from "@/types/salesforce";
import type { BriefFacts, BriefQuestion, Objection } from "@/lib/callBriefRules";

/** Store data, the app date and the acting user (same shape as the outreach ActionContext) */
export interface CallContext {
  data: DataSnapshot;
  /** The app's "today" (time travel) */
  asOf: Date;
  userId: string;
}

export interface ScheduleCallInput {
  /** Set to edit an existing call */
  id?: string;
  accountId: string;
  opportunityId?: string;
  contactIds: string[];
  callType: CallType;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24-hour */
  time: string;
  durationMin: number;
  subject?: string;
  /** Defaults to ctx.userId (or the account owner when the user owns no accounts) */
  ownerId?: string;
}

export type TimelineKind = "Call" | "Email" | "Sequence" | "Meeting" | "Task" | "Quote" | "Contract" | "Ticket" | "Invoice";
export const TIMELINE_KINDS: TimelineKind[] = ["Call", "Email", "Sequence", "Meeting", "Task", "Quote", "Contract", "Ticket", "Invoice"];

export interface TimelineEntry {
  id: string;
  /** ISO date or date-time */
  date: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  href?: string;
  tone?: "warn";
}

export interface BriefAttendee {
  id: string;
  name: string;
  title: string;
  role: string;
  lastSpoke?: { date: string; kind: string };
  note?: string;
}

export interface BriefCommitment extends CallCommitment {
  overdue: boolean;
}

export interface BriefRisk {
  kind: "blackout" | "board" | "economic-buyer" | "competitor" | "health" | "invoice" | "quote" | "ticket";
  text: string;
}

export interface CallBrief {
  callId: string;
  source: "rules" | "ai";
  /** 2–3 line "at a glance" written by the AI (empty for rules) */
  aiSummary: string[];
  snapshot: {
    accountId: string;
    accountName: string;
    segment: string;
    facility: string;
    locations: number;
    commodity: string;
    region: string;
    place: string;
    isCustomer: boolean;
    season: { status: "hard" | "light" | "none" | "year-round"; label: string };
    health?: { score: number; band: string; trend: "up" | "down" | "flat"; delta: number };
    pipeline: { amount: number; count: number };
    opportunity?: { id: string; name: string; stage: OpportunityStage; amount: number; closeDate: string; economicBuyer: boolean };
    quote?: { id: string; number: string; status: string; total: number };
    contract?: { id: string; number: string; status: string; endDate: string; arr: number };
    overdue: { count: number; amount: number };
  };
  attendees: BriefAttendee[];
  gaps: string[];
  lastTime?: {
    callId: string;
    date: string;
    subject: string;
    callType: CallType;
    pending: boolean;
    summary: string[];
    sentiment?: string;
    commitments: BriefCommitment[];
    questionsAsked: string[];
  };
  timeline: TimelineEntry[];
  questions: BriefQuestion[];
  talking: {
    products: { name: string; why: string }[];
    reference?: { accountId: string; name: string; detail: string };
    objections: Objection[];
    points: string[];
  };
  risks: BriefRisk[];
  facts: BriefFacts;
}

/** A CRM change suggested by AI Notes; nothing is applied until the rep confirms it */
export interface SuggestedUpdate {
  key: "stage" | "closeDate" | "economicBuyer" | "nextStep" | "locations";
  label: string;
  object: "Opportunity" | "Account";
  recordId: string;
  from: string;
  to: string;
  changes: Record<string, unknown>;
  /** Why it can't be applied as-is (e.g. the economic-buyer gate) */
  blocked?: string;
  /** Only applies together with this other suggestion (e.g. stage needs the economic buyer) */
  requires?: SuggestedUpdate["key"];
}

export type { DataSnapshot };
