import { Suspense } from "react";
import type { Metadata } from "next";
import { CommissionsView } from "@/components/commissions/commissions-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Commissions" };

export default function CommissionsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <CommissionsView />
    </Suspense>
  );
}
