"use client";

import { useState } from "react";
import { CalendarClock, History, RotateCcw } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const DEMO_PRESETS: { label: string; date: string; note: string }[] = [
  { label: "Pre-planting", date: "2027-02-10", note: "Agronomy prepay & spring booking" },
  { label: "Winter wheat pre-harvest", date: "2026-05-05", note: "Kansas, Oklahoma, Texas" },
  { label: "Prairie canola pre-harvest", date: "2026-07-08", note: "SK, AB, MB, North Dakota" },
  { label: "Corn Belt pre-harvest", date: "2026-08-10", note: "Iowa, Illinois, Nebraska, Ontario" },
  { label: "Corn Belt harvest", date: "2026-10-12", note: "Combines rolling, dump pits full" },
  { label: "Post-harvest settlements", date: "2026-11-30", note: "Settlements, 1099s, year-end" },
];

export function TimeTravel({ compact = false }: { compact?: boolean }) {
  const { asOfISO, todayISO, isTimeTraveling, setAsOf: set } = useStore();
  const [open, setOpen] = useState(false);
  const setAsOf = (iso: string, close = true) => {
    set(iso);
    if (close) setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className={cn("gap-2", isTimeTraveling && "border-brand-gold bg-accent text-accent-foreground hover:bg-accent/80")}
          aria-label="Time travel: change the date the app reasons about"
        >
          {isTimeTraveling ? <History className="size-4" /> : <CalendarClock className="size-4" />}
          <span className="tabular">{fmtDate(asOfISO)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b p-4">
          <p className="text-sm font-semibold">Time travel</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pretend it&apos;s a different day. Rankings, reasons, the season map and campaign copy all recalculate.
          </p>
          <div className="mt-3 flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="as-of" className="text-xs">
                As-of date
              </Label>
              <Input
                id="as-of"
                type="date"
                value={asOfISO}
                min="2025-10-01"
                max="2027-12-31"
                onChange={(e) => e.target.value && setAsOf(e.target.value, false)}
              />
            </div>
            <Button variant="ghost" size="icon" disabled={!isTimeTraveling} onClick={() => setAsOf(todayISO)} aria-label="Back to today">
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </div>
        <div className="p-2">
          <p className="px-2 pb-1 pt-1 text-xs font-medium text-muted-foreground">Demo moments</p>
          {DEMO_PRESETS.map((p) => (
            <button
              key={p.date}
              type="button"
              onClick={() => setAsOf(p.date)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                asOfISO === p.date && "bg-muted font-medium",
              )}
            >
              <span>
                <span className="block">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.note}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">{fmtDate(p.date).replace(/, \d{4}$/, "")}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAsOf(todayISO)}
            className="mt-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
          >
            <span>Today</span>
            <span className="text-xs text-muted-foreground tabular">{fmtDate(todayISO)}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TimeTravelBanner() {
  const { isTimeTraveling, asOfISO, todayISO, setAsOf, ready } = useStore();
  if (!ready || !isTimeTraveling) return null;
  return (
    <div className="border-b border-brand-gold/40 bg-accent text-accent-foreground">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-1.5 text-xs sm:text-sm">
        <span className="flex items-center gap-2">
          <History className="size-4 shrink-0" />
          <span>
            Time travel is on. The app is reasoning as if today is <strong className="tabular">{fmtDate(asOfISO)}</strong>.
          </span>
        </span>
        <button type="button" onClick={() => setAsOf(todayISO)} className="shrink-0 font-medium underline underline-offset-2">
          Back to today
        </button>
      </div>
    </div>
  );
}
