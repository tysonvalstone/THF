import { Suspense } from "react";
import type { Metadata } from "next";
import { HarvestDayView } from "@/components/harvest/harvest-day-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Harvest Day Simulator" };

export default function HarvestDayPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Harvest Day Simulator</h1>
      <Suspense fallback={<Skeleton className="h-[560px]" />}>
        <HarvestDayView />
      </Suspense>
    </div>
  );
}
