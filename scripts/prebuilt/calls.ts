/**
 * Call Desk seed: 4–7 calls per territory rep per weekday, from 30 days
 * before to 60 days after the anchor, in realistic back-to-back blocks.
 * Call types follow each account's opportunity stage (customers get
 * check-ins and renewals); seasonal prospects are left alone during harvest
 * unless a deal is late-stage. Past calls are Completed with a ScriptId, short
 * AI Notes (from the same rules the app uses) and commitments; a few are
 * "Notes pending". Transcripts are rebuilt from ScriptId at runtime.
 *
 * Deterministic: everything comes from hash01 of stable keys.
 */
import type { SeedContext } from "./platform";
import type { DataSnapshot } from "../../src/lib/data/types";
import type { Account, Call, CallNotes, CallType, Contact, Opportunity, OpportunityStage } from "../../src/types/salesforce";
import { hash01 } from "./quoting";
import { pickScript } from "../../src/lib/callScripts";
import { blackoutStatus, isSeasonalSegment, thanksgiving } from "../../src/lib/seasonality";
import { simulatedTranscript } from "../../src/lib/call-desk/transcript";
import { commitmentsFrom, notesFromTranscript } from "../../src/lib/call-desk/notes";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const id = (n: number) => `a0DHs${String(n).padStart(10, "0")}AAA`;

/** Back-to-back blocks a rep might run in a day (sorted slot lists) */
const DAY_TEMPLATES: string[][] = [
  ["08:30", "09:00", "09:30", "11:00", "11:30", "13:30", "14:00", "15:30"],
  ["08:00", "08:30", "10:00", "10:30", "11:00", "13:00", "14:30", "15:00"],
  ["09:00", "09:30", "10:00", "11:30", "13:00", "13:30", "15:00", "16:00"],
  ["08:30", "09:15", "10:00", "10:30", "13:30", "14:00", "14:30", "16:00"],
];

/** Rough notes a rep might jot during the call (most calls have none) */
const REP_NOTES = [
  "",
  "",
  "",
  "",
  "",
  "Positive call, interested in seeing a proposal",
  "Concerned about budget; pushback on timing, deal feels stalled",
  "Wants a reference from a nearby site",
  "Follow up with the controller on budget",
];

const DURATION: Record<CallType, number> = { Discovery: 30, Demo: 45, "Follow-up": 30, Negotiation: 30, Renewal: 30, "Check-in": 15 };

function typeForStage(stage: OpportunityStage, h: number): CallType {
  switch (stage) {
    case "Prospecting":
      return "Discovery";
    case "Qualification":
      return h < 0.6 ? "Discovery" : "Follow-up";
    case "Needs Analysis":
      return h < 0.6 ? "Demo" : "Follow-up";
    case "Proposal":
      return h < 0.5 ? "Follow-up" : "Demo";
    case "Negotiation":
      return h < 0.75 ? "Negotiation" : "Follow-up";
    default:
      return h < 0.6 ? "Negotiation" : "Follow-up";
  }
}

const ROLE_ORDER: Record<CallType, Contact["Buying_Role__c"][]> = {
  Discovery: ["Champion", "Decision Maker", "Economic Buyer", "Influencer"],
  Demo: ["Champion", "End User", "Decision Maker", "Influencer"],
  "Follow-up": ["Champion", "Decision Maker", "Economic Buyer"],
  Negotiation: ["Economic Buyer", "Decision Maker", "Champion"],
  Renewal: ["Decision Maker", "Economic Buyer", "Champion"],
  "Check-in": ["Champion", "Decision Maker", "End User"],
};

function pickContacts(contacts: Contact[], type: CallType, key: string): Contact[] {
  if (!contacts.length) return [];
  const order = ROLE_ORDER[type];
  const sorted = [...contacts].sort((a, b) => {
    const ra = order.indexOf(a.Buying_Role__c);
    const rb = order.indexOf(b.Buying_Role__c);
    return (ra < 0 ? 9 : ra) - (rb < 0 ? 9 : rb) || a.Id.localeCompare(b.Id);
  });
  const two = type !== "Check-in" && sorted.length > 1 && hash01(`${key}:two`) < 0.7;
  return two ? sorted.slice(0, 2) : sorted.slice(0, 1);
}

interface Candidate {
  account: Account;
  opp?: Opportunity;
  weight: number;
  kind: "deal" | "customer" | "prospect";
}

/** Seeded notes stay short: summary, a few points, next steps, sentiment */
function trimNotes(n: CallNotes): CallNotes {
  return {
    summary: n.summary,
    keyPoints: n.keyPoints.filter((k) => !k.startsWith("Landed well")).slice(0, 2),
    painPoints: n.painPoints.slice(0, 2),
    objections: n.objections.slice(0, 1),
    qualification: n.qualification,
    nextSteps: n.nextSteps.slice(0, 3),
    sentiment: n.sentiment,
    source: "rules",
  };
}

export function buildCalls(ctx: SeedContext): Pick<DataSnapshot, "calls"> {
  const anchor = ctx.anchor;
  const anchorISO = iso(anchor);
  const reps = ctx.users.slice(4);
  const contactsBy = new Map<string, Contact[]>();
  for (const c of ctx.contacts) contactsBy.set(c.AccountId, [...(contactsBy.get(c.AccountId) ?? []), c]);
  const openOpps = ctx.opportunities.filter((o) => !o.IsClosed);
  const data = { accounts: ctx.accounts, contacts: ctx.contacts, opportunities: ctx.opportunities };
  const holidays = new Set([iso(thanksgiving(anchor.getUTCFullYear())), iso(addDays(thanksgiving(anchor.getUTCFullYear()), 1))]);

  const calls: Call[] = [];
  let n = 0;

  for (const rep of reps) {
    const mine = ctx.accounts.filter((a) => a.OwnerId === rep.Id && !a.ParentId && contactsBy.has(a.Id));
    const byAccount = new Map(mine.map((a) => [a.Id, a]));
    const pool: Candidate[] = [];
    for (const o of openOpps) {
      const a = byAccount.get(o.AccountId);
      if (a) pool.push({ account: a, opp: o, weight: 3 + (["Negotiation", "Board Approval", "Proposal"].includes(o.StageName) ? 2 : 0), kind: "deal" });
    }
    const withDeal = new Set(pool.map((c) => c.account.Id));
    for (const a of mine) {
      if (withDeal.has(a.Id)) continue;
      if (a.Type === "Customer - Direct") pool.push({ account: a, weight: 1.2, kind: "customer" });
      else if (hash01(`${a.Id}:prospect-call`) < 0.35) pool.push({ account: a, weight: 0.6, kind: "prospect" });
    }
    const lastCalled = new Map<string, string>();

    for (let offset = -30; offset <= 60; offset++) {
      const day = addDays(anchor, offset);
      const dow = day.getUTCDay();
      const dayISO = iso(day);
      if (dow === 0 || dow === 6 || holidays.has(dayISO)) continue;
      const dayKey = `${rep.Id}:${dayISO}`;
      const count = dayISO === anchorISO && rep.Id === "005Hs00000000005AA" ? 6 : 4 + Math.floor(hash01(`${dayKey}:count`) * 4);
      const template = DAY_TEMPLATES[Math.floor(hash01(`${dayKey}:tpl`) * DAY_TEMPLATES.length) % DAY_TEMPLATES.length];
      const slots = template.filter((_, i) => hash01(`${dayKey}:slot:${i}`) < 0.9 || i < 2).slice(0, count);

      // Eligible today: not called in the last 6 days, season-aware
      const eligible = pool.filter((c) => {
        const last = lastCalled.get(c.account.Id);
        if (last && (day.getTime() - Date.parse(`${last}T00:00:00Z`)) / 86_400_000 < 6) return false;
        if (isSeasonalSegment(c.account.Segment__c) && blackoutStatus(c.account, day).status === "hard") {
          if (c.kind === "prospect") return false;
          if (c.kind === "deal" && !["Negotiation", "Board Approval", "Proposal"].includes(c.opp!.StageName)) return hash01(`${dayKey}:${c.account.Id}:bo`) < 0.25;
        }
        return true;
      });
      // Weighted draw without replacement
      // The guest "Sales rep" persona (Luke) gets a deal-heavy day on the anchor date
      const showcase = dayISO === anchorISO && rep.Id === "005Hs00000000005AA";
      const weight = (c: Candidate) => (showcase && c.kind === "deal" ? c.weight * 4 : c.weight);
      const scored = eligible.map((c) => ({ c, s: -Math.log(Math.max(1e-9, hash01(`${dayKey}:${c.account.Id}:${c.opp?.Id ?? ""}`))) / weight(c) })).sort((a, b) => a.s - b.s);
      const chosen: Candidate[] = [];
      for (const { c } of scored) {
        if (chosen.some((x) => x.account.Id === c.account.Id)) continue;
        chosen.push(c);
        if (chosen.length >= slots.length) break;
      }

      chosen.forEach((c, i) => {
        const key = `${dayKey}:${i}`;
        const h = hash01(`${key}:type`);
        const seasonalHard = isSeasonalSegment(c.account.Segment__c) && blackoutStatus(c.account, day).status === "hard";
        let type: CallType =
          c.kind === "deal" ? typeForStage(c.opp!.StageName, h) : c.kind === "customer" ? (h < 0.35 ? "Renewal" : h < 0.7 ? "Check-in" : "Follow-up") : "Discovery";
        if (seasonalHard && (type === "Discovery" || type === "Demo")) type = "Check-in";
        const next = slots[i + 1];
        const [hh, mm] = slots[i].split(":").map(Number);
        const gap = next ? next.split(":").map(Number).reduce((s, v, j) => s + (j ? v : v * 60), 0) - (hh * 60 + mm) : 60;
        const duration = Math.max(15, Math.min(DURATION[type], gap));
        const contacts = pickContacts(contactsBy.get(c.account.Id) ?? [], type, key);
        if (!contacts.length) return;
        const past = dayISO < anchorISO;
        const script = pickScript(type, c.account.Segment__c, c.account.Type === "Customer - Direct");
        const canceled = past && hash01(`${key}:cancel`) < 0.03;
        const pending = past && !canceled && hash01(`${key}:pending`) < 0.08;
        const call: Call = {
          Id: id(++n),
          Subject: `${type}: ${c.account.Name}`,
          AccountId: c.account.Id,
          ...(c.opp ? { OpportunityId: c.opp.Id } : {}),
          ContactIds: contacts.map((x) => x.Id),
          OwnerId: rep.Id,
          CallType: type,
          Start: `${dayISO}T${slots[i]}`,
          DurationMin: duration,
          Status: canceled ? "Canceled" : past ? "Completed" : "Scheduled",
          ...(past && !canceled ? { ScriptId: script.id } : {}),
          NotesStatus: past && !canceled && !pending ? "Saved" : "Pending",
          CreatedDate: `${iso(addDays(day, -3 - Math.floor(hash01(`${key}:created`) * 10)))}T15:00:00.000Z`,
        };
        if (past && !canceled && !pending) {
          const transcript = simulatedTranscript(call, data);
          const repNotes = REP_NOTES[Math.floor(hash01(`${key}:notes`) * REP_NOTES.length) % REP_NOTES.length];
          if (repNotes) call.RepNotes = repNotes;
          const notes = trimNotes(notesFromTranscript(call, transcript, repNotes, data));
          call.Notes = notes;
          call.Commitments = commitmentsFrom(call, notes).map((cm, j) => ({ ...cm, done: !!cm.due && cm.due < anchorISO && hash01(`${key}:done:${j}`) < 0.7 }));
        }
        calls.push(call);
        lastCalled.set(c.account.Id, dayISO);
      });
    }
  }
  return { calls: calls.sort((a, b) => a.Start.localeCompare(b.Start) || a.OwnerId.localeCompare(b.OwnerId)) };
}
