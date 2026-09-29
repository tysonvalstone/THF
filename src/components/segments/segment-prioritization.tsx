"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/store";
import { DEFAULT_K, DEFAULT_WEIGHTS, prioritize, WEIGHT_LABELS, type SegmentPriority, type Weights } from "@/lib/prioritization";
import { formatRate, type RateEstimate, type Tag } from "@/lib/stats";
import { closeDateFlags, sellingWindowAt } from "@/lib/seasonality";
import { opportunityHref } from "@/lib/links";
import { fmtDate, fmtShortDate, MONTHS_SHORT, parseDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A number with a plain-English tooltip */
function Num({ tip, children, className }: { tip: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("cursor-help tabular underline decoration-slate-300 decoration-dotted underline-offset-4", className)}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-relaxed">{tip}</TooltipContent>
    </Tooltip>
  );
}

export function TagChip({ tag }: { tag: Tag }) {
  const cls = tag === "Measured" ? "border-slate-300 text-slate-700" : tag === "Blended" ? "border-amber-300 text-amber-800" : "border-slate-300 text-slate-500 border-dashed";
  const tip =
    tag === "Measured"
      ? "Measured: based on at least 10 decided deals in this group."
      : tag === "Blended"
        ? "Blended: fewer than 10 decided deals, so the rate is pulled toward a broader rate (prior strength k)."
        : "Prior: no history here yet, so a broader rate is used as a starting assumption.";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex h-5 cursor-help items-center rounded-md border px-1.5 text-[11px] font-medium", cls)}>
          {tag}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Close rate with its Wilson 95% interval drawn on a 0–100% track */
function IntervalBar({ r }: { r: RateEstimate }) {
  return (
    <div className="relative h-2 w-full rounded-sm bg-slate-100" aria-hidden>
      <div className="absolute inset-y-0 rounded-sm bg-[var(--viz-seq-2)]/60" style={{ left: `${r.low * 100}%`, width: `${Math.max(1, (r.high - r.low) * 100)}%` }} />
      <div className="absolute -inset-y-0.5 w-0.5 rounded-sm bg-[var(--viz-seq-4)]" style={{ left: `calc(${r.rate * 100}% - 1px)` }} />
    </div>
  );
}

function rateText(r: RateEstimate) {
  return r.enoughData ? pct(r.rate) : "Not enough data";
}

function MonthStrip({ s }: { s: SegmentPriority }) {
  const max = Math.max(0.01, ...s.stats.byCreatedMonth.map((m) => m.rate));
  return (
    <div>
      <div className="grid grid-cols-12 gap-[2px]">
        {s.stats.byCreatedMonth.map((m, i) => {
          const low = !m.enoughData;
          const h = Math.max(8, (m.rate / max) * 100);
          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  tabIndex={0}
                  className={cn("relative flex h-10 cursor-help items-end rounded-sm bg-slate-50", i === s.month && "ring-2 ring-primary ring-offset-1")}
                  aria-label={`${MONTHS_SHORT[i]}: ${low ? "not enough data" : pct(m.rate)}`}
                >
                  <div
                    className="w-full rounded-sm"
                    style={{
                      height: `${h}%`,
                      background: low ? "repeating-linear-gradient(45deg,#cbd5e1 0 2px,#f1f5f9 2px 5px)" : "var(--viz-seq-3)",
                    }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                <p className="font-medium">Deals created in {MONTHS_SHORT[i]}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {low ? `Not enough data (${m.decided} decided). ${formatRate(m)}.` : `${pct(m.rate)} close rate (${m.won} of ${m.decided}).`}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1 grid grid-cols-12 gap-[2px] text-center text-[10px] text-muted-foreground">
        {MONTHS_SHORT.map((m, i) => (
          <span key={m} className={cn(i === s.month && "font-semibold text-primary")}>
            {m[0]}
          </span>
        ))}
      </div>
    </div>
  );
}

function SegmentCard({ s, maxScore }: { s: SegmentPriority; maxScore: number }) {
  const r = s.seasonalRate;
  const overall = s.stats.closeRate;
  const monthName = MONTHS_SHORT[s.month];
  return (
    <article className="rounded-md border bg-card p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="w-5 text-sm font-semibold text-muted-foreground tabular">{s.rank}</span>
          <div>
            <h3 className="text-base font-semibold">{s.segment}</h3>
            <p className="text-xs text-muted-foreground">
              <Num tip="Parent accounts in this segment">{s.accounts}</Num> accounts ·{" "}
              <Num tip="Open opportunities and amount">
                {s.openDeals} open, {fmtMoney(s.openPipeline)}
              </Num>
            </p>
          </div>
        </div>
        <div className="text-right">
          <Num
            tip={`Seasonal close rate × weighted blend (${pct(s.blend)})`}
            className="text-2xl font-semibold no-underline"
          >
            {s.score}
          </Num>
          <div className="mt-1 h-1 w-16 rounded-sm bg-slate-100">
            <div className="h-1 rounded-sm bg-primary" style={{ width: `${(s.score / Math.max(1, maxScore)) * 100}%` }} />
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Priority</p>
        </div>
      </header>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Close Rate ({monthName})</p>
          <div className="mt-1 flex items-center gap-2">
            <Num tip={`${r.explanation} 95% Wilson interval: ${pct(r.low)}–${pct(r.high)}.`} className="text-lg font-semibold">
              {rateText(r)}
            </Num>
            <TagChip tag={r.tag} />
          </div>
          <div className="mt-2">
            <IntervalBar r={r} />
            <p className="mt-1 text-[11px] text-muted-foreground tabular">
              95% range {pct(r.low)}–{pct(r.high)} · all months: {overall.enoughData ? pct(overall.rate) : "not enough data"} ({overall.tag.toLowerCase()})
            </p>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Decided Deals</p>
          <Num tip={`${s.stats.won} won and ${s.stats.lost} lost deals (${s.stats.open} still open). Close rates need at least 10 decided deals.`} className="text-lg font-semibold">
            {s.stats.decided}
          </Num>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Median Cycle</p>
          <Num
            tip={s.stats.medianDaysToClose === null ? "No closed deals yet; the company median is used for ranking." : "Median days from created to closed, over decided deals."}
            className="text-lg font-semibold"
          >
            {s.stats.medianDaysToClose === null ? "—" : `${Math.round(s.stats.medianDaysToClose)} d`}
          </Num>
          <p className="text-[11px] text-muted-foreground">{s.components.cycleSpeed.tag.toLowerCase()}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Median Won Deal</p>
          <Num tip={s.stats.medianWonAmount === null ? "No won deals yet; the company median is used for ranking." : "Median Amount of won deals."} className="text-lg font-semibold">
            {s.stats.medianWonAmount === null ? "—" : fmtMoney(s.stats.medianWonAmount)}
          </Num>
          <p className="text-[11px] text-muted-foreground">{s.components.dealSize.tag.toLowerCase()}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Close rate by month created</p>
          <MonthStrip s={s} />
        </div>
        <div>
          <p className="mb-1.5 text-xs text-muted-foreground">Priority inputs</p>
          <ul className="space-y-1.5">
            {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => {
              const c = s.components[k];
              const raw =
                c.raw === null
                  ? "no data"
                  : k === "dealSize"
                    ? fmtMoney(c.raw)
                    : k === "cycleSpeed"
                      ? `${Math.round(c.raw)} days`
                      : k === "productFit"
                        ? pct(c.raw)
                        : `${c.raw.toFixed(1)} locations`;
              return (
                <li key={k} className="grid grid-cols-[110px_1fr_36px] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{WEIGHT_LABELS[k].label}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div tabIndex={0} className="h-1.5 cursor-help rounded-sm bg-slate-100">
                        <div className="h-1.5 rounded-sm bg-slate-500" style={{ width: `${c.scaled * 100}%` }} />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-64">
                      {WEIGHT_LABELS[k].help} Value: {raw} ({c.tag.toLowerCase()}).
                    </TooltipContent>
                  </Tooltip>
                  <span className="text-right tabular">{c.scaled.toFixed(2)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </article>
  );
}

function WeightPanel({ weights, setWeights, k, setK }: { weights: Weights; setWeights: (w: Weights) => void; k: number; setK: (k: number) => void }) {
  return (
    <aside className="space-y-5 rounded-md border bg-panel p-4 lg:sticky lg:top-20 lg:self-start" aria-label="Weights">
      <div>
        <h2 className="text-sm font-semibold">Weights</h2>
      </div>
      {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((key) => (
        <div key={key}>
          <div className="flex items-center justify-between text-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <label tabIndex={0} className="cursor-help" htmlFor={`w-${key}`}>
                  {WEIGHT_LABELS[key].label}
                </label>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{WEIGHT_LABELS[key].help}</TooltipContent>
            </Tooltip>
            <span className="font-medium tabular">{weights[key]}</span>
          </div>
          <Slider id={`w-${key}`} className="mt-2" value={[weights[key]]} min={0} max={100} step={5} onValueChange={([v]) => setWeights({ ...weights, [key]: v })} aria-label={WEIGHT_LABELS[key].label} />
        </div>
      ))}
      <div className="border-t border-slate-300/70 pt-4">
        <div className="flex items-center justify-between text-sm">
          <Tooltip>
            <TooltipTrigger asChild>
              <label tabIndex={0} className="cursor-help" htmlFor="k">
                Prior strength (k)
              </label>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              For thin segments or months: rate = (won + k × broader rate) ÷ (decided + k). Higher k leans harder on the broader rate.
            </TooltipContent>
          </Tooltip>
          <span className="font-medium tabular">{k}</span>
        </div>
        <Slider id="k" className="mt-2" value={[k]} min={0} max={50} step={1} onValueChange={([v]) => setK(v)} aria-label="Prior strength k" />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full bg-card"
        onClick={() => {
          setWeights(DEFAULT_WEIGHTS);
          setK(DEFAULT_K);
        }}
      >
        Reset
      </Button>
    </aside>
  );
}

export function SegmentPrioritization() {
  const { ready, data, asOf, lightningBaseUrl, mode } = useStore();
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [k, setK] = useState(DEFAULT_K);
  const p = useMemo(() => (ready ? prioritize(data, asOf, weights, k) : null), [ready, data, asOf, weights, k]);
  const accounts = useMemo(() => new Map(data.accounts.map((a) => [a.Id, a])), [data.accounts]);

  if (!p) {
    return (
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Skeleton className="h-96" />
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-60" />
          <Skeleton className="h-60" />
        </div>
      </div>
    );
  }
  const window = sellingWindowAt(asOf);
  const maxScore = Math.max(...p.segments.map((s) => s.score));

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <WeightPanel weights={weights} setWeights={setWeights} k={k} setK={setK} />

      <div className="min-w-0 space-y-6">
        <header className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">Segments</h1>
          <p className="text-sm text-muted-foreground tabular">
            {fmtDate(asOf)} · {window.name}
          </p>
        </header>

        <section aria-label="Ranked segments" className="space-y-3">
          {p.segments.map((s) => (
            <SegmentCard key={s.segment} s={s} maxScore={maxScore} />
          ))}
        </section>

        <section className="rounded-md border bg-card">
          <header className="flex flex-col gap-1 border-b px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-base font-semibold">Top Open Deals by Expected Value</h2>
            </div>

          </header>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Deal</th>
                  <th className="px-4 py-2 font-medium">Segment</th>
                  <th className="px-4 py-2 font-medium">Stage</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 font-medium">Close rate</th>
                  <th className="px-4 py-2 text-right font-medium">Expected $/day</th>
                  <th className="px-4 py-2 font-medium">Close date</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {p.topOpen.map((v, i) => {
                  const flags = closeDateFlags(v.opp, accounts.get(v.opp.AccountId), asOf);
                  const href = opportunityHref(v.opp.Id, mode === "live" ? lightningBaseUrl : undefined);
                  return (
                    <tr key={v.opp.Id} className="align-top hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-muted-foreground tabular">{i + 1}</td>
                      <td className="max-w-72 px-4 py-2.5">
                        <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="font-medium text-primary hover:underline">
                          {v.accountName}
                        </a>
                        <p className="truncate text-xs text-muted-foreground">{v.opp.Name.replace(`${v.accountName} - `, "")}</p>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{v.segment}</td>
                      <td className="px-4 py-2.5">{v.opp.StageName}</td>
                      <td className="px-4 py-2.5 text-right tabular">{fmtMoney(v.opp.Amount)}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex items-center gap-1.5">
                          <Num tip={`${v.rate.explanation} Uses the rate for ${MONTHS_SHORT[parseDate(v.opp.CreatedDate).getUTCMonth()]}-created deals in this segment.`}>{pct(v.rate.rate)}</Num>
                          <TagChip tag={v.rate.tag} />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Num tip={`${pct(v.rate.rate)} × ${fmtMoney(v.opp.Amount, { compact: false })} = ${fmtMoney(v.expectedAmount)} expected, ÷ ${Math.round(v.medianDays)}-day median cycle.`}>
                          ${Math.round(v.expectedPerDay).toLocaleString()}
                        </Num>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="tabular">{fmtShortDate(v.opp.CloseDate)}</span>
                        {flags.map((f) => (
                          <Tooltip key={f.kind}>
                            <TooltipTrigger asChild>
                              <span tabIndex={0} className="mt-1 block w-fit cursor-help rounded-md border border-amber-300 px-1.5 text-[11px] text-amber-800">
                                {f.kind === "board" ? "Before board" : f.kind === "blackout" ? "In blackout" : "No econ. buyer"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64">{f.message}</TooltipContent>
                          </Tooltip>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
