/**
 * Simulated transcripts: the seeded script for a call rendered with the
 * account's facts and real speaker names (rep vs contacts).
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Call, Contact } from "@/types/salesforce";
import { USER_BY_ID } from "@/data/reference/users";
import { pickScript, renderScript, SCRIPT_BY_ID, scriptVars, type CallScript, type TranscriptLine } from "@/lib/callScripts";

export type TranscriptData = Pick<DataSnapshot, "accounts" | "contacts" | "opportunities">;

/** Contacts on the call, else the account's economic buyer and champion */
export function callContacts(call: Pick<Call, "AccountId" | "ContactIds">, data: Pick<DataSnapshot, "contacts">): Contact[] {
  const byId = new Map(data.contacts.map((c) => [c.Id, c]));
  const on = call.ContactIds.map((id) => byId.get(id)).filter((c): c is Contact => !!c);
  if (on.length) return on;
  const at = data.contacts.filter((c) => c.AccountId === call.AccountId);
  const rank = (c: Contact) => ["Economic Buyer", "Decision Maker", "Champion", "Influencer", "End User", "Board Member"].indexOf(c.Buying_Role__c);
  return at.sort((a, b) => rank(a) - rank(b)).slice(0, 2);
}

export function repName(ownerId: string): string {
  return USER_BY_ID[ownerId]?.Name ?? "Sales rep";
}

/** The script a call uses: its stored ScriptId, else one picked by call type and segment */
export function scriptFor(call: Pick<Call, "ScriptId" | "CallType" | "AccountId">, data: Pick<DataSnapshot, "accounts">): CallScript {
  const stored = call.ScriptId ? SCRIPT_BY_ID[call.ScriptId] : undefined;
  if (stored) return stored;
  const a = data.accounts.find((x) => x.Id === call.AccountId);
  return pickScript(call.CallType, a?.Segment__c, a?.Type === "Customer - Direct");
}

/** A realistic, seeded transcript for the call (the call's own Transcript when it has one) */
export function simulatedTranscript(call: Call, data: TranscriptData): TranscriptLine[] {
  if (call.Transcript?.length) return call.Transcript;
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const contacts = callContacts(call, data);
  const opportunity = call.OpportunityId ? data.opportunities.find((o) => o.Id === call.OpportunityId) : undefined;
  const vars = scriptVars({ call, account, contacts, opportunity });
  const c0 = contacts[0]?.Name ?? "Customer";
  const c1 = contacts[1]?.Name ?? c0;
  return renderScript(scriptFor(call, data), vars, { rep: repName(call.OwnerId), c0, c1 });
}

/** "12:05" from seconds */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((l) => `[${fmtClock(l.atSec)}] ${l.speaker}: ${l.text}`).join("\n");
}
