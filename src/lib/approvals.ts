/**
 * Approval requests routed to a role (discounts → Manager, non-standard
 * clauses → Legal, extended or harvest payment terms → Finance). The header
 * "Approvals" inbox lists pending requests for the current role. Modules
 * create a request with `requestApproval` and apply the business change
 * themselves when `decideApproval` records the decision.
 */
import type { ApprovalRequest, ApprovalType } from "@/types/salesforce";
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";

export function requestApproval(input: {
  type: ApprovalType;
  object: ApprovalRequest["Object"];
  recordId: string;
  recordName: string;
  approverRole: ApprovalRequest["ApproverRole"];
  detail: string;
  requestedById: string;
  asOf: Date;
  data?: DataSnapshot;
}): { id: string; mutations: Mutation[] } {
  // One open request per record and type: refresh the existing one instead
  const existing = input.data?.approvals.find((a) => a.RecordId === input.recordId && a.Type === input.type && a.Status === "Pending");
  if (existing) {
    return { id: existing.Id, mutations: [{ op: "update", object: "ApprovalRequest", id: existing.Id, changes: { Detail: input.detail, RequestedDate: input.asOf.toISOString() } }] };
  }
  const id = newId("ApprovalRequest");
  const record: ApprovalRequest = {
    Id: id,
    Type: input.type,
    Object: input.object,
    RecordId: input.recordId,
    RecordName: input.recordName,
    ApproverRole: input.approverRole,
    Status: "Pending",
    Detail: input.detail,
    RequestedById: input.requestedById,
    RequestedDate: input.asOf.toISOString(),
  };
  return { id, mutations: [{ op: "create", object: "ApprovalRequest", record }] };
}

export function decideApproval(request: ApprovalRequest, decision: "Approved" | "Rejected", deciderId: string, asOf: Date, note?: string): Mutation[] {
  return [
    {
      op: "update",
      object: "ApprovalRequest",
      id: request.Id,
      changes: { Status: decision, DecidedById: deciderId, DecidedDate: asOf.toISOString(), DecisionNote: note },
    },
  ];
}

/** Pending requests for a record (e.g. to show "Awaiting Legal") */
export function pendingFor(data: DataSnapshot, recordId: string): ApprovalRequest[] {
  return data.approvals.filter((a) => a.RecordId === recordId && a.Status === "Pending");
}
