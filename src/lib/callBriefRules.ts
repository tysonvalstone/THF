/**
 * Rules for the pre-call brief when no AI key is set: questions to ask,
 * product pitches, likely objections and talking points, keyed by segment,
 * opportunity stage, season and what the last calls left open.
 *
 * Every rule reads from `BriefFacts` (built in lib/call-desk/brief.ts) so the
 * templates stay plain data. Pure.
 */
import type { CallType, OpportunityStage, Segment } from "@/types/salesforce";

export interface BriefFacts {
  segment: Segment;
  seasonal: boolean;
  callType: CallType;
  stage?: OpportunityStage;
  /** Season on the call date */
  season: "hard" | "light" | "none";
  /** "Nov 26" when in a blackout */
  blackoutEnd?: string;
  /** Harvest ended within the last 60 days (or is under way) */
  harvestRecent: boolean;
  isCustomer: boolean;
  economicBuyerKnown: boolean;
  /** "September 30" */
  fiscalYearEnd: string;
  /** Days until the fiscal year ends (0–365) */
  fyeDaysAway: number;
  /** "December" */
  boardMonth?: string;
  closeDate?: string;
  locations: number;
  current: string;
  currentKind?: "manual" | "legacy" | "competitor" | "ours";
  /** Competitor named on the last call, else a likely one */
  competitor?: string;
  competitorMentioned: boolean;
  budgetKnown: boolean;
  timelineKnown: boolean;
  /** Open commitments the customer made last time */
  theirOpen: string[];
  /** Days to contract end for customers */
  contractEndDays?: number;
  contractEnd?: string;
  openTickets: number;
  commodity: string;
  lastPain?: string;
}

export interface QuestionRule {
  id: string;
  priority: number;
  when: (f: BriefFacts) => boolean;
  text: (f: BriefFacts) => string;
  /** Why it's on the list (shown as a small tag) */
  why: string;
}

const GRAIN_SEGMENTS: Segment[] = ["Country Elevator", "Multi-Location Co-op", "River Terminal", "Rail/Shuttle Loader", "Seed Cleaner / Specialty Crop"];
const isGrain = (f: BriefFacts) => GRAIN_SEGMENTS.includes(f.segment);
const early = (f: BriefFacts) => !f.stage || f.stage === "Prospecting" || f.stage === "Qualification";

/** "Pull a sample of settlements" → "pull a sample of settlements" */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "");

export const QUESTION_RULES: QuestionRule[] = [
  {
    id: "their-commitment",
    priority: 96,
    when: (f) => f.theirOpen.length > 0,
    text: (f) => `Last time you were going to ${lowerFirst(f.theirOpen[0])}. Did that come together?`,
    why: "Open commitment",
  },
  {
    id: "economic-buyer",
    priority: 94,
    when: (f) => !f.economicBuyerKnown && !f.isCustomer,
    text: (f) =>
      f.segment === "Ethanol Plant" || f.segment === "Processor"
        ? "Who else signs off: the plant manager or the CFO?"
        : f.segment === "Feed Mill"
          ? "Who else signs off: the owner or the GM?"
          : "Who else signs off: GM or the board?",
    why: "Economic buyer missing",
  },
  {
    id: "renewal",
    priority: 92,
    when: (f) => f.isCustomer && f.contractEndDays !== undefined && f.contractEndDays <= 180,
    text: (f) => `Your renewal is ${f.contractEnd}. Any changes in locations or users we should plan for?`,
    why: "Renewal",
  },
  {
    id: "budget",
    priority: 90,
    when: (f) => !f.budgetKnown && !f.isCustomer && f.fyeDaysAway <= 150,
    text: (f) => `Your fiscal year ends ${f.fiscalYearEnd}. Is budget set for next year?`,
    why: "Budget unknown",
  },
  {
    id: "budget-new-year",
    priority: 86,
    when: (f) => !f.budgetKnown && !f.isCustomer && f.fyeDaysAway > 300,
    text: (f) => `Your new fiscal year started after ${f.fiscalYearEnd}. Did software make it into this year's budget?`,
    why: "Budget unknown",
  },
  {
    id: "competitor",
    priority: 88,
    when: (f) => f.competitorMentioned && !!f.competitor,
    text: (f) => `Where do things stand with ${f.competitor}? What would make you pick them?`,
    why: "Competitor",
  },
  {
    id: "harvest-volume",
    priority: 84,
    when: (f) => f.seasonal && f.harvestRecent,
    text: () => "How did scale-ticket volume hold up this harvest?",
    why: "Season",
  },
  {
    id: "open-ticket",
    priority: 83,
    when: (f) => f.isCustomer && f.openTickets > 0,
    text: () => "Is the open support issue resolved to your satisfaction?",
    why: "Support",
  },
  {
    id: "board-agenda",
    priority: 80,
    when: (f) => !!f.boardMonth && !f.isCustomer && (f.segment === "Multi-Location Co-op" || f.stage === "Negotiation" || f.stage === "Board Approval" || f.stage === "Proposal"),
    text: (f) => `Can this make the ${f.boardMonth} board agenda? What does the board need to see?`,
    why: "Board",
  },
  {
    id: "board-questions",
    priority: 78,
    when: (f) => f.stage === "Board Approval",
    text: () => "What questions do you expect from the board, and can I help answer them?",
    why: "Stage",
  },
  {
    id: "negotiation-terms",
    priority: 76,
    when: (f) => f.stage === "Negotiation",
    text: (f) => `What has to be true on price and terms to sign by ${f.closeDate ?? "the close date"}?`,
    why: "Stage",
  },
  {
    id: "proposal-changes",
    priority: 72,
    when: (f) => f.stage === "Proposal",
    text: () => "What would you change in the proposal before it goes for approval?",
    why: "Stage",
  },
  {
    id: "demo-start",
    priority: 70,
    when: (f) => f.callType === "Demo",
    text: (f) => (isGrain(f) ? "Which workflow should we start with: scale house, contracts or settlements?" : "Which workflow should we start with: origination, receiving or DDGS and sales?"),
    why: "Demo",
  },
  {
    id: "legacy-risk",
    priority: 66,
    when: (f) => f.currentKind === "legacy",
    text: (f) => `When does support for ${f.current} end, and what's the plan if it fails during harvest?`,
    why: "Current system",
  },
  {
    id: "manual-hours",
    priority: 66,
    when: (f) => f.currentKind === "manual",
    text: () => "How many hours a week go into re-keying tickets and building the position in Excel?",
    why: "Current system",
  },
  {
    id: "timeline-seasonal",
    priority: 62,
    when: (f) => !f.timelineKnown && f.seasonal && !f.isCustomer,
    text: () => "Would you want to be live before spring planting?",
    why: "Timeline unknown",
  },
  {
    id: "timeline-year-round",
    priority: 62,
    when: (f) => !f.timelineKnown && !f.seasonal && !f.isCustomer,
    text: () => "When would you want to be live, and what else is happening at the plant then?",
    why: "Timeline unknown",
  },
  {
    id: "why-now",
    priority: 60,
    when: (f) => early(f) && !f.isCustomer,
    text: () => "What's driving the look at new software now?",
    why: "Stage",
  },
  {
    id: "cost-of-keying",
    priority: 58,
    when: (f) => early(f) && isGrain(f) && !f.isCustomer,
    text: () => "What does keying tickets twice cost you: hours per week at each location?",
    why: "Pain",
  },
  {
    id: "fall-rush",
    priority: 58,
    when: (f) => f.segment === "Ethanol Plant" || f.segment === "Processor",
    text: () => "How does receiving handle the fall rush: how many loads a day at peak?",
    why: "Segment",
  },
  {
    id: "batching-down",
    priority: 58,
    when: (f) => f.segment === "Feed Mill",
    text: () => "What happens today when the batching PC goes down?",
    why: "Segment",
  },
  {
    id: "locations-same-system",
    priority: 55,
    when: (f) => f.segment === "Multi-Location Co-op" && f.locations > 1,
    text: (f) => `Are all ${f.locations} locations on the same system, or does each run its own?`,
    why: "Segment",
  },
  {
    id: "first-locations",
    priority: 54,
    when: (f) => f.stage === "Needs Analysis",
    text: () => "Which locations would go first, and who runs the scale house there?",
    why: "Stage",
  },
  {
    id: "customer-wish",
    priority: 50,
    when: (f) => f.isCustomer,
    text: () => "What's one thing that would make the system more useful before next harvest?",
    why: "Customer",
  },
  {
    id: "good-time",
    priority: 40,
    when: (f) => f.season === "hard" && f.seasonal,
    text: (f) => `Is this still a good time, or should we pick it up after ${f.blackoutEnd ?? "harvest"}?`,
    why: "Season",
  },
  // Always-available fallbacks so every brief has at least five
  { id: "success", priority: 30, when: () => true, text: () => "What would a good first year with us look like to you?", why: "General" },
  { id: "process", priority: 29, when: () => true, text: () => "What's the next step on your side, and who needs to be in it?", why: "General" },
  { id: "priorities", priority: 28, when: () => true, text: (f) => `What are the top priorities for the ${f.commodity} side this year?`, why: "General" },
];

export interface BriefQuestion {
  id: string;
  text: string;
  why: string;
}

/** 5–7 tailored questions, highest priority first */
export function questionsFor(f: BriefFacts, max = 7): BriefQuestion[] {
  const hits = QUESTION_RULES.filter((r) => r.when(f)).sort((a, b) => b.priority - a.priority);
  const seen = new Set<string>();
  const out: BriefQuestion[] = [];
  for (const r of hits) {
    const text = r.text(f);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ id: r.id, text, why: r.why });
    if (out.length >= max) break;
  }
  return out;
}

/* --------------------------------------------------------- product pitch */

/** One-line reason each product fits, by segment (default when a segment isn't listed) */
export const PRODUCT_PITCH: Record<string, { default: string } & Partial<Record<Segment, string>>> = {
  Ceres: {
    default: "Grain accounting and producer settlements in one ledger; no second keying of tickets.",
    "Multi-Location Co-op": "Patronage, equity and deferred payments across every location, with 1099s and T5018s at year-end.",
    "Feed Mill": "Feed accounting and grower settlements without QuickBooks checks.",
    "Seed Cleaner / Specialty Crop": "Grower settlements and contract accounting sized for a single plant.",
  },
  GrainSight: {
    default: "Contracts (including DP), real-time position, bids and hedges as trucks cross the scale.",
    "Ethanol Plant": "Corn origination, basis and DDGS sales that post to the plant ERP.",
    Processor: "Origination contracts and position alongside the processing ERP.",
    "River Terminal": "Real-time position and barge loadout against contracts.",
    "Rail/Shuttle Loader": "Shuttle train planning against contracts and the live position.",
  },
  ScaleTrac: {
    default: "Scale house ticketing with grade and moisture from the probe, discounts applied automatically.",
    "Feed Mill": "Ingredient receiving at the scale, tied to purchase contracts.",
    "Ethanol Plant": "Faster receiving lines in the fall rush; tickets post straight to origination.",
  },
  "GrainSight Mobile": {
    default: "Growers see contracts, settlements and bids on their phone and e-sign contracts.",
  },
  "ScaleTrac Mobile": {
    default: "Drivers check in from the cab; a quick add-on that can go live in weeks.",
  },
};

export function pitchFor(product: string, segment: Segment): string {
  const p = PRODUCT_PITCH[product];
  return p ? (p[segment] ?? p.default) : "";
}

/* ------------------------------------------------------------ objections */

export interface Objection {
  objection: string;
  response: string;
}

export function objectionsFor(f: BriefFacts): Objection[] {
  const out: Objection[] = [];
  if (f.isCustomer) {
    out.push({ objection: "The renewal price increase", response: "Hold the increase at 2 percent on a three-year renewal." });
    if (f.openTickets > 0) out.push({ objection: "Support was slow this season", response: "Name the fix, and offer a setup review before next harvest." });
    out.push({ objection: "We don't need more modules", response: "Start with ScaleTrac Mobile: live in weeks, no change to the office." });
    return out.slice(0, 3);
  }
  if (f.competitor) {
    out.push({ objection: `${f.competitor} is cheaper in year one`, response: "Compare three-year cost: our price is fixed and implementation is fixed scope." });
  }
  out.push({ objection: "It's too expensive", response: "Priced per location; most sites fund it from month-end labor savings. Offer the math on their numbers." });
  if (f.seasonal) out.push({ objection: "Not during harvest", response: "We never go live during harvest: migrate in winter, cut over before spring planting." });
  if (f.segment === "Ethanol Plant" || f.segment === "Processor") out.push({ objection: "We won't replace our ERP", response: "No need: GrainSight integrates and the ERP stays the book of record." });
  if (f.segment === "Feed Mill") out.push({ objection: "Batching is already handled", response: "We connect to batching; our strength is receiving and producer accounts." });
  if (f.currentKind === "legacy" || f.segment === "Multi-Location Co-op") {
    out.push({ objection: "Migration risk", response: "Fixed-scope implementation, one location at a time, with a parallel run." });
  }
  if (f.stage === "Board Approval" || f.stage === "Negotiation") {
    out.push({ objection: "Payment timing", response: "Offer harvest payment terms: first invoice due after harvest (needs Finance approval)." });
  }
  return out.slice(0, 3);
}

/* -------------------------------------------------------- talking points */

export function talkingPointsFor(f: BriefFacts): string[] {
  const out: string[] = [];
  if (f.seasonal && f.season === "hard") out.push(`In harvest until ${f.blackoutEnd}. Keep it short and book the real conversation for after.`);
  else if (f.seasonal && f.season === "light") out.push(`Spring planting until ${f.blackoutEnd}. Keep it brief.`);
  else if (!f.seasonal) out.push("Year-round buyer: no blackout. Budgets follow the fiscal year end.");
  if (f.lastPain) out.push(`Tie back to last call: ${f.lastPain.replace(/\.$/, "")}.`);
  switch (f.stage) {
    case "Prospecting":
    case "Qualification":
      out.push("Qualify first: pain, economic buyer, budget and timeline before any pricing.");
      break;
    case "Needs Analysis":
      out.push("Map the workflow end to end and agree on the first locations to go live.");
      break;
    case "Proposal":
      out.push("Anchor on three-year cost, not year one.");
      break;
    case "Negotiation":
      out.push("Trade, don't give: a discount for a longer term or a board date.");
      break;
    case "Board Approval":
      out.push("Offer a board-ready one-pager and to join the meeting for questions.");
      break;
  }
  if (f.isCustomer) out.push("Customer: lead with what's working, then renewal and expansion.");
  return out.slice(0, 3);
}
