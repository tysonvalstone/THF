"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/data/store";
import { prioritize } from "@/lib/prioritization";
import { blackoutStatus } from "@/lib/seasonality";
import { areaCodes, areaName, computeAreaInsights, nextArea, type Area } from "@/lib/regionInsights";
import { MAP_COMMODITIES, type MapCommodity } from "@/lib/cropCalendar";
import { REGION_BY_ID } from "@/data/reference/regions";
import { recordHref } from "@/lib/links";
import { addDays, fmtDate, parseDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import type { DataSnapshot } from "@/lib/data/types";
import { SeasonalityMap, type MapFacility } from "@/components/map/seasonality-map";
import { TagChip } from "@/components/segments/segment-prioritization";
import { Button } from "@/components/ui/button";
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
  const won = closed.filter((o) => o.IsWon).length;
  return closed.length ? won / closed.length : null;
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
      <p className={cn("mt-0.5 h-4 text-xs tabular", change ? (change.up ? "text-status-good" : "text-muted-foreground") : "")}>{change?.text ?? ""}</p>
    </div>
  );
}

export function Home() {
  const router = useRouter();
  const { ready, data, asOf, ranked } = useStore();
  const [area, setArea] = useState<Area>({ level: "all" });
  const [commodity, setCommodity] = useState<MapCommodity>("Corn");

  const prio = useMemo(() => (ready ? prioritize(data, asOf) : null), [ready, data, asOf]);
  const kpis = useMemo(() => {
    if (!ready) return null;
    const now = pipelineAt(data, asOf);
    const prev = pipelineAt(data, addDays(asOf, -30));
    const wr = winRate(data, asOf);
    const wrPrev = winRate(data, addDays(asOf, -365));
    const noContact = data.accounts.filter((a) => !a.ParentId && blackoutStatus(a, asOf).status !== "none").length;
    return { now, prev, wr, wrPrev, noContact };
  }, [ready, data, asOf]);
  const insights = useMemo(() => (prio ? computeAreaInsights(data, area, asOf, commodity, ranked, prio) : null), [prio, data, area, asOf, commodity, ranked]);
  const facilities = useMemo<MapFacility[] | undefined>(() => {
    if (area.level !== "state") return undefined;
    return data.accounts
      .filter((a) => a.BillingState === area.state)
      .map((a) => ({ id: a.ParentId ?? a.Id, lat: a.BillingLatitude, lon: a.BillingLongitude, label: a.Name, covered: a.Type === "Customer - Direct" }));
  }, [data.accounts, area]);

  if (!ready || !prio || !kpis || !insights) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-[520px]" />
      </div>
    );
  }

  const delta = (now: number, prev: number, money = true) => {
    if (!prev) return null;
    const d = now - prev;
    if (Math.abs(d) < 1) return { text: "No change vs. 30 days ago", up: false };
    return { text: `${d > 0 ? "+" : "−"}${money ? fmtMoney(Math.abs(d)) : Math.abs(d)} vs. 30 days ago`, up: d > 0 };
  };
  const crumbs: { label: string; area: Area }[] = [{ label: "North America", area: { level: "all" } }];
  if (area.regionId) crumbs.push({ label: REGION_BY_ID[area.regionId].name, area: { level: "region", regionId: area.regionId } });
  if (area.level === "state") crumbs.push({ label: areaName(area), area });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Current Status</h1>
        <p className="mt-0.5 text-sm text-muted-foreground tabular">{fmtDate(asOf)}</p>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-label="Key stats">
        <Kpi label="Open Pipeline" value={fmtMoney(kpis.now.total)} change={delta(kpis.now.total, kpis.prev.total)} tip="Total amount of open opportunities." />
        <Kpi label="Weighted Pipeline" value={fmtMoney(kpis.now.weighted)} change={delta(kpis.now.weighted, kpis.prev.weighted)} tip="Open amount × stage probability." />
        <Kpi label="Open Opportunities" value={String(kpis.now.count)} change={delta(kpis.now.count, kpis.prev.count, false)} tip="Opportunities open on this date." />
        <Kpi
          label="Win Rate (12 mo)"
          value={kpis.wr === null ? "—" : pct(kpis.wr)}
          change={kpis.wr !== null && kpis.wrPrev !== null ? { text: `${kpis.wr >= kpis.wrPrev ? "+" : "−"}${Math.abs(Math.round((kpis.wr - kpis.wrPrev) * 100))} pts vs. prior year`, up: kpis.wr >= kpis.wrPrev } : null}
          tip="Won ÷ decided deals closed in the trailing 12 months."
        />
        <Kpi label="Accounts in No-Contact Period" value={String(kpis.noContact)} tip="Elevators and co-ops in a harvest or planting blackout." />
      </section>

      <section aria-labelledby="map-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="map-title" className="text-lg font-semibold">
            Opportunity Map
          </h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Commodity</span>
            <select value={commodity} onChange={(e) => setCommodity(e.target.value as MapCommodity)} className="h-8 rounded-md border border-input bg-card px-2 text-sm">
              {MAP_COMMODITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 rounded-md border bg-card p-3">
            <div className="mb-2 flex h-8 items-center justify-between gap-2">
              <nav aria-label="Map location" className="flex min-w-0 items-center gap-1.5 text-sm">
                {crumbs.map((c, i) => (
                  <span key={c.label} className="flex items-center gap-1.5 truncate">
                    {i > 0 && <span className="text-slate-400">›</span>}
                    {i < crumbs.length - 1 ? (
                      <button type="button" className="text-primary hover:underline" onClick={() => setArea(c.area)}>
                        {c.label}
                      </button>
                    ) : (
                      <span className="font-medium">{c.label}</span>
                    )}
                  </span>
                ))}
              </nav>
              {area.level !== "all" && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setArea(crumbs[crumbs.length - 2].area)}>
                    Back
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setArea({ level: "all" })}>
                    Reset
                  </Button>
                </div>
              )}
            </div>
            <SeasonalityMap
              date={asOf}
              commodity={commodity}
              onCommodityChange={setCommodity}
              hideControls
              focusCodes={areaCodes(area)}
              facilities={facilities}
              onAreaClick={(code) => {
                const next = nextArea(area, code);
                if (next) setArea(next);
              }}
              onFacilityClick={(id) => router.push(recordHref(id))}
            />
          </div>

          <aside className="space-y-5 rounded-md border bg-card p-4" aria-live="polite">
            <div>
              <h3 className="text-base font-semibold">{insights.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{insights.summary}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Facilities</dt>
                <dd className="font-semibold tabular">{insights.facilities.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Customers</dt>
                <dd className="font-semibold tabular">{insights.customers.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Penetration</dt>
                <dd className="font-semibold tabular">
                  {insights.penetration.covered} of {insights.penetration.total}
                  <span className="block text-xs font-normal text-muted-foreground">{insights.penetration.label}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Open Pipeline</dt>
                <dd className="font-semibold tabular">
                  {fmtMoney(insights.openPipeline)}
                  <span className="block text-xs font-normal text-muted-foreground">{insights.openDeals} deals</span>
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">{commodity} season</dt>
                <dd className="font-semibold">{insights.phase}</dd>
              </div>
            </dl>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground">Top Potential Customers</h4>
              <ol className="mt-2 divide-y">
                {insights.top.map((t) => (
                  <li key={t.account.Id} className="py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={recordHref(t.account.Id)} className="truncate text-sm font-medium text-primary hover:underline">
                        {t.account.Name}
                      </Link>
                      <span className="shrink-0 text-sm tabular">{fmtMoney(t.estDeal)}</span>
                    </div>
                    <p className="flex justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {t.account.Segment__c} · {t.account.Number_of_Locations__c} {t.account.Number_of_Locations__c === 1 ? "location" : "locations"}
                      </span>
                      <span className={cn("shrink-0", t.blackout.startsWith("Blackout") && "text-amber-800")}>{t.blackout}</span>
                    </p>
                  </li>
                ))}
                {!insights.top.length && <li className="py-2 text-sm text-muted-foreground">No prospects in this area.</li>}
              </ol>
            </div>
            <div>
              <h4 className="text-xs font-medium text-muted-foreground">Key Insights</h4>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                {insights.insights.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </section>

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
