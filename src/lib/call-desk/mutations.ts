/**
 * Call Desk record changes as Salesforce-style mutations. Pure: the UI
 * commits them through useCrud().run (audited automatically), and the Demo
 * Mode walkthrough can call the same helpers.
 */
import type { Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import type { Call, CallNotes, Opportunity, Task } from "@/types/salesforce";
import { changeStage } from "@/lib/actions/outreach";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import { commitmentsFrom, isOurs } from "./notes";
import { callContacts } from "./transcript";
import { callDate } from "./time";
import type { CallContext, ScheduleCallInput, SuggestedUpdate } from "./types";

/** "Now" on the as-of date at today's clock time, so records sort naturally */
export function stampAt(asOf: Date): string {
  const now = new Date();
  return new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds())).toISOString();
}

/** Owner for a new call: the acting user if they own accounts, else the account owner */
function ownerFor(ctx: CallContext, accountId: string, requested?: string): string {
  if (requested) return requested;
  const ownsAny = ctx.data.accounts.some((a) => a.OwnerId === ctx.userId);
  if (ownsAny) return ctx.userId;
  return ctx.data.accounts.find((a) => a.Id === accountId)?.OwnerId ?? ctx.userId;
}

/**
 * Create (or edit, when `input.id` matches a call) a scheduled call.
 * Returns the call Id and the mutations to commit.
 */
export function scheduleCallMutations(ctx: CallContext, input: ScheduleCallInput): { callId: string; mutations: Mutation[] } {
  const account = ctx.data.accounts.find((a) => a.Id === input.accountId);
  const subject = input.subject?.trim() || `${input.callType}: ${account?.Name ?? "Call"}`;
  const start = `${input.date}T${input.time}`;
  const existing = input.id ? ctx.data.calls.find((c) => c.Id === input.id) : undefined;
  if (existing) {
    const changes: Partial<Call> = {
      Subject: subject,
      AccountId: input.accountId,
      // null (not undefined) so clearing survives the JSON change log
      OpportunityId: input.opportunityId || (null as unknown as undefined),
      ContactIds: input.contactIds,
      CallType: input.callType,
      Start: start,
      DurationMin: input.durationMin,
      ...(input.ownerId ? { OwnerId: input.ownerId } : {}),
    };
    return { callId: existing.Id, mutations: [{ op: "update", object: "Call", id: existing.Id, changes }] };
  }
  const call: Call = {
    Id: newId("Call"),
    Subject: subject,
    AccountId: input.accountId,
    ...(input.opportunityId ? { OpportunityId: input.opportunityId } : {}),
    ContactIds: input.contactIds,
    OwnerId: ownerFor(ctx, input.accountId, input.ownerId),
    CallType: input.callType,
    Start: start,
    DurationMin: input.durationMin,
    Status: "Scheduled",
    NotesStatus: "Pending",
    CreatedDate: stampAt(ctx.asOf),
  };
  return { callId: call.Id, mutations: [{ op: "create", object: "Call", record: call }] };
}

function nextBusinessDay(from: Date, n: number): string {
  let d = from;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return toISODate(d);
}

/**
 * Save a finished call: the Call record becomes the logged activity
 * (Completed, transcript, rep notes, AI Notes, commitments, questions asked),
 * each next step becomes a Task, and only the CRM updates the rep confirmed
 * are applied. The economic-buyer update is applied before a stage change, so
 * the Prospecting gate in `changeStage` sees it; a still-blocked stage change
 * is skipped.
 *
 * `call` should already carry Transcript, RepNotes and QuestionsAsked.
 */
export function saveCallMutations(ctx: CallContext, call: Call, notes: CallNotes, confirmedUpdates: SuggestedUpdate[]): Mutation[] {
  const out: Mutation[] = [];
  const stamp = stampAt(ctx.asOf);
  const day = parseDate(callDate(call));
  const contacts = callContacts(call, ctx.data);
  const account = ctx.data.accounts.find((a) => a.Id === call.AccountId);
  let opp: Opportunity | undefined = call.OpportunityId ? ctx.data.opportunities.find((o) => o.Id === call.OpportunityId) : undefined;

  out.push({
    op: "update",
    object: "Call",
    id: call.Id,
    changes: {
      Status: "Completed",
      ...(call.Transcript ? { Transcript: call.Transcript } : {}),
      RepNotes: call.RepNotes ?? "",
      Notes: notes,
      NotesStatus: "Saved",
      Commitments: commitmentsFrom(call, notes),
      QuestionsAsked: call.QuestionsAsked ?? [],
    },
  });

  for (const step of notes.nextSteps) {
    const ours = isOurs(call, step.owner);
    const who = contacts.find((c) => c.Name === step.owner) ?? contacts[0];
    const task: Task = {
      Id: newId("Task"),
      Subject: ours ? step.text : `Check: ${step.owner} to ${step.text.charAt(0).toLowerCase()}${step.text.slice(1)}`,
      Type: "Follow-up",
      TaskSubtype: "Task",
      Status: "Not Started",
      Priority: "Normal",
      ActivityDate: step.due ?? nextBusinessDay(day, ours ? 3 : 5),
      ...(who ? { WhoId: who.Id } : {}),
      WhatId: opp?.Id ?? call.AccountId,
      AccountId: call.AccountId,
      OwnerId: call.OwnerId,
      Description: `From AI Notes: ${call.Subject} (${callDate(call)})`,
      CreatedDate: stamp,
    };
    out.push({ op: "create", object: "Task", record: task });
  }

  const order: SuggestedUpdate["key"][] = ["economicBuyer", "locations", "closeDate", "nextStep", "stage"];
  const confirmed = [...confirmedUpdates].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  for (const u of confirmed) {
    if (u.blocked) continue;
    if (u.object === "Account") {
      if (account) out.push({ op: "update", object: "Account", id: u.recordId, changes: u.changes });
      continue;
    }
    const target = opp && opp.Id === u.recordId ? opp : ctx.data.opportunities.find((o) => o.Id === u.recordId);
    if (!target) continue;
    if (u.key === "stage") {
      const r = changeStage(ctx, target, String(u.changes.StageName) as Opportunity["StageName"]);
      if (r.blocked) continue;
      out.push(...r.mutations);
      opp = { ...target, ...(r.mutations[0] as { changes: Partial<Opportunity> }).changes };
      continue;
    }
    const changes = { ...u.changes, LastModifiedDate: stamp } as Partial<Opportunity>;
    out.push({ op: "update", object: "Opportunity", id: target.Id, changes });
    opp = { ...target, ...changes };
  }
  return out;
}

/** Remove a call's AI Notes (the call stays, notes go back to pending) */
export function deleteNotesMutations(call: Call): Mutation[] {
  // null (not undefined) so the change survives the JSON change log
  const cleared = null as unknown as undefined;
  return [{ op: "update", object: "Call", id: call.Id, changes: { Notes: cleared, NotesStatus: "Pending", Commitments: [], Transcript: cleared, RepNotes: "" } }];
}

/** Mark a commitment done or not done */
export function toggleCommitmentMutations(call: Call, index: number): Mutation[] {
  const list = [...(call.Commitments ?? [])];
  if (!list[index]) return [];
  list[index] = { ...list[index], done: !list[index].done };
  return [{ op: "update", object: "Call", id: call.Id, changes: { Commitments: list } }];
}

