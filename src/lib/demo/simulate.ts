/**
 * Demo Mode "fast-forward": realistic activity between two dates, from a
 * seeded PRNG (same demo run + dates → same activity). Pure: returns the
 * mutations to commit (through useCrud().run, so they are audited) and counts
 * for the one-line summary.
 *
 * What happens in the window:
 * - sequence steps due in the window go out (their Tasks are completed);
 * - members of campaigns running in the window open (Status "Opened", an
 *   "Email opened" Task), some reply (Status "Responded", HasResponded,
 *   a "Reply" Task) and some replies book a meeting (an Event);
 * - a few open deals move one stage (changeStage, economic-buyer gate kept);
 * - a couple of late-stage deals close won (closeWonMutations), one is lost;
 * - open invoices coming due get paid (recordPaymentMutations).
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { Event, Opportunity, OpportunityStage, Task } from "@/types/salesforce";
import { addDays, diffDays, parseDate, toISODate } from "@/lib/dates";
import { changeStage, LOSS_REASONS } from "@/lib/actions/outreach";
import { closeWonMutations } from "@/lib/quotes/lifecycle";
import { balanceOf, recordPaymentMutations } from "@/lib/billing";
import { isRenewalOpportunity } from "@/lib/success/renewals";
import { rngFor, shuffle, stochasticRound, type Rng } from "./prng";

export interface SimCounts {
  days: number;
  sent: number;
  opens: number;
  replies: number;
  meetings: number;
  stageMoves: number;
  wins: number;
  losses: number;
  payments: number;
}

export interface SimResult {
  mutations: Mutation[];
  counts: SimCounts;
  /** Won opportunity ids (for links in the activity feed) */
  wonIds: string[];
}

export interface SimOptions {
  /** Demo run id (part of the PRNG seed) */
  seed: string;
  userId: string;
  /** Deals the walkthrough manages itself (never moved by the simulation) */
  skipOpportunityIds?: string[];
}

const NEXT: Partial<Record<OpportunityStage, OpportunityStage>> = {
  Qualification: "Needs Analysis",
  "Needs Analysis": "Proposal",
  Proposal: "Negotiation",
  Negotiation: "Board Approval",
};

/** Salesforce date-time at midday on a date */
const at = (iso: string, hour = 14) => `${iso}T${String(hour).padStart(2, "0")}:00:00.000+0000`;

function dayIn(rng: Rng, from: Date, days: number): string {
  return toISODate(addDays(from, 1 + Math.floor(rng() * Math.max(1, days))));
}

export function simulateWindow(data: DataSnapshot, fromISO: string, toISO: string, opts: SimOptions): SimResult {
  const from = parseDate(fromISO);
  const to = parseDate(toISO);
  const days = Math.max(0, diffDays(to, from));
  const counts: SimCounts = { days, sent: 0, opens: 0, replies: 0, meetings: 0, stageMoves: 0, wins: 0, losses: 0, payments: 0 };
  const out: Mutation[] = [];
  const wonIds: string[] = [];
  if (days <= 0) return { mutations: out, counts, wonIds };
  const rng = rngFor(`${opts.seed}|${fromISO}|${toISO}`);
  const scale = Math.min(1, days / 30);
  const skip = new Set(opts.skipOpportunityIds ?? []);

  // 1. Sequence steps due in the window go out
  for (const t of data.tasks) {
    if (t.Status === "Completed" || !t.Subject.startsWith("Sequence step:")) continue;
    if (t.ActivityDate <= fromISO || t.ActivityDate > toISO) continue;
    out.push({ op: "update", object: "Task", id: t.Id, changes: { Status: "Completed", CompletedDateTime: at(t.ActivityDate, 9) } });
    counts.sent++;
  }

  // 2. Campaign engagement: opens, replies, meetings
  const campaigns = new Map(data.campaigns.filter((c) => c.StartDate <= toISO && c.EndDate >= fromISO && c.Status !== "Aborted").map((c) => [c.Id, c]));
  const members = shuffle(
    data.campaignMembers.filter((m) => campaigns.has(m.CampaignId) && (m.Status === "Planned" || m.Status === "Sent" || m.Status === "Opened")),
    rng,
  );
  const pOpen = 0.55 * scale + 0.1;
  const pReply = 0.24;
  const pMeeting = 0.35;
  for (const m of members) {
    const c = campaigns.get(m.CampaignId)!;
    const start = c.StartDate > fromISO ? parseDate(c.StartDate) : from;
    const span = Math.max(1, diffDays(to, start));
    const accountId = m.AccountId;
    const whoId = m.ContactId ?? m.LeadId;
    const opened = m.Status === "Opened" || rng() < pOpen;
    if (!opened) continue;
    const openDay = dayIn(rng, start, span);
    const task = (subject: string, day: string): Task => ({
      Id: newId("Task"),
      Subject: subject,
      Type: "Email",
      TaskSubtype: "Email",
      Status: "Completed",
      Priority: "Normal",
      ActivityDate: day,
      ...(whoId ? { WhoId: whoId } : {}),
      WhatId: c.Id,
      ...(accountId ? { AccountId: accountId } : {}),
      OwnerId: c.OwnerId || opts.userId,
      Description: `Simulated in Demo Mode (campaign "${c.Name}").`,
      CreatedDate: at(day),
      CompletedDateTime: at(day),
    });
    if (m.Status !== "Opened") {
      out.push({ op: "create", object: "Task", record: task(`Email opened: ${c.Name}`, openDay) });
      counts.opens++;
    }
    if (rng() >= pReply) {
      if (m.Status !== "Opened") out.push({ op: "update", object: "CampaignMember", id: m.Id, changes: { Status: "Opened" } });
      continue;
    }
    const replyDay = openDay < toISO ? toISODate(addDays(parseDate(openDay), 1)) : openDay;
    out.push(
      { op: "update", object: "CampaignMember", id: m.Id, changes: { Status: "Responded", HasResponded: true, FirstRespondedDate: replyDay } },
      { op: "create", object: "Task", record: task(`Reply: ${c.Name}`, replyDay) },
    );
    counts.replies++;
    if (rng() < pMeeting && accountId) {
      const meetDay = toISODate(addDays(parseDate(replyDay), 3));
      const ev: Event = {
        Id: newId("Event"),
        Subject: `Meeting booked: ${c.Name}`,
        Type: "Meeting",
        StartDateTime: at(meetDay, 15),
        EndDateTime: at(meetDay, 16),
        Location: "Zoom",
        ...(whoId ? { WhoId: whoId } : {}),
        WhatId: c.Id,
        AccountId: accountId,
        OwnerId: c.OwnerId || opts.userId,
        Description: "Booked from an email reply (simulated in Demo Mode).",
        CreatedDate: at(replyDay),
      };
      out.push({ op: "create", object: "Event", record: ev });
      counts.meetings++;
    }
  }

  // 3. Pipeline: stage moves, wins and a loss
  const open = data.opportunities.filter((o) => !o.IsClosed && !skip.has(o.Id) && !isRenewalOpportunity(o) && parseDate(o.CreatedDate) <= to);
  const touched = new Set<string>();
  const ctxAt = (day: string) => ({ data, asOf: parseDate(day), userId: opts.userId });

  const winPool = shuffle(open.filter((o) => (o.StageName === "Negotiation" || o.StageName === "Board Approval") && o.Economic_Buyer_Identified__c), rng);
  for (const o of winPool.slice(0, stochasticRound(2 * scale, rng))) {
    const day = dayIn(rng, from, days);
    out.push(...closeWonMutations(ctxAt(day), o.Id));
    touched.add(o.Id);
    wonIds.push(o.Id);
    counts.wins++;
  }

  const lossPool = shuffle(open.filter((o) => !touched.has(o.Id) && (o.StageName === "Proposal" || o.StageName === "Needs Analysis")), rng);
  for (const o of lossPool.slice(0, stochasticRound(1 * scale, rng))) {
    const r = changeStage(ctxAt(dayIn(rng, from, days)), o, "Closed Lost", { lossReason: LOSS_REASONS[Math.floor(rng() * LOSS_REASONS.length)] });
    if (r.blocked) continue;
    out.push(...r.mutations);
    touched.add(o.Id);
    counts.losses++;
  }

  const movePool = shuffle(open.filter((o) => !touched.has(o.Id) && NEXT[o.StageName] && o.Economic_Buyer_Identified__c), rng);
  for (const o of movePool.slice(0, stochasticRound(5 * scale, rng))) {
    const r = changeStage(ctxAt(dayIn(rng, from, days)), o as Opportunity, NEXT[o.StageName]!);
    if (r.blocked) continue;
    out.push(...r.mutations);
    counts.stageMoves++;
  }

  // 4. Cash: open invoices coming due get paid
  const horizon = toISODate(addDays(to, 10));
  for (const inv of data.invoices) {
    if ((inv.Status !== "Sent" && inv.Status !== "Overdue") || balanceOf(inv) <= 0 || inv.External) continue;
    if (inv.DueDate > horizon || inv.IssueDate > toISO) continue;
    // Invoices coming due mostly get paid; ones already overdue trickle in
    const p = inv.DueDate > fromISO ? 0.7 : 0.05 + 0.3 * scale;
    if (rng() > p) continue;
    const earliest = inv.IssueDate > fromISO ? parseDate(inv.IssueDate) : from;
    const day = toISODate(addDays(earliest, Math.floor(rng() * Math.max(1, diffDays(to, earliest) + 1))));
    const muts = recordPaymentMutations({ data, asOf: to, userId: opts.userId }, inv, {
      amount: balanceOf(inv),
      date: day > toISO ? toISO : day,
      method: rng() < 0.6 ? "ACH" : "Check",
      reference: `SIM-${inv.InvoiceNumber}`,
    });
    if (!muts.length) continue;
    out.push(...muts);
    counts.payments++;
  }

  return { mutations: out, counts, wonIds };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Fast-forwarded 30 days · 42 opens, 9 replies, 3 meetings, 2 wins" */
export function simSummary(c: SimCounts): string {
  const parts = [
    plural(c.opens, "open"),
    plural(c.replies, "reply", "replies"),
    plural(c.meetings, "meeting"),
    plural(c.wins, "win"),
    ...(c.losses ? [plural(c.losses, "loss", "losses")] : []),
    ...(c.stageMoves ? [plural(c.stageMoves, "stage move")] : []),
    ...(c.payments ? [plural(c.payments, "payment")] : []),
  ];
  return `Fast-forwarded ${plural(c.days, "day")} · ${parts.join(", ")}`;
}
