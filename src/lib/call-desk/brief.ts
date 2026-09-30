/**
 * Pre-call brief: everything a rep needs in about 60 seconds, built from the
 * store. Rules-based (lib/callBriefRules.ts) by default; with an AI key the
 * summary, questions and talking points are replaced by the model's (see
 * `applyAiBrief`). Pure.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Call, Contact, Opportunity } from "@/types/salesforce";
import { REGION_BY_ID } from "@/data/reference/regions";
import { VENDOR_BY_NAME } from "@/data/reference/software";
import { MODULES, PRODUCT_FIT, type Module } from "@/data/reference/product-fit";
import { addDays, diffDays, fmtMonthYear, fmtShortDate, parseDate, toISODate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { blackoutStatus, closeDateFlags, harvestWindowFor, isSeasonalSegment, nextBoardMeeting, sellingWindowAt } from "@/lib/seasonality";
import { healthFor } from "@/lib/success/health";
import { objectionsFor, pitchFor, questionsFor, talkingPointsFor, type BriefFacts } from "@/lib/callBriefRules";
import { competitorFor, fiscalYearEndLabel } from "@/lib/callScripts";
import { callOpportunity } from "./notes";
import { callContacts } from "./transcript";
import { callDate } from "./time";
import type { BriefAttendee, BriefRisk, CallBrief, TimelineEntry } from "./types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const OPEN_QUOTE = ["Draft", "In Review", "Approved", "Sent"];

const isCustomerAccount = (a: Account, data: Pick<DataSnapshot, "contracts">) =>
  a.Type === "Customer - Direct" || data.contracts.some((c) => c.AccountId === a.Id && (c.Status === "Active" || c.Status === "Signed"));

function overdueInvoices(data: Pick<DataSnapshot, "invoices">, accountId: string, asOf: Date) {
  const today = toISODate(asOf);
  return data.invoices.filter((i) => i.AccountId === accountId && i.Status !== "Paid" && i.Status !== "Void" && i.Status !== "Draft" && (i.Status === "Overdue" || i.DueDate < today) && i.AmountPaid < i.Total);
}

/** Previous calls with this account, newest first */
export function priorCalls(data: Pick<DataSnapshot, "calls">, call: Pick<Call, "Id" | "AccountId" | "Start">): Call[] {
  return data.calls.filter((c) => c.AccountId === call.AccountId && c.Id !== call.Id && c.Status === "Completed" && c.Start < call.Start).sort((a, b) => b.Start.localeCompare(a.Start));
}

function fyeDaysAway(fye: string | undefined, from: Date): number {
  const m = fye?.match(/^(\d{2})-(\d{2})$/);
  if (!m) return 365;
  let d = new Date(Date.UTC(from.getUTCFullYear(), Number(m[1]) - 1, Number(m[2])));
  if (d < from) d = new Date(Date.UTC(from.getUTCFullYear() + 1, Number(m[1]) - 1, Number(m[2])));
  return diffDays(d, from);
}

function health(data: DataSnapshot, accountId: string, asOf: Date) {
  try {
    const h = healthFor(data, accountId, asOf);
    return h && Number.isFinite(h.score) ? h : undefined;
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------------- timeline */

export function timelineForAccount(data: DataSnapshot, accountId: string, until: string, excludeCallId?: string): TimelineEntry[] {
  const contacts = new Map(data.contacts.map((c) => [c.Id, c.Name]));
  const out: TimelineEntry[] = [];
  const until10 = until.slice(0, 10);
  for (const c of data.calls) {
    if (c.AccountId !== accountId || c.Id === excludeCallId || c.Status !== "Completed" || c.Start.slice(0, 10) > until10) continue;
    out.push({
      id: c.Id,
      date: c.Start,
      kind: "Call",
      title: c.Subject,
      detail: c.Notes?.summary?.split("\n").slice(1, 3).join(" ") || (c.NotesStatus === "Pending" ? "Notes pending" : undefined),
    });
  }
  for (const t of data.tasks) {
    if (t.AccountId !== accountId || t.ActivityDate > until10) continue;
    const seq = t.Subject.startsWith("Sequence step");
    if (t.Status !== "Completed" && !seq) continue;
    const kind = seq ? "Sequence" : t.TaskSubtype === "Email" || t.Type === "Email" ? "Email" : t.Type === "Call" ? "Call" : "Task";
    const who = t.WhoId ? contacts.get(t.WhoId) : undefined;
    out.push({ id: t.Id, date: t.ActivityDate, kind, title: t.Subject, detail: [who, t.CallDisposition].filter(Boolean).join(" · ") || undefined });
  }
  for (const e of data.events) {
    if (e.AccountId !== accountId || e.StartDateTime.slice(0, 10) > until10) continue;
    out.push({ id: e.Id, date: e.StartDateTime, kind: "Meeting", title: e.Subject, detail: e.Type });
  }
  for (const q of data.quotes) {
    if (q.AccountId !== accountId || q.CreatedDate.slice(0, 10) > until10) continue;
    out.push({ id: q.Id, date: q.CreatedDate, kind: "Quote", title: `${q.QuoteNumber} ${q.Name}`, detail: `${q.Status} · ${fmtMoney(q.TotalPrice)}`, href: `/quotes/${q.Id}` });
  }
  for (const c of data.contracts) {
    if (c.AccountId !== accountId) continue;
    const d = c.SignedDate ?? c.CreatedDate;
    if (d.slice(0, 10) > until10) continue;
    out.push({ id: c.Id, date: d, kind: "Contract", title: `${c.ContractNumber} ${c.Name}`, detail: `${c.Status} · ends ${fmtShortDate(c.EndDate)}` });
  }
  for (const s of data.supportTickets) {
    if (s.AccountId !== accountId || s.CreatedDate.slice(0, 10) > until10) continue;
    out.push({ id: s.Id, date: s.CreatedDate, kind: "Ticket", title: s.Subject, detail: `${s.Priority} · ${s.Status}`, tone: s.Status !== "Closed" && (s.Priority === "High" || s.Priority === "Urgent") ? "warn" : undefined });
  }
  for (const i of data.invoices) {
    if (i.AccountId !== accountId || i.IssueDate > until10) continue;
    const late = i.Status === "Overdue" || (i.Status === "Sent" && i.DueDate < until10 && i.AmountPaid < i.Total);
    out.push({ id: i.Id, date: i.IssueDate, kind: "Invoice", title: `${i.InvoiceNumber} · ${fmtMoney(i.Total)}`, detail: late ? `Overdue since ${fmtShortDate(i.DueDate)}` : i.Status, tone: late ? "warn" : undefined });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/* ------------------------------------------------------------------ brief */

function lastSpoke(data: DataSnapshot, contact: Contact, before: string): { date: string; kind: string } | undefined {
  let best: { date: string; kind: string } | undefined;
  const consider = (date: string, kind: string) => {
    if (date.slice(0, 16) < before && (!best || date > best.date)) best = { date, kind };
  };
  for (const t of data.tasks) if (t.WhoId === contact.Id && t.Status === "Completed") consider(t.ActivityDate, t.Type === "Email" ? "Email" : t.Type === "Call" ? "Call" : "Task");
  for (const e of data.events) if (e.WhoId === contact.Id) consider(e.StartDateTime, "Meeting");
  for (const c of data.calls) if (c.Status === "Completed" && c.ContactIds.includes(contact.Id)) consider(c.Start, "Call");
  return best;
}

function referenceCustomer(data: DataSnapshot, account: Account, asOf: Date) {
  const since = toISODate(addDays(asOf, -540));
  const today = toISODate(asOf);
  const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
  let best: { opp: Opportunity; a: Account; score: number } | undefined;
  for (const o of data.opportunities) {
    if (!o.IsWon || o.CloseDate < since || o.CloseDate > today || o.AccountId === account.Id) continue;
    const a = accounts.get(o.AccountId);
    if (!a || a.Segment__c !== account.Segment__c || a.ParentId === account.Id || account.ParentId === a.Id) continue;
    const score = (a.Region__c === account.Region__c ? 4 : 0) + (a.BillingState === account.BillingState ? 2 : 0) + o.CloseDate.localeCompare(since) / 10 + (o.CloseDate > toISODate(addDays(asOf, -180)) ? 1 : 0);
    if (!best || score > best.score) best = { opp: o, a, score };
  }
  if (!best) return undefined;
  const products = data.lineItems
    .filter((l) => l.OpportunityId === best!.opp.Id)
    .map((l) => data.products.find((p) => p.Id === l.Product2Id)?.Name)
    .filter((n): n is string => !!n && !/Implementation|Training|Support/.test(n));
  return {
    accountId: best.a.Id,
    name: best.a.Name,
    detail: `Won ${fmtMonthYear(best.opp.CloseDate)} · ${best.a.BillingCity}, ${best.a.BillingState} · ${best.a.Number_of_Locations__c} location${best.a.Number_of_Locations__c === 1 ? "" : "s"}${products.length ? ` · ${[...new Set(products)].slice(0, 3).join(" + ")}` : ""}`,
  };
}

function productFits(data: DataSnapshot, account: Account): { name: string; why: string }[] {
  const fit = PRODUCT_FIT[account.Segment__c];
  const list = data.products.filter((p) => p.IsActive && p.Best_Fit__c.includes(account.Facility_Type__c));
  const score = (name: string) => ((MODULES as readonly string[]).includes(name) ? fit[name as Module] : 0.3);
  return list
    .sort((a, b) => score(b.Name) - score(a.Name))
    .filter((p) => score(p.Name) >= 0.5)
    .slice(0, 3)
    .map((p) => ({ name: p.Name, why: pitchFor(p.Name, account.Segment__c) || p.Description }));
}

export interface BriefOptions {
  /** Brief as of (time travel); defaults to the call date */
  asOf?: Date;
}

/** The complete rules-based brief for a call */
export function buildBrief(call: Call, data: DataSnapshot, opts: BriefOptions = {}): CallBrief | null {
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  if (!account) return null;
  const day = parseDate(callDate(call));
  const asOf = opts.asOf ?? day;
  const opp = callOpportunity(call, data);
  const customer = isCustomerAccount(account, data);
  const contactsOnCall = callContacts(call, data);
  const accountContacts = data.contacts.filter((c) => c.AccountId === account.Id);

  // Snapshot
  const seasonal = isSeasonalSegment(account.Segment__c);
  const b = blackoutStatus(account, day);
  const season: CallBrief["snapshot"]["season"] = !seasonal
    ? { status: "year-round", label: "Year-round" }
    : b.status === "hard"
      ? { status: "hard", label: `In harvest blackout until ${fmtShortDate(b.blackout!.end)}` }
      : b.status === "light"
        ? { status: "light", label: `Spring planting until ${fmtShortDate(b.blackout!.end)}` }
        : { status: "none", label: `Open: ${sellingWindowAt(day).name}` };
  const h = customer ? health(data, account.Id, asOf) : undefined;
  const openOpps = data.opportunities.filter((o) => o.AccountId === account.Id && !o.IsClosed);
  const quotes = data.quotes.filter((q) => q.AccountId === account.Id).sort((a, b2) => b2.CreatedDate.localeCompare(a.CreatedDate));
  const quote = quotes.find((q) => OPEN_QUOTE.includes(q.Status)) ?? quotes[0];
  const contracts = data.contracts.filter((c) => c.AccountId === account.Id).sort((a, b2) => b2.StartDate.localeCompare(a.StartDate));
  const contract = contracts.find((c) => c.Status === "Active" || c.Status === "Signed") ?? contracts[0];
  const overdue = overdueInvoices(data, account.Id, asOf);

  // Who's on the call
  const priors = priorCalls(data, call);
  const last = priors[0];
  const attendees: BriefAttendee[] = contactsOnCall.map((c) => {
    const spoke = lastSpoke(data, c, call.Start);
    const onLast = last?.ContactIds.includes(c.Id);
    return {
      id: c.Id,
      name: c.Name,
      title: c.Title,
      role: c.Buying_Role__c,
      ...(spoke ? { lastSpoke: spoke } : {}),
      note: onLast && last.Notes ? `On the last call (${fmtShortDate(callDate(last))}), ${last.Notes.sentiment.toLowerCase()}` : !spoke ? "First conversation" : undefined,
    };
  });
  const gaps: string[] = [];
  const eb = accountContacts.find((c) => c.Buying_Role__c === "Economic Buyer");
  if (opp && !opp.Economic_Buyer_Identified__c) gaps.push(eb && !contactsOnCall.some((c) => c.Id === eb.Id) ? `Economic buyer not identified (${eb.Name}, ${eb.Title}, likely)` : "Economic buyer not identified");
  else if (eb && !contactsOnCall.some((c) => c.Id === eb.Id) && !customer && opp && ["Proposal", "Negotiation", "Board Approval"].includes(opp.StageName)) gaps.push(`Economic buyer not on this call (${eb.Name})`);
  if (!accountContacts.some((c) => c.Buying_Role__c === "Champion") && !customer) gaps.push("No champion identified");
  if ((account.Segment__c === "Multi-Location Co-op" || opp?.StageName === "Board Approval") && !accountContacts.some((c) => c.Buying_Role__c === "Board Member")) gaps.push("No board member contact");
  if (!contactsOnCall.length) gaps.push("No contacts on the invite");

  // Last time
  const lastTime: CallBrief["lastTime"] = last
    ? {
        callId: last.Id,
        date: last.Start,
        subject: last.Subject,
        callType: last.CallType,
        pending: last.NotesStatus !== "Saved" || !last.Notes,
        summary: (last.Notes?.summary ?? "").split("\n").filter(Boolean).slice(0, 3),
        sentiment: last.Notes?.sentiment,
        commitments: (last.Commitments ?? []).map((c) => ({ ...c, overdue: !c.done && !!c.due && c.due < toISODate(asOf) })),
        questionsAsked: last.QuestionsAsked ?? [],
      }
    : undefined;

  // Facts for the rules
  const withNotes = priors.filter((c) => c.Notes);
  const q = (k: "budget" | "timeline" | "competitors") => withNotes.find((c) => c.Notes!.qualification[k])?.Notes!.qualification[k];
  const mentioned = q("competitors")?.split(",")[0]?.trim();
  const vendor = VENDOR_BY_NAME[account.Current_Software__c];
  const board = nextBoardMeeting(account.Board_Meeting_Months__c, day);
  const harvest = harvestWindowFor(account, day.getUTCFullYear());
  const contractEnd = customer && contract ? contract.EndDate : account.Software_Contract_End__c;
  const facts: BriefFacts = {
    segment: account.Segment__c,
    seasonal,
    callType: call.CallType,
    stage: opp?.StageName,
    season: b.status,
    blackoutEnd: b.blackout ? fmtShortDate(b.blackout.end) : undefined,
    harvestRecent: !!harvest && day >= harvest.start && diffDays(day, harvest.end) <= 60,
    isCustomer: customer,
    economicBuyerKnown: !!opp?.Economic_Buyer_Identified__c || customer,
    fiscalYearEnd: fiscalYearEndLabel(account.Fiscal_Year_End__c),
    fyeDaysAway: fyeDaysAway(account.Fiscal_Year_End__c, day),
    boardMonth: board ? MONTHS[board.getUTCMonth()] : undefined,
    closeDate: opp ? fmtShortDate(opp.CloseDate) : undefined,
    locations: account.Number_of_Locations__c,
    current: account.Current_Software__c,
    currentKind: vendor?.kind,
    competitor: mentioned ?? (vendor?.kind === "competitor" ? account.Current_Software__c : competitorFor(account)),
    competitorMentioned: !!mentioned,
    budgetKnown: !!q("budget"),
    timelineKnown: !!q("timeline"),
    theirOpen: (last?.Commitments ?? []).filter((c) => c.owner === "them" && !c.done).map((c) => c.text),
    contractEndDays: customer && contractEnd ? diffDays(parseDate(contractEnd), asOf) : undefined,
    contractEnd: contractEnd ? fmtShortDate(contractEnd) : undefined,
    openTickets: data.supportTickets.filter((t) => t.AccountId === account.Id && t.Status !== "Closed").length,
    commodity: (account.Primary_Commodities__c[0] ?? "grain").toLowerCase().replace(/(winter|spring) /, ""),
    lastPain: last?.Notes?.painPoints[0],
  };

  // Risks
  const risks: BriefRisk[] = [];
  if (opp) for (const f of closeDateFlags(opp, account, asOf)) risks.push({ kind: f.kind, text: f.message });
  if (mentioned) risks.push({ kind: "competitor", text: `${mentioned} came up on the last call.` });
  if (h && (h.trend === "down" || h.band === "At Risk")) risks.push({ kind: "health", text: `Health ${h.score} (${h.band})${h.delta < 0 ? `, down ${Math.abs(Math.round(h.delta))} in 90 days` : ""}.` });
  if (overdue.length) risks.push({ kind: "invoice", text: `${overdue.length} overdue invoice${overdue.length === 1 ? "" : "s"} (${fmtMoney(overdue.reduce((s, i) => s + i.Total - i.AmountPaid, 0))}).` });
  if (quote && OPEN_QUOTE.includes(quote.Status)) {
    const left = diffDays(parseDate(quote.ExpirationDate), asOf);
    if (left >= 0 && left <= 7) risks.push({ kind: "quote", text: `${quote.QuoteNumber} expires ${fmtShortDate(quote.ExpirationDate)}.` });
  }
  const urgent = data.supportTickets.filter((t) => t.AccountId === account.Id && t.Status !== "Closed" && (t.Priority === "High" || t.Priority === "Urgent"));
  if (urgent.length) risks.push({ kind: "ticket", text: `${urgent.length} open ${urgent[0].Priority.toLowerCase()} support ticket${urgent.length === 1 ? "" : "s"}: ${urgent[0].Subject}.` });

  return {
    callId: call.Id,
    source: "rules",
    aiSummary: [],
    snapshot: {
      accountId: account.Id,
      accountName: account.Name,
      segment: account.Segment__c,
      facility: account.Facility_Type__c,
      locations: account.Number_of_Locations__c,
      commodity: account.Primary_Commodities__c.join(", "),
      region: REGION_BY_ID[account.Region__c]?.name ?? account.Region__c,
      place: `${account.BillingCity}, ${account.BillingState}`,
      isCustomer: customer,
      season,
      ...(h ? { health: { score: Math.round(h.score), band: h.band, trend: h.trend, delta: Math.round(h.delta) } } : {}),
      pipeline: { amount: openOpps.reduce((s, o) => s + o.Amount, 0), count: openOpps.length },
      ...(opp ? { opportunity: { id: opp.Id, name: opp.Name, stage: opp.StageName, amount: opp.Amount, closeDate: opp.CloseDate, economicBuyer: opp.Economic_Buyer_Identified__c } } : {}),
      ...(quote ? { quote: { id: quote.Id, number: quote.QuoteNumber, status: quote.Status, total: quote.TotalPrice } } : {}),
      ...(contract ? { contract: { id: contract.Id, number: contract.ContractNumber, status: contract.Status, endDate: contract.EndDate, arr: contract.ARR } } : {}),
      overdue: { count: overdue.length, amount: overdue.reduce((s, i) => s + i.Total - i.AmountPaid, 0) },
    },
    attendees,
    gaps,
    ...(lastTime ? { lastTime } : {}),
    timeline: timelineForAccount(data, account.Id, call.Start, call.Id),
    questions: questionsFor(facts),
    talking: {
      products: productFits(data, account),
      reference: referenceCustomer(data, account, asOf),
      objections: objectionsFor(facts),
      points: talkingPointsFor(facts),
    },
    risks,
    facts,
  };
}

/* ------------------------------------------------------------------- AI */

export interface AiBriefParts {
  summary: string[];
  questions: string[];
  talkingPoints: string[];
  objections: { objection: string; response: string }[];
}

/** Replace the rules' summary, questions and talking points with the model's */
export function applyAiBrief(brief: CallBrief, ai: AiBriefParts): CallBrief {
  const questions = ai.questions.filter(Boolean).slice(0, 7).map((text, i) => ({ id: `ai-${i}`, text, why: "AI" }));
  return {
    ...brief,
    source: "ai",
    aiSummary: ai.summary.filter(Boolean).slice(0, 3),
    questions: questions.length >= 3 ? questions : brief.questions,
    talking: {
      ...brief.talking,
      points: ai.talkingPoints.length ? ai.talkingPoints.slice(0, 4) : brief.talking.points,
      objections: ai.objections.length ? ai.objections.slice(0, 3) : brief.talking.objections,
    },
  };
}

/** Compact text of the account's store data for the AI brief */
export function briefDigest(brief: CallBrief, call: Call): string {
  const s = brief.snapshot;
  const lines = [
    `Call: ${call.CallType}, ${callDate(call)} ${call.Start.slice(11, 16)}, subject "${call.Subject}".`,
    `Account: ${s.accountName} (${s.segment}, ${s.facility}), ${s.place}, region ${s.region}, ${s.locations} locations, commodities ${s.commodity}, ${s.isCustomer ? "customer" : "prospect"}.`,
    `Season: ${s.season.label}. Fiscal year ends ${brief.facts.fiscalYearEnd}. Next board meeting: ${brief.facts.boardMonth ?? "unknown"}.`,
    `Current software: ${brief.facts.current}. Likely competitor: ${brief.facts.competitor ?? "none"}.`,
    s.opportunity ? `Opportunity: ${s.opportunity.name}, stage ${s.opportunity.stage}, ${fmtMoney(s.opportunity.amount)}, close ${s.opportunity.closeDate}, economic buyer ${s.opportunity.economicBuyer ? "identified" : "NOT identified"}.` : "No open opportunity.",
    s.quote ? `Quote: ${s.quote.number} ${s.quote.status} ${fmtMoney(s.quote.total)}.` : "",
    s.contract ? `Contract: ${s.contract.number} ${s.contract.status}, ends ${s.contract.endDate}, ARR ${fmtMoney(s.contract.arr)}.` : "",
    s.health ? `Health: ${s.health.score} (${s.health.band}, trend ${s.health.trend}).` : "",
    s.overdue.count ? `Overdue invoices: ${s.overdue.count} (${fmtMoney(s.overdue.amount)}).` : "",
    `On the call: ${brief.attendees.map((a) => `${a.name} (${a.title}, ${a.role}${a.lastSpoke ? `, last spoke ${a.lastSpoke.date.slice(0, 10)}` : ", first conversation"})`).join("; ") || "none listed"}.`,
    brief.gaps.length ? `Gaps: ${brief.gaps.join("; ")}.` : "",
    brief.lastTime ? `Last call ${brief.lastTime.date.slice(0, 10)} (${brief.lastTime.callType}): ${brief.lastTime.summary.join(" ")} Open commitments: ${brief.lastTime.commitments.filter((c) => !c.done).map((c) => `${c.owner === "us" ? "ours" : "theirs"}: ${c.text}${c.due ? ` due ${c.due}` : ""}`).join("; ") || "none"}.` : "No previous calls.",
    `Risks: ${brief.risks.map((r) => r.text).join(" ") || "none"}.`,
    `Recent activity: ${brief.timeline.slice(0, 12).map((t) => `${t.date.slice(0, 10)} ${t.kind}: ${t.title}${t.detail ? ` (${t.detail})` : ""}`).join("; ")}.`,
    `Products that fit: ${brief.talking.products.map((p) => p.name).join(", ")}. Reference customer: ${brief.talking.reference ? `${brief.talking.reference.name} (${brief.talking.reference.detail})` : "none"}.`,
  ];
  return lines.filter(Boolean).join("\n").slice(0, 8000);
}

/** Plain-text brief for Copy brief */
export function briefText(brief: CallBrief, call: Call): string {
  const s = brief.snapshot;
  const out: string[] = [];
  out.push(`${call.Subject} — ${callDate(call)} ${call.Start.slice(11, 16)}`, "");
  if (brief.aiSummary.length) out.push(...brief.aiSummary, "");
  out.push("SNAPSHOT");
  out.push(`${s.accountName} · ${s.segment} · ${s.locations} location${s.locations === 1 ? "" : "s"} · ${s.commodity} · ${s.region}`);
  out.push(`Season: ${s.season.label}`);
  if (s.health) out.push(`Health: ${s.health.score} (${s.health.band})`);
  out.push(`Open pipeline: ${fmtMoney(s.pipeline.amount)} (${s.pipeline.count})`);
  if (s.opportunity) out.push(`Deal: ${s.opportunity.name} · ${s.opportunity.stage} · ${fmtMoney(s.opportunity.amount)} · close ${fmtShortDate(s.opportunity.closeDate)}`);
  if (s.quote) out.push(`Quote: ${s.quote.number} · ${s.quote.status} · ${fmtMoney(s.quote.total)}`);
  if (s.contract) out.push(`Contract: ${s.contract.number} · ${s.contract.status} · ends ${fmtShortDate(s.contract.endDate)}`);
  if (s.overdue.count) out.push(`Overdue: ${s.overdue.count} invoice(s), ${fmtMoney(s.overdue.amount)}`);
  out.push("", "WHO'S ON THE CALL");
  for (const a of brief.attendees) out.push(`- ${a.name}, ${a.title} (${a.role})${a.lastSpoke ? ` · last spoke ${fmtShortDate(a.lastSpoke.date)}` : ""}`);
  for (const g of brief.gaps) out.push(`! ${g}`);
  if (brief.lastTime) {
    out.push("", `LAST TIME (${fmtShortDate(brief.lastTime.date)})`);
    out.push(...(brief.lastTime.summary.length ? brief.lastTime.summary : ["Notes pending"]));
    for (const c of brief.lastTime.commitments) out.push(`- [${c.done ? "x" : " "}] ${c.owner === "us" ? "Us" : "Them"}: ${c.text}${c.due ? ` (due ${fmtShortDate(c.due)})` : ""}${c.overdue ? " OVERDUE" : ""}`);
  }
  out.push("", "QUESTIONS TO ASK");
  brief.questions.forEach((q, i) => out.push(`${i + 1}. ${q.text}`));
  out.push("", "TALKING POINTS");
  for (const p of brief.talking.points) out.push(`- ${p}`);
  for (const p of brief.talking.products) out.push(`- ${p.name}: ${p.why}`);
  if (brief.talking.reference) out.push(`- Reference: ${brief.talking.reference.name} (${brief.talking.reference.detail})`);
  for (const o of brief.talking.objections) out.push(`- "${o.objection}" → ${o.response}`);
  if (brief.risks.length) {
    out.push("", "RISKS");
    for (const r of brief.risks) out.push(`- ${r.text}`);
  }
  return out.join("\n");
}
