import { Suspense } from "react";
import type { Metadata } from "next";
import { PipelineView } from "@/components/records/pipeline-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Pipeline" };

export default function PipelinePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[560px]" />}>
      <PipelineView />
    </Suspense>
  );
}
