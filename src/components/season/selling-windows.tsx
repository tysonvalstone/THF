"use client";

import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { SELLING_WINDOWS, sellingWindowAt, windowRange, type SellingWindowDef } from "@/lib/seasonality";
import { playForDate } from "@/lib/content/messaging";
import { WEBINAR_PRESET } from "@/lib/content/webinar";
import { campaignBuilderHref } from "@/lib/links";
import { diffDays, fmtShortDate, MONTHS_SHORT } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TONE: Record<SellingWindowDef["sellToGrain"], string> = {
  prime: "bg-primary text-primary-foreground",
  good: "bg-[#cfe3da] text-[#123a2d]",
  limited: "bg-slate-200 text-slate-700",
  "no-contact": "bg-slate-400 text-white",
};
const TONE_LABEL: Record<SellingWindowDef["sellToGrain"], string> = {
  prime: "Prime",
  good: "Good",
  limited: "Limited",
  "no-contact": "No contact",
};

/** Year strip of the grain selling windows with today marked */
export function SellingWindowStrip() {
  const { asOf } = useStore();
  const year = asOf.getUTCFullYear();
  const start = new Date(Date.UTC(year, 0, 1));
  const days = diffDays(new Date(Date.UTC(year + 1, 0, 1)), start);
  const pct = (d: Date) => Math.min(100, Math.max(0, (diffDays(d, start) / days) * 100));
  const segments = SELLING_WINDOWS.flatMap((w) => {
    const [sm, sd] = w.start.split("-").map(Number);
    const [em, ed] = w.end.split("-").map(Number);
    const s = new Date(Date.UTC(year, sm - 1, sd));
    const e = new Date(Date.UTC(year, em - 1, ed));
    if (e < s) return [{ w, s: start, e }, { w, s, e: new Date(Date.UTC(year, 11, 31)) }];
    return [{ w, s, e }];
  });
  return (
    <div>
      <div className="relative h-9 rounded-md bg-slate-100">
        {segments.map(({ w, s, e }, i) => (
          <div
            key={`${w.id}-${i}`}
            className={cn("absolute inset-y-0 flex items-center overflow-hidden border-r border-white px-1.5 text-[11px] font-medium whitespace-nowrap", TONE[w.sellToGrain])}
            style={{ left: `${pct(s)}%`, width: `${Math.max(0.5, pct(e) - pct(s) + 0.27)}%` }}
            title={`${w.name} (${w.when}): ${TONE_LABEL[w.sellToGrain]} for elevators and co-ops`}
          >
            {pct(e) - pct(s) > 7 ? w.name : ""}
          </div>
        ))}
        <div className="absolute -top-1 -bottom-1 w-0.5 bg-foreground" style={{ left: `${pct(asOf)}%` }} aria-hidden />
      </div>
      <div className="mt-1 grid grid-cols-12 text-[10px] text-muted-foreground">
        {MONTHS_SHORT.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(TONE) as SellingWindowDef["sellToGrain"][]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm", TONE[k])} /> {TONE_LABEL[k]}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What to do in the current selling window */
export function CurrentWindowCard({ compact = false }: { compact?: boolean }) {
  const { asOf } = useStore();
  const w = sellingWindowAt(asOf);
  const range = windowRange(w, asOf);
  const grainPlay = playForDate(asOf, "Country Elevator");
  const grainDark = w.sellToGrain === "no-contact";
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">
          Now: {w.when} · until {fmtShortDate(range.end)}
        </p>
        <p className="mt-0.5 font-semibold">{w.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{w.summary}</p>
      </div>
      {!compact && <SellingWindowStrip />}
      <div className="flex flex-wrap gap-2">
        {grainDark ? (
          <Button asChild size="sm">
            <Link href={campaignBuilderHref({ types: ["Ethanol Plant", "Feed Mill", "Oilseed Crusher", "Flour Mill"], season: "Year-round" })}>Campaign for year-round segments</Link>
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link href={campaignBuilderHref({ types: ["Grain Elevator", "Cooperative"], season: grainPlay })}>{grainPlay} campaign for elevators & co-ops</Link>
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href={`/campaigns/new?preset=${WEBINAR_PRESET}`}>Price-later compliance webinar</Link>
        </Button>
      </div>
    </div>
  );
}
