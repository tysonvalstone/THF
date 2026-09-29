"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CloudSun } from "lucide-react";
import { REGIONS } from "@/data/reference/regions";
import { useStore } from "@/lib/data/store";
import { climateFor, cropNoun, harvestWindows } from "@/lib/season";
import { addDays, diffDays, fmtShortDate, MONTHS_SHORT } from "@/lib/dates";
import { COMMODITIES, type Commodity } from "@/types/salesforce";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const LAUNCH_BG = "repeating-linear-gradient(135deg, var(--phase-pre) 0 3px, #cfe0f7 3px 6px)";
const PLANT_BG = "repeating-linear-gradient(45deg, #9fb9a4 0 2px, #e3ece4 2px 5px)";

interface Bar {
  kind: "planting" | "launch" | "harvest" | "settlement";
  start: Date;
  end: Date;
  label: string;
}

export function SeasonCalendar() {
  const { ready, asOf } = useStore();
  const [year, setYear] = useState<number | null>(null);
  const [country, setCountry] = useState<"all" | "US" | "CA">("all");
  const [commodity, setCommodity] = useState<Commodity | "all">("all");
  const y = year ?? asOf.getUTCFullYear();
  const yearStart = useMemo(() => new Date(Date.UTC(y, 0, 1)), [y]);
  const yearEnd = useMemo(() => new Date(Date.UTC(y + 1, 0, 1)), [y]);
  const days = diffDays(yearEnd, yearStart);
  const pct = (d: Date) => Math.min(100, Math.max(0, (diffDays(d, yearStart) / days) * 100));

  const rows = useMemo(() => {
    const out: { regionId: string; regionName: string; commodity: Commodity; importance: number; bars: Bar[] }[] = [];
    for (const r of REGIONS) {
      if (country !== "all" && r.country !== country) continue;
      for (const c of r.crops) {
        if (commodity !== "all" && c.commodity !== commodity) continue;
        if (c.importance < 0.4) continue;
        const bars: Bar[] = [];
        for (const w of harvestWindows(r.id, c, new Date(Date.UTC(y, 6, 1)))) {
          bars.push({ kind: "planting", start: w.plantStart, end: w.plantEnd, label: `${cropNoun(c.commodity)} planting` });
          bars.push({ kind: "harvest", start: w.start, end: w.end, label: `${cropNoun(c.commodity)} harvest` });
          bars.push({ kind: "settlement", start: addDays(w.end, 1), end: addDays(w.end, 60), label: "Settlement & year-end" });
        }
        out.push({ regionId: r.id, regionName: r.name, commodity: c.commodity, importance: c.importance, bars: bars.filter((b) => b.end > yearStart && b.start < yearEnd) });
      }
    }
    return out;
  }, [country, commodity, y, yearStart, yearEnd]);

  if (!ready) return <Skeleton className="h-[640px]" />;

  const todayInYear = asOf >= yearStart && asOf < yearEnd;
  const regionsShown = [...new Set(rows.map((r) => r.regionId))];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={() => setYear(y - 1)} aria-label="Previous year">
            <ChevronLeft />
          </Button>
          <span className="w-14 text-center font-semibold tabular">{y}</span>
          <Button variant="outline" size="icon-sm" onClick={() => setYear(y + 1)} aria-label="Next year">
            <ChevronRight />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "US", "CA"] as const).map((c) => (
            <Button key={c} size="sm" variant={country === c ? "secondary" : "ghost"} onClick={() => setCountry(c)}>
              {c === "all" ? "US & Canada" : c === "US" ? "United States" : "Canada"}
            </Button>
          ))}
          <select
            value={commodity}
            onChange={(e) => setCommodity(e.target.value as Commodity | "all")}
            className="h-7 rounded-md border bg-card px-2 text-sm"
            aria-label="Commodity"
          >
            <option value="all">All commodities</option>
            {COMMODITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground" aria-label="Legend">
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm" style={{ background: PLANT_BG }} /> Planting
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-phase-harvest" /> Harvest (climate-adjusted)
        </li>
        <li className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-phase-post/70" /> Settlement & year-end window
        </li>
      </ul>

      <Card className="py-0">
        <CardContent className="overflow-x-auto px-0">
          <div className="min-w-[860px]">
            <div className="sticky top-0 z-10 grid grid-cols-[220px_1fr] border-b bg-card text-xs text-muted-foreground">
              <div className="px-4 py-2 font-medium">Region · crop</div>
              <div className="relative grid grid-cols-12">
                {MONTHS_SHORT.map((m) => (
                  <div key={m} className="border-l py-2 pl-1.5">
                    {m}
                  </div>
                ))}
              </div>
            </div>
            {regionsShown.map((regionId) => {
              const regionRows = rows.filter((r) => r.regionId === regionId);
              const climate = climateFor(regionId as never, y);
              return (
                <Fragment key={regionId}>
                  <div className="grid grid-cols-[220px_1fr] border-b bg-muted/40">
                    <div className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold">
                      {regionRows[0].regionName}
                      {climate.condition !== "Normal" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="h-5 cursor-help gap-1 px-1.5 text-[10px] font-normal">
                              <CloudSun className="size-3" /> {climate.condition}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64">{climate.note}</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    <div />
                  </div>
                  {regionRows.map((row) => (
                    <div key={row.commodity} className="grid grid-cols-[220px_1fr] border-b last:border-b-0">
                      <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                        <span>{row.commodity}</span>
                      </div>
                      <div className="relative">
                        <div className="absolute inset-0 grid grid-cols-12" aria-hidden>
                          {MONTHS_SHORT.map((m) => (
                            <div key={m} className="border-l" />
                          ))}
                        </div>
                        {row.bars.map((b, i) => (
                          <Tooltip key={`${b.kind}-${i}`}>
                            <TooltipTrigger asChild>
                              <div
                                tabIndex={0}
                                className={cn(
                                  "absolute rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  b.kind === "harvest" && "top-2 bottom-2 bg-phase-harvest",
                                  b.kind === "launch" && "top-2 bottom-2",
                                  b.kind === "settlement" && "top-3 bottom-3 bg-phase-post/70",
                                  b.kind === "planting" && "top-3 bottom-3",
                                )}
                                style={{
                                  left: `${pct(b.start)}%`,
                                  width: `${Math.max(0.6, pct(b.end) - pct(b.start))}%`,
                                  background: b.kind === "launch" ? LAUNCH_BG : b.kind === "planting" ? PLANT_BG : undefined,
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              {b.label}: {fmtShortDate(b.start)} – {fmtShortDate(b.end)}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                        {todayInYear && <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-foreground/80" style={{ left: `${pct(asOf)}%` }} aria-hidden />}
                      </div>
                    </div>
                  ))}
                </Fragment>
              );
            })}
            {!rows.length && <p className="p-8 text-center text-sm text-muted-foreground">No crops match these filters.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
