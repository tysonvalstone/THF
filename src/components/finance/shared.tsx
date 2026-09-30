"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { InvoiceStatus } from "@/types/salesforce";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/roles";
import { useStore } from "@/lib/data/store";
import type { NetSuiteResult } from "@/lib/data/netsuite";
import { cn } from "@/lib/utils";

export const selectCls = "h-8 rounded-md border border-input bg-card px-2 text-sm";

/** Finance pages: roles without `see:finance` get a short no-access state */
export function FinanceGate({ children }: { children: React.ReactNode }) {
  const { role } = useAuth();
  if (can(role, "see:finance")) return <>{children}</>;
  return (
    <div className="mx-auto max-w-md rounded-md border bg-card px-6 py-10 text-center">
      <h1 className="text-base font-semibold">You don&apos;t have access to Finance</h1>
      <p className="mt-1 text-sm text-muted-foreground">Finance, managers and admins can open this page.</p>
      <Link href="/" className="mt-4 inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-muted">
        Go to Home
      </Link>
    </div>
  );
}

const STATUS_CLS: Record<InvoiceStatus, string> = {
  Draft: "border-slate-300 text-slate-600",
  Sent: "border-primary/50 text-primary",
  Paid: "border-primary bg-primary text-primary-foreground",
  Overdue: "border-red-200 bg-red-50 text-status-critical",
  Void: "border-slate-200 bg-slate-100 text-slate-500 line-through",
};

export function InvoiceStatusPill({ status, className }: { status: InvoiceStatus; className?: string }) {
  return <span className={cn("inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap", STATUS_CLS[status], className)}>{status}</span>;
}

export function Tag({ children, title, className }: { children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 items-center rounded-sm border border-amber-300 bg-amber-50 px-1.5 text-[11px] font-medium whitespace-nowrap text-amber-800", className)}>
      {children}
    </span>
  );
}

const EMPTY: NetSuiteResult = { mode: "off", invoices: [], payments: [] };

/** Read-only NetSuite invoices and payments (off in Demo Mode or without credentials) */
export function useNetSuite(): NetSuiteResult & { loading: boolean } {
  const { demoMode, ready } = useStore();
  const [state, setState] = useState<NetSuiteResult | null>(null);
  const skip = !ready || demoMode;
  useEffect(() => {
    if (skip) return;
    let live = true;
    fetch("/api/netsuite", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<NetSuiteResult>) : EMPTY))
      .catch(() => EMPTY)
      .then((r) => {
        if (live) setState(r);
      });
    return () => {
      live = false;
    };
  }, [skip]);
  if (skip) return { ...EMPTY, loading: false };
  return { ...(state ?? EMPTY), loading: state === null };
}
