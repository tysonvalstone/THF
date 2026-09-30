"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import type { ContractStatus } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { useAuth, useUserId } from "@/lib/auth";
import type { ContractContext, ContractInfo } from "@/lib/contracts";
import { cn } from "@/lib/utils";

export { selectCls, fieldSelectCls, Notice } from "@/components/quotes/shared";

const STATUS_CLS: Record<ContractStatus, string> = {
  Draft: "border-slate-300 text-slate-600",
  "Legal Review": "border-amber-300 bg-amber-50 text-amber-800",
  "Sent for Signature": "border-primary/50 text-primary",
  Signed: "border-primary/30 bg-accent-soft text-primary",
  Active: "border-primary bg-primary text-primary-foreground",
  Expired: "border-slate-200 bg-slate-100 text-slate-500",
  Terminated: "border-red-200 bg-red-50 text-status-critical",
};

export function ContractStatusPill({ status, className }: { status: ContractStatus; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap", STATUS_CLS[status], className)}>{status}</span>;
}

export function Flag({ tone = "warning", children, title }: { tone?: "warning" | "critical" | "neutral"; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-800",
        tone === "critical" && "border-red-200 bg-red-50 text-status-critical",
        tone === "neutral" && "border-slate-300 text-slate-600",
      )}
    >
      {children}
    </span>
  );
}

/** Non-standard / Unsigned > 14 days / Expiring chips */
export function ContractFlags({ info, autoRenew }: { info: ContractInfo; autoRenew: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {info.nonStandard && (
        <Flag tone="neutral" title="One or more clauses differ from the library">
          Non-standard
        </Flag>
      )}
      {info.unsigned && (
        <Flag tone="critical" title={`Out for signature ${info.unsignedDays} days`}>
          Unsigned {info.unsignedDays}d
        </Flag>
      )}
      {info.expiring && (
        <Flag tone={autoRenew ? "warning" : "critical"} title={autoRenew ? "Auto-renews at the end date" : "Ends without renewal"}>
          {autoRenew ? "Renews" : "Expiring"} {info.daysToEnd}d
        </Flag>
      )}
    </span>
  );
}

const PATH: ContractStatus[] = ["Draft", "Legal Review", "Sent for Signature", "Signed", "Active"];

/** Status path: Draft → Legal Review → Sent for Signature → Signed → Active (→ Expired / Terminated) */
export function StatusPath({ status }: { status: ContractStatus }) {
  const ended = status === "Expired" || status === "Terminated";
  const idx = ended ? PATH.length : PATH.indexOf(status);
  const steps: ContractStatus[] = ended ? [...PATH, status] : PATH;
  return (
    <ol className="flex w-full overflow-x-auto rounded-md border bg-card text-xs" aria-label="Contract status">
      {steps.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        return (
          <li
            key={s}
            aria-current={current ? "step" : undefined}
            className={cn(
              "flex min-w-[110px] flex-1 items-center justify-center gap-1 border-r px-3 py-2 font-medium whitespace-nowrap last:border-r-0",
              done && "bg-accent-soft text-primary",
              current && (s === "Terminated" ? "bg-red-50 text-status-critical" : s === "Expired" ? "bg-slate-100 text-slate-600" : "bg-primary text-primary-foreground"),
              !done && !current && "text-muted-foreground",
            )}
          >
            {done && <Check className="size-3" aria-hidden />}
            {s}
          </li>
        );
      })}
    </ol>
  );
}

/** Store data, as-of date, acting user and role, for the lib/contracts helpers */
export function useContractContext(): ContractContext {
  const { data, asOf } = useStore();
  const userId = useUserId();
  const { role } = useAuth();
  return useMemo(() => ({ data, asOf, userId, role }), [data, asOf, userId, role]);
}

export const TERM_CHOICES = [12, 24, 36, 48, 60] as const;
export const PAYMENT_TERM_CHOICES = ["Net 30", "Net 45", "Net 60", "Due on receipt"] as const;
export const BILLING_CHOICES = ["Annual", "Quarterly", "Monthly"] as const;
