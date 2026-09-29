import type { Metadata } from "next";
import { CampaignList } from "@/components/campaigns/campaign-list";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="mt-1 max-w-3xl text-muted-foreground">
          Seasonal plays by region and facility type. Each campaign keeps its target list, copy and CampaignMember response tracking.
        </p>
      </div>
      <CampaignList />
    </div>
  );
}
