"use client";

import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, CircleCheck, Minus, OctagonAlert, TriangleAlert } from "lucide-react";
import type { OnboardingProject } from "@/types/salesforce";
import { useAuth, useUserId } from "@/lib/auth";
import { can } from "@/lib/roles";
import type { HealthBand, HealthResult } from "@/lib/success/health";
import { cn } from "@/lib/utils";

export { selectCls, fieldSelectCls } from "@/components/quotes/shared";

const BAND: Record<HealthBand, { icon: typeof CircleCheck; cls: string }> = {
  Healthy: { icon: CircleCheck, cls: "border-green-200 bg-green-50 text-status-good" },
  Watch: { icon: TriangleAlert, cls: "border-amber-300 bg-amber-50 text-amber-800" },
  "At Risk": { icon: OctagonAlert, cls: "border-red-200 bg-red-50 text-status-critical" },
};

/** Health band: shape + label, never colour alone */
export function HealthBadge({ band, score, className }: { band: HealthBand; score?: number; className?: string }) {
  const { icon: Icon, cls } = BAND[band];
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap", cls, className)}>
      <Icon className="size-3" aria-hidden />
      {score !== undefined && <span className="tabular">{score}</span>}
      {band}
    </span>
  );
}

export function TrendMark({ health, showDelta = true }: { health: Pick<HealthResult, "trend" | "delta" | "previous">; showDelta?: boolean }) {
  const Icon = health.trend === "up" ? ArrowUpRight : health.trend === "down" ? ArrowDownRight : Minus;
  const label = health.trend === "up" ? "Improving" : health.trend === "down" ? "Declining" : "Steady";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs whitespace-nowrap", health.trend === "down" ? "text-status-critical" : health.trend === "up" ? "text-status-good" : "text-muted-foreground")}
      title={`${label}: ${health.previous} 90 days ago`}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{label}</span>
      {showDelta && <span className="tabular">{health.delta > 0 ? `+${health.delta}` : health.delta === 0 ? "0" : `−${Math.abs(health.delta)}`}</span>}
    </span>
  );
}

const PROJECT_CLS: Record<OnboardingProject["Status"], string> = {
  "Not Started": "border-slate-300 text-slate-600",
  "In Progress": "border-primary/40 text-primary",
  "At Risk": "border-red-200 bg-red-50 text-status-critical",
  Live: "border-primary bg-primary text-primary-foreground",
};

export function ProjectStatusPill({ status }: { status: OnboardingProject["Status"] }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap", PROJECT_CLS[status])}>
      {status === "At Risk" && <OctagonAlert className="size-3" aria-hidden />}
      {status === "Live" && <CircleCheck className="size-3" aria-hidden />}
      {status}
    </span>
  );
}

export function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-xs tabular text-muted-foreground">{pct}%</span>
    </span>
  );
}

/** Reps see their own customers; roles with team visibility see everyone */
export function useCustomerScope(): { team: boolean; visible: (ownerId: string) => boolean } {
  const { role } = useAuth();
  const userId = useUserId();
  return useMemo(() => {
    const team = can(role, "see:team");
    return { team, visible: (ownerId: string) => team || ownerId === userId };
  }, [role, userId]);
}

export function StatTile({ label, value, onClick, active }: { label: string; value: string; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular">{value}</dd>
    </>
  );
  if (!onClick) return <div className="rounded-md border bg-card px-4 py-3">{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cn("rounded-md border bg-card px-4 py-3 text-left hover:border-primary/40", active && "border-primary/60")}>
      {body}
    </button>
  );
}
