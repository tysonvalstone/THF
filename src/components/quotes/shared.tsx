"use client";

import { useMemo } from "react";
import type { QuoteStatus } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { useUserId } from "@/lib/auth";
import type { QuoteContext } from "@/lib/quotes/build";
import { cn } from "@/lib/utils";

export const selectCls = "h-8 rounded-md border border-input bg-card px-2 text-sm";
export const fieldSelectCls = "h-9 w-full rounded-md border border-input bg-card px-2 text-sm";

const STATUS_CLS: Record<QuoteStatus, string> = {
  Draft: "border-slate-300 text-slate-600",
  "In Review": "border-amber-300 bg-amber-50 text-amber-800",
  Approved: "border-primary/30 bg-accent-soft text-primary",
  Rejected: "border-red-200 bg-red-50 text-status-critical",
  Sent: "border-primary/50 text-primary",
  Accepted: "border-primary bg-primary text-primary-foreground",
  Declined: "border-red-200 text-status-critical",
  Expired: "border-slate-200 bg-slate-100 text-slate-500",
};

export function QuoteStatusPill({ status, className }: { status: QuoteStatus; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap", STATUS_CLS[status], className)}>{status}</span>;
}

/** Store data, as-of date and the acting user, for the lib/quotes helpers */
export function useQuoteContext(): QuoteContext {
  const { data, asOf } = useStore();
  const userId = useUserId();
  return useMemo(() => ({ data, asOf, userId }), [data, asOf, userId]);
}

export function Notice({ tone = "warning", children }: { tone?: "warning" | "info" | "critical"; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        tone === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
        tone === "info" && "border-slate-200 bg-slate-50 text-slate-700",
        tone === "critical" && "border-red-200 bg-red-50 text-red-900",
      )}
    >
      {children}
    </p>
  );
}
