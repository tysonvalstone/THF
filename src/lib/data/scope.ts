/**
 * Record visibility for the Sales rep role: only their own accounts and the
 * records hanging off them. Shared reference data (products, price books,
 * campaigns, sequences, new builds, clauses) stays visible. Every page reads
 * the scoped snapshot, so KPIs, charts and the map show the rep's own book.
 */
import type { DataSnapshot } from "./types";

export function scopeToOwner(d: DataSnapshot, ownerId: string): DataSnapshot {
  const accounts = d.accounts.filter((a) => a.OwnerId === ownerId);
  const acct = new Set(accounts.map((a) => a.Id));
  const opportunities = d.opportunities.filter((o) => o.OwnerId === ownerId || acct.has(o.AccountId));
  const opp = new Set(opportunities.map((o) => o.Id));
  const quotes = d.quotes.filter((q) => q.OwnerId === ownerId || acct.has(q.AccountId));
  const quote = new Set(quotes.map((q) => q.Id));
  const contracts = d.contracts.filter((c) => c.OwnerId === ownerId || acct.has(c.AccountId));
  const contract = new Set(contracts.map((c) => c.Id));
  const invoices = d.invoices.filter((i) => acct.has(i.AccountId));
  const projects = d.onboardingProjects.filter((p) => acct.has(p.AccountId));
  const project = new Set(projects.map((p) => p.Id));
  const mine = <T extends { OwnerId: string; AccountId?: string }>(r: T) => r.OwnerId === ownerId || (!!r.AccountId && acct.has(r.AccountId));
  return {
    ...d,
    accounts,
    contacts: d.contacts.filter((c) => acct.has(c.AccountId)),
    leads: d.leads.filter((l) => l.OwnerId === ownerId),
    opportunities,
    lineItems: d.lineItems.filter((li) => opp.has(li.OpportunityId)),
    tasks: d.tasks.filter(mine),
    events: d.events.filter(mine),
    quotes,
    quoteLineItems: d.quoteLineItems.filter((l) => quote.has(l.QuoteId)),
    contracts,
    contractClauses: d.contractClauses.filter((c) => contract.has(c.ContractId)),
    invoices,
    payments: d.payments.filter((p) => acct.has(p.AccountId)),
    onboardingProjects: projects,
    onboardingTasks: d.onboardingTasks.filter((t) => project.has(t.ProjectId)),
    healthSignals: d.healthSignals.filter((h) => acct.has(h.AccountId)),
    supportTickets: d.supportTickets.filter((t) => acct.has(t.AccountId)),
    quotas: d.quotas.filter((q) => q.OwnerId === ownerId),
    commissionPlans: d.commissionPlans.filter((p) => p.OwnerId === ownerId),
    calls: d.calls.filter((c) => c.OwnerId === ownerId),
    approvals: d.approvals.filter((a) => a.RequestedById === ownerId),
  };
}
