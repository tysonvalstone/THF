import { Suspense } from "react";
import type { Metadata } from "next";
import { SegmentPrioritization } from "@/components/segments/segment-prioritization";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Segments" };

export default function SegmentsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <SegmentPrioritization />
    </Suspense>
  );
}
