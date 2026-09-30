import { Suspense } from "react";
import type { Metadata } from "next";
import { RenewalsView } from "@/components/success/renewals-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Renewals" };

export default function RenewalsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Renewals</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <RenewalsView />
      </Suspense>
    </div>
  );
}
