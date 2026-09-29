"use client";

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { REGIONS } from "@/data/reference/regions";
import { useStore } from "@/lib/data/store";
import { cropNoun, harvestWindows } from "@/lib/season";
import { addDays, diffDays, fmtShortDate, fmtSpan } from "@/lib/dates";
import { campaignBuilderHref } from "@/lib/links";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Chronological list of campaign launch windows in the next 120 days */
export function LaunchSchedule() {
  const { ready, asOf, ranked } = useStore();
  if (!ready) return null;
  const horizon = addDays(asOf, 120);
  const items = REGIONS.flatMap((r) =>
    r.crops
      .filter((c) => c.importance >= 0.5)
      .flatMap((c) =>
        harvestWindows(r.id, c, asOf)
          .map((w) => ({ region: r, crop: c, harvest: w.start, launch: addDays(w.start, -42), launchEnd: addDays(w.start, -28) }))
          .filter((x) => x.launchEnd >= asOf && x.launch <= horizon),
      ),
  ).sort((a, b) => a.launch.getTime() - b.launch.getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Launch schedule, next 120 days</CardTitle>
        <CardDescription>When to drop mail and start sequences so they land 4–6 weeks before harvest.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <ol className="divide-y">
            {items.map((x) => {
              const open = asOf >= x.launch;
              const prospects = ranked.filter((s) => s.target.regionId === x.region.id && s.target.commodities.includes(x.crop.commodity)).length;
              return (
                <li key={`${x.region.id}-${x.crop.commodity}-${x.harvest.toISOString()}`} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex gap-3">
                    <div className="w-14 shrink-0 text-center">
                      <p className="text-[11px] font-medium text-muted-foreground uppercase">{fmtShortDate(x.launch).split(" ")[0]}</p>
                      <p className="text-lg leading-none font-semibold tabular">{x.launch.getUTCDate()}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {x.region.name} · {cropNoun(x.crop.commodity).toLowerCase()} harvest
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {open ? <span className="font-medium text-primary">Open now</span> : `Opens in ${fmtSpan(diffDays(x.launch, asOf))}`} · harvest {fmtShortDate(x.harvest)} · {prospects} prospects
                      </p>
                    </div>
                  </div>
                  <Button asChild size="sm" variant={open ? "default" : "outline"} className="self-start sm:self-auto">
                    <Link href={campaignBuilderHref({ regions: [x.region.id], commodity: x.crop.commodity, season: "Pre-harvest" })}>
                      <Megaphone className="size-4" /> Plan campaign
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No harvest launch windows in the next 120 days. It&apos;s agronomy prepay and pre-planting season.</p>
        )}
      </CardContent>
    </Card>
  );
}
