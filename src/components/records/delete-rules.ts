/**
 * What deleting a record takes with it. Each function returns either a
 * reason the delete is blocked, or the dependent mutations to commit first.
 *
 * - Account: blocked while it has open opportunities or child locations.
 *   Otherwise its contacts, tasks, events, campaign memberships and closed
 *   opportunities (with their line items and quotes) go with it.
 * - Lead: its tasks, events and campaign memberships go with it; a linked
 *   new build goes back to New.
 * - Contact: only the contact; its activity stays on the account.
 * - Opportunity: its line items and quotes go with it; its tasks and events
 *   move to the account.
 * - Campaign: its members and not-started campaign tasks go with it.
 * - Campaign member: its not-started campaign tasks go with it.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";

export interface DeletePlan {
  blocked?: string;
  cascade: Mutation[];
  /** Plain-language summary for the confirmation dialog */
  detail: string;
}

const del = (object: Mutation["object"], id: string): Mutation => ({ op: "delete", object, id });
const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function opportunityChildren(data: DataSnapshot, oppId: string): Mutation[] {
  const quotes = data.quotes.filter((q) => q.OpportunityId === oppId);
  const quoteIds = new Set(quotes.map((q) => q.Id));
  return [
    ...data.quoteLineItems.filter((l) => quoteIds.has(l.QuoteId)).map((l) => del("QuoteLineItem", l.Id)),
    ...quotes.map((q) => del("Quote", q.Id)),
    ...data.lineItems.filter((l) => l.OpportunityId === oppId).map((l) => del("OpportunityLineItem", l.Id)),
  ];
}

export function accountDeletePlan(data: DataSnapshot, id: string): DeletePlan {
  const opps = data.opportunities.filter((o) => o.AccountId === id);
  const open = opps.filter((o) => !o.IsClosed);
  if (open.length) return { blocked: `This account has ${n(open.length, "open opportunity", "open opportunities")}. Close or delete them first.`, cascade: [], detail: "" };
  const children = data.accounts.filter((a) => a.ParentId === id);
  if (children.length) return { blocked: `This account has ${n(children.length, "location")}. Delete the locations first.`, cascade: [], detail: "" };
  const contacts = data.contacts.filter((c) => c.AccountId === id);
  const tasks = data.tasks.filter((t) => t.AccountId === id || t.WhatId === id);
  const events = data.events.filter((e) => e.AccountId === id || e.WhatId === id);
  const members = data.campaignMembers.filter((m) => m.AccountId === id);
  const cascade: Mutation[] = [
    ...opps.flatMap((o) => [...opportunityChildren(data, o.Id), del("Opportunity", o.Id)]),
    ...members.map((m) => del("CampaignMember", m.Id)),
    ...tasks.map((t) => del("Task", t.Id)),
    ...events.map((e) => del("Event", e.Id)),
    ...contacts.map((c) => del("Contact", c.Id)),
  ];
  const parts = [contacts.length && n(contacts.length, "contact"), opps.length && n(opps.length, "closed opportunity", "closed opportunities"), tasks.length + events.length && n(tasks.length + events.length, "activity", "activities")].filter(Boolean);
  return { cascade, detail: parts.length ? `Also deletes ${parts.join(", ")}.` : "" };
}

export function leadDeletePlan(data: DataSnapshot, id: string): DeletePlan {
  const tasks = data.tasks.filter((t) => t.WhoId === id);
  const events = data.events.filter((e) => e.WhoId === id);
  const members = data.campaignMembers.filter((m) => m.LeadId === id && !m.AccountId);
  const builds = data.newBuilds.filter((b) => b.Lead_Id__c === id);
  const cascade: Mutation[] = [
    ...tasks.map((t) => del("Task", t.Id)),
    ...events.map((e) => del("Event", e.Id)),
    ...members.map((m) => del("CampaignMember", m.Id)),
    ...builds.map((b): Mutation => ({ op: "update", object: "NewBuild", id: b.Id, changes: { Status: "New", Lead_Id__c: "" } })),
  ];
  const acts = tasks.length + events.length;
  return { cascade, detail: acts ? `Also deletes ${n(acts, "activity", "activities")}.` : "" };
}

export function contactDeletePlan(): DeletePlan {
  return { cascade: [], detail: "Activity logged with this contact stays on the account." };
}

export function opportunityDeletePlan(data: DataSnapshot, id: string): DeletePlan {
  const o = data.opportunities.find((x) => x.Id === id);
  const repoint: Mutation[] = o
    ? [
        ...data.tasks.filter((t) => t.WhatId === id).map((t): Mutation => ({ op: "update", object: "Task", id: t.Id, changes: { WhatId: o.AccountId } })),
        ...data.events.filter((e) => e.WhatId === id).map((e): Mutation => ({ op: "update", object: "Event", id: e.Id, changes: { WhatId: o.AccountId } })),
      ]
    : [];
  const quotes = data.quotes.filter((q) => q.OpportunityId === id).length;
  return { cascade: [...repoint, ...opportunityChildren(data, id)], detail: `Products${quotes ? ` and ${n(quotes, "quote")}` : ""} go with it. Activity stays on the account.` };
}

export function campaignDeletePlan(data: DataSnapshot, id: string): DeletePlan {
  const members = data.campaignMembers.filter((m) => m.CampaignId === id);
  const tasks = data.tasks.filter((t) => t.WhatId === id && t.Status === "Not Started");
  return {
    cascade: [...tasks.map((t) => del("Task", t.Id)), ...members.map((m) => del("CampaignMember", m.Id))],
    detail: members.length ? `Also removes ${n(members.length, "member")} and ${n(tasks.length, "scheduled task")}.` : "",
  };
}

export function campaignMemberDeletePlan(data: DataSnapshot, memberId: string): DeletePlan {
  const m = data.campaignMembers.find((x) => x.Id === memberId);
  if (!m) return { cascade: [], detail: "" };
  const target = m.AccountId ?? m.LeadId;
  const tasks = data.tasks.filter((t) => t.WhatId === m.CampaignId && t.Status === "Not Started" && (t.AccountId === target || t.WhoId === target || (m.ContactId && t.WhoId === m.ContactId)));
  return { cascade: tasks.map((t) => del("Task", t.Id)), detail: tasks.length ? `Also removes ${n(tasks.length, "scheduled task")}.` : "" };
}
