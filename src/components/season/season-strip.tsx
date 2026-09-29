"use client";

import { busyWindows, type BusyWindow } from "@/lib/season";
import { addDays, addMonths, diffDays, fmtShortDate, MONTHS_SHORT } from "@/lib/dates";
import type { Commodity, FacilityType, RegionId } from "@/types/salesforce";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const KIND_COLOR: Record<BusyWindow["kind"], string> = {
  harvest: "var(--phase-harvest)",
  "spring-application": "#4a3aa7",
  "fall-application": "#8b6f47",
  "feeding-season": "#1baf7a",
};

/**
 * 12-month strip for one facility: busy windows as bars, the 4–6 week
 * pre-season launch window as a hatched band, and a "today" marker.
 */
export function SeasonStrip({
  entity,
  asOf,
}: {
  entity: { Region__c: RegionId; Facility_Type__c: FacilityType; Primary_Commodities__c: Commodity[] };
  asOf: Date;
}) {
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() - 2, 1));
  const end = addMonths(start, 12);
  const span = diffDays(end, start);
  const pct = (d: Date) => Math.min(100, Math.max(0, (diffDays(d, start) / span) * 100));

  const windows = busyWindows(entity, asOf).filter((w) => w.end > start && w.start < end);
  const rows = [...new Set(windows.map((w) => w.label))];
  const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i));

  if (!rows.length) {
    return <p className="text-sm text-muted-foreground">Year-round operation</p>;
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <div className="grid grid-cols-12 text-[10px] text-muted-foreground">
          {months.map((m) => (
            <span key={m.toISOString()} className="border-l pl-1 first:border-l-0">
              {MONTHS_SHORT[m.getUTCMonth()]}
              {m.getUTCMonth() === 0 && <span className="ml-0.5 tabular">{String(m.getUTCFullYear()).slice(2)}</span>}
            </span>
          ))}
        </div>
        <div className="mt-1 space-y-1.5">
          {rows.map((label) => (
            <div key={label} className="relative h-7 rounded-md bg-muted/60">
              {windows
                .filter((w) => w.label === label)
                .map((w) => {
                  const launchStart = addDays(w.start, -42);
                  const launchEnd = addDays(w.start, -28);
                  return (
                    <div key={w.start.toISOString()}>
                      {w.kind !== "feeding-season" && (
                        <div
                          className="absolute inset-y-1 rounded-sm"
                          style={{
                            left: `${pct(launchStart)}%`,
                            width: `${Math.max(0, pct(launchEnd) - pct(launchStart))}%`,
                            background: "repeating-linear-gradient(135deg, rgba(42,120,214,0.35) 0 3px, rgba(42,120,214,0.08) 3px 6px)",
                          }}
                          aria-hidden
                        />
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div
                            className="absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-[11px] font-medium whitespace-nowrap text-white"
                            style={{ left: `${pct(w.start)}%`, width: `${Math.max(1.5, pct(w.end) - pct(w.start))}%`, background: KIND_COLOR[w.kind] }}
                            tabIndex={0}
                          >
                            {label}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          {label}: {fmtShortDate(w.start)} – {fmtShortDate(w.end)}
                          {w.climate && w.climate.harvestShiftDays !== 0 ? ` (${w.climate.condition.toLowerCase()}, ${w.climate.harvestShiftDays > 0 ? "+" : ""}${w.climate.harvestShiftDays} days)` : ""}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground" style={{ left: `${pct(asOf)}%` }} aria-hidden>
          <span className="absolute -top-0.5 -translate-x-1/2 rounded bg-foreground px-1 text-[9px] font-medium text-background">Today</span>
        </div>
      </div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className="inline-block h-2.5 w-5 rounded-sm"
          style={{ background: "repeating-linear-gradient(135deg, rgba(42,120,214,0.35) 0 3px, rgba(42,120,214,0.08) 3px 6px)" }}
        />
        Campaign launch window (6–4 weeks before the busy season)
      </p>
    </div>
  );
}
