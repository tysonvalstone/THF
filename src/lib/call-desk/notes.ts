/**
 * AI Notes without an AI key: rules and keyword extraction over the call
 * transcript and the rep's rough notes produce the same sections the model
 * would (summary, key points, pain points, objections with responses,
 * qualification, next steps with owners and due dates, sentiment, a
 * follow-up email) plus suggested CRM updates the rep confirms one by one.
 *
 * Pure: the seed script uses this too.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Call, CallNotes, Contact, Opportunity, OpportunityStage } from "@/types/salesforce";
import { SOFTWARE_VENDORS } from "@/data/reference/software";
import { addDays, fmtShortDate, parseDate, toISODate } from "@/lib/dates";
import { nextBoardMeeting, thanksgiving } from "@/lib/seasonality";
import { mergeValues, renderTemplate } from "@/lib/sequences/engine";
import type { TranscriptLine } from "@/lib/callScripts";
import { callContacts, repName } from "./transcript";
import { callDate } from "./time";
import type { SuggestedUpdate } from "./types";

export type NotesData = Pick<DataSnapshot, "accounts" | "contacts" | "opportunities">;

interface Said {
  speaker: string;
  rep: boolean;
  text: string;
  /** Index of the transcript line */
  line: number;
}

const sentences = (text: string) =>
  text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

function said(transcript: TranscriptLine[], rep: string): Said[] {
  return transcript.flatMap((l, i) => sentences(l.text).map((text) => ({ speaker: l.speaker, rep: l.speaker === rep, text, line: i })));
}

const clip = (s: string, n = 150) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const stripEnd = (s: string) => s.replace(/[.?!]+$/, "");

/* --------------------------------------------------------------- patterns */

const PAIN: [RegExp, string][] = [
  [/keyed twice|keys? it again|key every .* twice|re-?keys?\b/i, "Scale tickets keyed twice"],
  [/can't key them fast enough|settlements run behind/i, "Settlements run behind at peak"],
  [/reconcil/i, "Manual reconciliation"],
  [/retires?\b|nobody else knows/i, "Key-person risk on the current system"],
  [/has to go|old PC|end of support/i, "Current system near end of life"],
  [/backs? up|backed up/i, "Receiving lines back up at peak"],
  [/by hand|paper sheets/i, "Manual work when systems fail"],
  [/shorted/i, "Outages hit customer orders"],
  [/spreadsheet|excel/i, "Key data kept in spreadsheets"],
  [/errors?\b/i, "Errors in producer statements"],
  [/can't see our position/i, "No real-time position"],
  [/auditors? flagged/i, "Audit findings on manual steps"],
  [/slow|frustrat/i, "Slow support response"],
  [/bottleneck/i, "Scale house bottleneck"],
];

const OBJECTION: [RegExp, string][] = [
  [/came in lower|discounting/i, "Competitor priced lower"],
  [/price is my worry|number is the problem|expensive|cost is the question|budget is tight|percent off/i, "Price"],
  [/price increase/i, "Renewal price increase"],
  [/won't use|stay in the truck/i, "Driver adoption"],
  [/migration risk|go down at any location/i, "Migration risk during harvest"],
  [/replace the ERP/i, "Replacing the ERP"],
  [/take the mill down/i, "Downtime at cutover"],
  [/quote was a lot higher/i, "Competitor comparison"],
];

const POSITIVE = /appreciate|great\b|helpful|like that|sounds good|makes sense|perfect|that works|right approach|a fit\b|we're close|happy to|that helps|what i want to see|smoothly|doing its job/i;
const NEGATIVE = /worry|scared|problem|frustrat|tight|concern|risk|won't|can't|too expensive|slow/i;

const COMPETITORS = SOFTWARE_VENDORS.filter((v) => v.kind === "competitor").map((v) => v.name);

/** A commitment starts the sentence ("I'll send…", "Good. I'll book…"), not "…and I'll walk him through it" */
const COMMIT = /^(?:(?:good|great|no problem|that works|sure|and|also|so)[.,]?\s+)?(I'll|I will|I'm going to|We'll|We will)\b/i;
const COMMIT_VERB = /\b(send|put|book|add|resend|set up|set|get|include|pull|check|look|bring|walk|schedule|share|follow)\b/i;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function nextWeekday(from: Date, dow: number, minDays = 1): Date {
  let d = addDays(from, minDays);
  while (d.getUTCDay() !== dow) d = addDays(d, 1);
  return d;
}

function businessDays(from: Date, n: number): Date {
  let d = from;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d;
}

/** Due date from phrases like "by Friday", "this week", "next week", "after Thanksgiving" */
export function dueFrom(text: string, from: Date, board: Date | null, fallbackDays: number): string {
  const t = text.toLowerCase();
  const dow = WEEKDAYS.findIndex((d) => t.includes(d));
  if (/next friday/.test(t)) return toISODate(nextWeekday(addDays(from, 7), 5, 0));
  if (dow >= 0) return toISODate(nextWeekday(from, dow));
  if (/tomorrow/.test(t)) return toISODate(businessDays(from, 1));
  if (/this week/.test(t)) return toISODate(from.getUTCDay() >= 5 ? businessDays(from, 2) : nextWeekday(from, 5, 0));
  if (/next week/.test(t)) return toISODate(businessDays(from, 5));
  if (/thanksgiving/.test(t)) {
    const tg = thanksgiving(from.getUTCFullYear());
    return toISODate(addDays(tg < from ? thanksgiving(from.getUTCFullYear() + 1) : tg, 4));
  }
  if (/after harvest/.test(t)) return toISODate(addDays(thanksgiving(from.getUTCFullYear()), 4) > from ? addDays(thanksgiving(from.getUTCFullYear()), 4) : businessDays(from, 10));
  if (/board (meeting|packet|agenda)|before the \w+ meeting/.test(t) && board) {
    const d = addDays(board, -7);
    return toISODate(d > from ? d : businessDays(from, 3));
  }
  return toISODate(businessDays(from, fallbackDays));
}

/** Swap the speaker's point of view when the customer made the commitment ("send you our" → "send us their") */
function theirView(s: string): string {
  const map: Record<string, string> = { our: "their", ours: "theirs", we: "they", us: "them", you: "us", your: "our" };
  return s.replace(/\b(our|ours|we|us|you|your)\b/gi, (w) => map[w.toLowerCase()] ?? w);
}

/** "I'll send a short summary this week so you have it" → "Send a short summary" (the due date carries the timing) */
export function actionText(sentence: string, customer = false): string {
  let s = stripEnd(sentence)
    .replace(/^(good|great|no problem|that works|good to know|sure)[.,]?\s*/i, "")
    .replace(/^(and|also|so)\s+/i, "");
  s = s.replace(/^(I'll|I will|I'm going to|We'll|We will)\s+/i, "");
  s = s.split(/\s+so (?:you|it|that)\b|,\s*once\b/)[0];
  s = s
    .replace(/\s+(by|on)\s+(next\s+)?(monday|tuesday|wednesday|thursday|friday)\b.*$/i, "")
    .replace(/\s+(for\s+)?(this|next) week$/i, "")
    .trim();
  return cap(customer ? theirView(s) : s);
}

function firstMatch(list: Said[], re: RegExp, prefer?: RegExp): Said | undefined {
  const hits = list.filter((s) => re.test(s.text));
  return (prefer && hits.find((s) => prefer.test(s.text))) || hits[0];
}

const locationsIn = (text: string) => {
  const m = text.match(/\b(\d{1,3})\s+(?:locations|sites|elevators)\b/i);
  return m ? Number(m[1]) : undefined;
};

/* ----------------------------------------------------------------- notes */

export interface NotesOptions {
  /** Sender name for the follow-up email (defaults to the call owner) */
  sender?: string;
}

/** Structured AI Notes from a transcript and the rep's rough notes, by rules */
export function notesFromTranscript(call: Call, transcript: TranscriptLine[], repNotes: string, data: NotesData, opts: NotesOptions = {}): CallNotes {
  const rep = repName(call.OwnerId);
  const all = said(transcript, rep);
  const them = all.filter((s) => !s.rep);
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const contacts = callContacts(call, data);
  const day = parseDate(callDate(call));
  const board = nextBoardMeeting(account?.Board_Meeting_Months__c, day);
  const noteLines = repNotes
    .split(/\n+/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);

  // Pain points: first sentence per pain theme
  const painLabels: string[] = [];
  const painPoints: string[] = [];
  for (const [re, label] of PAIN) {
    const hit = them.find((s) => re.test(s.text));
    if (hit && !painPoints.includes(clip(hit.text))) {
      painLabels.push(label);
      painPoints.push(clip(hit.text));
    }
    if (painPoints.length >= 4) break;
  }

  // Objections, answered by the rep's next line
  const objections: CallNotes["objections"] = [];
  const objectionLabels: string[] = [];
  for (const [re, label] of OBJECTION) {
    const hit = them.find((s) => re.test(s.text) && !objections.some((o) => o.objection === clip(s.text)));
    if (!hit) continue;
    const reply = all.find((s) => s.rep && s.line > hit.line && s.line <= hit.line + 2);
    const replyLine = reply ? transcript[reply.line].text : "";
    objections.push({ objection: clip(hit.text), response: replyLine ? clip(replyLine, 200) : "Not answered on the call" });
    objectionLabels.push(label);
    if (objections.length >= 3) break;
  }

  // Qualification
  const budget = firstMatch(them, /\$[\d,]+|budget/i, /\$[\d,]+/);
  // Who decides: an explicit sign-off or approval, not a passing mention of the board
  const decision = firstMatch(them, /\bsigns?\b.*\boff\b|\bapprov|\bdecides?\b/i, /sign/i);
  const timeline = firstMatch(them, /before (spring )?planting|no later than|after thanksgiving|after harvest|meets? in \w+|before our fiscal year|budget is being set now|fiscal year ends/i, /no later than|before (spring )?planting|meets? in/i);
  const fullText = `${transcript.map((l) => l.text).join(" ")} ${noteLines.join(" ")}`;
  const competitors = COMPETITORS.filter((c) => fullText.toLowerCase().includes(c.toLowerCase()));
  const locationsSaid = all.map((s) => locationsIn(s.text)).find((n) => n !== undefined);
  const noteBudget = noteLines.find((l) => /\$[\d,]+|budget/i.test(l));
  const qualification: CallNotes["qualification"] = {
    ...(budget || noteBudget ? { budget: clip(budget?.text ?? noteBudget!, 140) } : {}),
    ...(decision ? { decisionMaker: clip(decision.text, 140) } : {}),
    ...(timeline ? { timeline: clip(timeline.text, 140) } : {}),
    ...(competitors.length ? { competitors: competitors.join(", ") } : {}),
    ...(locationsSaid ? { locations: `${locationsSaid} locations` } : {}),
  };

  // Next steps: commitments on either side
  const nextSteps: CallNotes["nextSteps"] = [];
  for (const s of all) {
    if (!COMMIT.test(s.text) || !COMMIT_VERB.test(s.text)) continue;
    const text = actionText(s.text, !s.rep);
    if (!text || nextSteps.some((n) => n.text === text)) continue;
    nextSteps.push({ text, owner: s.rep ? rep : s.speaker, due: dueFrom(s.text, day, board, s.rep ? 3 : 5) });
    if (nextSteps.length >= 5) break;
  }
  for (const l of noteLines) {
    if (/^(todo|to do|follow up|send|call|email|schedule|book)\b/i.test(l)) {
      const text = cap(stripEnd(l.replace(/^(todo|to do)[:\s-]*/i, "")));
      if (!nextSteps.some((n) => n.text === text)) nextSteps.push({ text, owner: rep, due: dueFrom(l, day, board, 3) });
    }
  }

  // Sentiment from what the customer said (and the rep's notes)
  const count = (re: RegExp) => noteLines.reduce((n, l) => n + (l.match(re)?.length ?? 0), 0);
  const pos = them.filter((s) => POSITIVE.test(s.text)).length + count(/positive|good call|interested|keen|excited/gi);
  const neg = them.filter((s) => NEGATIVE.test(s.text)).length + count(/concern|worried|pushback|cold|stalled|hesitant/gi);
  const sentiment: CallNotes["sentiment"] = pos - neg >= 2 ? "Positive" : neg - pos >= 2 ? "Concerned" : "Neutral";

  // Key points: the qualification facts, what landed, and the rep's own notes
  const keyPoints: string[] = [];
  if (qualification.locations) keyPoints.push(`${qualification.locations}${account?.Current_Software__c && account.Current_Software__c !== "ThiboLiSoft" ? ` on ${account.Current_Software__c}` : ""}`);
  if (qualification.decisionMaker) keyPoints.push(`Decision: ${lowerFirst(stripEnd(qualification.decisionMaker))}`);
  if (qualification.budget) keyPoints.push(`Budget: ${lowerFirst(stripEnd(qualification.budget))}`);
  if (qualification.timeline && qualification.timeline !== qualification.decisionMaker) keyPoints.push(`Timeline: ${lowerFirst(stripEnd(qualification.timeline))}`);
  for (const s of them.filter((x) => POSITIVE.test(x.text) && x.text.split(/\s+/).length > 4).slice(0, 2)) keyPoints.push(`Landed well: "${stripEnd(s.text)}"`);
  for (const l of noteLines.filter((x) => !nextSteps.some((n) => n.text === cap(stripEnd(x))))) keyPoints.push(`Rep note: ${stripEnd(l)}`);

  // Summary, 3–4 lines
  const who = contacts.length ? contacts.map((c) => c.Name).join(" and ") : "the customer";
  const lines = [`${call.CallType} call with ${who} at ${account?.Name ?? "the account"}.`];
  if (painLabels.length) lines.push(`Main pain: ${painLabels.slice(0, 2).map((p, i) => (i ? lowerFirst(p) : p)).join("; ")}.`);
  if (objectionLabels.length) lines.push(`Concern raised: ${lowerFirst(objectionLabels[0])}${objections[0].response !== "Not answered on the call" ? ", answered on the call" : ", still open"}${competitors.length ? `; ${competitors[0]} in the picture` : ""}.`);
  else if (qualification.decisionMaker && /sign/i.test(qualification.decisionMaker)) lines.push(`${cap(stripEnd(qualification.decisionMaker))}.`);
  if (nextSteps.length) lines.push(`Next: ${lowerFirst(nextSteps[0].text)}${nextSteps[0].due ? ` by ${fmtShortDate(nextSteps[0].due)}` : ""}.`);

  const notes: CallNotes = {
    summary: lines.slice(0, 4).join("\n"),
    keyPoints: keyPoints.slice(0, 6),
    painPoints,
    objections,
    qualification,
    nextSteps,
    sentiment,
    source: "rules",
  };
  notes.followUpEmail = followUpEmail(call, notes, data, opts.sender ?? rep);
  return notes;
}

/* ------------------------------------------------------ follow-up email */

const EMAIL_TEMPLATE = `Hi {{contact.first_name}},

Thanks for the time today. Here's what I heard from {{account.name}}:
{{pains}}

Next steps:
{{steps}}
{{board}}
Best,
{{sender.name}}`;

/** Follow-up email draft, filled with the sequence merge fields */
export function followUpEmail(call: Call, notes: Pick<CallNotes, "painPoints" | "nextSteps" | "qualification">, data: NotesData, sender: string): { subject: string; body: string } {
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const contact = callContacts(call, data)[0];
  const day = parseDate(callDate(call));
  const pains = notes.painPoints.slice(0, 3).map((p) => `- ${stripEnd(p)}`);
  const steps = notes.nextSteps.slice(0, 4).map((n) => `- ${n.text}${n.due ? ` (${fmtShortDate(n.due)})` : ""}`);
  const body = EMAIL_TEMPLATE.replace("{{pains}}", pains.length ? pains.join("\n") : "- Where things stand and what matters most this season")
    .replace("{{steps}}", steps.length ? steps.join("\n") : "- I'll follow up with a short summary")
    .replace("{{board}}", /board/i.test(notes.qualification.decisionMaker ?? "") ? "\nHappy to put together a one-page summary for the board meeting on {{next_board_meeting}}.\n" : "");
  const subject = `Following up: {{account.name}}`;
  if (!account) return { subject: subject.replace("{{account.name}}", "our call"), body };
  const values = mergeValues({ account, contact, sender: { name: sender }, asOf: day, data });
  return { subject: renderTemplate(subject, values).text, body: renderTemplate(body, values).text };
}

/* --------------------------------------------------- suggested updates */

const STAGES: OpportunityStage[] = ["Prospecting", "Qualification", "Needs Analysis", "Proposal", "Negotiation", "Board Approval"];
/** How far a call of each type can move a deal */
const STAGE_CAP: Record<Call["CallType"], OpportunityStage | null> = {
  Discovery: "Needs Analysis",
  Demo: "Proposal",
  "Follow-up": "Negotiation",
  Negotiation: "Board Approval",
  Renewal: null,
  "Check-in": null,
};

/** The deal a call is about: its linked opportunity, else the account's most likely open deal */
export function callOpportunity(call: Pick<Call, "OpportunityId" | "AccountId">, data: Pick<DataSnapshot, "opportunities">): Opportunity | undefined {
  if (call.OpportunityId) return data.opportunities.find((o) => o.Id === call.OpportunityId);
  return data.opportunities.filter((o) => o.AccountId === call.AccountId && !o.IsClosed).sort((a, b) => b.Probability - a.Probability)[0];
}

function economicBuyerFor(call: Call, notes: CallNotes, contacts: Contact[], data: NotesData): Contact | undefined {
  const onCall = callContacts(call, data).find((c) => c.Buying_Role__c === "Economic Buyer");
  if (onCall) return onCall;
  // Only when the call named who signs off (not just a passing mention of the board)
  if (!notes.qualification.decisionMaker || !/sign/i.test(notes.qualification.decisionMaker)) return undefined;
  return contacts.find((c) => c.AccountId === call.AccountId && c.Buying_Role__c === "Economic Buyer");
}

/** CRM changes the notes support. Nothing is applied until the rep confirms each one. */
export function suggestedUpdates(call: Call, notes: CallNotes, data: NotesData): SuggestedUpdate[] {
  const out: SuggestedUpdate[] = [];
  const account: Account | undefined = data.accounts.find((a) => a.Id === call.AccountId);
  const opp = callOpportunity(call, data);
  const day = parseDate(callDate(call));

  if (opp && !opp.IsClosed) {
    let ebKnown = opp.Economic_Buyer_Identified__c;
    if (!opp.Economic_Buyer_Identified__c) {
      const eb = economicBuyerFor(call, notes, data.contacts, data);
      if (eb) {
        ebKnown = true;
        out.push({
          key: "economicBuyer",
          label: "Economic buyer",
          object: "Opportunity",
          recordId: opp.Id,
          from: "Not identified",
          to: `Identified: ${eb.Name}`,
          changes: { Economic_Buyer_Identified__c: true, Economic_Buyer__c: eb.Id },
        });
      }
    }
    const capStage = STAGE_CAP[call.CallType];
    const idx = STAGES.indexOf(opp.StageName);
    if (capStage && idx >= 0 && notes.sentiment !== "Concerned" && idx < STAGES.indexOf(capStage)) {
      const target = STAGES[idx + 1];
      const gated = opp.StageName === "Prospecting" && !opp.Economic_Buyer_Identified__c;
      out.push({
        key: "stage",
        label: "Stage",
        object: "Opportunity",
        recordId: opp.Id,
        from: opp.StageName,
        to: target,
        changes: { StageName: target },
        ...(gated && !ebKnown ? { blocked: "Identify the economic buyer (controller or GM) before moving past Prospecting." } : gated ? { requires: "economicBuyer" as const } : {}),
      });
    }
    const board = nextBoardMeeting(account?.Board_Meeting_Months__c, day);
    const boardTalk = /board/i.test(`${notes.qualification.decisionMaker ?? ""} ${notes.qualification.timeline ?? ""}`);
    const close = parseDate(opp.CloseDate);
    if (boardTalk && board && close < board) {
      const to = toISODate(board);
      out.push({ key: "closeDate", label: "Close date", object: "Opportunity", recordId: opp.Id, from: fmtShortDate(opp.CloseDate), to: fmtShortDate(to), changes: { CloseDate: to } });
    } else if (close < day) {
      const to = toISODate(addDays(day, 30));
      out.push({ key: "closeDate", label: "Close date", object: "Opportunity", recordId: opp.Id, from: fmtShortDate(opp.CloseDate), to: fmtShortDate(to), changes: { CloseDate: to } });
    }
    const ours = notes.nextSteps.find((n) => n.owner === repName(call.OwnerId)) ?? notes.nextSteps[0];
    if (ours) {
      const text = `${ours.text}${ours.due ? ` by ${fmtShortDate(ours.due)}` : ""}`;
      if (text !== opp.NextStep) out.push({ key: "nextStep", label: "Next step", object: "Opportunity", recordId: opp.Id, from: opp.NextStep || "None", to: text, changes: { NextStep: text } });
    }
  }
  const locs = notes.qualification.locations ? Number(notes.qualification.locations.match(/\d+/)?.[0]) : NaN;
  if (account && Number.isFinite(locs) && locs > 0 && locs !== account.Number_of_Locations__c) {
    out.push({ key: "locations", label: "Locations", object: "Account", recordId: account.Id, from: String(account.Number_of_Locations__c), to: String(locs), changes: { Number_of_Locations__c: locs } });
  }
  return out;
}

/** Whether a next step belongs to the rep (vs. the customer) */
export function isOurs(call: Pick<Call, "OwnerId">, owner: string): boolean {
  const rep = repName(call.OwnerId);
  return owner === rep || owner === "us" || owner.toLowerCase() === rep.split(" ")[0].toLowerCase();
}

/** Commitments (ours/theirs) from the notes' next steps */
export function commitmentsFrom(call: Pick<Call, "OwnerId">, notes: Pick<CallNotes, "nextSteps">): NonNullable<Call["Commitments"]> {
  return notes.nextSteps.map((n) => ({ text: n.text, owner: isOurs(call, n.owner) ? "us" : "them", ...(n.due ? { due: n.due } : {}), done: false }));
}
