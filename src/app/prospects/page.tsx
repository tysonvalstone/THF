import { Suspense } from "react";
import type { Metadata } from "next";
import { ProspectList } from "@/components/prospects/prospect-list";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Prospects" };

export default function ProspectsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Prospect ranking</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Every prospect account and open lead, scored for today on season timing, market signal, fit, displacement, engagement and
          climate. Expand a row to see the full breakdown.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <ProspectList />
      </Suspense>
    </div>
  );
}
