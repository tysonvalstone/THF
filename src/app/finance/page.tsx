import { Suspense } from "react";
import type { Metadata } from "next";
import { RevenueDashboard } from "@/components/finance/revenue-dashboard";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Revenue" };

export default function FinancePage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <RevenueDashboard />
    </Suspense>
  );
}
