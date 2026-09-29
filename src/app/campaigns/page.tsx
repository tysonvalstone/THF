import type { Metadata } from "next";
import { CampaignList } from "@/components/campaigns/campaign-list";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Campaigns</h1>
      <CampaignList />
    </div>
  );
}
