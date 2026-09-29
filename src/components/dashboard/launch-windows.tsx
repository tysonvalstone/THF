"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { REGIONS } from "@/data/reference/regions";
import { useStore } from "@/lib/data/store";
import { cropNoun, cropStatus } from "@/lib/season";
import { diffDays, fmtShortDate, fmtSpan } from "@/lib/dates";
import { campaignBuilderHref } from "@/lib/links";
import { Button } from "@/components/ui/button";

type WindowState = "open" | "upcoming" | "closing";

export interface LaunchWindow {
  regionId: string;
  regionName: string;
  commodity: string;
  state: WindowState;
  launchStart: Date;
  launchEnd: Date;
  harvestStart: Date;
  daysToHarvest: number;
  prospects: number;
}

export function useLaunchWindows(): LaunchWindow[] {
  const { asOf, ranked } = useStore();
  const out: LaunchWindow[] = [];
  for (const region of REGIONS) {
    for (const crop of region.crops) {
      if (crop.importance < 0.5) continue;
      const s = cropStatus(region.id, crop, asOf);
      if (s.phase === "Harvest") continue;
      const toOpen = diffDays(s.launchStart, asOf);
      let state: WindowState | null = null;
      if (asOf >= s.launchStart && asOf <= s.launchEnd) state = "open";
      else if (toOpen > 0 && toOpen <= 21) state = "upcoming";
      else if (asOf > s.launchEnd && s.daysToHarvest > 0) state = "closing";
      if (!state) continue;
      out.push({
        regionId: region.id,
        regionName: region.name,
        commodity: crop.commodity,
        state,
        launchStart: s.launchStart,
        launchEnd: s.launchEnd,
        harvestStart: s.window.start,
        daysToHarvest: s.daysToHarvest,
        prospects: ranked.filter((r) => r.target.regionId === region.id && r.target.commodities.includes(crop.commodity)).length,
      });
    }
  }
  const order: Record<WindowState, number> = { open: 0, closing: 1, upcoming: 2 };
  return out.sort((a, b) => order[a.state] - order[b.state] || a.daysToHarvest - b.daysToHarvest);
}

const STATE_TEXT: Record<WindowState, string> = {
  open: "Launch window open",
  closing: "Last call",
  upcoming: "Opens soon",
};

export function LaunchWindows() {
  const { asOf } = useStore();
  const windows = useLaunchWindows().slice(0, 6);
  if (!windows.length) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        No harvest launch windows in the next three weeks. Try the post-harvest settlement or pre-planting plays from the campaign builder.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {windows.map((w) => (
        <li key={`${w.regionId}-${w.commodity}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {w.regionName} · {cropNoun(w.commodity as never)} harvest
            </p>
            <p className="text-xs text-muted-foreground">
              <span className={w.state === "open" ? "font-medium text-primary" : w.state === "closing" ? "font-medium text-[#a8431b]" : ""}>
                {STATE_TEXT[w.state]}
              </span>
              {" · "}
              {w.state === "upcoming"
                ? `opens ${fmtShortDate(w.launchStart)}, in ${fmtSpan(diffDays(w.launchStart, asOf))}`
                : `harvest starts ${fmtShortDate(w.harvestStart)} (in ${fmtSpan(w.daysToHarvest)})`}
              {" · "}
              {w.prospects} prospects
            </p>
          </div>
          <Button asChild size="sm" variant={w.state === "upcoming" ? "outline" : "default"} className="shrink-0 self-start sm:self-auto">
            <Link href={campaignBuilderHref({ regions: [w.regionId], commodity: w.commodity, season: "Pre-harvest" })}>
              <Megaphone className="size-4" />
              Build campaign
            </Link>
          </Button>
        </li>
      ))}
    </ul>
  );
}
