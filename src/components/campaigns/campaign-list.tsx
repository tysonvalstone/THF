"use client";

import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { REGION_BY_ID } from "@/data/reference/regions";
import { fmtShortDate } from "@/lib/dates";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLaunchWindows } from "@/components/dashboard/launch-windows";
import { campaignBuilderHref } from "@/lib/links";
import { cropNoun } from "@/lib/season";
import type { Campaign, Commodity } from "@/types/salesforce";
import { cn } from "@/lib/utils";

export function statusClass(s: Campaign["Status"]) {
  return s === "In Progress" ? "bg-[#e6f0fc] text-[#1c5cab]" : s === "Planned" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground";
}

export function CampaignList() {
  const { ready, data } = useStore();
  const windows = useLaunchWindows().filter((w) => w.state !== "upcoming").slice(0, 3);
  if (!ready) return <Skeleton className="h-96" />;

  const rows = [...data.campaigns]
    .sort((a, b) => b.StartDate.localeCompare(a.StartDate))
    .map((c) => {
      const members = data.campaignMembers.filter((m) => m.CampaignId === c.Id);
      const responded = members.filter((m) => m.HasResponded).length;
      return { c, members: members.length, responded };
    });

  return (
    <div className="space-y-5">
      {windows.length > 0 && (
        <Card className="border-primary/30 bg-brand-green-soft/40 py-4">
          <CardContent className="flex flex-col gap-3 px-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-medium">Launch windows open now</p>
              <p className="text-sm text-muted-foreground">
                {windows.map((w) => `${w.regionName} ${cropNoun(w.commodity as Commodity).toLowerCase()}`).join(" · ")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {windows.map((w) => (
                <Button key={`${w.regionId}-${w.commodity}`} asChild size="sm" variant="outline">
                  <Link href={campaignBuilderHref({ regions: [w.regionId], commodity: w.commodity, season: "Pre-harvest" })}>
                    <Megaphone className="size-4" /> {REGION_BY_ID[w.regionId as keyof typeof REGION_BY_ID].shortName} {w.commodity}
                  </Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))] gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
          <span>Campaign</span>
          <span>Status</span>
          <span>Dates</span>
          <span className="text-right">Members</span>
          <span className="text-right">Response</span>
          <span className="text-right">Budget</span>
        </div>
        <ul className="divide-y">
          {rows.map(({ c, members, responded }) => (
            <li key={c.Id}>
              <Link href={`/campaigns/${c.Id}`} className="grid gap-1 px-4 py-3 hover:bg-muted/30 md:grid-cols-[minmax(0,2.2fr)_repeat(5,minmax(0,1fr))] md:items-center md:gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{c.Name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {c.Type} · {c.Season__c} · {c.Target_Regions__c.map((r) => REGION_BY_ID[r]?.shortName).join(", ")}
                  </span>
                </span>
                <span>
                  <Badge className={cn("border-0", statusClass(c.Status))}>{c.Status}</Badge>
                </span>
                <span className="text-sm text-muted-foreground tabular">
                  {fmtShortDate(c.StartDate)} – {fmtShortDate(c.EndDate)}
                </span>
                <span className="text-sm tabular md:text-right">{members}</span>
                <span className="text-sm tabular md:text-right">
                  {responded} <span className="text-muted-foreground">({members ? fmtPct(responded / members) : "0%"})</span>
                </span>
                <span className="text-sm tabular md:text-right">{fmtMoney(c.BudgetedCost)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/campaigns/new">
            <Plus className="size-4" /> New seasonal campaign
          </Link>
        </Button>
      </div>
    </div>
  );
}
