import { Suspense } from "react";
import type { Metadata } from "next";
import { ProspectList } from "@/components/prospects/prospect-list";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Prospects" };

export default function ProspectsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Prospects</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <ProspectList />
      </Suspense>
    </div>
  );
}
