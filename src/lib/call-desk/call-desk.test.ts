import { test } from "node:test";
import assert from "node:assert/strict";

import { SEED } from "@/data/seed";
import { applyMutations } from "@/lib/data/local-repository";
import { parseDate } from "@/lib/dates";
import type { Call, Contact, Opportunity } from "@/types/salesforce";
import { CALL_SCRIPTS, pickScript } from "@/lib/callScripts";
import { questionsFor, type BriefFacts } from "@/lib/callBriefRules";
import {
  buildBrief,
  briefText,
  fmtCountdown,
  minutesUntil,
  nextCall,
  notesFromTranscript,
  saveCallMutations,
  scheduleCallMutations,
  searchCalls,
  simulatedTranscript,
  suggestedUpdates,
} from "./index";

const asOf = parseDate("2026-09-29");
const LUKE = "005Hs00000000005AA";
const ctx = { data: SEED, asOf, userId: LUKE };

/** A Prospecting deal with no economic buyer yet, whose account has an economic-buyer contact */
const gated = SEED.opportunities.find(
  (o) => !o.IsClosed && o.StageName === "Prospecting" && !o.Economic_Buyer_Identified__c && SEED.contacts.some((c) => c.AccountId === o.AccountId && c.Buying_Role__c === "Economic Buyer"),
) as Opportunity;
const eb = SEED.contacts.find((c) => c.AccountId === gated.AccountId && c.Buying_Role__c === "Economic Buyer") as Contact;
const champion = SEED.contacts.find((c) => c.AccountId === gated.AccountId && c.Id !== eb.Id) ?? eb;

function scheduled(overrides: Partial<Call> = {}): { data: typeof SEED; call: Call } {
  const r = scheduleCallMutations(ctx, { accountId: gated.AccountId, opportunityId: gated.Id, contactIds: [champion.Id], callType: "Discovery", date: "2026-09-29", time: "14:00", durationMin: 30 });
  const data = applyMutations(SEED, r.mutations);
  const call = { ...data.calls.find((c) => c.Id === r.callId)!, ...overrides };
  return { data, call };
}

/* ------------------------------------------------------------------ seed */

test("seed: 4–7 calls per territory rep per weekday, past calls completed with notes", () => {
  const reps = new Set(SEED.calls.map((c) => c.OwnerId));
  assert.equal(reps.size, 6, "six territory reps");
  assert.ok(!reps.has("005Hs00000000001AA"), "app personas own no calls");
  const lukeToday = SEED.calls.filter((c) => c.OwnerId === LUKE && c.Start.startsWith("2026-09-29"));
  assert.ok(lukeToday.length >= 4 && lukeToday.length <= 7, `Luke has a realistic day (${lukeToday.length})`);
  const past = SEED.calls.filter((c) => c.Start < "2026-09-29" && c.Status === "Completed");
  assert.ok(past.length > 400);
  assert.ok(past.filter((c) => c.NotesStatus === "Saved").every((c) => c.Notes && c.ScriptId && !c.Transcript), "notes saved, transcript rebuilt from ScriptId");
  assert.ok(past.some((c) => c.NotesStatus === "Pending"), "a few notes pending");
  assert.ok(SEED.calls.filter((c) => c.Start >= "2026-09-30").every((c) => c.Status === "Scheduled"));
});

/* ----------------------------------------------------------- transcripts */

test("each call type and segment gets a script; transcripts use real speaker names", () => {
  assert.equal(CALL_SCRIPTS.length, 8);
  assert.equal(pickScript("Discovery", "Feed Mill").id, "feed-mill");
  assert.equal(pickScript("Demo", "Ethanol Plant").id, "processor-origination");
  assert.equal(pickScript("Discovery", "Multi-Location Co-op").id, "discovery-coop");
  assert.equal(pickScript("Follow-up", "Country Elevator", true).id, "check-in");
  const { data, call } = scheduled();
  const t = simulatedTranscript(call, data);
  assert.ok(t.length > 10);
  assert.ok(t.some((l) => l.speaker === "Luke Brenneman"), "rep label");
  assert.ok(t.some((l) => l.speaker === champion.Name), "contact label");
  assert.ok(t.every((l, i) => i === 0 || l.atSec > t[i - 1].atSec), "timestamps increase");
  assert.ok(!t.some((l) => /\{\w+\}/.test(l.text)), "all placeholders filled");
});

/* ----------------------------------------------------------------- brief */

test("brief rules: gaps, questions, season and talking points look complete", () => {
  const { data, call } = scheduled();
  const brief = buildBrief(call, data, { asOf })!;
  assert.ok(brief);
  assert.equal(brief.source, "rules");
  assert.ok(brief.gaps.some((g) => g.startsWith("Economic buyer not identified")));
  assert.ok(brief.questions.length >= 5 && brief.questions.length <= 7, `${brief.questions.length} questions`);
  assert.ok(brief.questions.some((q) => /signs off/.test(q.text)), "asks who signs off");
  assert.ok(brief.snapshot.season.label.length > 0);
  assert.ok(brief.talking.objections.length > 0);
  assert.ok(brief.talking.points.length > 0);
  assert.ok(brief.timeline.every((e, i) => i === 0 || e.date <= brief.timeline[i - 1].date), "timeline newest first");
  assert.match(briefText(brief, call), /QUESTIONS TO ASK/);
});

test("question rules are keyed by segment, stage and season", () => {
  const base: BriefFacts = {
    segment: "Multi-Location Co-op",
    seasonal: true,
    callType: "Follow-up",
    stage: "Proposal",
    season: "hard",
    blackoutEnd: "Nov 26",
    harvestRecent: true,
    isCustomer: false,
    economicBuyerKnown: false,
    fiscalYearEnd: "September 30",
    fyeDaysAway: 20,
    boardMonth: "December",
    locations: 8,
    current: "GrainMaster Classic",
    currentKind: "legacy",
    competitor: "HarvestCore 360",
    competitorMentioned: true,
    budgetKnown: false,
    timelineKnown: false,
    theirOpen: ["Send over last year's patronage file"],
    openTickets: 0,
    commodity: "corn",
  };
  const q = questionsFor(base).map((x) => x.text);
  assert.equal(q.length, 7);
  assert.match(q[0], /send over last year's patronage file/);
  assert.ok(q.includes("Who else signs off: GM or the board?"));
  assert.ok(q.includes("Your fiscal year ends September 30. Is budget set for next year?"));
  assert.ok(q.some((x) => /HarvestCore 360/.test(x)));
  const ethanol = questionsFor({ ...base, segment: "Ethanol Plant", seasonal: false, season: "none", theirOpen: [], competitorMentioned: false }).map((x) => x.text);
  assert.ok(ethanol.includes("Who else signs off: the plant manager or the CFO?"));
  assert.ok(!ethanol.some((x) => /scale-ticket volume/.test(x)), "no harvest question for year-round plants");
  assert.ok(questionsFor({ ...base, theirOpen: [], isCustomer: true, economicBuyerKnown: true }).length >= 5, "always at least five");
});

/* ----------------------------------------------------------------- notes */

test("notes extraction: summary, pains, objections, qualification, next steps, sentiment", () => {
  const { data, call } = scheduled();
  const t = simulatedTranscript(call, data);
  const notes = notesFromTranscript(call, t, "Positive call, interested in seeing a proposal\nSend references from a nearby co-op", data);
  assert.equal(notes.source, "rules");
  const lines = notes.summary.split("\n");
  assert.ok(lines.length >= 3 && lines.length <= 4);
  assert.ok(notes.painPoints.length > 0);
  assert.ok(notes.objections.length > 0 && notes.objections.every((o) => o.response.length > 0));
  assert.ok(notes.qualification.budget && /\$[\d,]+/.test(notes.qualification.budget));
  assert.ok(notes.qualification.decisionMaker);
  assert.ok(notes.qualification.competitors);
  assert.ok(notes.nextSteps.some((n) => n.owner === "Luke Brenneman"), "our steps");
  assert.ok(notes.nextSteps.some((n) => n.owner !== "Luke Brenneman"), "their steps");
  assert.ok(notes.nextSteps.every((n) => n.due && n.due >= "2026-09-29"));
  assert.ok(notes.nextSteps.some((n) => n.text === "Send references from a nearby co-op"), "rep notes become next steps");
  assert.equal(notes.sentiment, "Positive");
  assert.ok(notes.followUpEmail && !/\{\{/.test(notes.followUpEmail.body), "follow-up email merged");
  const worried = notesFromTranscript(call, t, "Concerned about budget; pushback on timing, deal feels stalled", data);
  assert.equal(worried.sentiment, "Concerned");
});

test("suggested updates respect the economic-buyer gate", () => {
  const { data, call } = scheduled();
  const t = simulatedTranscript(call, data);
  const notes = notesFromTranscript(call, t, "", data);
  const ups = suggestedUpdates(call, notes, data);
  const stage = ups.find((u) => u.key === "stage");
  assert.ok(stage, "stage suggestion");
  assert.equal(stage!.to, "Qualification");
  const ebUp = ups.find((u) => u.key === "economicBuyer");
  assert.ok(ebUp, "board/sign-off talk points at the account's economic buyer");
  assert.equal(stage!.requires, "economicBuyer");
});

/* -------------------------------------------------------- save mutations */

test("save: completes the call, creates tasks and applies only confirmed updates", () => {
  const { data, call } = scheduled({ QuestionsAsked: ["Who else signs off: GM or the board?"], RepNotes: "Good call" });
  const t = simulatedTranscript(call, data);
  const notes = notesFromTranscript(call, t, "Good call", data);
  const ups = suggestedUpdates(call, notes, data);
  const stageOnly = ups.filter((u) => u.key === "stage");
  const c2 = { ...ctx, data };

  // Stage without the economic buyer: blocked by changeStage, so skipped
  let after = applyMutations(data, saveCallMutations(c2, { ...call, Transcript: t }, notes, stageOnly));
  assert.equal(after.opportunities.find((o) => o.Id === gated.Id)!.StageName, "Prospecting");
  const saved = after.calls.find((c) => c.Id === call.Id)!;
  assert.equal(saved.Status, "Completed");
  assert.equal(saved.NotesStatus, "Saved");
  assert.equal(saved.Transcript?.length, t.length);
  assert.deepEqual(saved.QuestionsAsked, ["Who else signs off: GM or the board?"]);
  assert.ok(saved.Commitments!.some((c) => c.owner === "us") && saved.Commitments!.some((c) => c.owner === "them"));
  const tasks = after.tasks.filter((x) => x.Description.startsWith("From AI Notes") && x.AccountId === call.AccountId);
  assert.equal(tasks.length, notes.nextSteps.length);

  // Economic buyer + stage together: EB applied first, then the stage moves
  const both = ups.filter((u) => u.key === "stage" || u.key === "economicBuyer");
  after = applyMutations(data, saveCallMutations(c2, call, notes, both));
  const opp = after.opportunities.find((o) => o.Id === gated.Id)!;
  assert.equal(opp.Economic_Buyer_Identified__c, true);
  assert.equal(opp.StageName, "Qualification");

  // Nothing confirmed: the deal is untouched
  after = applyMutations(data, saveCallMutations(c2, call, notes, []));
  assert.deepEqual(after.opportunities.find((o) => o.Id === gated.Id), gated);
});

test("the next brief includes the saved notes, commitments and answered questions", () => {
  const { data, call } = scheduled({ QuestionsAsked: ["Who else signs off: GM or the board?"] });
  const t = simulatedTranscript(call, data);
  const notes = notesFromTranscript(call, t, "", data);
  const after = applyMutations(data, saveCallMutations({ ...ctx, data }, { ...call, Transcript: t }, notes, []));
  const r = scheduleCallMutations({ ...ctx, data: after }, { accountId: gated.AccountId, opportunityId: gated.Id, contactIds: [champion.Id], callType: "Follow-up", date: "2026-10-06", time: "09:00", durationMin: 30 });
  const next = applyMutations(after, r.mutations);
  const brief = buildBrief(next.calls.find((c) => c.Id === r.callId)!, next, { asOf })!;
  assert.equal(brief.lastTime?.callId, call.Id);
  assert.deepEqual(brief.lastTime?.summary, notes.summary.split("\n").slice(0, 3));
  assert.ok(brief.lastTime!.commitments.length > 0);
  assert.deepEqual(brief.lastTime!.questionsAsked, ["Who else signs off: GM or the board?"]);
  assert.ok(brief.questions.some((q) => q.why === "Open commitment"), "asks about their open commitment");
  assert.ok(brief.timeline.some((e) => e.id === call.Id && e.kind === "Call"));
});

/* ------------------------------------------------------ clock and search */

test("countdown and next call use the simulated clock", () => {
  const calls = [
    { Start: "2026-09-29T09:00", DurationMin: 30, Status: "Scheduled" as const },
    { Start: "2026-09-29T10:00", DurationMin: 30, Status: "Scheduled" as const },
  ];
  assert.equal(minutesUntil(calls[1], "2026-09-29T09:48"), 12);
  assert.equal(fmtCountdown(12), "in 12 min");
  assert.equal(nextCall(calls, "2026-09-29T09:48")?.Start, "2026-09-29T10:00");
  assert.equal(nextCall(calls, "2026-09-29T09:10")?.Start, "2026-09-29T09:00", "a call in progress is still next");
});

test("search finds calls by transcript text, account and date", () => {
  const hits = searchCalls(SEED, { query: "scale tickets", limit: 5 });
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.snippets.length > 0 && h.snippets.some((s) => /scale|ticket/i.test(s))));
  const acct = SEED.calls.find((c) => c.Status === "Completed" && c.Notes)!;
  const byAccount = searchCalls(SEED, { accountId: acct.AccountId, from: "2026-08-01", to: "2026-09-28" });
  assert.ok(byAccount.every((h) => h.call.AccountId === acct.AccountId));
  assert.ok(searchCalls(SEED, { query: "competitor-that-does-not-exist" }).length === 0);
});
