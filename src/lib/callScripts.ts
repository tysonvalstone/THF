/**
 * Seeded call transcripts for the AI Notes simulator.
 *
 * Eight realistic ag-software conversations. A call's script is picked by
 * call type and segment (and whether the account is already a customer), then
 * rendered with the account's own facts: locations, current software, a
 * likely competitor, commodity, board month, fiscal year end and budget.
 * Seeded calls store only `ScriptId`; the transcript is rebuilt at runtime.
 *
 * Pure: no React, no browser APIs (the seed script imports this file).
 */
import type { Account, Call, CallType, Contact, Opportunity, Segment } from "@/types/salesforce";
import { SOFTWARE_VENDORS } from "@/data/reference/software";
import { USER_BY_ID } from "@/data/reference/users";
import { nextBoardMeeting } from "@/lib/seasonality";

export type Speaker = "rep" | "c0" | "c1";

export interface ScriptLine {
  who: Speaker;
  text: string;
}

export interface CallScript {
  id: string;
  name: string;
  callTypes: CallType[];
  segments: Segment[] | "any";
  lines: ScriptLine[];
}

export interface TranscriptLine {
  speaker: string;
  text: string;
  atSec: number;
}

export interface ScriptVars {
  account: string;
  rep: string;
  c0: string;
  c1: string;
  locations: string;
  current: string;
  competitor: string;
  commodity: string;
  boardMonth: string;
  fye: string;
  budget: string;
  ticketsDay: string;
}

const L = (who: Speaker, text: string): ScriptLine => ({ who, text });

const GRAIN: Segment[] = ["Country Elevator", "Multi-Location Co-op", "River Terminal", "Rail/Shuttle Loader", "Seed Cleaner / Specialty Crop"];

export const CALL_SCRIPTS: CallScript[] = [
  {
    id: "discovery-elevator",
    name: "Discovery: elevator scale house and settlements",
    callTypes: ["Discovery"],
    segments: GRAIN,
    lines: [
      L("rep", "Thanks for making time, {c0}. I know harvest has everyone stretched, so I'll keep this to twenty minutes."),
      L("c0", "Appreciate that. We're running about {ticketsDay} tickets a day right now, so I've got a window before the afternoon rush."),
      L("rep", "How are scale tickets handled today, from the probe to settlement?"),
      L("c0", "The scale house writes the ticket in {current}, then the office keys it again into the accounting side. Everything gets keyed twice."),
      L("rep", "Where does that hurt the most?"),
      L("c0", "Month-end. It takes us three days to reconcile tickets against settlements, and the errors show up in producer statements."),
      L("c1", "And we can't see our position in real time. I'm building it in a spreadsheet every morning."),
      L("rep", "That's the gap GrainSight closes. Tickets flow straight into contracts and the position updates as trucks cross the scale."),
      L("c1", "Honestly the price is my worry. We looked at {competitor} last year and the number scared the board off."),
      L("rep", "Fair. We price per location, and most elevators your size fund it out of what they save on month-end labor. I can show you that math on your numbers."),
      L("rep", "Who else signs off on a decision like this: the GM or the board?"),
      L("c0", "I recommend it, but the board signs off. They meet in {boardMonth}, and the budget for next year gets set before our fiscal year ends {fye}."),
      L("rep", "Is there budget set aside for a system change?"),
      L("c1", "We set aside about {budget} in the capital plan for software, but nothing is approved yet."),
      L("rep", "Good to know. I'll send a short summary and a price range this week so you have it before the board packet goes out."),
      L("c0", "That works. I'll pull a sample of last month's settlements so you can see what we deal with."),
      L("rep", "Great. I'll book a demo for after harvest, once things calm down."),
      L("c0", "After Thanksgiving is best. That sounds good."),
    ],
  },
  {
    id: "discovery-coop",
    name: "Discovery: co-op system replacement and patronage",
    callTypes: ["Discovery", "Follow-up"],
    segments: ["Multi-Location Co-op"],
    lines: [
      L("rep", "Thanks for the time, {c0}. Last time you mentioned {current} is getting harder to support. Where do things stand?"),
      L("c0", "Our programmer retires next spring and nobody else knows the system. That's the real deadline."),
      L("rep", "How many locations are on it today?"),
      L("c0", "All {locations} locations. Each elevator runs its own scale house, and the agronomy side is on a separate system."),
      L("c1", "Patronage and equity are the painful part. I rebuild the patronage allocation in a spreadsheet every year, and it takes weeks."),
      L("rep", "Ceres handles patronage, equity and deferred payments in one ledger, with 1099s at year-end."),
      L("c1", "That's what I want to see. Our auditors flagged the manual steps last year."),
      L("rep", "What would make the board say no?"),
      L("c0", "Migration risk. We can't have tickets go down at any location during harvest. The board will want a plan for that."),
      L("rep", "We never go live during harvest. We migrate history in the winter and cut over before spring planting, one location at a time."),
      L("c0", "That's the right approach."),
      L("rep", "Who signs off, and when?"),
      L("c0", "I bring it to the board and they sign off. They meet in {boardMonth}, and the budget for the new fiscal year is set after {fye}."),
      L("c1", "We've got roughly {budget} penciled in for software, but it depends on the board."),
      L("rep", "I'll put together a migration plan and a board-ready summary by next Friday."),
      L("c1", "I'll send over last year's patronage file so you can use real numbers."),
      L("c0", "Good. Let's get the board packet together before the {boardMonth} meeting."),
    ],
  },
  {
    id: "demo-grain",
    name: "Demo: probe to settlement",
    callTypes: ["Demo"],
    segments: GRAIN,
    lines: [
      L("rep", "Today I'll walk through a load from the probe to the settlement, using your setup: {locations} locations with {commodity} as the main crop."),
      L("c0", "Perfect. Start with the scale house, that's where our bottleneck is."),
      L("rep", "Here's a ticket in ScaleTrac. Grade and moisture come in from the probe, discounts apply automatically, and the driver signs on the kiosk."),
      L("c0", "So nobody re-keys the ticket in the office? That alone would save us an hour a day per location."),
      L("rep", "Right. The ticket posts to the grower's contract, and the position updates immediately."),
      L("c1", "What about delayed price? We carry a lot of DP bushels through the winter."),
      L("rep", "DP contracts are built in. You see open DP by grower, and storage charges accrue daily."),
      L("c1", "I like that. Our drivers won't use a kiosk though. They want to stay in the truck."),
      L("rep", "Most sites start with the kiosk at the scale window and add the ScaleTrac Mobile app later, so drivers check in from the cab."),
      L("c0", "{competitor} showed us something similar, but their quote was a lot higher."),
      L("rep", "We're typically lower per location, and implementation is fixed scope. I'll put the numbers side by side."),
      L("c0", "The board will want that comparison before they sign off. Our next meeting is in {boardMonth}."),
      L("rep", "I'll send the proposal and the comparison by Friday, sized for {locations} locations."),
      L("c1", "I'll check with our GM on timing and get back to you next week."),
      L("c0", "This was helpful. If we can go live before planting, that works for us."),
    ],
  },
  {
    id: "processor-origination",
    name: "Ethanol and processing: origination and DDGS",
    callTypes: ["Discovery", "Demo", "Follow-up"],
    segments: ["Ethanol Plant", "Processor"],
    lines: [
      L("rep", "Thanks, {c0}. You mentioned corn origination is where you want to start."),
      L("c0", "Yes. We take in about {ticketsDay} loads a day in the fall, and receiving backs up onto the highway at peak."),
      L("rep", "How do your merchandisers manage contracts and basis today?"),
      L("c1", "{current} handles the plant side fine, but origination is bolted on. Contracts live in a spreadsheet and we reconcile to the ERP by hand."),
      L("rep", "GrainSight runs origination: contracts, basis, bids and the real-time position, and it posts to your ERP so accounting stays where it is."),
      L("c1", "So we don't have to replace the ERP? That was my biggest concern."),
      L("rep", "No. We integrate with it. The ERP stays the book of record for the plant."),
      L("c0", "What about DDGS sales? We track those in the same spreadsheet."),
      L("rep", "DDGS contracts and shipments are in GrainSight too, with rail car tracking."),
      L("c0", "Good. Cost is the question. Margins are thin this year, so the budget is tight."),
      L("rep", "Understood. Most plants phase it in: origination first, which pays back in receiving time, then DDGS next year."),
      L("c1", "That's a phased approach we could sell internally. The plant manager and the CFO sign off."),
      L("rep", "When do you set next year's budget?"),
      L("c1", "Our fiscal year ends {fye}, so the budget is being set now. We've got about {budget} for systems."),
      L("c0", "We also had {competitor} in here last month, so we'll be comparing."),
      L("rep", "That's fine. I'll send a phased proposal and an integration outline this week."),
      L("c1", "I'll set up a call with our CFO for next week."),
      L("c0", "Sounds good. This looks like a fit."),
    ],
  },
  {
    id: "feed-mill",
    name: "Feed mill: batching risk and grower settlements",
    callTypes: ["Discovery", "Demo", "Follow-up"],
    segments: ["Feed Mill"],
    lines: [
      L("rep", "{c0}, thanks for the time. How is batching running since we last talked?"),
      L("c0", "Same as before. {current} runs on an old PC in the control room, and IT says it has to go."),
      L("rep", "What happens when that PC goes down?"),
      L("c0", "We batch by hand from paper sheets. It happened twice this summer, and we shorted a swine customer's order."),
      L("rep", "That's the risk to take off the table. ScaleTrac handles ingredient receiving, Ceres handles the feed accounting, and batching connects through the standard interface."),
      L("c1", "We've been talking to {competitor}. Their batching looks strong."),
      L("rep", "They're good on batching. Where mills tell us they struggle is grain receiving and producer accounts, which is where we're strongest."),
      L("c1", "That matters, because we buy corn direct from about 300 growers."),
      L("rep", "How are those growers settled today?"),
      L("c1", "Checks out of QuickBooks, and I key every scale ticket twice."),
      L("rep", "Who else is part of the decision?"),
      L("c0", "The owner signs off. He wants a number before our fiscal year ends {fye}."),
      L("c1", "We have around {budget} set aside, but we can't take the mill down for more than a weekend."),
      L("rep", "We cut over on a weekend and run parallel for two weeks. I'll send a cutover plan and pricing by Thursday."),
      L("c0", "I'll get you our batch volumes and the ingredient list."),
      L("c1", "Sounds good. This is helpful."),
    ],
  },
  {
    id: "negotiation",
    name: "Negotiation: price, terms and board date",
    callTypes: ["Negotiation"],
    segments: "any",
    lines: [
      L("rep", "Thanks for getting back to me on the proposal, {c0}. Where did it land?"),
      L("c0", "The scope is right. The number is the problem. We need about 10 percent off to get it past the board."),
      L("rep", "What's driving that?"),
      L("c1", "{competitor} came in lower on the first year. They're discounting to get in."),
      L("rep", "Their first year is lower, but it goes up after. Our price is fixed for three years, and implementation is fixed scope. Over the full term we come in lower."),
      L("c1", "The multi-year view helps. Can you do anything on payment timing?"),
      L("rep", "We can bill the first year after harvest, so payment lines up with your cash flow. That needs a quick approval on our side."),
      L("c0", "That would help a lot. Harvest payment terms make this much easier."),
      L("rep", "If I get harvest terms approved on a 36-month term, can you take it to the board in {boardMonth}?"),
      L("c0", "Yes. The board meets in {boardMonth} and signs off on anything this size. If the paperwork is clean, I'll recommend it."),
      L("c1", "We'd want to go live before spring planting, no later than February."),
      L("rep", "That works. We'd start data migration in December after harvest wraps up."),
      L("rep", "I'll send the revised quote with harvest terms and three-year pricing by Wednesday."),
      L("c0", "I'll get it on the board agenda."),
      L("c1", "And I'll send you our standard vendor paperwork."),
      L("c0", "Good. I think we're close."),
    ],
  },
  {
    id: "renewal",
    name: "Renewal: price increase, new location, mobile add-on",
    callTypes: ["Renewal"],
    segments: "any",
    lines: [
      L("rep", "{c0}, thanks for the time. Your renewal comes up this winter, so I wanted to check in early."),
      L("c0", "Sure. Overall the system is doing its job. Harvest went smoothly on the scale side."),
      L("rep", "Glad to hear it. Any issues from support this season?"),
      L("c1", "One. Settlements were slow for a week in October, and it took a few days to get a fix. That was frustrating."),
      L("rep", "I saw that ticket. The fix went out, and I've asked support to review your setup before next harvest."),
      L("c0", "Appreciate that. The renewal includes a price increase, right?"),
      L("rep", "It's the 3 percent in the contract. If you sign a three-year renewal, we can hold it at 2 percent."),
      L("c0", "That helps. We're also adding a location in the spring, so we'd want that on the renewal."),
      L("rep", "Good. That would bring you to {locations} locations. I'll add the new location to the renewal quote."),
      L("c1", "Our drivers keep asking about the mobile app. Is that something we could add?"),
      L("rep", "ScaleTrac Mobile is a quick add-on and can go live in a few weeks. I'll include ScaleTrac Mobile as an option."),
      L("c0", "Send it over. The GM signs off on renewals, and I'll walk him through it."),
      L("rep", "I'll send the renewal quote with the new location and the mobile option by Friday."),
      L("c0", "Great. Happy to keep going with you."),
    ],
  },
  {
    id: "check-in",
    name: "Harvest check-in",
    callTypes: ["Check-in", "Follow-up"],
    segments: "any",
    lines: [
      L("rep", "Just a quick check-in, {c0}. I know it's a busy time, so I'll keep it short."),
      L("c0", "Thanks. It's been nonstop, but I've got five minutes."),
      L("rep", "How did scale-ticket volume hold up this harvest?"),
      L("c0", "We took in more {commodity} than last year. Lines backed up at two locations on the big days."),
      L("rep", "Was that the scale or the office?"),
      L("c0", "The office. Tickets pile up and we can't key them fast enough, so settlements run behind."),
      L("rep", "That's worth a proper look once things calm down. Is there anything you need from me right now?"),
      L("c1", "The pricing you sent. I haven't had time to read it, and the board meets in {boardMonth}."),
      L("rep", "No problem. I'll resend the pricing with a one-page summary so it's quick to read."),
      L("c0", "That's helpful. Let's plan a proper call after harvest."),
      L("rep", "I'll put something on the calendar for the first week after Thanksgiving."),
      L("c1", "I'll look at the summary before the board meeting."),
      L("c0", "Sounds good. Talk then."),
    ],
  },
];

export const SCRIPT_BY_ID: Record<string, CallScript> = Object.fromEntries(CALL_SCRIPTS.map((s) => [s.id, s]));

const YEAR_ROUND: Segment[] = ["Ethanol Plant", "Processor"];

/** The script for a call type and segment (customers get check-in style follow-ups) */
export function pickScript(callType: CallType, segment: Segment | undefined, isCustomer = false): CallScript {
  const seg = segment ?? "Country Elevator";
  const id = (() => {
    switch (callType) {
      case "Discovery":
        return seg === "Feed Mill" ? "feed-mill" : YEAR_ROUND.includes(seg) ? "processor-origination" : seg === "Multi-Location Co-op" ? "discovery-coop" : "discovery-elevator";
      case "Demo":
        return seg === "Feed Mill" ? "feed-mill" : YEAR_ROUND.includes(seg) ? "processor-origination" : "demo-grain";
      case "Follow-up":
        if (isCustomer) return "check-in";
        return seg === "Multi-Location Co-op" ? "discovery-coop" : seg === "Feed Mill" ? "feed-mill" : YEAR_ROUND.includes(seg) ? "processor-origination" : "check-in";
      case "Negotiation":
        return "negotiation";
      case "Renewal":
        return "renewal";
      default:
        return "check-in";
    }
  })();
  return SCRIPT_BY_ID[id];
}

/* ------------------------------------------------------------------ vars */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function hash(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** "August 31" from "08-31" */
export function fiscalYearEndLabel(fye: string | undefined): string {
  const m = fye?.match(/^(\d{2})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[1]) - 1]} ${Number(m[2])}` : "August 31";
}

/** A likely competitor for the account (never its current system) */
export function competitorFor(account: Pick<Account, "Id" | "Facility_Type__c" | "Current_Software__c">): string {
  const list = SOFTWARE_VENDORS.filter((v) => v.kind === "competitor" && v.fits.includes(account.Facility_Type__c) && v.name !== account.Current_Software__c);
  const pool = list.length ? list : SOFTWARE_VENDORS.filter((v) => v.kind === "competitor" && v.name !== account.Current_Software__c);
  return pool[Math.floor(hash(account.Id) * pool.length) % pool.length]?.name ?? "HarvestCore 360";
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export interface ScriptInput {
  call: Pick<Call, "Id" | "OwnerId" | "CallType" | "Start" | "ContactIds" | "OpportunityId">;
  account: Account | undefined;
  contacts: Contact[];
  opportunity?: Opportunity;
}

/** Account facts that fill a script's placeholders */
export function scriptVars({ call, account, contacts, opportunity }: ScriptInput): ScriptVars {
  const a = account;
  const rep = USER_BY_ID[call.OwnerId]?.Name.split(" ")[0] ?? "Sam";
  const c0 = contacts[0]?.FirstName ?? "there";
  const c1 = contacts[1]?.FirstName ?? c0;
  const locs = Math.max(1, a?.Number_of_Locations__c ?? 1) + (call.CallType === "Renewal" ? 1 : 0);
  const when = new Date(`${call.Start.slice(0, 10)}T00:00:00Z`);
  const board = nextBoardMeeting(a?.Board_Meeting_Months__c, when);
  const current = !a || a.Current_Software__c === "ThiboLiSoft" ? "the old system" : a.Current_Software__c;
  const est = opportunity?.Amount ?? 24000 * locs;
  const budget = Math.max(15000, Math.round((est * 0.9) / 5000) * 5000);
  const tickets = Math.max(150, Math.round(((a?.Scales__c ?? 2) * (a?.Segment__c === "Ethanol Plant" ? 180 : 260)) / 50) * 50);
  const commodity = a?.Primary_Commodities__c?.[0];
  return {
    account: a?.Name ?? "your operation",
    rep,
    c0,
    c1,
    locations: String(locs),
    current,
    competitor: a ? competitorFor(a) : "HarvestCore 360",
    commodity: commodity === "Winter Wheat" || commodity === "Spring Wheat" ? "wheat" : (commodity ?? "corn").toLowerCase(),
    boardMonth: board ? MONTHS[board.getUTCMonth()] : "January",
    fye: fiscalYearEndLabel(a?.Fiscal_Year_End__c),
    budget: money(budget),
    ticketsDay: tickets.toLocaleString("en-US"),
  };
}

export function fillTemplate(text: string, vars: ScriptVars): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k as keyof ScriptVars] : m));
}

/** Seconds a line takes to say (about 2.6 words a second, plus a pause) */
function lineSeconds(text: string): number {
  return Math.round(text.split(/\s+/).length / 2.6) + 2;
}

/** Renders a script into speaker-labelled transcript lines with timestamps */
export function renderScript(script: CallScript, vars: ScriptVars, names: { rep: string; c0: string; c1: string }): TranscriptLine[] {
  let at = 3;
  return script.lines.map((l) => {
    const text = fillTemplate(l.text, vars);
    const line = { speaker: names[l.who], text, atSec: at };
    at += lineSeconds(text);
    return line;
  });
}
