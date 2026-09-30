import { Suspense } from "react";
import type { Metadata } from "next";
import { CallDeskView } from "@/components/call-desk/call-desk-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Call Desk" };

export default function CallDeskPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Today&apos;s calls</h1>
      <Suspense fallback={<Skeleton className="h-[560px]" />}>
        <CallDeskView />
      </Suspense>
    </div>
  );
}
