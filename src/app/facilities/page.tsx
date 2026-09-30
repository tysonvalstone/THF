import { Suspense } from "react";
import type { Metadata } from "next";
import { FacilitiesView } from "@/components/facilities/facilities-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Facilities" };

export default function FacilitiesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <FacilitiesView />
    </Suspense>
  );
}
