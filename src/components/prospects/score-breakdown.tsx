"use client";

import { FACTOR_KEYS, FACTOR_META, type FactorKey, type ScoredTarget } from "@/lib/scoring";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Fixed categorical order: color follows the factor, never its rank. */
export const FACTOR_COLOR: Record<FactorKey, string> = {
  timing: "#2a78d6",
  market: "#eb6834",
  fit: "#1baf7a",
  displacement: "#eda100",
  engagement: "#e87ba4",
  climate: "#008300",
};

/** One-line stacked bar: each factor's points on a 0–100 scale */
export function MiniBreakdown({ s, className }: { s: ScoredTarget; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex h-2.5 w-full min-w-28 gap-[2px] overflow-hidden rounded-full bg-muted", className)} tabIndex={0} aria-label={`Score breakdown, total ${s.total}`}>
          {FACTOR_KEYS.map((k) => (
            <span key={k} className="h-full first:rounded-l-full" style={{ width: `${s.factors[k].points}%`, background: FACTOR_COLOR[k] }} />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="w-56 p-2.5">
        <ul className="space-y-1">
          {FACTOR_KEYS.map((k) => (
            <li key={k} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: FACTOR_COLOR[k] }} />
                {FACTOR_META[k].label}
              </span>
              <span className="tabular">
                {Math.round(s.factors[k].points)}/{FACTOR_META[k].max}
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

export function BreakdownLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1">
      {FACTOR_KEYS.map((k) => (
        <li key={k} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2.5 rounded-[2px]" style={{ background: FACTOR_COLOR[k] }} />
          {FACTOR_META[k].label} <span className="tabular">({FACTOR_META[k].max})</span>
        </li>
      ))}
    </ul>
  );
}

/** Full breakdown: one row per factor with its reason */
export function ScoreBreakdown({ s, className }: { s: ScoredTarget; className?: string }) {
  return (
    <ul className={cn("space-y-3", className)}>
      {FACTOR_KEYS.map((k) => {
        const f = s.factors[k];
        return (
          <li key={k}>
            <div className="flex items-center justify-between gap-3 text-sm">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex cursor-help items-center gap-2 font-medium" tabIndex={0}>
                    <span className="size-2.5 rounded-[2px]" style={{ background: FACTOR_COLOR[k] }} />
                    {FACTOR_META[k].label}
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{FACTOR_META[k].description}</TooltipContent>
              </Tooltip>
              <span className="text-muted-foreground tabular">
                <strong className="font-semibold text-foreground">{Math.round(f.points)}</strong> / {f.max}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full" style={{ width: `${(f.points / f.max) * 100}%`, background: FACTOR_COLOR[k] }} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{f.reason.charAt(0).toUpperCase() + f.reason.slice(1)}.</p>
          </li>
        );
      })}
    </ul>
  );
}
