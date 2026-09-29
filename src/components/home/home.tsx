"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { prioritize } from "@/lib/prioritization";
import { blackoutStatus } from "@/lib/seasonality";
import { addDays, fmtDate, parseDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import type { DataSnapshot } from "@/lib/data/types";
import { OpportunityMap } from "./opportunity-map";
import { TagChip } from "@/components/segments/segment-prioritization";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function pipelineAt(data: DataSnapshot, d: Date) {
  const open = data.opportunities.filter((o) => parseDate(o.CreatedDate) <= d && !(o.IsClosed && parseDate(o.CloseDate) <= d));
  return {
    count: open.length,
    total: open.reduce((s, o) => s + o.Amount, 0),
    weighted: open.reduce((s, o) => s + (o.Amount * o.Probability) / 100, 0),
  };
}

function winRate(data: DataSnapshot, end: Date) {
  const start = addDays(end, -365);
  const closed = data.opportunities.filter((o) => o.IsClosed && parseDate(o.CloseDate) > start && parseDate(o.CloseDate) <= end);
  return closed.length ? closed.filter((o) => o.IsWon).length / closed.length : null;
}

function Kpi({ label, value, change, tip }: { label: string; value: string; change?: { text: string; up: boolean } | null; tip: string }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <p tabIndex={0} className="w-fit cursor-help text-xs text-muted-foreground">
            {label}
          </p>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      <p className={cn("mt-0.5 h-4 text-xs tabular", change?.up ? "text-status-good" : "text-muted-foreground")}>{change?.text ?? ""}</p>
    </div>
  );
}

export function Home() {
  const { ready, data, asOf } = useStore();
  const prio = useMemo(() => (ready ? prioritize(data, asOf) : null), [ready, data, asOf]);
  const kpis = useMemo(() => {
    if (!ready) return null;
    return {
      now: pipelineAt(data, asOf),
      prev: pipelineAt(data, addDays(asOf, -30)),
      wr: winRate(data, asOf),
      wrPrev: winRate(data, addDays(asOf, -365)),
      noContact: data.accounts.filter((a) => !a.ParentId && blackoutStatus(a, asOf).status !== "none").length,
    };
  }, [ready, data, asOf]);

  if (!prio || !kpis) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-[560px]" />
      </div>
    );
  }

  const delta = (now: number, prev: number, money = true) => {
    if (!prev) return null;
    const d = now - prev;
    if (Math.abs(d) < 1) return { text: "No change vs. 30 days ago", up: false };
    return { text: `${d > 0 ? "+" : "−"}${money ? fmtMoney(Math.abs(d)) : Math.abs(d)} vs. 30 days ago`, up: d > 0 };
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Current Status</h1>
        <p className="mt-0.5 text-sm text-muted-foreground tabular">{fmtDate(asOf)}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Key stats">
        <Kpi label="Open Pipeline" value={fmtMoney(kpis.now.total)} change={delta(kpis.now.total, kpis.prev.total)} tip="Total amount of open opportunities" />
        <Kpi label="Weighted Pipeline" value={fmtMoney(kpis.now.weighted)} change={delta(kpis.now.weighted, kpis.prev.weighted)} tip="Open amount × stage probability" />
        <Kpi label="Open Opportunities" value={String(kpis.now.count)} change={delta(kpis.now.count, kpis.prev.count, false)} tip="Opportunities open on this date" />
        <Kpi
          label="Win Rate (12 mo)"
          value={kpis.wr === null ? "—" : pct(kpis.wr)}
          change={
            kpis.wr !== null && kpis.wrPrev !== null
              ? { text: `${kpis.wr >= kpis.wrPrev ? "+" : "−"}${Math.abs(Math.round((kpis.wr - kpis.wrPrev) * 100))} pts vs. prior year`, up: kpis.wr >= kpis.wrPrev }
              : null
          }
          tip="Won ÷ decided, trailing 12 months"
        />
        <Kpi label="Accounts in No-Contact Period" value={String(kpis.noContact)} tip="Elevators and co-ops in harvest or planting blackout" />
      </section>

      <OpportunityMap prio={prio} />

      <section aria-labelledby="priority-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="priority-title" className="text-lg font-semibold">
            Segment Priority
          </h2>
          <Link href="/segments" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Segment</th>
                <th className="px-4 py-2 font-medium">Close Rate</th>
                <th className="px-4 py-2 text-right font-medium">Open Pipeline</th>
                <th className="px-4 py-2 text-right font-medium">Median Deal</th>
                <th className="px-4 py-2 text-right font-medium">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {prio.segments.slice(0, 6).map((s) => (
                <tr key={s.segment}>
                  <td className="px-4 py-2.5 text-muted-foreground tabular">{s.rank}</td>
                  <td className="px-4 py-2.5 font-medium">{s.segment}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2 tabular">
                      {pct(s.seasonalRate.rate)}
                      <TagChip tag={s.seasonalRate.tag} />
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">{fmtMoney(s.openPipeline)}</td>
                  <td className="px-4 py-2.5 text-right tabular">{s.stats.medianWonAmount ? fmtMoney(s.stats.medianWonAmount) : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular">{s.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
