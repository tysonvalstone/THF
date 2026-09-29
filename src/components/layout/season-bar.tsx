"use client";

import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/data/store";
import { SELLING_WINDOWS, sellingWindowAt, type SellingWindowDef } from "@/lib/seasonality";
import { addDays, diffDays, MONTHS_SHORT, toISODate } from "@/lib/dates";
import { TimeTravel } from "./time-travel";
import { cn } from "@/lib/utils";

const TONE: Record<SellingWindowDef["sellToGrain"], string> = {
  prime: "bg-[#1f5f4a]",
  good: "bg-[#8fbfab]",
  limited: "bg-slate-300",
  "no-contact": "bg-slate-500",
};

/**
 * Season timeline under the header: step or play through the year, or click
 * / drag anywhere on the track to change the date the whole app reasons about.
 */
export function SeasonBar() {
  const { asOf, setAsOf, isTimeTraveling, todayISO, ready } = useStore();
  const [playing, setPlaying] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const year = asOf.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const days = diffDays(new Date(Date.UTC(year + 1, 0, 1)), start);
  const pct = (d: Date) => Math.min(100, Math.max(0, (diffDays(d, start) / days) * 100));
  const w = sellingWindowAt(asOf);

  const step = (n: number) => setAsOf(toISODate(addDays(asOf, n)));

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => step(7), 450);
    return () => clearInterval(id);
  });

  const dateAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    const f = Math.min(0.9999, Math.max(0, (clientX - r.left) / r.width));
    setAsOf(toISODate(addDays(start, Math.floor(f * days))));
  };

  const segments = SELLING_WINDOWS.flatMap((sw) => {
    const [sm, sd] = sw.start.split("-").map(Number);
    const [em, ed] = sw.end.split("-").map(Number);
    const s = new Date(Date.UTC(year, sm - 1, sd));
    const e = new Date(Date.UTC(year, em - 1, ed));
    return e < s ? [{ sw, s: start, e }, { sw, s, e: new Date(Date.UTC(year, 11, 31)) }] : [{ sw, s, e }];
  });

  if (!ready) return <div className="h-12 border-b bg-card" />;

  return (
    <div className="border-b bg-card">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => step(-7)} aria-label="Back one week" className="size-7 rounded-md border text-sm hover:bg-muted">
            ‹
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause" : "Play through the season"}
            className={cn("h-7 w-12 rounded-md border text-xs font-medium hover:bg-muted", playing && "border-primary text-primary")}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button type="button" onClick={() => step(7)} aria-label="Forward one week" className="size-7 rounded-md border text-sm hover:bg-muted">
            ›
          </button>
        </div>

        <div className="order-last w-full min-w-[240px] flex-1 md:order-none md:w-auto">
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Date"
            aria-valuemin={0}
            aria-valuemax={days}
            aria-valuenow={diffDays(asOf, start)}
            aria-valuetext={asOf.toDateString()}
            className="relative h-5 cursor-pointer touch-none select-none"
            onPointerDown={(e) => {
              dragging.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              dateAt(e.clientX);
            }}
            onPointerMove={(e) => dragging.current && dateAt(e.clientX)}
            onPointerUp={() => (dragging.current = false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") step(e.shiftKey ? -30 : -1);
              if (e.key === "ArrowRight") step(e.shiftKey ? 30 : 1);
            }}
          >
            <div className="absolute inset-x-0 top-1.5 flex h-2 overflow-hidden rounded-full">
              {segments.map(({ sw, s, e }, i) => (
                <div key={`${sw.id}-${i}`} className={cn("h-full", TONE[sw.sellToGrain])} style={{ width: `${pct(e) - pct(s) + 0.27}%` }} title={`${sw.name} (${sw.when})`} />
              ))}
            </div>
            <div className="absolute top-0 size-5 -translate-x-1/2 rounded-full border-2 border-white bg-foreground shadow" style={{ left: `${pct(asOf)}%` }} aria-hidden />
          </div>
          <div className="mt-0.5 grid grid-cols-12 text-[10px] text-muted-foreground">
            {MONTHS_SHORT.map((m, i) => (
              <span key={m} className={cn(i === asOf.getUTCMonth() && "font-semibold text-foreground")}>
                {m}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden text-sm sm:inline">
            <span className="font-medium">{w.name}</span>
            {w.sellToGrain === "no-contact" && <span className="text-muted-foreground"> · elevators & co-ops no-contact</span>}
          </span>
          <TimeTravel />
          {isTimeTraveling && (
            <button type="button" onClick={() => setAsOf(todayISO)} className="text-sm font-medium text-primary hover:underline">
              Today
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
