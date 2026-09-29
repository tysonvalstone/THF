import { Suspense } from "react";
import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "New campaign" };

export default function NewCampaignPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Season & region campaign builder</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Pick the season, regions and facility types. HarvestSignal pulls the ranked targets, writes the letter, a 3-email sequence and a
          call script tied to their harvest timing, and creates the Salesforce records when you launch.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-[520px]" />}>
        <CampaignBuilder />
      </Suspense>
    </div>
  );
}
