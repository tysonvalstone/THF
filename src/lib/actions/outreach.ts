/**
 * One-click outreach → Salesforce-style record changes.
 *
 * Each function is pure: it takes the current data and returns the
 * mutations to commit plus a human summary of what changed. This is the
 * "admin disappears" layer: reps click once, and Tasks, Events,
 * Opportunity stages, NextSteps and Lead statuses update themselves.
 */
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";
import { PRODUCTS } from "@/data/reference/products";
import type {
  Account,
  Campaign,
  CampaignContent,
  CampaignMember,
  Commodity,
  Event,
  FacilityType,
  Lead,
  Opportunity,
  OpportunityStage,
  RegionId,
  Task,
} from "@/types/salesforce";
import { addDays, fmtShortDate, toISODate } from "@/lib/dates";

export interface ActionContext {
  data: DataSnapshot;
  asOf: Date;
  userId: string;
}

export interface ActionResult {
  mutations: Mutation[];
  summary: string[];
}

const STAGES: OpportunityStage[] = ["Prospecting", "Qualification", "Needs Analysis", "Proposal", "Negotiation", "Board Approval"];
const PROBABILITY: Record<string, number> = { Prospecting: 10, Qualification: 20, "Needs Analysis": 40, Proposal: 60, Negotiation: 75, "Board Approval": 90 };
const FORECAST: Record<string, Opportunity["ForecastCategoryName"]> = {
  Prospecting: "Pipeline",
  Qualification: "Pipeline",
  "Needs Analysis": "Pipeline",
  Proposal: "Best Case",
  Negotiation: "Commit",
  "Board Approval": "Commit",
};

export const ECONOMIC_BUYER_GATE = "Identify the economic buyer (controller or GM) before moving past Prospecting.";

/** The contact on this call/email, if they are the account's economic buyer */
function economicBuyerOnCall(ctx: ActionContext, whoId?: string) {
  if (!whoId) return undefined;
  const c = ctx.data.contacts.find((x) => x.Id === whoId);
  return c?.Buying_Role__c === "Economic Buyer" ? c : undefined;
}

/**
 * Advance a deal one stage, honoring the buying-committee rule: a deal can't
 * leave Prospecting until the economic buyer is identified.
 */
function advance(ctx: ActionContext, opp: Opportunity, target: OpportunityStage, whoId: string | undefined, nextStep: string, out: ActionResult) {
  const eb = economicBuyerOnCall(ctx, whoId);
  const identified = opp.Economic_Buyer_Identified__c || !!eb;
  const blocked = opp.StageName === "Prospecting" && target !== "Prospecting" && !identified;
  const stage = blocked ? opp.StageName : target;
  out.mutations.push({
    op: "update",
    object: "Opportunity",
    id: opp.Id,
    changes: {
      StageName: stage,
      Probability: PROBABILITY[stage] ?? opp.Probability,
      ForecastCategoryName: FORECAST[stage] ?? opp.ForecastCategoryName,
      NextStep: blocked ? "Identify the economic buyer (controller or GM)" : nextStep,
      LastModifiedDate: stamp(ctx.asOf),
      ...(eb && !opp.Economic_Buyer_Identified__c ? { Economic_Buyer_Identified__c: true, Economic_Buyer__c: eb.Id } : {}),
    },
  });
  if (eb && !opp.Economic_Buyer_Identified__c) out.summary.push(`Economic buyer identified: ${eb.Name}`);
  if (blocked) out.summary.push(`Stayed in Prospecting. ${ECONOMIC_BUYER_GATE}`);
  else if (stage !== opp.StageName) out.summary.push(`Opportunity advanced to ${stage}`);
  else out.summary.push("Opportunity next step updated");
}

/** "Now" on the as-of date, keeping today's clock time so records sort naturally */
function stamp(asOf: Date): string {
  const now = new Date();
  const d = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()));
  return d.toISOString().replace(/\.\d{3}Z$/, ".000+0000");
}

/** Next business day at least `days` out */
export function businessDaysOut(asOf: Date, days: number): Date {
  let d = addDays(asOf, days);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, 1);
  return d;
}

interface Resolved {
  account?: Account;
  lead?: Lead;
  openOpp?: Opportunity;
  openTasks: Task[];
}

function resolve(ctx: ActionContext, targetId: string): Resolved {
  const account = ctx.data.accounts.find((a) => a.Id === targetId);
  const lead = account ? undefined : ctx.data.leads.find((l) => l.Id === targetId);
  const openOpp = account
    ? ctx.data.opportunities.filter((o) => o.AccountId === account.Id && !o.IsClosed).sort((a, b) => b.Probability - a.Probability)[0]
    : undefined;
  const openTasks = ctx.data.tasks.filter(
    (t) => t.Status !== "Completed" && (account ? t.AccountId === account.Id : t.WhoId === targetId) && t.ActivityDate <= toISODate(ctx.asOf),
  );
  return { account, lead, openOpp, openTasks };
}

function completeOpenTasks(ctx: ActionContext, r: Resolved, out: ActionResult) {
  for (const t of r.openTasks) {
    out.mutations.push({ op: "update", object: "Task", id: t.Id, changes: { Status: "Completed", CompletedDateTime: stamp(ctx.asOf) } });
  }
  if (r.openTasks.length) out.summary.push(`Closed ${r.openTasks.length} overdue follow-up task${r.openTasks.length > 1 ? "s" : ""}`);
}

function touchLead(r: Resolved, out: ActionResult, patch: Partial<Lead> = {}) {
  if (!r.lead) return;
  const changes: Partial<Lead> = { ...patch };
  if (r.lead.Status === "Open - Not Contacted" && !patch.Status) changes.Status = "Working - Contacted";
  if (!Object.keys(changes).length) return;
  out.mutations.push({ op: "update", object: "Lead", id: r.lead.Id, changes });
  if (changes.Status) out.summary.push(`Lead status → ${changes.Status}`);
  if (changes.Rating) out.summary.push(`Lead rating → ${changes.Rating}`);
}

function newTask(ctx: ActionContext, r: Resolved, fields: Partial<Task> & Pick<Task, "Subject" | "Type" | "TaskSubtype" | "Status" | "ActivityDate">): Task {
  return {
    Id: newId("Task"),
    Priority: "Normal",
    Description: "",
    OwnerId: ctx.userId,
    CreatedDate: stamp(ctx.asOf),
    ...(r.account ? { AccountId: r.account.Id, WhatId: r.openOpp?.Id ?? r.account.Id } : {}),
    ...(fields.Status === "Completed" ? { CompletedDateTime: stamp(ctx.asOf) } : {}),
    ...fields,
  };
}

function estimateOpportunity(ctx: ActionContext, account: Account, nextStep: string, stage: OpportunityStage): { opp: Opportunity; lines: Mutation[] } {
  const oppId = newId("Opportunity");
  const fits = PRODUCTS.filter((p) => p.Best_Fit__c.includes(account.Facility_Type__c)).slice(0, 2);
  const impl = PRODUCTS.find((p) => p.ProductCode === "SVC-IMPL")!;
  const lines: Mutation[] = [];
  let amount = 0;
  for (const p of [...fits, impl]) {
    const qty = p.Pricing_Unit__c === "per location / year" ? account.Number_of_Locations__c : 1;
    const unit = p.Pricing_Unit__c === "one-time" ? p.List_Price__c : p.List_Price__c * 3;
    amount += unit * qty;
    lines.push({
      op: "create",
      object: "OpportunityLineItem",
      record: { Id: newId("OpportunityLineItem"), OpportunityId: oppId, Product2Id: p.Id, Quantity: qty, UnitPrice: unit, TotalPrice: unit * qty },
    });
  }
  const opp: Opportunity = {
    Id: oppId,
    AccountId: account.Id,
    Name: `${account.Name} - ${fits.map((p) => p.Name.replace("ThiboLi ", "")).join(" + ")}`,
    Type: account.Type === "Customer - Direct" ? "Add-On Business" : "New Business",
    StageName: stage,
    Amount: amount,
    CloseDate: toISODate(addDays(ctx.asOf, 90)),
    Probability: PROBABILITY[stage],
    ForecastCategoryName: FORECAST[stage],
    NextStep: nextStep,
    LeadSource: "Direct Mail",
    OwnerId: account.OwnerId,
    IsClosed: false,
    IsWon: false,
    CreatedDate: stamp(ctx.asOf),
    LastModifiedDate: stamp(ctx.asOf),
    Economic_Buyer_Identified__c: false,
  };
  return { opp, lines };
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------
export function sendEmail(
  ctx: ActionContext,
  input: { targetId: string; whoId?: string; toEmail: string; subject: string; body: string; scheduleFor?: string },
): ActionResult {
  const r = resolve(ctx, input.targetId);
  const out: ActionResult = { mutations: [], summary: [] };
  const scheduled = input.scheduleFor && input.scheduleFor > toISODate(ctx.asOf);
  const sendDate = scheduled ? input.scheduleFor! : toISODate(ctx.asOf);

  out.mutations.push({
    op: "create",
    object: "Task",
    record: newTask(ctx, r, {
      Subject: `${scheduled ? "Email (scheduled)" : "Email"}: ${input.subject}`,
      Type: "Email",
      TaskSubtype: "Email",
      Status: scheduled ? "Not Started" : "Completed",
      ActivityDate: sendDate,
      WhoId: input.whoId,
      Description: `To: ${input.toEmail}\n\n${input.body}`,
    }),
  });
  out.summary.push(scheduled ? `Email scheduled for ${fmtShortDate(sendDate)}` : "Email sent and logged as a completed Task");

  const followUp = businessDaysOut(new Date(`${sendDate}T00:00:00Z`), 3);
  out.mutations.push({
    op: "create",
    object: "Task",
    record: newTask(ctx, r, {
      Subject: `Follow up: "${input.subject}"`,
      Type: "Follow-up",
      TaskSubtype: "Task",
      Status: "Not Started",
      ActivityDate: toISODate(followUp),
      WhoId: input.whoId,
      Description: "Auto-created by HarvestSignal: check for a reply and call if there's no response.",
    }),
  });
  out.summary.push(`Follow-up task created for ${fmtShortDate(followUp)}`);

  if (!scheduled) completeOpenTasks(ctx, r, out);
  if (r.openOpp) {
    const nextStep = `Follow up on email "${input.subject}" by ${fmtShortDate(followUp)}`;
    out.mutations.push({ op: "update", object: "Opportunity", id: r.openOpp.Id, changes: { NextStep: nextStep, LastModifiedDate: stamp(ctx.asOf) } });
    out.summary.push("Opportunity next step updated");
  }
  touchLead(r, out);
  return out;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------
export type CallOutcome = "Connected" | "Interested - Book Demo" | "Left Voicemail" | "No Answer" | "Not Interested - Revisit";
export const CALL_OUTCOMES: CallOutcome[] = ["Connected", "Interested - Book Demo", "Left Voicemail", "No Answer", "Not Interested - Revisit"];

export function logCall(
  ctx: ActionContext,
  input: { targetId: string; whoId?: string; whoName?: string; outcome: CallOutcome; notes: string; demoDate?: string },
): ActionResult {
  const r = resolve(ctx, input.targetId);
  const out: ActionResult = { mutations: [], summary: [] };
  const connected = input.outcome === "Connected" || input.outcome.startsWith("Interested") || input.outcome.startsWith("Not Interested");

  out.mutations.push({
    op: "create",
    object: "Task",
    record: newTask(ctx, r, {
      Subject: `Call: ${input.outcome === "Interested - Book Demo" ? "interested, demo booked" : input.outcome.toLowerCase()}${input.whoName ? ` with ${input.whoName}` : ""}`,
      Type: "Call",
      TaskSubtype: "Call",
      Status: "Completed",
      ActivityDate: toISODate(ctx.asOf),
      WhoId: input.whoId,
      Description: input.notes || `${input.outcome}.`,
      CallDisposition: input.outcome,
      CallDurationInSeconds: connected ? 420 : 30,
    }),
  });
  out.summary.push("Call logged as a completed Task");
  completeOpenTasks(ctx, r, out);

  if (input.outcome === "Left Voicemail" || input.outcome === "No Answer") {
    const due = businessDaysOut(ctx.asOf, 2);
    out.mutations.push({
      op: "create",
      object: "Task",
      record: newTask(ctx, r, {
        Subject: `Call back${input.whoName ? ` ${input.whoName}` : ""}`,
        Type: "Call",
        TaskSubtype: "Task",
        Status: "Not Started",
        ActivityDate: toISODate(due),
        WhoId: input.whoId,
        Description: `Auto-created after "${input.outcome}".`,
      }),
    });
    out.summary.push(`Call-back task created for ${fmtShortDate(due)}`);
    if (r.openOpp) {
      out.mutations.push({ op: "update", object: "Opportunity", id: r.openOpp.Id, changes: { NextStep: `Call back ${fmtShortDate(due)}`, LastModifiedDate: stamp(ctx.asOf) } });
      out.summary.push("Opportunity next step updated");
    }
    touchLead(r, out);
    return out;
  }

  if (input.outcome === "Interested - Book Demo") {
    const demo = input.demoDate ? new Date(`${input.demoDate}T00:00:00Z`) : businessDaysOut(ctx.asOf, 7);
    const start = new Date(Date.UTC(demo.getUTCFullYear(), demo.getUTCMonth(), demo.getUTCDate(), 15, 0, 0));
    let oppId = r.openOpp?.Id;
    if (r.openOpp) {
      const idx = STAGES.indexOf(r.openOpp.StageName);
      const nextStage = idx >= 0 && idx < 2 ? STAGES[idx + 1] : r.openOpp.StageName;
      advance(ctx, r.openOpp, nextStage, input.whoId, `Demo ${fmtShortDate(demo)}`, out);
    } else if (r.account) {
      const eb = economicBuyerOnCall(ctx, input.whoId);
      const stage: OpportunityStage = eb ? "Qualification" : "Prospecting";
      const { opp, lines } = estimateOpportunity(ctx, r.account, eb ? `Demo ${fmtShortDate(demo)}` : "Identify the economic buyer (controller or GM)", stage);
      if (eb) Object.assign(opp, { Economic_Buyer_Identified__c: true, Economic_Buyer__c: eb.Id });
      oppId = opp.Id;
      out.mutations.push({ op: "create", object: "Opportunity", record: opp }, ...lines);
      out.summary.push(`New opportunity created (${stage}, ${Math.round(opp.Amount / 1000)}K)`);
      if (!eb) out.summary.push(ECONOMIC_BUYER_GATE);
    }
    const ev: Event = {
      Id: newId("Event"),
      Subject: `Demo: ${r.account?.Name ?? r.lead?.Company ?? "prospect"}`,
      Type: "Demo",
      StartDateTime: start.toISOString().replace(/\.\d{3}Z$/, ".000+0000"),
      EndDateTime: new Date(start.getTime() + 3600_000).toISOString().replace(/\.\d{3}Z$/, ".000+0000"),
      Location: "Zoom",
      WhoId: input.whoId,
      WhatId: oppId ?? r.account?.Id,
      AccountId: r.account?.Id,
      OwnerId: ctx.userId,
      Description: input.notes || "Demo booked from a call.",
      CreatedDate: stamp(ctx.asOf),
    };
    out.mutations.push({ op: "create", object: "Event", record: ev });
    out.summary.push(`Demo event added to the calendar for ${fmtShortDate(demo)}`);
    touchLead(r, out, { Status: "Working - Contacted", Rating: "Hot" });
    return out;
  }

  if (input.outcome === "Not Interested - Revisit") {
    const revisit = businessDaysOut(ctx.asOf, 90);
    out.mutations.push({
      op: "create",
      object: "Task",
      record: newTask(ctx, r, {
        Subject: "Revisit: check timing next season",
        Type: "Follow-up",
        TaskSubtype: "Task",
        Status: "Not Started",
        ActivityDate: toISODate(revisit),
        WhoId: input.whoId,
        Description: "Auto-created: not interested right now.",
      }),
    });
    out.summary.push(`Revisit task created for ${fmtShortDate(revisit)}`);
    if (r.openOpp) {
      out.mutations.push({ op: "update", object: "Opportunity", id: r.openOpp.Id, changes: { NextStep: `Revisit ${fmtShortDate(revisit)}`, LastModifiedDate: stamp(ctx.asOf) } });
      out.summary.push("Opportunity next step updated");
    }
    touchLead(r, out, { Status: "Nurturing" });
    return out;
  }

  // Connected
  if (r.openOpp) {
    const nextStage = r.openOpp.StageName === "Prospecting" ? "Qualification" : r.openOpp.StageName;
    advance(ctx, r.openOpp, nextStage, input.whoId, "Send recap and confirm next meeting", out);
  }
  const due = businessDaysOut(ctx.asOf, 1);
  out.mutations.push({
    op: "create",
    object: "Task",
    record: newTask(ctx, r, {
      Subject: "Send call recap",
      Type: "Email",
      TaskSubtype: "Task",
      Status: "Not Started",
      ActivityDate: toISODate(due),
      WhoId: input.whoId,
      Description: "Auto-created: recap the call and propose next steps.",
    }),
  });
  out.summary.push(`Recap task created for ${fmtShortDate(due)}`);
  touchLead(r, out);
  return out;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export interface MemberInput {
  targetId: string;
  whoId?: string;
}

function memberTasks(ctx: ActionContext, campaign: Pick<Campaign, "Id" | "Name" | "Type" | "StartDate">, members: MemberInput[], content?: CampaignContent): Mutation[] {
  const out: Mutation[] = [];
  for (const m of members) {
    const r = resolve(ctx, m.targetId);
    const subject =
      campaign.Type === "Direct Mail" || campaign.Type === "Multi-Channel"
        ? `Mail drop: ${campaign.Name}`
        : campaign.Type === "Call Blitz"
          ? `Call: ${campaign.Name}`
          : `Email (scheduled): ${content?.emails[0]?.subject ?? campaign.Name}`;
    out.push({
      op: "create",
      object: "Task",
      record: newTask(ctx, r, {
        Subject: subject,
        Type: campaign.Type === "Call Blitz" ? "Call" : campaign.Type === "Email" ? "Email" : "Mail Drop",
        TaskSubtype: campaign.Type === "Email" ? "Email" : "Task",
        Status: "Not Started",
        ActivityDate: campaign.StartDate,
        WhoId: m.whoId,
        WhatId: campaign.Id,
        Description: `Auto-created from campaign "${campaign.Name}".`,
      }),
    });
  }
  return out;
}

export function addToCampaign(ctx: ActionContext, input: { campaignId: string; members: MemberInput[] }): ActionResult {
  const campaign = ctx.data.campaigns.find((c) => c.Id === input.campaignId);
  if (!campaign) return { mutations: [], summary: ["Campaign not found"] };
  const existing = new Set(ctx.data.campaignMembers.filter((m) => m.CampaignId === campaign.Id).map((m) => m.AccountId ?? m.LeadId));
  const fresh = input.members.filter((m) => !existing.has(m.targetId));
  const mutations: Mutation[] = fresh.map((m) => ({
    op: "create" as const,
    object: "CampaignMember" as const,
    record: {
      Id: newId("CampaignMember"),
      CampaignId: campaign.Id,
      ...(m.targetId.startsWith("00Q") ? { LeadId: m.targetId } : { ContactId: m.whoId, AccountId: m.targetId }),
      Status: "Planned",
      HasResponded: false,
      CreatedDate: stamp(ctx.asOf),
    } satisfies CampaignMember,
  }));
  const startDate = campaign.StartDate > toISODate(ctx.asOf) ? campaign.StartDate : toISODate(ctx.asOf);
  mutations.push(...memberTasks(ctx, { ...campaign, StartDate: startDate }, fresh, campaign.Content__c));
  mutations.push({ op: "update", object: "Campaign", id: campaign.Id, changes: { NumberSent: campaign.NumberSent + fresh.length } });
  const skipped = input.members.length - fresh.length;
  return {
    mutations,
    summary: [
      `${fresh.length} member${fresh.length === 1 ? "" : "s"} added to "${campaign.Name}"`,
      ...(fresh.length ? [`${fresh.length} ${campaign.Type === "Call Blitz" ? "call" : campaign.Type === "Email" ? "email" : "mail-drop"} task${fresh.length === 1 ? "" : "s"} scheduled`] : []),
      ...(skipped ? [`${skipped} already in the campaign`] : []),
    ],
  };
}

export function createCampaign(
  ctx: ActionContext,
  input: {
    name: string;
    type: Campaign["Type"];
    startDate: string;
    endDate: string;
    budget: number;
    season: string;
    regions: RegionId[];
    facilityTypes: FacilityType[];
    commodity?: Commodity;
    description: string;
    content: CampaignContent;
    expectedRevenue: number;
    members: MemberInput[];
  },
): { result: ActionResult; campaignId: string } {
  const id = newId("Campaign");
  const campaign: Campaign = {
    Id: id,
    Name: input.name,
    Type: input.type,
    Status: input.startDate > toISODate(ctx.asOf) ? "Planned" : "In Progress",
    IsActive: true,
    StartDate: input.startDate,
    EndDate: input.endDate,
    BudgetedCost: input.budget,
    ActualCost: 0,
    ExpectedRevenue: input.expectedRevenue,
    ExpectedResponse: input.type === "Direct Mail" ? 6 : input.type === "Call Blitz" ? 12 : 5,
    NumberSent: input.members.length,
    Description: input.description,
    OwnerId: ctx.userId,
    CreatedDate: stamp(ctx.asOf),
    Season__c: input.season,
    Target_Regions__c: input.regions,
    Target_Facility_Types__c: input.facilityTypes,
    ...(input.commodity ? { Target_Commodity__c: input.commodity } : {}),
    Content__c: input.content,
  };
  const mutations: Mutation[] = [{ op: "create", object: "Campaign", record: campaign }];
  for (const m of input.members) {
    mutations.push({
      op: "create",
      object: "CampaignMember",
      record: {
        Id: newId("CampaignMember"),
        CampaignId: id,
        ...(m.targetId.startsWith("00Q") ? { LeadId: m.targetId } : { ContactId: m.whoId, AccountId: m.targetId }),
        Status: "Planned",
        HasResponded: false,
        CreatedDate: stamp(ctx.asOf),
      },
    });
  }
  mutations.push(...memberTasks(ctx, campaign, input.members, input.content));
  return {
    campaignId: id,
    result: {
      mutations,
      summary: [
        `Campaign "${input.name}" created (${campaign.Status})`,
        `${input.members.length} CampaignMember records created`,
        `${input.members.length} ${input.type === "Call Blitz" ? "call" : input.type === "Email" ? "email" : "mail-drop"} tasks scheduled for ${fmtShortDate(input.startDate)}`,
      ],
    },
  };
}
