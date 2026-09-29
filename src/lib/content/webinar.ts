import type { CampaignContent } from "@/types/salesforce";
import type { Sender } from "./templates";
import { addDays, fmtDate } from "@/lib/dates";

/** The first scheduled campaign: a price-later (DP) contract compliance webinar */
export const WEBINAR_PRESET = "price-later-webinar";
export const WEBINAR_NAME = "Price-Later Contract Compliance Webinar";

/** Tuesday about three weeks out, 10:00 CT */
export function webinarDate(from: Date): Date {
  let d = addDays(from, 21);
  while (d.getUTCDay() !== 2) d = addDays(d, 1);
  return d;
}

export function templateWebinarCampaign(asOf: Date, sender: Sender): CampaignContent {
  const when = fmtDate(webinarDate(asOf));
  const signature = `${sender.name}\n${sender.title}, ThiboLiSoft\n${sender.email}${sender.phone ? ` · ${sender.phone}` : ""}`;
  return {
    source: "template",
    letter: {
      subject: `Invitation: Price-later contracts, what auditors and examiners look for (${when}, 10:00 CT, 45 minutes)`,
      body: `Dear {{FirstName}},

Price-later (delayed price) contracts are one of the most common findings in warehouse exams and year-end audits: open DP bushels that don't reconcile to the position, missing signatures, service charges applied inconsistently, and liabilities that aren't reported the way lenders expect.

On ${when} at 10:00 CT, we're hosting a 45-minute webinar for grain controllers and general managers:

• What state and federal warehouse examiners check on price-later and deferred-payment contracts
• How to reconcile open DP bushels to the daily position and the balance sheet
• Service charges, pricing deadlines and the paper trail your auditor will ask for
• A short walkthrough of how customers handle this in GrainSight and Ceres

It is timed for year-end: before audits start and before your board meeting.

Reply to this letter or email me to save your seat. We'll send the recording to anyone who registers.

Sincerely,

${signature}`,
    },
    emails: [
      {
        sendOffsetDays: 0,
        subject: `Webinar ${when}: price-later contract compliance`,
        body: `Hi {{FirstName}},

Open price-later bushels are a common audit finding at elevators and co-ops. On ${when} at 10:00 CT we're running a 45-minute session for controllers and GMs on what examiners look for, how to reconcile DP to the position, and the paper trail auditors ask for.

Want me to save you a seat? Just reply "yes".

${sender.name}
ThiboLiSoft`,
      },
      {
        sendOffsetDays: 7,
        subject: "Reminder: price-later compliance webinar next week",
        body: `Hi {{FirstName}},

A quick reminder about next week's session on price-later contract compliance (${when}, 10:00 CT). Bring your questions about service charges, pricing deadlines and year-end reconciliation, and we'll answer them live.

Reply "yes" and I'll send the calendar invite.

${sender.name}`,
      },
      {
        sendOffsetDays: 23,
        subject: "Recording + checklist: price-later contracts",
        body: `Hi {{FirstName}},

Thanks for your interest in the price-later compliance session. Here's the recording and a one-page checklist to use before your audit.

If it would help, we can do a 20-minute review of how {{Company}} tracks open DP bushels today. December and January are the easiest months to fit it in.

${sender.name}
ThiboLiSoft`,
      },
    ],
    callScript: {
      opener: `Hi {{FirstName}}, it's ${sender.name.split(" ")[0]} with ThiboLiSoft. I'm calling controllers and GMs about a short webinar on price-later contract compliance before audit season. Is that on your radar this year?`,
      discovery: [
        "How do you reconcile open price-later bushels to the position today?",
        "What came up in your last warehouse exam or audit?",
        "Who signs off on DP service charges and pricing deadlines?",
        "When does your board review year-end results?",
      ],
      valuePoints: [
        "Open DP bushels reconciled to the position automatically in GrainSight",
        "Contracts, signatures and service charges in one audit trail",
        "Deferred-payment and price-later liabilities reported correctly in Ceres",
      ],
      objections: [
        { objection: "We handle it in spreadsheets.", response: "Most of our customers did too. The webinar shows what auditors flag in spreadsheet-based DP tracking, and it costs you 45 minutes." },
        { objection: "Our auditor hasn't raised it.", response: "Great. The session is also a quick way to check before they do, and to see what peers are changing." },
        { objection: "Too busy right now.", response: "It's recorded. Register and we'll send it, plus the one-page checklist." },
      ],
      close: `Can I register you and your ${"{{FirstName}}".length > 0 ? "controller" : "team"} for ${when} at 10:00 CT?`,
    },
  };
}
