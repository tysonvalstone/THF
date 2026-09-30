/**
 * Mapping between the /api/ai "call-notes" response and CallNotes, plus the
 * call details sent with the request. Pure.
 */
import type { CallNotesAi } from "@/lib/ai/types";
import type { Call, CallNotes, OpportunityStage } from "@/types/salesforce";
import { fmtShortDate } from "@/lib/dates";
import { callOpportunity, suggestedUpdates, type NotesData } from "./notes";
import { callContacts, repName } from "./transcript";
import { callDate } from "./time";
import type { SuggestedUpdate } from "./types";

const STAGES: OpportunityStage[] = ["Prospecting", "Qualification", "Needs Analysis", "Proposal", "Negotiation", "Board Approval"];

/** Call details for the model: who, when, the deal and its gate */
export function callMeta(call: Call, data: NotesData): string {
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const opp = callOpportunity(call, data);
  const contacts = callContacts(call, data);
  return [
    `Call type: ${call.CallType}. Date: ${callDate(call)} ${call.Start.slice(11, 16)}.`,
    `Rep: ${repName(call.OwnerId)} (ThiboLiSoft).`,
    `Account: ${account ? `${account.Name}, ${account.Segment__c}, ${account.BillingCity} ${account.BillingState}, ${account.Number_of_Locations__c} locations, current software ${account.Current_Software__c}` : "unknown"}.`,
    `Contacts: ${contacts.map((c) => `${c.Name} (${c.Title}, ${c.Buying_Role__c})`).join("; ") || "none"}.`,
    opp ? `Opportunity: ${opp.Name}, stage ${opp.StageName}, close ${opp.CloseDate}, economic buyer ${opp.Economic_Buyer_Identified__c ? "identified" : "not identified"}.` : "No open opportunity.",
  ].join("\n");
}

/** CallNotes from the model's output, and suggested updates (rules on the AI notes, plus the model's own) */
export function notesFromAi(ai: CallNotesAi, call: Call, data: NotesData): { notes: CallNotes; updates: SuggestedUpdate[] } {
  const rep = repName(call.OwnerId);
  const contacts = callContacts(call, data);
  const q = ai.qualification;
  const notes: CallNotes = {
    summary: ai.summary.join("\n"),
    keyPoints: ai.keyPoints,
    painPoints: ai.painPoints,
    objections: ai.objections,
    qualification: {
      ...(q.budget ? { budget: q.budget } : {}),
      ...(q.decisionMaker ? { decisionMaker: q.decisionMaker } : {}),
      ...(q.timeline ? { timeline: q.timeline } : {}),
      ...(q.competitors ? { competitors: q.competitors } : {}),
      ...(q.locations ? { locations: `${q.locations} locations` } : {}),
    },
    nextSteps: ai.nextSteps.map((s) => ({
      text: s.text,
      owner: s.owner === "rep" ? rep : s.ownerName || contacts[0]?.Name || "Customer",
      ...(s.due ? { due: s.due } : {}),
    })),
    sentiment: ai.sentiment,
    followUpEmail: ai.followUpEmail.body ? ai.followUpEmail : undefined,
    source: "ai",
  };
  const updates = suggestedUpdates(call, notes, data);
  const opp = callOpportunity(call, data);
  if (opp && !opp.IsClosed) {
    const u = ai.updates;
    if (u.closeDate && u.closeDate !== opp.CloseDate && !updates.some((x) => x.key === "closeDate")) {
      updates.push({ key: "closeDate", label: "Close date", object: "Opportunity", recordId: opp.Id, from: fmtShortDate(opp.CloseDate), to: fmtShortDate(u.closeDate), changes: { CloseDate: u.closeDate } });
    }
    if (u.economicBuyerName && !opp.Economic_Buyer_Identified__c && !updates.some((x) => x.key === "economicBuyer")) {
      const eb = data.contacts.find((c) => c.AccountId === call.AccountId && c.Name.toLowerCase() === u.economicBuyerName!.toLowerCase());
      if (eb) updates.unshift({ key: "economicBuyer", label: "Economic buyer", object: "Opportunity", recordId: opp.Id, from: "Not identified", to: `Identified: ${eb.Name}`, changes: { Economic_Buyer_Identified__c: true, Economic_Buyer__c: eb.Id } });
    }
    const target = u.stage as OpportunityStage | null;
    const idx = STAGES.indexOf(opp.StageName);
    if (target && STAGES.indexOf(target) === idx + 1 && !updates.some((x) => x.key === "stage")) {
      const gated = opp.StageName === "Prospecting" && !opp.Economic_Buyer_Identified__c;
      const ebSuggested = updates.some((x) => x.key === "economicBuyer");
      updates.push({
        key: "stage",
        label: "Stage",
        object: "Opportunity",
        recordId: opp.Id,
        from: opp.StageName,
        to: target,
        changes: { StageName: target },
        ...(gated && !ebSuggested ? { blocked: "Identify the economic buyer (controller or GM) before moving past Prospecting." } : gated ? { requires: "economicBuyer" as const } : {}),
      });
    }
  }
  return { notes, updates };
}
