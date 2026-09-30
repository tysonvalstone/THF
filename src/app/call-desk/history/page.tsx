import { Suspense } from "react";
import type { Metadata } from "next";
import { HistoryView } from "@/components/call-desk/history-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Past calls" };

export default function PastCallsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Past calls</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <HistoryView />
      </Suspense>
    </div>
  );
}
