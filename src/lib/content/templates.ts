import { REGION_BY_ID } from "@/data/reference/regions";
import type { CampaignContent, Commodity, Contact, FacilityType, RegionId } from "@/types/salesforce";
import type { ScoredTarget } from "@/lib/scoring";
import { MESSAGES, facilityGroup, playForDate, type FacilityGroup, type SeasonPlay } from "./messaging";

export interface Sender {
  name: string;
  title: string;
  email: string;
  phone?: string;
}

export interface CampaignBrief {
  play: SeasonPlay;
  regionIds: RegionId[];
  facilityTypes: FacilityType[];
  commodity?: Commodity;
  asOf: Date;
  sender: Sender;
}

const TYPE_PLURAL: Record<FacilityType, string> = {
  "Grain Elevator": "grain elevators",
  Cooperative: "co-ops",
  "Ethanol Plant": "ethanol plants",
  "Feed Mill": "feed mills",
  "Oilseed Crusher": "oilseed crushers",
  "Flour Mill": "flour mills",
  "Seed Processor": "seed plants",
  "Agronomy Retailer": "agronomy retailers",
};

const listJoin = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
const bullets = (items: string[]) => items.map((i) => `• ${i.charAt(0).toUpperCase()}${i.slice(1)}`).join("\n");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Dominant facility group in the audience */
function groupFor(types: FacilityType[]): FacilityGroup {
  const counts = new Map<FacilityGroup, number>();
  for (const t of types) counts.set(facilityGroup(t), (counts.get(facilityGroup(t)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "grain";
}

export interface TimingContext {
  line: string;
  short: string;
  harvestStart?: Date;
}

/** Plain-English timing line for the play and regions */
export function timingContext(brief: Pick<CampaignBrief, "play" | "regionIds" | "commodity" | "asOf">): TimingContext {
  const regionNames = listJoin(brief.regionIds.map((r) => REGION_BY_ID[r]?.name).filter(Boolean) as string[]) || "your area";
  switch (brief.play) {
    case "Year-end":
      return { line: `harvest is in across ${regionNames}, and year-end close, audits and next year's budgets are next`, short: "year-end" };
    case "Implementation":
      return { line: `spring planting across ${regionNames} is only weeks away, and a decision now can still go live before it`, short: "live before planting" };
    case "Budget window":
      return { line: `fiscal years across ${regionNames} often close Aug 31 or Sep 30, so next year's budget is being written now`, short: "budget season" };
    case "Quick wins":
      return { line: `harvest across ${regionNames} is about two weeks away`, short: "before harvest" };
    case "Harvest support":
      return { line: `harvest is in full swing across ${regionNames}`, short: "harvest" };
    default:
      return { line: `markets across ${regionNames} keep moving`, short: "this season" };
  }
}

const DISCOVERY: Record<FacilityGroup, string[]> = {
  grain: [
    "At peak harvest, how long does a truck sit on your scale?",
    "How do you work out drying, shrink and grade discounts today: on the ticket, or afterwards?",
    "How many hours does a settlement run take the office?",
    "At 3 p.m. on a busy day, how does your merchandiser see the company position?",
  ],
  processing: [
    "How do you get bids in front of producers today?",
    "How are DDGS, meal or oil contracts tracked alongside grain procurement?",
    "How quickly do you know your margin for the day?",
    "What does rail and truck planning look like during new-crop?",
  ],
  feed: [
    "How are batch records captured, and where do they live?",
    "How often do you re-cost rations when corn or meal moves?",
    "How are delivery tickets matched to batches and invoices?",
    "How are medicated feed and VFD records kept for audits?",
  ],
  agronomy: [
    "How do growers book and prepay today?",
    "How does an application ticket get from the cab to billing?",
    "How do you handle landlord and tenant split billing?",
    "How do you reconcile booked product against inventory by location?",
  ],
};

function objections(group: FacilityGroup, play: SeasonPlay): { objection: string; response: string }[] {
  const busy =
    play === "Harvest support"
      ? "Completely understand. That's why I'm not asking for time now. Can I put 20 minutes on your calendar for two weeks after your last truck?"
      : "That's exactly why we reach out now. Go-lives take 4–6 weeks, and we schedule them around your season, not ours.";
  return [
    { objection: "We're too busy right now.", response: busy },
    {
      objection: "We just renewed with our current vendor.",
      response: "Good to know when that renewal is. Many customers start with one module, like ScaleHouse or the producer portal, that works alongside their current system, then consolidate at renewal.",
    },
    {
      objection: "It's too expensive.",
      response:
        group === "grain"
          ? "Most elevators pay for it with saved office hours at settlement time and fewer ticket errors. I can show you the math with your own truck counts."
          : "We'll size it to your volume. Most customers recover the cost in reduced admin time and better procurement decisions within the first year.",
    },
    {
      objection: "Our current system works fine.",
      response: "Glad to hear it. What's the one thing your team still does in a spreadsheet? That's usually where we start.",
    },
  ];
}

export function templateCampaignContent(brief: CampaignBrief): CampaignContent {
  const group = groupFor(brief.facilityTypes);
  const m = MESSAGES[group][brief.play];
  const timing = timingContext(brief);
  const audience = listJoin([...new Set(brief.facilityTypes.map((t) => TYPE_PLURAL[t]))]);
  const regionNames = listJoin(brief.regionIds.map((r) => REGION_BY_ID[r]?.name).filter(Boolean) as string[]);
  const signature = `${brief.sender.name}\n${brief.sender.title}, ThiboLiSoft\n${brief.sender.email}${brief.sender.phone ? ` · ${brief.sender.phone}` : ""}`;
  const productList = listJoin([...new Set(m.products)]);
  // Facilities that receive grain by truck: their Harvest Day Simulator result
  // (mail-list columns "Harvest $ at risk" and "Harvest day link")
  const harvestDay =
    group === "grain" || group === "processing"
      ? `\nSee your harvest day. On a peak October day, trucks that give up on the scale line and drive to the next elevator could cost {{Company}} {{HarvestLoss}} this harvest. Watch your own day, minute by minute, with and without ScaleTrac and GrainSight Mobile: {{HarvestLink}}\n`
      : "";

  const letterBody = `Dear {{FirstName}},

Right now, ${timing.line}. For ${audience} like {{Company}}, that usually means:
${bullets(m.pains)}

ThiboLiSoft builds software for exactly this. With ${productList}, you get:
${bullets(m.outcomes)}

${m.proof}
${harvestDay}
I'd like to offer {{Company}} ${m.offer}. There's no cost and no obligation. We'll show you where the time goes today and what we'd change first.

Call me directly, or reply to the email address below, and we'll find a time that works around your season.

Sincerely,

${signature}

P.S. ${brief.play === "Budget window" ? "Budget it now and we'll schedule go-live for December, after harvest." : brief.play === "Year-end" ? "Decide by February and you're live before spring planting." : "We schedule every go-live around harvest and planting, never during them."}`;

  const emails: CampaignContent["emails"] = [
    {
      sendOffsetDays: 0,
      subject: brief.play === "Harvest support" ? "One idea for after harvest" : `${cap(timing.short)} at {{Company}}`,
      body: `Hi {{FirstName}},

${m.hook} ${cap(timing.line)}.

Most ${audience} we talk to in ${regionNames} are dealing with ${m.pains[0]}, and ${m.pains[1]}.

We help teams get to ${m.outcomes[0]}.

Worth 20 minutes? I'm offering ${m.offer}.

${brief.sender.name}
ThiboLiSoft`,
    },
    {
      sendOffsetDays: 4,
      subject: "How a neighbor fixed this before the rush",
      body: `Hi {{FirstName}},

A quick story. ${m.proof}

The biggest change was ${m.outcomes[1]}.

If that sounds useful for {{Company}}, reply "yes" and I'll send over a couple of times.

${brief.sender.name}`,
    },
    {
      sendOffsetDays: 10,
      subject: brief.play === "Quick wins" ? "Last note before harvest" : "Should I close the loop?",
      body: `Hi {{FirstName}},

${brief.play === "Quick wins" ? "Harvest is close, so this is my last note until after Thanksgiving." : "I don't want to clutter your inbox, so this is my last note for now."}

If ${m.pains[2]} is on your list to fix, we can help, and we'll schedule everything around your season.

Just reply with a good week and I'll take it from there.

${brief.sender.name}
ThiboLiSoft`,
    },
  ];

  return {
    source: "template",
    letter: { subject: m.hook, body: letterBody },
    emails,
    callScript: {
      opener: `Hi {{FirstName}}, it's ${brief.sender.name.split(" ")[0]} with ThiboLiSoft. I know ${timing.line}, so I'll take 30 seconds and you tell me whether it's worth a longer conversation.`,
      discovery: DISCOVERY[group],
      valuePoints: m.outcomes.map(cap),
      objections: objections(group, brief.play),
      close: `Based on what you've said, I'd suggest ${m.offer}. Does ${brief.play === "Harvest support" ? "a date right after your last truck" : "Tuesday or Thursday next week"} work?`,
    },
  };
}

/** Replace {{FirstName}} / {{Company}} / {{City}} merge fields */
export function mergeFields(
  text: string,
  fields: { FirstName?: string; Company?: string; City?: string; HarvestLoss?: string; HarvestLink?: string },
): string {
  return text
    .replace(/\{\{FirstName\}\}/g, fields.FirstName ?? "there")
    .replace(/\{\{Company\}\}/g, fields.Company ?? "your team")
    .replace(/\{\{City\}\}/g, fields.City ?? "")
    .replace(/\{\{HarvestLoss\}\}/g, fields.HarvestLoss ?? "thousands of dollars")
    .replace(/\{\{HarvestLink\}\}/g, fields.HarvestLink ?? "ask me for your link");
}

/** "$124,000" for the {{HarvestLoss}} merge field (mail-list column "Harvest $ at risk") */
export const harvestLossText = (dollars: number) => `$${Math.round(dollars).toLocaleString("en-US")}`;

export type EmailIntent = "timing" | "after-season" | "follow-up";

/** A personalized 1:1 email for a single scored prospect */
export function templateOneToOneEmail(opts: { s: ScoredTarget; contact?: Contact; sender: Sender; asOf: Date; intent?: EmailIntent }): { subject: string; body: string; play: SeasonPlay } {
  const { s, contact, sender } = opts;
  const t = s.target;
  const play = opts.intent === "after-season" ? "Year-end" : playForDate(opts.asOf, t.segment);
  const group = facilityGroup(t.facilityType);
  const m = MESSAGES[group][play];
  const first = contact?.FirstName ?? "there";
  const region = REGION_BY_ID[t.regionId];
  const why = s.whyNow.split(". ")[0].replace(/\.$/, "");

  let subject: string;
  if (opts.intent === "follow-up") subject = `Following up: ${t.name}`;
  else if (t.facilityType === "Ethanol Plant") subject = `New-crop corn origination at ${t.name}`;
  else if (t.facilityType === "Feed Mill") subject = `Winter feeding season at ${t.name}`;
  else if (play === "Harvest support") subject = "After harvest, 20 minutes?";
  else if (play === "Year-end") subject = `Year-end at ${t.name}`;
  else if (play === "Budget window") subject = `Next year's budget at ${t.name}`;
  else if (play === "Quick wins") subject = `A quick win for ${t.name} before harvest`;
  else if (play === "Implementation") subject = `Live before planting at ${t.name}`;
  else subject = `A quick idea for ${t.name}`;

  const body =
    opts.intent === "follow-up"
      ? `Hi ${first},

Following up on my last note. ${cap(why)}.

The teams we work with in ${region.name} usually start with ${m.outcomes[0]}. Happy to show you what that would look like at ${t.name}.

Is ${play === "Harvest support" ? "a date just after your last truck" : "next Tuesday or Thursday"} good for 20 minutes?

Best,
${sender.name}
${sender.title}, ThiboLiSoft`
      : `Hi ${first},

${cap(why)}.

Most ${TYPE_PLURAL[t.facilityType]} we talk to in ${region.name} are dealing with ${m.pains[0]}. We help teams get to ${m.outcomes[0]}.

${m.proof}

Would you be open to ${m.offer}? ${play === "Harvest support" ? "No rush. Pick any week after your last truck." : "I have time Tuesday or Thursday afternoon."}

Best,
${sender.name}
${sender.title}, ThiboLiSoft
${sender.email}`;

  return { subject, body, play };
}
