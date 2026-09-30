"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useAuth, useUserId } from "@/lib/auth";
import { can } from "@/lib/roles";
import { buildForecast, DEFAULT_WHAT_IF, OPEN_CATEGORIES, type ForecastDeal, type Granularity, type RepForecast, type WhatIf } from "@/lib/forecast";
import { fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { opportunityHref } from "@/lib/links";
import { USER_BY_ID } from "@/data/reference/users";
import type { ForecastCategory } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const pct = (x: number) => `${Math.round(x)}%`;
const money = (n: number) => fmtMoney(n, { compact: true });

/** One accent, stepped down by firmness */
const SERIES = [
  { key: "closed", label: "Closed", cls: "bg-primary" },
  { key: "commit", label: "Commit", cls: "bg-primary/65" },
  { key: "bestCase", label: "Best Case", cls: "bg-primary/35" },
  { key: "pipeline", label: "Pipeline", cls: "bg-slate-300" },
] as const;

const SELECT = "h-7 rounded-md border border-input bg-card px-1.5 text-xs text-foreground disabled:opacity-60";

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="inline-flex rounded-md border bg-card p-0.5 text-xs" role="tablist" aria-label={label}>
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={value === k}
          onClick={() => onChange(k)}
          className={cn("rounded-[4px] px-2.5 py-1", value === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Kpi({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-md border bg-card px-4 py-3", strong && "border-primary/40")}>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular">{value}</p>
      <p className="mt-0.5 h-4 truncate text-xs text-muted-foreground tabular">{sub ?? ""}</p>
    </div>
  );
}

/** Stacked bar per rep (closed → commit → best case → pipeline) with the quota tick and the seasonal expected marker */
function RepChart({ reps }: { reps: RepForecast[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...reps.map((r) => Math.max(r.quota, r.closed + r.commit + r.bestCase + r.pipeline, r.seasonalExpected)));
  const x = (v: number) => `${(v / max) * 100}%`;
  const total = reps.reduce(
    (t, r) => ({ ...t, closed: t.closed + r.closed, commit: t.commit + r.commit, bestCase: t.bestCase + r.bestCase, pipeline: t.pipeline + r.pipeline, seasonalExpected: t.seasonalExpected + r.seasonalExpected, quota: t.quota + r.quota }),
    { name: reps.length === 1 ? reps[0].name : "Team", closed: 0, commit: 0, bestCase: 0, pipeline: 0, seasonalExpected: 0, quota: 0 },
  );
  const shown = reps.find((r) => r.ownerId === hover) ?? total;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-sm", s.cls)} aria-hidden />
            {s.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-foreground" aria-hidden />
          Quota
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rotate-45 border border-primary bg-card" aria-hidden />
          Seasonal expected
        </span>
      </div>
      <p className="mt-3 h-5 truncate text-xs text-muted-foreground tabular" aria-live="polite">
        <span className="font-medium text-foreground">{shown.name}</span> · Closed {money(shown.closed)} · Commit {money(shown.commit)} · Best Case {money(shown.bestCase)} · Pipeline{" "}
        {money(shown.pipeline)} · Expected {money(shown.seasonalExpected)} · Quota {money(shown.quota)}
      </p>
      <ul className="mt-1 space-y-2.5" onMouseLeave={() => setHover(null)}>
        {reps.map((r) => {
          let left = 0;
          return (
            <li
              key={r.ownerId}
              tabIndex={0}
              onMouseEnter={() => setHover(r.ownerId)}
              onFocus={() => setHover(r.ownerId)}
              className={cn("grid grid-cols-[112px_minmax(0,1fr)_112px] items-center gap-3 rounded-sm text-sm outline-none", hover && hover !== r.ownerId && "opacity-50")}
              aria-label={`${r.name}: closed ${fmtMoney(r.closed)}, commit ${fmtMoney(r.commit)}, best case ${fmtMoney(r.bestCase)}, pipeline ${fmtMoney(r.pipeline)}, seasonal expected ${fmtMoney(r.seasonalExpected)}, quota ${fmtMoney(r.quota)}`}
            >
              <span className="truncate text-muted-foreground">{r.name}</span>
              <span className="relative h-4">
                <span className="absolute inset-y-0 left-0 w-full rounded-[3px] bg-slate-100" aria-hidden />
                {SERIES.map((s) => {
                  const v = r[s.key];
                  const el = v > 0 ? <span key={s.key} className={cn("absolute inset-y-0", s.cls)} style={{ left: x(left), width: x(v) }} aria-hidden /> : null;
                  left += v;
                  return el;
                })}
                {r.quota > 0 && <span className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `calc(${x(r.quota)} - 1px)` }} aria-hidden />}
                {r.seasonalExpected > 0 && (
                  <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-primary bg-card" style={{ left: x(r.seasonalExpected) }} aria-hidden />
                )}
              </span>
              <span className="text-right text-xs whitespace-nowrap tabular">
                {r.quota > 0 ? (
                  <>
                    <span className="font-medium">{pct(r.attainmentPct)}</span>
                    <span className="text-muted-foreground"> · {pct(r.forecastPct)} exp.</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">No quota</span>
                )}
              </span>
            </li>
          );
        })}
        {!reps.length && <li className="text-sm text-muted-foreground">No reps in this period</li>}
      </ul>
    </div>
  );
}

function WhatIfPanel({ whatIf, setWhatIf, projected, projectedPct, expected, quota }: { whatIf: WhatIf; setWhatIf: (w: WhatIf) => void; projected: number; projectedPct: number; expected: number; quota: number }) {
  const rows: { key: keyof WhatIf; label: string; min: number; max: number; step: number; fmt: (v: number) => string }[] = [
    { key: "winRate", label: "Win rate", min: 0.5, max: 1.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: "dealSize", label: "Avg deal size", min: 0.5, max: 1.5, step: 0.05, fmt: (v) => `${v.toFixed(2)}×` },
    { key: "slippagePct", label: "Slippage", min: 0, max: 60, step: 5, fmt: (v) => `${v}% pushed out` },
  ];
  const delta = projected - expected;
  return (
    <section className="min-w-0 rounded-md border bg-card" aria-labelledby="whatif-title">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 id="whatif-title" className="text-sm font-semibold">
          What-if
        </h2>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setWhatIf(DEFAULT_WHAT_IF)} disabled={JSON.stringify(whatIf) === JSON.stringify(DEFAULT_WHAT_IF)}>
          Reset
        </Button>
      </div>
      <div className="space-y-4 p-4">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-center justify-between text-sm">
              <label htmlFor={`wi-${r.key}`}>{r.label}</label>
              <span className="text-xs font-medium tabular">{r.fmt(whatIf[r.key])}</span>
            </div>
            <Slider
              id={`wi-${r.key}`}
              className="mt-2"
              value={[whatIf[r.key]]}
              min={r.min}
              max={r.max}
              step={r.step}
              onValueChange={([v]) => setWhatIf({ ...whatIf, [r.key]: v })}
              aria-label={r.label}
            />
          </div>
        ))}
        <div className="border-t pt-3">
          <p className="text-xs text-muted-foreground">Projected</p>
          <p className="mt-0.5 flex items-baseline gap-2 text-2xl font-semibold tabular">
            {fmtMoney(projected)}
            {Math.abs(delta) >= 1 && (
              <span className={cn("text-xs font-medium", delta > 0 ? "text-status-good" : "text-status-critical")}>
                {delta > 0 ? "+" : "−"}
                {money(Math.abs(delta))}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground tabular">{quota > 0 ? `${pct(projectedPct)} of ${money(quota)} quota` : "No quota for this period"}</p>
        </div>
      </div>
    </section>
  );
}

export function ForecastView() {
  const { data, asOf, ready, lightningBaseUrl } = useStore();
  const { role } = useAuth();
  const userId = useUserId();
  const { update } = useCrud();
  const team = can(role, "see:team");
  const canOverride = can(role, "override:forecast");

  const [granularity, setGranularity] = useState<Granularity>("quarter");
  const [offset, setOffset] = useState(0);
  const [rep, setRep] = useState<string>("all");
  const [whatIf, setWhatIf] = useState<WhatIf>(DEFAULT_WHAT_IF);
  const [category, setCategory] = useState<string>("all");

  const ownerId = team ? (rep === "all" ? undefined : rep) : userId;
  const f = useMemo(() => buildForecast(data, asOf, { granularity, offset, ownerId, whatIf }), [data, asOf, granularity, offset, ownerId, whatIf]);
  const teamReps = useMemo(() => {
    const ids = new Set(data.quotas.map((q) => q.OwnerId));
    return [...ids].map((id) => ({ id, name: USER_BY_ID[id]?.Name ?? id })).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.quotas]);

  const rows = useMemo(() => (category === "all" ? f.dealRows : f.dealRows.filter((d) => (d.won ? "Closed" : d.category) === category)), [f.dealRows, category]);

  const setRepCategory = (d: ForecastDeal, v: ForecastCategory) => update("Opportunity", d.opp.Id, { ForecastCategoryName: v }, d.opp.Name);
  const setOverride = (d: ForecastDeal, v: string) =>
    // null (not undefined) so clearing survives the JSON change log
    update("Opportunity", d.opp.Id, { Manager_Forecast_Category__c: v ? (v as ForecastCategory) : (null as unknown as undefined) }, d.opp.Name);

  const columns: Column<ForecastDeal>[] = [
    {
      key: "name",
      header: "Deal",
      sortValue: (d) => d.accountName,
      cell: (d) => (
        <div className="min-w-0">
          <Link href={opportunityHref(d.opp.Id, lightningBaseUrl)} className="block max-w-[260px] truncate font-medium hover:underline">
            {d.accountName || d.opp.Name}
          </Link>
          <span className="block max-w-[260px] truncate text-xs text-muted-foreground">{d.opp.Name.split(" - ").slice(1).join(" - ") || d.opp.StageName}</span>
        </div>
      ),
    },
    ...(team && !ownerId ? [{ key: "owner", header: "Owner", sortValue: (d: ForecastDeal) => d.ownerName, cell: (d: ForecastDeal) => d.ownerName, hideBelow: "md" as const }] : []),
    { key: "close", header: "Close", sortValue: (d) => d.opp.CloseDate, cell: (d) => <span className="tabular">{fmtShortDate(d.opp.CloseDate)}</span> },
    { key: "stage", header: "Stage", sortValue: (d) => d.opp.Probability, cell: (d) => (d.won ? "Closed Won" : d.opp.IsClosed ? "Open" : d.opp.StageName), hideBelow: "lg" },
    { key: "amount", header: "Amount", align: "right", sortValue: (d) => d.opp.Amount, cell: (d) => fmtMoney(d.opp.Amount) },
    {
      key: "category",
      header: "Category",
      sortValue: (d) => (d.won ? "Closed" : d.repCategory),
      cell: (d) => {
        if (d.won) return <span className="text-muted-foreground">Closed</span>;
        const mine = d.opp.OwnerId === userId && !d.opp.IsClosed && !canOverride;
        if (!mine) return <span className={cn(d.override && "text-muted-foreground line-through decoration-slate-400")}>{d.repCategory}</span>;
        return (
          <select className={SELECT} value={d.repCategory} onChange={(e) => setRepCategory(d, e.target.value as ForecastCategory)} aria-label={`Category for ${d.opp.Name}`}>
            {OPEN_CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        );
      },
    },
    ...(canOverride
      ? [
          {
            key: "override",
            header: "Override",
            sortValue: (d: ForecastDeal) => d.override ?? "",
            cell: (d: ForecastDeal) =>
              d.won ? null : (
                <select
                  className={cn(SELECT, d.override && "border-primary/50 font-medium text-primary")}
                  value={d.override ?? ""}
                  onChange={(e) => setOverride(d, e.target.value)}
                  aria-label={`Manager override for ${d.opp.Name}`}
                >
                  <option value="">None</option>
                  {OPEN_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              ),
          },
        ]
      : []),
    {
      key: "expected",
      header: "Seasonal expected",
      align: "right",
      sortValue: (d) => d.seasonalExpected,
      cell: (d) => (
        <div className="text-right">
          <span className="tabular">{fmtMoney(d.seasonalExpected)}</span>
          {!d.won && (
            <span className="block text-xs whitespace-nowrap text-muted-foreground">
              {d.category === "Omitted" ? "Omitted" : `${Math.round(d.probability * 100)}% stage${d.seasonal.note ? ` · ${d.seasonal.note}` : ""}`}
            </span>
          )}
        </div>
      ),
    },
  ];

  if (!ready) return <Skeleton className="h-[640px]" />;

  const periodLabel = offset === 0 ? `${f.periodLabel} (current)` : f.periodLabel;
  const noOpen = f.commit + f.bestCase + f.pipeline === 0;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{team ? "Forecast" : "My Forecast"}</h1>
          {!team && <span className="text-sm text-muted-foreground">{USER_BY_ID[userId]?.Name}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {team && (
            <select className="h-8 rounded-md border border-input bg-card px-2 text-sm" value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Rep">
              <option value="all">Whole team</option>
              {teamReps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <Segmented
            label="Period length"
            value={granularity}
            options={[
              ["month", "Month"],
              ["quarter", "Quarter"],
            ]}
            onChange={(g) => {
              setGranularity(g);
              setOffset(0);
            }}
          />
          <div className="flex items-center rounded-md border bg-card">
            <button type="button" className="flex size-8 items-center justify-center hover:bg-muted" onClick={() => setOffset(offset - 1)} aria-label="Previous period">
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button type="button" className="min-w-[124px] px-1 text-sm font-medium tabular" onClick={() => setOffset(0)} title="Back to the current period">
              {periodLabel}
            </button>
            <button type="button" className="flex size-8 items-center justify-center hover:bg-muted" onClick={() => setOffset(offset + 1)} aria-label="Next period">
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7" aria-label="Forecast summary">
        <Kpi label="Quota" value={money(f.quota)} sub={granularity === "month" ? "⅓ of quarter" : f.period} />
        <Kpi label="Closed" value={money(f.closed)} sub={`${f.dealRows.filter((d) => d.won).length} won`} />
        <Kpi label="Commit" value={money(f.commit)} sub={`Closed + commit ${money(f.closed + f.commit)}`} />
        <Kpi label="Best Case" value={money(f.bestCase)} />
        <Kpi label="Pipeline" value={money(f.pipeline)} sub={f.omitted ? `${money(f.omitted)} omitted` : undefined} />
        <Kpi label="Seasonal expected" value={money(f.seasonalExpected)} sub={`Weighted ${money(f.weighted)}`} strong />
        <Kpi label="Attainment" value={f.quota ? pct(f.attainmentPct) : "–"} sub={f.quota ? `${pct(f.forecastPct)} expected` : undefined} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="min-w-0 rounded-md border bg-card" aria-labelledby="reps-title">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
            <h2 id="reps-title" className="text-sm font-semibold">
              {team && !ownerId ? "By rep vs quota" : "Vs quota"}
            </h2>
            <span className="text-xs text-muted-foreground tabular">{f.periodLabel}</span>
          </div>
          <div className="p-4">
            <RepChart reps={f.byRep} />
            {noOpen && f.closed > 0 && <p className="mt-3 text-xs text-muted-foreground">No open deals close in this period.</p>}
          </div>
        </section>
        <WhatIfPanel whatIf={whatIf} setWhatIf={setWhatIf} projected={f.projected} projectedPct={f.projectedPct} expected={f.seasonalExpected} quota={f.quota} />
      </div>

      <section className="space-y-2" aria-labelledby="deals-title">
        <h2 id="deals-title" className="text-sm font-semibold">
          Deals closing in {f.periodLabel}
        </h2>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(d) => d.opp.Id}
          search={{ placeholder: "Search deals", text: (d) => `${d.accountName} ${d.opp.Name} ${d.ownerName}` }}
          filters={
            <select className="h-8 rounded-md border border-input bg-card px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="all">All categories</option>
              {(["Closed", "Commit", "Best Case", "Pipeline", "Omitted"] as const).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          }
          filterKey={`${category}|${f.period}|${ownerId ?? ""}`}
          defaultSort={{ key: "close", dir: "asc" }}
          param="deals"
          minWidth={760}
          caption={`Deals closing in ${f.periodLabel}`}
          empty={team ? "No deals close in this period" : "You have no deals closing in this period"}
        />
      </section>
    </div>
  );
}
