"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { prioritize } from "@/lib/prioritization";
import { blackoutStatus, closeDateFlags } from "@/lib/seasonality";
import { avgDealSize, closedWonByMonth, closedWonQuarter, focusThisMonth, pipelineAt, pipelineByStage, REGION_NAME, upcoming, winRate } from "@/lib/dashboard";
import { addDays, fmtDate, fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { opportunityHref } from "@/lib/links";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const PHASE_LABEL = { planting: "planting", growing: "growing", harvest: "harvest", "post-harvest": "post-harvest", "off-season": "off-season" } as const;

type Change = { text: string; up: boolean | null } | null;

function Kpi({ label, value, change }: { label: string; value: string; change: Change }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      <p className={cn("mt-0.5 h-4 text-xs tabular", change?.up ? "text-status-good" : change?.up === false ? "text-status-critical" : "text-muted-foreground")}>{change?.text ?? ""}</p>
    </div>
  );
}

function moneyChange(now: number, prev: number | null, period: string): Change {
  if (prev === null) return null;
  if (!prev) return now ? { text: `New vs. ${period}`, up: true } : null;
  const d = (now - prev) / prev;
  if (Math.abs(d) < 0.005) return { text: `Flat vs. ${period}`, up: null };
  return { text: `${d > 0 ? "▲" : "▼"} ${Math.abs(Math.round(d * 100))}% vs. ${period}`, up: d > 0 };
}

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-md border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Horizontal bars: one row per category, value labels at the bar end */
function HBarChart({ rows }: { rows: { label: string; value: number; sub: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 text-sm" title={`${r.label}: ${fmtMoney(r.value)} · ${r.sub}`}>
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="flex items-center gap-2">
            <span className="h-3.5 rounded-r-[4px] bg-primary" style={{ width: `${Math.max(0.5, (r.value / max) * 78)}%` }} />
            <span className="shrink-0 text-xs tabular">
              {fmtMoney(r.value, { compact: true })} <span className="text-muted-foreground">· {r.sub}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical bars by month with a hover readout */
function MonthChart({ rows }: { rows: { key: string; label: string; amount: number; count: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const shown = hover ?? rows.length - 1;
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div>
      <p className="h-5 text-xs text-muted-foreground tabular">
        {hover === null ? (
          <>
            12 months · <span className="font-medium text-foreground">{fmtMoney(total)}</span>
          </>
        ) : (
          <>
            {rows[shown].label} {rows[shown].key.slice(0, 4)} · <span className="font-medium text-foreground">{fmtMoney(rows[shown].amount)}</span> · {rows[shown].count} deal{rows[shown].count === 1 ? "" : "s"}
          </>
        )}
      </p>
      <div className="mt-2 flex h-40 items-end gap-1.5 border-b" onMouseLeave={() => setHover(null)}>
        {rows.map((r, i) => (
          <button
            key={r.key}
            type="button"
            aria-label={`${r.label}: ${fmtMoney(r.amount)}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            className="flex h-full min-w-0 flex-1 items-end outline-none"
          >
            <span
              className={cn("w-full rounded-t-[4px] bg-primary transition-opacity", hover !== null && hover !== i && "opacity-40")}
              style={{ height: `${Math.max(r.amount ? 2 : 0, (r.amount / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {rows.map((r) => (
          <span key={r.key} className="min-w-0 flex-1 text-center text-[11px] text-muted-foreground">
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Home() {
  const { ready, data, asOf, ranked, lightningBaseUrl } = useStore();
  const prio = useMemo(() => (ready ? prioritize(data, asOf) : null), [ready, data, asOf]);

  const view = useMemo(() => {
    if (!ready || !prio) return null;
    const prevMonth = addDays(asOf, -30);
    const now = pipelineAt(data, asOf);
    const prev = pipelineAt(data, prevMonth);
    const byId = new Map(data.accounts.map((a) => [a.Id, a]));
    return {
      now,
      prev,
      won: closedWonQuarter(data, asOf),
      wr: winRate(data, asOf),
      wrPrev: winRate(data, addDays(asOf, -365)),
      avg: avgDealSize(data, asOf),
      avgPrev: avgDealSize(data, addDays(asOf, -365)),
      focus: focusThisMonth(data, asOf, prio, ranked),
      stages: pipelineByStage(data, asOf),
      months: closedWonByMonth(data, asOf),
      top: [...prio.allOpen]
        .sort((x, y) => y.expectedAmount - x.expectedAmount)
        .slice(0, 10)
        .map((v) => {
          const a = byId.get(v.opp.AccountId);
          const b = a ? blackoutStatus(a, asOf) : null;
          const closeFlag = closeDateFlags(v.opp, a, asOf).find((f) => f.kind === "blackout");
          return {
            v,
            account: a,
            blackout: b?.status === "hard" ? `To ${fmtShortDate(b.blackout!.end)}` : b?.status === "light" ? "Planting" : closeFlag ? "Close date" : null,
          };
        }),
      upcoming: upcoming(data, asOf),
    };
  }, [ready, prio, data, asOf, ranked]);

  if (!view) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  const { focus } = view;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Home</h1>
        <p className="mt-0.5 text-sm text-muted-foreground tabular">{fmtDate(asOf)}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Key metrics">
        <Kpi label="Open Pipeline" value={fmtMoney(view.now.total)} change={moneyChange(view.now.total, view.prev.total, "30 days ago")} />
        <Kpi label="Weighted Pipeline" value={fmtMoney(view.now.weighted)} change={moneyChange(view.now.weighted, view.prev.weighted, "30 days ago")} />
        <Kpi label={`Closed Won, ${view.won.quarter}`} value={fmtMoney(view.won.now)} change={moneyChange(view.won.now, view.won.prev, "last quarter")} />
        <Kpi
          label="Win Rate (12 mo)"
          value={view.wr === null ? "—" : pct(view.wr)}
          change={
            view.wr !== null && view.wrPrev !== null
              ? {
                  text: `${view.wr >= view.wrPrev ? "▲" : "▼"} ${Math.abs(Math.round((view.wr - view.wrPrev) * 100))} pts vs. prior year`,
                  up: Math.round(view.wr * 100) === Math.round(view.wrPrev * 100) ? null : view.wr > view.wrPrev,
                }
              : null
          }
        />
        <Kpi label="Average Deal Size" value={view.avg === null ? "—" : fmtMoney(view.avg)} change={view.avg === null ? null : moneyChange(view.avg, view.avgPrev, "prior year")} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Focus this month">
        <Card title="Top Commodity">
          {focus.commodity ? (
            <>
              <p className="text-base font-semibold">
                {focus.commodity.commodity}: {PHASE_LABEL[focus.commodity.phase]}
                {focus.commodity.regions.length ? ` in ${focus.commodity.regions.join(" and ")}` : ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{focus.commodity.why}</p>
              <p className="mt-3 text-xs text-muted-foreground tabular">
                {focus.commodity.outOfBlackout} of {focus.commodity.accounts} {focus.commodity.commodity.toLowerCase()} accounts out of blackout
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No data</p>
          )}
        </Card>
        <Card
          title="Top Region"
          action={
            focus.region && (
              <Link href={`/map?region=${focus.region.regionId}`} className="text-sm text-primary hover:underline">
                View on map
              </Link>
            )
          }
        >
          {focus.region ? (
            <>
              <p className="text-base font-semibold">
                {focus.region.name}: {focus.region.outOfBlackout} accounts out of blackout, {fmtMoney(focus.region.openPipeline)} open
              </p>
              <p className="mt-3 text-xs text-muted-foreground tabular">{focus.region.accounts} accounts in region</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No data</p>
          )}
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2" aria-label="Charts">
        <Card title="Pipeline by Stage">
          <HBarChart rows={view.stages.map((s) => ({ label: s.stage, value: s.amount, sub: `${s.count} deal${s.count === 1 ? "" : "s"}` }))} />
        </Card>
        <Card title="Closed Won by Month">
          <MonthChart rows={view.months} />
        </Card>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          title="Top 10 Open Opportunities"
          action={
            <Link href="/segments" className="text-sm text-primary hover:underline">
              View all
            </Link>
          }
          className="[&>div:last-child]:p-0"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Segment</th>
                  <th className="px-3 py-2 font-medium">Region</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Stage</th>
                  <th className="px-3 py-2 font-medium">Close</th>
                  <th className="px-4 py-2 font-medium">Blackout</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {view.top.map(({ v, account, blackout }) => {
                  const href = opportunityHref(v.opp.Id, lightningBaseUrl);
                  return (
                    <tr key={v.opp.Id} className="hover:bg-slate-50">
                      <td className="max-w-[240px] truncate px-4 py-2">
                        <Link href={href} className="font-medium hover:text-primary hover:underline" title={v.opp.Name}>
                          {v.accountName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{v.segment}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{account ? REGION_NAME(account.Region__c) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular">{fmtMoney(v.opp.Amount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{v.opp.StageName}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular">{fmtShortDate(v.opp.CloseDate)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        {blackout ? <span className="rounded-sm bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">{blackout}</span> : <span className="text-xs text-muted-foreground">Open</span>}
                      </td>
                    </tr>
                  );
                })}
                {!view.top.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                      No open opportunities
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Upcoming">
          <ol className="space-y-3">
            {view.upcoming.map((u) => (
              <li key={`${u.kind}-${u.title}`} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3">
                <span className="text-xs font-medium text-muted-foreground tabular">{fmtShortDate(u.date)}</span>
                <span className="min-w-0">
                  {u.href ? (
                    <Link href={u.href} className="block truncate text-sm font-medium hover:text-primary hover:underline">
                      {u.title}
                    </Link>
                  ) : (
                    <span className="block truncate text-sm font-medium">{u.title}</span>
                  )}
                  <span className="text-xs text-muted-foreground">{u.detail}</span>
                </span>
              </li>
            ))}
            {!view.upcoming.length && <li className="text-sm text-muted-foreground">Nothing in the next 120 days</li>}
          </ol>
        </Card>
      </div>
    </div>
  );
}
