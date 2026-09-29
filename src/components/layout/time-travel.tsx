"use client";

import { useState } from "react";
import { useStore } from "@/lib/data/store";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Demo moments: Oct → Dec → Mar → Jul re-rank everything and move the map */
export const DEMO_PRESETS: { label: string; date: string; note: string }[] = [
  { label: "October: harvest", date: "2026-10-12", note: "Elevators and co-ops go dark; year-round segments rise" },
  { label: "December: year-end", date: "2026-12-08", note: "Prime time for co-ops: audits, boards, budgets" },
  { label: "March: live before planting", date: "2027-03-09", note: "Implementation window" },
  { label: "July: budget window", date: "2027-07-13", note: "Fiscal years end Aug 31 / Sep 30" },
  { label: "Early August: quick wins", date: "2027-08-04", note: "Mobile add-ons and pilots only" },
];

export function TimeTravel() {
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
          size="sm"
          className={cn("tabular", isTimeTraveling && "border-primary text-primary")}
          aria-label="Time travel: change the date the app reasons about"
        >
          {isTimeTraveling ? "As of " : ""}
          {fmtDate(asOfISO)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b p-3">
          <p className="text-sm font-semibold">Time travel</p>
          <p className="mt-1 text-xs text-muted-foreground">Pick a date. Segment rankings, close rates, blackouts and the map all recalculate.</p>
          <div className="mt-3 flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="as-of" className="text-xs">
                As-of date
              </Label>
              <Input id="as-of" type="date" value={asOfISO} min="2024-01-01" max="2027-12-31" onChange={(e) => e.target.value && setAsOf(e.target.value, false)} />
            </div>
            <Button variant="outline" size="sm" disabled={!isTimeTraveling} onClick={() => setAsOf(todayISO)}>
              Today
            </Button>
          </div>
        </div>
        <ul className="p-1.5">
          {DEMO_PRESETS.map((p) => (
            <li key={p.date}>
              <button
                type="button"
                onClick={() => setAsOf(p.date)}
                className={cn("flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted", asOfISO === p.date && "bg-accent-soft")}
              >
                <span>
                  <span className="block font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">{p.note}</span>
                </span>
                <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular">{fmtDate(p.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function TimeTravelBanner() {
  const { isTimeTraveling, asOfISO, todayISO, setAsOf, ready } = useStore();
  if (!ready || !isTimeTraveling) return null;
  return (
    <div className="border-b bg-card">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-1.5 text-xs">
        <span className="text-muted-foreground">
          Viewing as of <strong className="font-semibold text-foreground tabular">{fmtDate(asOfISO)}</strong>. Rankings use history up to this date.
        </span>
        <button type="button" onClick={() => setAsOf(todayISO)} className="shrink-0 font-medium text-primary underline-offset-2 hover:underline">
          Back to today
        </button>
      </div>
    </div>
  );
}
