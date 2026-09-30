/**
 * What each business role can see and do. Navigation, buttons, approvals and
 * record visibility all check these, so a role change updates the whole app.
 */
import type { AppRole } from "@/lib/supabase/config";

export type Capability =
  | "see:team" // team pipeline, forecast, all reps' records
  | "see:finance" // Finance tab (revenue, invoices, board report)
  | "see:contracts"
  | "see:commissions:all"
  | "approve:discount:25" // discounts up to 25%
  | "approve:discount:any"
  | "approve:payment-terms"
  | "approve:clauses"
  | "edit:clauses"
  | "edit:invoices"
  | "admin:settings"
  | "admin:users"
  | "override:forecast";

const MATRIX: Record<AppRole, Capability[]> = {
  rep: ["see:contracts"],
  manager: ["see:team", "see:finance", "see:contracts", "approve:discount:25", "override:forecast"],
  finance: ["see:team", "see:finance", "see:contracts", "see:commissions:all", "approve:payment-terms", "edit:invoices"],
  legal: ["see:team", "see:contracts", "approve:clauses", "edit:clauses"],
  admin: [
    "see:team",
    "see:finance",
    "see:contracts",
    "see:commissions:all",
    "approve:discount:25",
    "approve:discount:any",
    "approve:payment-terms",
    "approve:clauses",
    "edit:clauses",
    "edit:invoices",
    "admin:settings",
    "admin:users",
    "override:forecast",
  ],
};

export function can(role: AppRole, capability: Capability): boolean {
  return MATRIX[role].includes(capability);
}

/** Which role decides each approval type */
export const APPROVER_FOR = {
  Discount: "manager",
  "Non-standard clause": "legal",
  "Payment terms": "finance",
} as const;

/** Whether this role can decide a request routed to `approverRole` (admins can decide anything) */
export function canDecide(role: AppRole, approverRole: "manager" | "finance" | "legal" | "admin"): boolean {
  return role === "admin" || role === approverRole;
}
