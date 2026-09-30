"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { REGION_BY_ID } from "@/data/reference/regions";
import { fmtShortDate } from "@/lib/dates";
import { fmtMoney, fmtPct } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable, type Column } from "@/components/shared/data-table";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import type { Campaign, CampaignStatus } from "@/types/salesforce";
import { cn } from "@/lib/utils";

export function statusClass(s: Campaign["Status"]) {
  return s === "In Progress" ? "bg-[#e6f0fc] text-[#1c5cab]" : s === "Planned" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground";
}

interface Row {
  c: Campaign;
  members: number;
  responded: number;
}

const ALL = "all";
const STATUSES: CampaignStatus[] = ["Planned", "In Progress", "Completed", "Aborted"];

export function CampaignList() {
  const { ready, data } = useStore();
  const router = useRouter();
  const [status, setStatus] = useState(ALL);

  const rows = useMemo<Row[]>(() => {
    const count = new Map<string, { members: number; responded: number }>();
    for (const m of data.campaignMembers) {
      const x = count.get(m.CampaignId) ?? { members: 0, responded: 0 };
      x.members++;
      if (m.HasResponded) x.responded++;
      count.set(m.CampaignId, x);
    }
    return data.campaigns.map((c) => ({ c, ...(count.get(c.Id) ?? { members: 0, responded: 0 }) }));
  }, [data.campaigns, data.campaignMembers]);
  const filtered = useMemo(() => (status === ALL ? rows : rows.filter((r) => r.c.Status === status)), [rows, status]);

  if (!ready) return <Skeleton className="h-96" />;

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Campaign",
      sortValue: (r) => r.c.Name,
      cell: ({ c }) => (
        <div className="min-w-0 max-w-96">
          <Link href={`/campaigns/${c.Id}`} className="block truncate font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {c.Name}
          </Link>
          <LocalChangeTag id={c.Id} />
          <span className="block truncate text-xs text-muted-foreground">
            {c.Type} · {c.Season__c} · {c.Target_Regions__c.map((r) => REGION_BY_ID[r]?.shortName).join(", ")}
          </span>
        </div>
      ),
    },
    { key: "status", header: "Status", sortValue: (r) => r.c.Status, cell: ({ c }) => <Badge className={cn("border-0", statusClass(c.Status))}>{c.Status}</Badge> },
    {
      key: "dates",
      header: "Dates",
      hideBelow: "sm",
      sortValue: (r) => r.c.StartDate,
      cell: ({ c }) => (
        <span className="whitespace-nowrap text-muted-foreground tabular">
          {fmtShortDate(c.StartDate)} – {fmtShortDate(c.EndDate)}
        </span>
      ),
    },
    { key: "members", header: "Members", align: "right", sortValue: (r) => r.members, cell: (r) => r.members },
    {
      key: "response",
      header: "Response",
      align: "right",
      hideBelow: "md",
      sortValue: (r) => (r.members ? r.responded / r.members : 0),
      cell: (r) => (
        <span className="whitespace-nowrap">
          {r.responded} <span className="text-muted-foreground">({r.members ? fmtPct(r.responded / r.members) : "0%"})</span>
        </span>
      ),
    },
    { key: "budget", header: "Budget", align: "right", hideBelow: "md", sortValue: (r) => r.c.BudgetedCost, cell: (r) => fmtMoney(r.c.BudgetedCost) },
  ];

  return (
    <DataTable
      rows={filtered}
      columns={columns}
      rowKey={(r) => r.c.Id}
      search={{ placeholder: "Search campaigns", text: (r) => `${r.c.Name} ${r.c.Type} ${r.c.Season__c}` }}
      filters={
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="h-8 rounded-md border border-input bg-card px-2 text-sm">
          <option value={ALL}>All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      }
      filterKey={status}
      actions={
        <Button size="sm" asChild>
          <Link href="/campaigns/new">
            <Plus /> New campaign
          </Link>
        </Button>
      }
      defaultSort={{ key: "dates", dir: "desc" }}
      onRowClick={(r) => router.push(`/campaigns/${r.c.Id}`)}
      caption="Campaigns"
    />
  );
}
