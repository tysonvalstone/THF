/**
 * Discount approval policy (pure, unit tested in pricing.test.ts).
 *
 * The discount checked is the largest on any line, with the header discount
 * stacked on recurring lines (10% line + 10% header = 19%).
 *
 *   ≤ 15%                        auto-approved on submit
 *   > 15% and ≤ 25%              sales manager (or administrator)
 *   > 25%, or TCV over $500K     administrator, with a written reason
 *
 * Any pricing change after submit or approval returns the quote to Draft.
 */
import type { QuoteTotals } from "./pricing";
import { fmtPctValue } from "./pricing";

export const DISCOUNT_POLICY = {
  /** Max discount a rep can give without approval, % */
  autoMax: 15,
  /** Max discount a sales manager can approve, % */
  managerMax: 25,
  /** Contract value that always needs an administrator */
  adminTcv: 500_000,
  /** CAD per USD, to compare CAD quotes with the USD threshold */
  cadPerUsd: 1.36,
} as const;

export type ApprovalLevel = "auto" | "manager" | "admin";

export const APPROVER_LABEL: Record<ApprovalLevel, string> = {
  auto: "Auto-approved",
  manager: "Sales manager",
  admin: "Administrator",
};

/** The policy as short rules for the UI and PDFs */
export const POLICY_RULES: string[] = [
  `Discount up to ${DISCOUNT_POLICY.autoMax}%: auto-approved`,
  `Over ${DISCOUNT_POLICY.autoMax}% to ${DISCOUNT_POLICY.managerMax}%: sales manager`,
  `Over ${DISCOUNT_POLICY.managerMax}%, or TCV over $${DISCOUNT_POLICY.adminTcv / 1000}K: administrator, with a reason`,
  "Header discount stacks on each recurring line",
  "Pricing changes after approval return the quote to Draft",
];

export interface ApprovalRequirement {
  level: ApprovalLevel;
  /** The discount the policy checked, % */
  discount: number;
  tcv: number;
  /** Why this level applies */
  reasons: string[];
  /** The approver must enter a reason */
  reasonRequired: boolean;
  approver: string;
}

/** The approval a quote needs; CAD totals are converted to USD for the TCV threshold */
export function approvalFor(totals: Pick<QuoteTotals, "maxEffectiveDiscount" | "tcv">, currency: "USD" | "CAD" = "USD"): ApprovalRequirement {
  const d = Math.round(totals.maxEffectiveDiscount * 100) / 100;
  const reasons: string[] = [];
  let level: ApprovalLevel = "auto";
  if (d > DISCOUNT_POLICY.managerMax) {
    level = "admin";
    reasons.push(`Discount ${fmtPctValue(d)} is over ${DISCOUNT_POLICY.managerMax}%`);
  } else if (d > DISCOUNT_POLICY.autoMax) {
    level = "manager";
    reasons.push(`Discount ${fmtPctValue(d)} is over ${DISCOUNT_POLICY.autoMax}%`);
  }
  const tcvUsd = currency === "CAD" ? totals.tcv / DISCOUNT_POLICY.cadPerUsd : totals.tcv;
  if (tcvUsd > DISCOUNT_POLICY.adminTcv) {
    level = "admin";
    const shown = currency === "CAD" ? `CA$${Math.round(totals.tcv).toLocaleString("en-US")} (about $${Math.round(tcvUsd).toLocaleString("en-US")})` : `$${Math.round(totals.tcv).toLocaleString("en-US")}`;
    reasons.push(`TCV ${shown} is over $${DISCOUNT_POLICY.adminTcv.toLocaleString("en-US")}`);
  }
  if (level === "auto") reasons.push(`Discount ${fmtPctValue(d)} is within the ${DISCOUNT_POLICY.autoMax}% rep limit`);
  return { level, discount: d, tcv: totals.tcv, reasons, reasonRequired: level === "admin", approver: APPROVER_LABEL[level] };
}

/** Business roles that can approve at each level ("manager" and "admin" are AppRole values) */
export function canApprove(level: ApprovalLevel, role: string | null | undefined): boolean {
  if (level === "auto") return true;
  if (role === "admin") return true;
  return level === "manager" && role === "manager";
}

/** Text stored in Quote.Approval_Reason__c */
export function approvalReasonText(req: ApprovalRequirement, note?: string): string {
  const base = req.level === "auto" ? `Auto-approved: ${req.reasons.join("; ")}` : `${req.approver} approval: ${req.reasons.join("; ")}`;
  return note?.trim() ? `${base}. ${note.trim()}` : base;
}
