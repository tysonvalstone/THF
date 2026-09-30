/**
 * Audit trail: one AuditEntry per create / update / delete / approval / signature,
 * written in the same commit as the change it describes (so Undo removes both).
 */
import type { AuditEntry } from "@/types/salesforce";
import type { DataSnapshot, Mutation, ObjectName } from "@/lib/data/types";
import { COLLECTION } from "@/lib/data/types";
import { newId } from "@/lib/data/local-repository";

export interface Actor {
  id: string;
  name: string;
  role: string;
}

/** Objects not worth auditing (the log itself, and approval records, which get their own Approve/Reject entries) */
const SKIP = new Set<ObjectName>(["AuditEntry"]);

function nameOf(r: Record<string, unknown> | undefined, id: string): string {
  if (!r) return id;
  const v = r.Name ?? r.Subject ?? r.QuoteNumber ?? r.ContractNumber ?? r.InvoiceNumber ?? r.RecordName ?? (r.FirstName ? `${r.FirstName} ${r.LastName ?? ""}` : undefined);
  return typeof v === "string" && v.trim() ? v : id;
}

function find(data: DataSnapshot, object: ObjectName, id: string): Record<string, unknown> | undefined {
  return (data[COLLECTION[object]] as unknown as { Id: string }[]).find((r) => r.Id === id) as Record<string, unknown> | undefined;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const brief = (v: unknown) => (typeof v === "string" && v.length > 200 ? `${v.slice(0, 200)}…` : v);

export function auditMutations(mutations: Mutation[], before: DataSnapshot, actor: Actor, at: Date): Mutation[] {
  const out: Mutation[] = [];
  for (const m of mutations) {
    if (SKIP.has(m.object)) continue;
    let entry: Omit<AuditEntry, "Id" | "At" | "UserId" | "UserName" | "Role"> | null = null;
    if (m.op === "create") {
      const rec = m.record as unknown as Record<string, unknown>;
      entry = { Action: "Create", Object: m.object, RecordId: m.record.Id, RecordName: nameOf(rec, m.record.Id), Changes: [] };
    } else if (m.op === "delete") {
      const rec = find(before, m.object, m.id);
      entry = { Action: "Delete", Object: m.object, RecordId: m.id, RecordName: nameOf(rec, m.id), Changes: [] };
    } else {
      const rec = find(before, m.object, m.id);
      const changes = Object.entries(m.changes as Record<string, unknown>)
        .filter(([k, v]) => !same(rec?.[k], v))
        .filter(([k]) => k !== "SignatureImage")
        .map(([field, v]) => ({ field, old: brief(rec?.[field] ?? null), new: brief(v ?? null) }));
      if (!changes.length) continue;
      const status = (m.changes as Record<string, unknown>).Status;
      const action: AuditEntry["Action"] =
        m.object === "ApprovalRequest" && status === "Approved"
          ? "Approve"
          : m.object === "ApprovalRequest" && status === "Rejected"
            ? "Reject"
            : status === "Signed"
              ? "Sign"
              : status === "Sent"
                ? "Send"
                : "Update";
      entry = { Action: action, Object: m.object, RecordId: m.id, RecordName: nameOf({ ...rec, ...(m.changes as object) }, m.id), Changes: changes };
    }
    const record: AuditEntry = { Id: newId("AuditEntry"), At: at.toISOString(), UserId: actor.id, UserName: actor.name, Role: actor.role, ...entry };
    out.push({ op: "create", object: "AuditEntry", record });
  }
  return out;
}
