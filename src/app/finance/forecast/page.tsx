import { Suspense } from "react";
import type { Metadata } from "next";
import { ForecastView } from "@/components/forecast/forecast-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Forecast" };

export default function ForecastPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <ForecastView />
    </Suspense>
  );
}
