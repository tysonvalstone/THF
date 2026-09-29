import { REGION_BY_ID } from "@/data/reference/regions";
import type { CampaignContent, Commodity, Contact, FacilityType, RegionId } from "@/types/salesforce";
import { cropNoun, cropStatus } from "@/lib/season";
import { fmtShortDate, fmtSpan } from "@/lib/dates";
import type { ScoredTarget } from "@/lib/scoring";
import { MESSAGES, facilityGroup, playForTiming, type FacilityGroup, type SeasonPlay } from "./messaging";

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

/** Plain-English seasonal timing for the lead region + commodity */
export function timingContext(brief: Pick<CampaignBrief, "play" | "regionIds" | "commodity" | "asOf">): TimingContext {
  const region = REGION_BY_ID[brief.regionIds[0]];
  if (!region) return { line: "the season is turning", short: "this season" };
  const crop = region.crops.find((c) => c.commodity === brief.commodity) ?? [...region.crops].sort((a, b) => b.importance - a.importance)[0];
  const s = cropStatus(region.id, crop, brief.asOf);
  const noun = cropNoun(crop.commodity).toLowerCase();
  const regionNames = listJoin(brief.regionIds.map((r) => REGION_BY_ID[r]?.name).filter(Boolean) as string[]);
  const climate = s.window.climate;
  const climateNote =
    climate.condition !== "Normal" && climate.harvestShiftDays !== 0
      ? ` (${climate.harvestShiftDays < 0 ? "about a week early" : "later than usual"} this year)`
      : "";
  switch (brief.play) {
    case "Pre-harvest":
      return s.phase === "Harvest"
        ? { line: `${noun} harvest is already rolling across ${regionNames}`, short: `${noun} harvest`, harvestStart: s.window.start }
        : {
            line: `${noun} harvest starts around ${fmtShortDate(s.window.start)} across ${regionNames}, about ${fmtSpan(s.daysToHarvest).replace("about ", "")} from now${climateNote}`,
            short: `${noun} harvest in ${fmtSpan(s.daysToHarvest).replace("about ", "")}`,
            harvestStart: s.window.start,
          };
    case "Harvest":
      return { line: `${noun} harvest is in full swing across ${regionNames}`, short: `${noun} harvest` };
    case "Post-harvest":
      return { line: `${noun} harvest is wrapping up across ${regionNames}, and ${region.localColor}`, short: "settlement season" };
    case "Pre-planting":
      return { line: `spring planting across ${regionNames} is only weeks away`, short: "spring" };
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
    play === "Harvest"
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
  const productList = listJoin(m.products);

  const letterBody = `Dear {{FirstName}},

Right now, ${timing.line}. For ${audience} like {{Company}}, that usually means:
${bullets(m.pains)}

ThiboLiSoft builds software for exactly this. With ${productList}, you get:
${bullets(m.outcomes)}

${m.proof}

I'd like to offer {{Company}} ${m.offer}. There's no cost and no obligation. We'll show you where the time goes today and what we'd change first.

Call me directly, or reply to the email address below, and we'll find a time that works around your season.

Sincerely,

${signature}

P.S. ${brief.play === "Pre-harvest" ? "Go-lives take 4–6 weeks. If you want relief before harvest, the time to talk is now." : brief.play === "Post-harvest" ? "Talk to us before year-end and we'll have you live before next harvest." : "We schedule every go-live around your busy season, not ours."}`;

  const emails: CampaignContent["emails"] = [
    {
      sendOffsetDays: 0,
      subject: brief.play === "Pre-harvest" ? `${cap(timing.short)}: is {{Company}} ready?` : brief.play === "Harvest" ? "One idea for after harvest" : `${cap(timing.short)} at {{Company}}`,
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
      subject: brief.play === "Pre-harvest" ? "Last call before harvest" : "Should I close the loop?",
      body: `Hi {{FirstName}},

${brief.play === "Pre-harvest" ? "Harvest is close, so this is my last note until the rush is over." : "I don't want to clutter your inbox, so this is my last note for now."}

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
      close: `Based on what you've said, I'd suggest ${m.offer}. Does ${brief.play === "Harvest" ? "a date right after your last truck" : "Tuesday or Thursday next week"} work?`,
    },
  };
}

/** Replace {{FirstName}} / {{Company}} / {{City}} merge fields */
export function mergeFields(text: string, fields: { FirstName?: string; Company?: string; City?: string }): string {
  return text
    .replace(/\{\{FirstName\}\}/g, fields.FirstName ?? "there")
    .replace(/\{\{Company\}\}/g, fields.Company ?? "your team")
    .replace(/\{\{City\}\}/g, fields.City ?? "");
}

export type EmailIntent = "timing" | "after-season" | "follow-up";

/** A personalized 1:1 email for a single scored prospect */
export function templateOneToOneEmail(opts: { s: ScoredTarget; contact?: Contact; sender: Sender; asOf: Date; intent?: EmailIntent }): { subject: string; body: string; play: SeasonPlay } {
  const { s, contact, sender } = opts;
  const t = s.target;
  const play = opts.intent === "after-season" ? "Post-harvest" : playForTiming(s.timing?.state, s.timing?.window.kind);
  const group = facilityGroup(t.facilityType);
  const m = MESSAGES[group][play];
  const first = contact?.FirstName ?? "there";
  const region = REGION_BY_ID[t.regionId];
  const why = s.whyNow.split(". ")[0].replace(/\.$/, "");

  let subject: string;
  if (opts.intent === "follow-up") subject = `Following up: ${t.name}`;
  else if (t.facilityType === "Ethanol Plant") subject = `New-crop corn origination at ${t.name}`;
  else if (t.facilityType === "Feed Mill") subject = `Winter feeding season at ${t.name}`;
  else if (play === "Pre-harvest" && s.timing) subject = `${s.timing.window.label} in ${fmtSpan(s.timing.days).replace("about ", "")}: a quick idea for ${t.name}`;
  else if (play === "Harvest") subject = "After harvest, 20 minutes?";
  else if (play === "Post-harvest") subject = `Settlement season at ${t.name}`;
  else subject = `A quick idea for ${t.name}`;

  const body =
    opts.intent === "follow-up"
      ? `Hi ${first},

Following up on my last note. ${cap(why)}.

The teams we work with in ${region.name} usually start with ${m.outcomes[0]}. Happy to show you what that would look like at ${t.name}.

Is ${play === "Harvest" ? "a date just after your last truck" : "next Tuesday or Thursday"} good for 20 minutes?

Best,
${sender.name}
${sender.title}, ThiboLiSoft`
      : `Hi ${first},

${cap(why)}.

Most ${TYPE_PLURAL[t.facilityType]} we talk to in ${region.name} are dealing with ${m.pains[0]}. We help teams get to ${m.outcomes[0]}.

${m.proof}

Would you be open to ${m.offer}? ${play === "Harvest" ? "No rush. Pick any week after your last truck." : "I have time Tuesday or Thursday afternoon."}

Best,
${sender.name}
${sender.title}, ThiboLiSoft
${sender.email}`;

  return { subject, body, play };
}
