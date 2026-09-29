import { Suspense } from "react";
import type { Metadata } from "next";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "New Campaign" };

export default function NewCampaignPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">New Campaign</h1>
      <Suspense fallback={<Skeleton className="h-[520px]" />}>
        <CampaignBuilder />
      </Suspense>
    </div>
  );
}
