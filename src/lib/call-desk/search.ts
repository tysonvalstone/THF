/**
 * Full-text search across call transcripts, rep notes and AI Notes (Past
 * calls page and the assistant's `search_calls` tool). Seeded calls have no
 * stored transcript, so it is rebuilt from the script on the fly.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Call } from "@/types/salesforce";
import { simulatedTranscript } from "./transcript";

export type SearchData = Pick<DataSnapshot, "calls" | "accounts" | "contacts" | "opportunities">;

/** All searchable text of a completed call */
export function callSearchText(call: Call, data: SearchData): string {
  const n = call.Notes;
  const parts = [call.Subject, call.CallType, call.RepNotes ?? ""];
  if (n) {
    parts.push(n.summary, ...n.keyPoints, ...n.painPoints, ...n.objections.flatMap((o) => [o.objection, o.response]), ...Object.values(n.qualification).filter(Boolean) as string[], ...n.nextSteps.map((s) => s.text));
  }
  if (call.Status === "Completed") parts.push(...simulatedTranscript(call, data).map((l) => `${l.speaker}: ${l.text}`));
  return parts.join("\n");
}

export interface CallHit {
  call: Call;
  account: string;
  /** Matching sentences (up to 3) */
  snippets: string[];
}

export interface CallQuery {
  query?: string;
  accountId?: string;
  from?: string;
  to?: string;
  ownerId?: string;
  limit?: number;
}

const words = (q: string) =>
  q
    .toLowerCase()
    .split(/[^a-z0-9$'-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
const norm = (s: string) => s.toLowerCase().replace(/[‐-―-]/g, " ");
const STOP = new Set(["the", "and", "about", "what", "did", "say", "said", "for", "with", "they", "was", "were", "any", "our", "their", "last", "this", "that", "calls", "call"]);

/** Completed calls matching the filters, newest first, with matching snippets */
export function searchCalls(data: SearchData, q: CallQuery): CallHit[] {
  const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
  const phrase = norm(q.query?.trim() ?? "");
  // Match word stems so "scale tickets" finds "scale-ticket volume"
  const terms = phrase ? words(phrase).map((w) => (w.length > 3 ? w.replace(/(es|s)$/, "") : w)) : [];
  const hit = (line: string) => {
    const l = norm(line);
    return l.includes(phrase) || (terms.length > 0 && terms.every((t) => l.includes(t)));
  };
  const out: CallHit[] = [];
  const list = data.calls
    .filter((c) => c.Status === "Completed")
    .filter((c) => !q.accountId || c.AccountId === q.accountId || accounts.get(c.AccountId)?.ParentId === q.accountId)
    .filter((c) => !q.ownerId || c.OwnerId === q.ownerId)
    .filter((c) => (!q.from || c.Start.slice(0, 10) >= q.from) && (!q.to || c.Start.slice(0, 10) <= q.to))
    .sort((a, b) => b.Start.localeCompare(a.Start));
  for (const call of list) {
    let snippets: string[] = [];
    if (phrase) {
      // Every term in the same line (sentence-level relevance), or the exact phrase
      snippets = callSearchText(call, data).split("\n").filter(hit).slice(0, 3);
      if (!snippets.length) continue;
    }
    out.push({ call, account: accounts.get(call.AccountId)?.Name ?? "", snippets });
    if (q.limit && out.length >= q.limit) break;
  }
  return out;
}
