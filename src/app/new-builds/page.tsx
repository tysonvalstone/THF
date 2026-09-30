import { Suspense } from "react";
import type { Metadata } from "next";
import { NewBuildsView } from "@/components/new-builds/new-builds-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "New Builds" };

export default function NewBuildsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[560px]" />}>
      <NewBuildsView />
    </Suspense>
  );
}
