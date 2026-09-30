"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/data/store";
import { prioritize } from "@/lib/prioritization";
import type { Area } from "@/lib/regionInsights";
import { REGION_BY_ID, REGION_BY_STATE } from "@/data/reference/regions";
import type { RegionId } from "@/types/salesforce";
import { OpportunityMap } from "@/components/home/opportunity-map";
import { Skeleton } from "@/components/ui/skeleton";

/** ?region=eastern-corn-belt or ?state=IA opens the map zoomed there; ?trip=… opens Plan a Trip with that request; ?sales=1 turns on recent sales */
function areaFrom(region?: string, state?: string): Area | undefined {
  const st = state?.toUpperCase();
  if (st && REGION_BY_STATE[st]) return { level: "state", regionId: REGION_BY_STATE[st] as RegionId, state: st };
  if (region && region in REGION_BY_ID) return { level: "region", regionId: region as RegionId };
  return undefined;
}

export function MapView({ region, state, trip, sales }: { region?: string; state?: string; trip?: string; sales?: boolean }) {
  const { ready, data, asOf } = useStore();
  const prio = useMemo(() => (ready ? prioritize(data, asOf) : null), [ready, data, asOf]);
  if (!prio) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-[600px]" />
      </div>
    );
  }
  return <OpportunityMap key={`${region ?? ""}-${state ?? ""}-${trip ?? ""}-${sales ? 1 : 0}`} prio={prio} initialArea={areaFrom(region, state)} initialTrip={trip} initialSales={sales} />;
}
