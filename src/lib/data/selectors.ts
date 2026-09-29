import type { DataSnapshot } from "./types";
import type { Account, Contact, Event, Lead, Opportunity, Task } from "@/types/salesforce";
import { USER_BY_ID } from "@/data/reference/users";
import { parseDate } from "@/lib/dates";

export function userName(id: string): string {
  return USER_BY_ID[id]?.Name ?? "Unassigned";
}

export function findAccount(data: DataSnapshot, id: string): Account | undefined {
  return data.accounts.find((a) => a.Id === id);
}

export function findLead(data: DataSnapshot, id: string): Lead | undefined {
  return data.leads.find((l) => l.Id === id);
}

export function contactsFor(data: DataSnapshot, accountId: string): Contact[] {
  return data.contacts.filter((c) => c.AccountId === accountId);
}

export function opportunitiesFor(data: DataSnapshot, accountId: string): Opportunity[] {
  return data.opportunities
    .filter((o) => o.AccountId === accountId)
    .sort((a, b) => Number(a.IsClosed) - Number(b.IsClosed) || b.CloseDate.localeCompare(a.CloseDate));
}

export type TimelineItem =
  | { kind: "task"; date: Date; record: Task }
  | { kind: "event"; date: Date; record: Event };

/**
 * Activity timeline for an Account or Lead. Items dated after `asOf` are
 * returned as upcoming (open tasks, scheduled events) rather than hidden.
 */
export function timelineFor(data: DataSnapshot, id: string): TimelineItem[] {
  const isLead = id.startsWith("00Q");
  const items: TimelineItem[] = [
    ...data.tasks
      .filter((t) => (isLead ? t.WhoId === id : t.AccountId === id))
      .map((t) => ({ kind: "task" as const, date: parseDate(t.ActivityDate), record: t })),
    ...data.events
      .filter((e) => (isLead ? e.WhoId === id : e.AccountId === id))
      .map((e) => ({ kind: "event" as const, date: parseDate(e.StartDateTime), record: e })),
  ];
  return items.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function contactName(data: DataSnapshot, whoId?: string): string | undefined {
  if (!whoId) return undefined;
  if (whoId.startsWith("00Q")) return data.leads.find((l) => l.Id === whoId)?.Name;
  return data.contacts.find((c) => c.Id === whoId)?.Name;
}

export function isOpenAsOf(o: Opportunity, asOf: Date): boolean {
  return parseDate(o.CreatedDate) <= asOf && !(o.IsClosed && parseDate(o.CloseDate) <= asOf);
}

export interface PipelineSummary {
  open: Opportunity[];
  total: number;
  weighted: number;
  commit: number;
  bestCase: number;
  byStage: { stage: string; amount: number; count: number }[];
  wonLast90: number;
}

export function pipelineSummary(data: DataSnapshot, asOf: Date): PipelineSummary {
  const open = data.opportunities.filter((o) => isOpenAsOf(o, asOf) && !o.IsClosed);
  const stages = ["Prospecting", "Qualification", "Needs Analysis", "Proposal", "Negotiation"];
  const ninetyAgo = asOf.getTime() - 90 * 86_400_000;
  return {
    open,
    total: open.reduce((s, o) => s + o.Amount, 0),
    weighted: open.reduce((s, o) => s + (o.Amount * o.Probability) / 100, 0),
    commit: open.filter((o) => o.ForecastCategoryName === "Commit").reduce((s, o) => s + o.Amount, 0),
    bestCase: open.filter((o) => o.ForecastCategoryName === "Best Case").reduce((s, o) => s + o.Amount, 0),
    byStage: stages.map((stage) => {
      const list = open.filter((o) => o.StageName === stage);
      return { stage, amount: list.reduce((s, o) => s + o.Amount, 0), count: list.length };
    }),
    wonLast90: data.opportunities
      .filter((o) => o.IsWon && parseDate(o.CloseDate).getTime() >= ninetyAgo && parseDate(o.CloseDate) <= asOf)
      .reduce((s, o) => s + o.Amount, 0),
  };
}
