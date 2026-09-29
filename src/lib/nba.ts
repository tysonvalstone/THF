import type { Contact, Opportunity, Task } from "@/types/salesforce";
import type { ScoredTarget } from "@/lib/scoring";
import { addDays, diffDays, fmtShortDate, fmtSpan, parseDate } from "@/lib/dates";

export type NbaChannel = "call" | "email" | "campaign" | "wait";

export interface NextBestAction {
  title: string;
  detail: string;
  channel: NbaChannel;
  contact?: Contact;
  due: Date;
  urgency: "now" | "this-week" | "soon" | "later";
}

/** Preferred buyer roles by situation */
const ROLE_PREFS = {
  preSeason: ["General Manager", "CEO", "Owner / President", "Grain Merchandiser", "Merchandising Manager", "Grain Division Manager"],
  postSeason: ["Controller", "CFO", "Office Manager", "General Manager"],
  ethanol: ["Commodity Manager", "General Manager", "Plant Manager"],
  feed: ["Mill Manager", "General Manager", "Nutritionist"],
  agronomy: ["Agronomy Manager", "Agronomy Division Manager", "General Manager"],
  processing: ["Oilseed Procurement Manager", "Wheat Buyer", "Plant Manager", "General Manager"],
};

export function pickContact(contacts: Contact[], prefs: string[]): Contact | undefined {
  const usable = contacts.filter((c) => !c.HasOptedOutOfEmail);
  for (const title of prefs) {
    const c = usable.find((x) => x.Title === title);
    if (c) return c;
  }
  return usable.find((c) => c.Buying_Role__c === "Decision Maker") ?? usable[0] ?? contacts[0];
}

export function preferredContact(s: ScoredTarget, contacts: Contact[]): Contact | undefined {
  const t = s.target;
  if (t.facilityType === "Ethanol Plant") return pickContact(contacts, ROLE_PREFS.ethanol);
  if (t.facilityType === "Feed Mill") return pickContact(contacts, ROLE_PREFS.feed);
  if (t.facilityType === "Agronomy Retailer") return pickContact(contacts, ROLE_PREFS.agronomy);
  if (t.facilityType === "Oilseed Crusher" || t.facilityType === "Flour Mill") return pickContact(contacts, ROLE_PREFS.processing);
  if (s.timing?.state === "after") return pickContact(contacts, ROLE_PREFS.postSeason);
  return pickContact(contacts, ROLE_PREFS.preSeason);
}

const firstName = (c?: Contact) => (c ? `${c.FirstName} (${c.Title})` : "the decision maker");

export function nextBestAction(
  s: ScoredTarget,
  ctx: { contacts: Contact[]; openOpps: Opportunity[]; openTasks: Task[]; asOf: Date },
): NextBestAction {
  const { asOf, contacts, openOpps, openTasks } = ctx;
  const contact = preferredContact(s, contacts);
  const lastTouch = s.engagement.lastTouch;
  const sinceTouch = lastTouch ? diffDays(asOf, lastTouch) : undefined;

  const overdue = openTasks
    .filter((t) => t.Status !== "Completed" && parseDate(t.ActivityDate) <= asOf)
    .sort((a, b) => a.ActivityDate.localeCompare(b.ActivityDate))[0];
  if (overdue) {
    return {
      title: `Overdue: ${overdue.Subject.replace(/^Follow up: /, "")}`,
      detail: `This follow-up was due ${fmtShortDate(overdue.ActivityDate)}. Log the call or email and HarvestSignal will close the task and update the deal.`,
      channel: "call",
      contact: contacts.find((c) => c.Id === overdue.WhoId) ?? contact,
      due: asOf,
      urgency: "now",
    };
  }

  const opp = [...openOpps].sort((a, b) => b.Probability - a.Probability)[0];
  if (opp) {
    return {
      title: `Advance ${opp.StageName.toLowerCase()}: ${opp.NextStep}`,
      detail: `${opp.Name} closes ${fmtShortDate(opp.CloseDate)}. ${s.timing?.state === "during" ? "They're mid-season, so keep the ask small and specific." : "Timing is good for a working session."}`,
      channel: s.timing?.state === "during" ? "email" : "call",
      contact,
      due: addDays(asOf, 2),
      urgency: "this-week",
    };
  }

  if (sinceTouch !== undefined && sinceTouch <= 7) {
    return {
      title: "Give them a breather",
      detail: `Last touch was ${sinceTouch === 0 ? "today" : `${sinceTouch} day${sinceTouch > 1 ? "s" : ""} ago`}. Next touch around ${fmtShortDate(addDays(lastTouch!, 10))} so we don't over-contact.`,
      channel: "wait",
      contact,
      due: addDays(lastTouch!, 10),
      urgency: "later",
    };
  }

  const pos = s.timing;
  const t = s.target;
  if (t.facilityType === "Ethanol Plant") {
    return {
      title: `Call ${firstName(contact)} about new-crop corn origination`,
      detail: "Lead with real-time corn position, basis bids to producers and DDGS contract tracking. Tie it to the current crush margin.",
      channel: "call",
      contact,
      due: addDays(asOf, 3),
      urgency: "this-week",
    };
  }
  if (t.facilityType === "Feed Mill") {
    return {
      title: `Call ${firstName(contact)} ahead of winter feeding season`,
      detail: "Lead with batch accuracy, delivery ticketing and ration costing as ingredient prices move.",
      channel: "call",
      contact,
      due: addDays(asOf, 3),
      urgency: "this-week",
    };
  }
  if (!pos) {
    return { title: `Introduce ThiboLiSoft to ${firstName(contact)}`, detail: "Send a short intro email with a relevant customer story.", channel: "email", contact, due: addDays(asOf, 5), urgency: "soon" };
  }
  const label = pos.window.label.toLowerCase();
  if (pos.state === "during") {
    const after = addDays(pos.window.end, 7);
    return {
      title: "Don't pitch mid-season: plant a flag",
      detail: `They're in ${label}. Send a two-line "we'll catch you after harvest" email to ${firstName(contact)} and book a call for ${fmtShortDate(after)}.`,
      channel: "email",
      contact,
      due: asOf,
      urgency: "soon",
    };
  }
  if (pos.state === "after") {
    return {
      title: `Reach ${firstName(contact)} while the season is fresh`,
      detail: `${pos.window.label} wrapped ${fmtSpan(pos.days)} ago. Send the settlement-season letter and offer a 20-minute year-end review.`,
      channel: "email",
      contact,
      due: addDays(asOf, 2),
      urgency: "this-week",
    };
  }
  if (pos.days <= 56) {
    return {
      title: `Call ${firstName(contact)} this week`,
      detail: `${pos.window.label} starts in ${fmtSpan(pos.days)}. Offer a free harvest-readiness review of their scale house and settlement process.`,
      channel: "call",
      contact,
      due: addDays(asOf, 2),
      urgency: pos.days <= 28 ? "now" : "this-week",
    };
  }
  return {
    title: "Enroll in the next pre-season campaign",
    detail: `${pos.window.label} is ${fmtSpan(pos.days)} away. The ideal launch window opens ${fmtShortDate(addDays(pos.window.start, -42))}, so add them to a campaign now and let the sequence do the work.`,
    channel: "campaign",
    contact,
    due: addDays(pos.window.start, -42),
    urgency: "later",
  };
}
