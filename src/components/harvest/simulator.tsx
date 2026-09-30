"use client";

import { useMemo, useState } from "react";
import { Columns2, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DAY_MINUTES, clockLabel, simulateDay, type DaySim } from "@/lib/harvest/engine";
import { facilityFromAccount, summarize, trucksFor, type Competitor, type HarvestSummary, type SimSettings } from "@/lib/harvest/summary";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Account } from "@/types/salesforce";
import { QueueChart } from "./queue-chart";
import { RouteInset } from "./route-inset";
import { SettingsPopover } from "./settings-popover";
import { SPEEDS, useSimClock, type SimClock } from "./use-sim-clock";
import { YardScene, type SceneCompetitor } from "./yard-scene";

const bu = (n: number) => `${fmtNumber(Math.round(n))} bu`;
const usd = (n: number) => fmtMoney(Math.round(n), { compact: false });
const storageLabel = (n?: number) => (!n ? "—" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M bu` : `${Math.round(n / 1000)}K bu`);

export interface SimulatorProps {
  account: Account;
  competitor: Competitor | null;
  settings: SimSettings;
  onSettingsChange: (s: SimSettings) => void;
  /** Buttons under the end-of-day summary (save, share, open account) */
  actions?: (summary: HarvestSummary) => React.ReactNode;
  /** Extra content beside the summary actions (e.g. the ranking weight slider) */
  aside?: React.ReactNode;
  autoPlay?: boolean;
}

export function HarvestSimulator({ account, competitor, settings, onSettingsChange, actions, aside, autoPlay = true }: SimulatorProps) {
  const clock = useSimClock({ autoPlay });
  const [compare, setCompare] = useState(false);
  const [skipped, setSkipped] = useState(false);

  const facility = useMemo(() => facilityFromAccount(account), [account]);
  const sims = useMemo(() => {
    if (!facility) return null;
    const trucks = trucksFor(facility);
    return {
      manual: simulateDay(facility, { serviceMinutes: settings.manualMinutes, waitLimitMinutes: settings.waitLimitMinutes }, trucks),
      automated: simulateDay(facility, { serviceMinutes: settings.automatedMinutes, waitLimitMinutes: settings.waitLimitMinutes }, trucks),
    };
  }, [facility, settings.manualMinutes, settings.automatedMinutes, settings.waitLimitMinutes]);
  const summary = useMemo(() => summarize(account, competitor, settings), [account, competitor, settings]);
  // Stable clock API and props so the scenes and charts only re-render when their data changes
  const clockApi = useMemo(() => ({ subscribe: clock.subscribe, seek: clock.seek }), [clock.subscribe, clock.seek]);
  const sceneCompetitor = useMemo<SceneCompetitor | null>(
    () => (competitor ? { name: competitor.account.Name, miles: competitor.miles, direction: competitor.direction, east: competitor.bearing > 0 && competitor.bearing < 180 } : null),
    [competitor],
  );

  if (!facility || !sims || !summary) {
    return <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">No truck receiving on record for {account.Name} (scales, dump pits and volume are needed).</div>;
  }

  const m = Math.min(DAY_MINUTES, clock.minute);
  const showSummary = clock.ended || skipped;

  const toggleCompare = () => {
    setCompare((c) => !c);
    clock.restart();
  };

  return (
    <div className="space-y-4">
      <FacilityHeader account={account} summary={summary} />

      <section className="rounded-md border bg-card" aria-label="Harvest day simulation">
        <Controls clock={clock} settings={settings} onSettingsChange={onSettingsChange} compare={compare} onCompare={toggleCompare} />

        {compare ? (
          <div className="grid gap-px bg-border md:grid-cols-2">
            <ScenePanel
              title="Manual"
              note={`${settings.manualMinutes} min per truck`}
              sim={sims.manual}
              clock={clockApi}
              competitor={sceneCompetitor}
              dailyBushels={summary.dailyBushels}
              minute={m}
              margin={settings.marginPerBu}
            />
            <ScenePanel
              title="ScaleTrac + GrainSight Mobile"
              note={`${settings.automatedMinutes} min per truck`}
              sim={sims.automated}
              clock={clockApi}
              competitor={sceneCompetitor}
              dailyBushels={summary.dailyBushels}
              minute={m}
              margin={settings.marginPerBu}
              accent
            />
          </div>
        ) : (
          <div className="grid gap-px bg-border lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="bg-card">
              <YardScene sim={sims.manual} clock={clockApi} competitor={sceneCompetitor} dailyBushels={summary.dailyBushels} label={`${account.Name} receiving yard, manual scale`} />
            </div>
            <div className="space-y-4 bg-card p-4">
              <Counters sim={sims.manual} minute={m} margin={settings.marginPerBu} />
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Trucks waiting</p>
                <QueueChart manual={sims.manual} clock={clockApi} />
              </div>
              {competitor && <Inset account={account} competitor={competitor} />}
            </div>
          </div>
        )}

        {compare && (
          <div className="grid gap-4 border-t p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-3">
              <Difference manual={sims.manual} automated={sims.automated} minute={m} margin={settings.marginPerBu} />
              <div>
                <p className="mb-1 flex items-center gap-3 text-xs font-medium text-muted-foreground">
                  Trucks waiting
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-3 rounded bg-status-critical" /> Manual
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-3 rounded bg-primary" /> Automated
                  </span>
                </p>
                <QueueChart manual={sims.manual} automated={sims.automated} clock={clockApi} height={140} />
              </div>
            </div>
            {competitor && <Inset account={account} competitor={competitor} />}
          </div>
        )}
      </section>

      {showSummary ? (
        <SummaryCard summary={summary} actions={actions?.(summary)} aside={aside} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed bg-card px-4 py-3 text-sm text-muted-foreground">
          <span>End-of-day summary at 11:00 pm</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSkipped(true);
              clock.pause();
              clock.seek(DAY_MINUTES);
            }}
          >
            <SkipForward className="size-3.5" aria-hidden /> Skip to end of day
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function FacilityHeader({ account, summary }: { account: Account; summary: HarvestSummary }) {
  const facts: [string, string][] = [
    ["Peak day", `${bu(summary.dailyBushels)} · ${fmtNumber(summary.trucksPerDay)} trucks`],
    [
      account.Annual_Production_Gal__c ? "Production" : "Storage",
      account.Annual_Production_Gal__c ? `${Math.round(account.Annual_Production_Gal__c / 1e6)}M gal/yr` : storageLabel(account.Storage_Capacity_Bu__c),
    ],
    ["Scales", String(summary.scales)],
    ["Dump pits", `${summary.pits} × ${fmtNumber(summary.pitRateBph)} bu/h`],
    ["County yield", `${summary.yieldFactor.toFixed(2)}×`],
    ["Nearest competitor", summary.competitorName ? `${summary.competitorName} · ${summary.competitorMiles} mi ${summary.competitorDirection}` : "—"],
  ];
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-semibold">{account.Name}</h2>
        <p className="text-sm text-muted-foreground">
          {[account.BillingCity, account.BillingState].filter(Boolean).join(", ")} · {account.Segment__c}
        </p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        {facts.map(([k, v]) => (
          <div key={k} className={cn("min-w-0", k === "Nearest competitor" && "col-span-2 sm:col-span-1")}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate text-sm font-medium tabular" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Controls({
  clock,
  settings,
  onSettingsChange,
  compare,
  onCompare,
}: {
  clock: SimClock;
  settings: SimSettings;
  onSettingsChange: (s: SimSettings) => void;
  compare: boolean;
  onCompare: () => void;
}) {
  const m = Math.min(DAY_MINUTES, clock.minute);
  return (
    <div className="space-y-2 border-b p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={clock.toggle} aria-label={clock.playing ? "Pause" : "Play"} className="w-20">
          {clock.playing ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {clock.playing ? "Pause" : "Play"}
        </Button>
        <Button size="icon-sm" variant="outline" onClick={clock.restart} aria-label="Restart the day">
          <RotateCcw className="size-3.5" aria-hidden />
        </Button>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => clock.setSpeed(s)}
              aria-pressed={clock.speed === s}
              className={cn("h-6 min-w-9 rounded-[4px] px-1.5 text-xs tabular text-muted-foreground hover:text-foreground", clock.speed === s && "bg-muted font-medium text-foreground")}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="ml-1 min-w-[5.5rem] text-xl font-semibold tracking-tight whitespace-nowrap tabular" aria-live="off">
          {clockLabel(m)}
        </span>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <SettingsPopover settings={settings} onChange={onSettingsChange} />
          <Button size="sm" variant={compare ? "default" : "outline"} onClick={onCompare} aria-pressed={compare}>
            <Columns2 className="size-3.5" aria-hidden />
            With ScaleTrac + GrainSight Mobile
          </Button>
        </div>
      </div>
      <Timeline clock={clock} />
    </div>
  );
}

const HOUR_MARKS = [0, 180, 360, 540, 720, 900, 1080];

function Timeline({ clock }: { clock: SimClock }) {
  const m = Math.min(DAY_MINUTES, clock.minute);
  return (
    <div>
      <input
        type="range"
        min={0}
        max={DAY_MINUTES}
        step={1}
        value={m}
        onChange={(e) => clock.seek(Number(e.target.value))}
        aria-label="Time of day"
        aria-valuetext={clockLabel(m)}
        className="h-1.5 w-full cursor-pointer accent-[#1f5f4a]"
      />
      <div className="relative mt-0.5 h-3.5 text-[10px] text-muted-foreground">
        {HOUR_MARKS.map((x) => (
          <span key={x} className="absolute -translate-x-1/2 whitespace-nowrap tabular first:translate-x-0 last:-translate-x-full" style={{ left: `${(x / DAY_MINUTES) * 100}%` }}>
            {clockLabel(x).replace(":00", "")}
          </span>
        ))}
      </div>
    </div>
  );
}

function ScenePanel({
  title,
  note,
  sim,
  clock,
  competitor,
  dailyBushels,
  minute,
  margin,
  accent,
}: {
  title: string;
  note: string;
  sim: DaySim;
  clock: Pick<SimClock, "subscribe">;
  competitor: SceneCompetitor | null;
  dailyBushels: number;
  minute: number;
  margin: number;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 bg-card">
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
        <span className={cn("text-sm font-semibold", accent && "text-primary")}>{title}</span>
        <span className="text-xs text-muted-foreground tabular">{note}</span>
      </div>
      <YardScene sim={sim} clock={clock} competitor={competitor} dailyBushels={dailyBushels} label={`${title} receiving yard`} automated={accent} />
      <div className="p-3">
        <Counters sim={sim} minute={minute} margin={margin} compact />
      </div>
    </div>
  );
}

function Counters({ sim, minute, margin, compact }: { sim: DaySim; minute: number; margin: number; compact?: boolean }) {
  const s = sim.series;
  const lostBu = s.buLost[minute];
  const items: { label: string; value: string; tone?: "bad" }[] = [
    { label: "Trucks waiting", value: String(s.queue[minute]) },
    { label: "Current wait", value: `${Math.round(s.wait[minute])} min`, tone: s.wait[minute] >= 30 ? "bad" : undefined },
    { label: "Bushels lost", value: fmtNumber(Math.round(lostBu)), tone: lostBu > 0 ? "bad" : undefined },
    { label: "Dollars lost", value: usd(lostBu * margin), tone: lostBu > 0 ? "bad" : undefined },
  ];
  return (
    <dl className={cn("grid grid-cols-2 gap-2", compact && "sm:grid-cols-4")}>
      {items.map((it) => (
        <div key={it.label} className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{it.label}</dt>
          <dd className={cn("font-semibold tracking-tight tabular", compact ? "text-lg" : "text-2xl", it.tone === "bad" && "text-status-critical")}>{it.value}</dd>
        </div>
      ))}
      <div className={cn("col-span-2 flex justify-between px-1 text-xs text-muted-foreground tabular", compact && "sm:col-span-4")}>
        <span>{fmtNumber(s.served[minute])} trucks dumped</span>
        <span>{fmtNumber(s.lost[minute])} gave up</span>
      </div>
    </dl>
  );
}

function Difference({ manual, automated, minute, margin }: { manual: DaySim; automated: DaySim; minute: number; margin: number }) {
  const keptBu = Math.max(0, manual.series.buLost[minute] - automated.series.buLost[minute]);
  const trucks = Math.max(0, manual.series.lost[minute] - automated.series.lost[minute]);
  return (
    <div className="rounded-md border border-primary/25 bg-accent-soft px-4 py-3">
      <p className="text-xs font-medium text-primary">Kept with ScaleTrac + GrainSight Mobile so far today</p>
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-2xl font-semibold tracking-tight text-primary tabular">{usd(keptBu * margin)}</span>
        <span className="text-sm text-foreground tabular">{bu(keptBu)}</span>
        <span className="text-sm text-muted-foreground tabular">{fmtNumber(trucks)} trucks</span>
      </p>
    </div>
  );
}

function Inset({ account, competitor }: { account: Account; competitor: Competitor }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">Where the lost trucks go</p>
      <RouteInset
        facility={{ name: account.Name, lat: account.BillingLatitude, lon: account.BillingLongitude }}
        competitor={{ name: competitor.account.Name, lat: competitor.account.BillingLatitude, lon: competitor.account.BillingLongitude }}
        miles={competitor.miles}
        direction={competitor.direction}
      />
    </div>
  );
}

function SummaryCard({ summary: s, actions, aside }: { summary: HarvestSummary; actions?: React.ReactNode; aside?: React.ReactNode }) {
  const tiles: { label: string; value: string; note: string; tone?: "bad" | "good" }[] = [
    { label: "Worst hour", value: s.manual.worstHour.label, note: `${s.manual.worstHour.trucksWaiting} trucks waiting · ${s.manual.worstHour.waitMinutes} min wait` },
    {
      label: "Lost per day",
      value: usd(s.manual.dollarsLostPerDay),
      note: `${fmtNumber(s.manual.trucksLost)} trucks · ${bu(s.manual.bushelsLostPerDay)}`,
      tone: s.manual.dollarsLostPerDay > 0 ? "bad" : undefined,
    },
    {
      label: `Harvest season · ${s.settings.seasonDays} days`,
      value: usd(s.manual.seasonDollarsLost),
      note: `${bu(s.manual.seasonBushelsLost)} to ${s.competitorName ?? "competitors"}`,
      tone: s.manual.seasonDollarsLost > 0 ? "bad" : undefined,
    },
    { label: "Saved with automation", value: usd(s.seasonSavings), note: `Automated still loses ${usd(s.automated.seasonDollarsLost)}`, tone: "good" },
  ];
  return (
    <section className="animate-in fade-in slide-in-from-bottom-2 rounded-md border bg-card duration-500" aria-label="End-of-day summary">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
        <h3 className="font-semibold">End of day</h3>
        <span className="text-xs text-muted-foreground">
          Manual {s.settings.manualMinutes} min vs. automated {s.settings.automatedMinutes} min per truck · trucks leave after {s.settings.waitLimitMinutes} min · ${s.settings.marginPerBu.toFixed(2)}
          /bu
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
            <dd className={cn("mt-0.5 text-2xl font-semibold tracking-tight tabular", t.tone === "bad" && "text-status-critical", t.tone === "good" && "text-primary")}>{t.value}</dd>
            <dd className="mt-0.5 text-xs text-muted-foreground tabular">{t.note}</dd>
          </div>
        ))}
      </dl>
      {(actions || aside) && (
        <div className="flex flex-wrap items-end justify-between gap-4 border-t px-4 py-3">
          <div className="flex flex-wrap gap-2">{actions}</div>
          {aside && <div className="w-full sm:w-60">{aside}</div>}
        </div>
      )}
    </section>
  );
}
