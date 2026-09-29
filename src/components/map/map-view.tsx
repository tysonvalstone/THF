"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { corePenetration, isCovered, whitespaceCounties } from "@/lib/facilities";
import { sellingWindowAt } from "@/lib/seasonality";
import { fmtDate } from "@/lib/dates";
import { SeasonalityMap, type MapFacility } from "./seasonality-map";
import { Skeleton } from "@/components/ui/skeleton";

export function MapView() {
  const { ready, data, asOf } = useStore();
  const facilities = useMemo<MapFacility[]>(
    () =>
      data.accounts
        .filter((a) => a.BillingState === "IL" || a.BillingState === "IA")
        .map((a) => ({ id: a.Id, lat: a.BillingLatitude, lon: a.BillingLongitude, label: `${a.Name} (${a.Segment__c}${isCovered(a) ? ", customer" : ""})`, covered: isCovered(a) })),
    [data.accounts],
  );
  const whitespace = useMemo(() => whitespaceCounties(data.accounts), [data.accounts]);
  const pen = useMemo(() => corePenetration(data.accounts).slice(0, 2), [data.accounts]);

  if (!ready) return <Skeleton className="h-[640px]" />;
  const w = sellingWindowAt(asOf);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">Seasonality map</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Where each crop is in its year on {fmtDate(asOf)}: blue is planting, red is harvest. Timing shifts with latitude, so southern Illinois reaches harvest
            weeks before northern Illinois. Use the date in the header to move through the year.
          </p>
        </div>
        <p className="text-sm text-muted-foreground md:text-right">
          Selling window: <span className="font-medium text-foreground">{w.name}</span> ({w.when})
        </p>
      </div>
      <div className="rounded-md border bg-card p-4">
        <SeasonalityMap date={asOf} initialCommodity="Corn" facilities={facilities} whitespaceCountyFips={whitespace.map((c) => c.fips)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {pen.map((p) => (
          <div key={p.label} className="rounded-md border bg-card p-4">
            <p className="text-xs text-muted-foreground">Coverage</p>
            <p className="mt-1 text-lg font-semibold tabular">
              {p.covered} of {p.total}
            </p>
            <p className="text-sm text-muted-foreground">{p.label}</p>
          </div>
        ))}
        <div className="rounded-md border bg-card p-4">
          <p className="text-xs text-muted-foreground">Whitespace</p>
          <p className="mt-1 text-lg font-semibold tabular">{whitespace.length} counties</p>
          <p className="text-sm text-muted-foreground">
            IL/IA counties with facilities but no customer.{" "}
            <Link href="/facilities" className="text-primary hover:underline">
              See facilities
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
