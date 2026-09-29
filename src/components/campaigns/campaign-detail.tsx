"use client";

import Link from "next/link";
import { ArrowLeft, Download, Mail, Megaphone } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { REGION_BY_ID } from "@/data/reference/regions";
import { contactName, userName } from "@/lib/data/selectors";
import { fmtDate, fmtShortDate } from "@/lib/dates";
import { fmtMoney, fmtPct } from "@/lib/format";
import { recordHref } from "@/lib/links";
import { templateCampaignContent } from "@/lib/content/templates";
import { mailListCsv, recipientFor } from "@/lib/campaigns";
import { downloadText } from "@/lib/csv";
import type { Commodity } from "@/types/salesforce";
import { LEGACY_PLAYS, SEASON_PLAYS, type SeasonPlay } from "@/lib/content/messaging";
import { useSender } from "@/lib/auth";
import { ContentEditor } from "./content-editor";
import { statusClass } from "./campaign-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DocTitle } from "@/components/shared/doc-title";
import { cn } from "@/lib/utils";

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular">{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function CampaignDetail({ id }: { id: string }) {
  const { ready, data, ranked } = useStore();
  const SENDER = useSender();
  if (!ready) return <Skeleton className="h-[520px]" />;
  const c = data.campaigns.find((x) => x.Id === id);
  if (!c) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">Campaign not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/campaigns">Back to campaigns</Link>
        </Button>
      </div>
    );
  }
  const members = data.campaignMembers.filter((m) => m.CampaignId === c.Id);
  const responded = members.filter((m) => m.HasResponded).length;
  const content =
    c.Content__c ??
    templateCampaignContent({
      play: (SEASON_PLAYS as string[]).includes(c.Season__c) ? (c.Season__c as SeasonPlay) : (LEGACY_PLAYS[c.Season__c] ?? "Year-round"),
      regionIds: c.Target_Regions__c,
      facilityTypes: c.Target_Facility_Types__c,
      commodity: c.Target_Commodity__c as Commodity | undefined,
      asOf: new Date(`${c.StartDate}T00:00:00Z`),
      sender: SENDER,
    });
  const scoredById = new Map(ranked.map((s) => [s.target.id, s]));
  const rows = members.map((m) => {
    const targetId = m.AccountId ?? m.LeadId!;
    const account = data.accounts.find((a) => a.Id === targetId);
    const lead = account ? undefined : data.leads.find((l) => l.Id === targetId);
    return { m, targetId, name: account?.Name ?? lead?.Company ?? "Unknown", place: account ? `${account.BillingCity}, ${account.BillingState}` : lead ? `${lead.City}, ${lead.State}` : "", person: contactName(data, m.ContactId ?? m.LeadId) };
  });

  const exportCsv = () => {
    const recips = rows
      .map((r) => scoredById.get(r.targetId))
      .filter(Boolean)
      .map((s) => recipientFor(data, s!))
      .filter(Boolean) as NonNullable<ReturnType<typeof recipientFor>>[];
    downloadText(`${c.Name.replace(/[^\w]+/g, "-").toLowerCase()}-mail-list.csv`, mailListCsv(recips));
  };

  return (
    <div className="space-y-5">
      <DocTitle title={c.Name} />
      <Link href="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Campaigns
      </Link>
      <Card>
        <CardContent className="space-y-5 px-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-primary">
                <Megaphone className="size-5" />
              </span>
              <div>
                <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  Campaign · {c.Type}
                  <Badge className={cn("border-0", statusClass(c.Status))}>{c.Status}</Badge>
                </p>
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{c.Name}</h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{c.Description}</p>
              </div>
            </div>
            <Button variant="outline" onClick={exportCsv} disabled={!rows.length} className="shrink-0">
              <Download className="size-4" /> Mail list CSV
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Dates" value={`${fmtShortDate(c.StartDate)} – ${fmtShortDate(c.EndDate)}`} />
            <Stat label="Members" value={String(members.length)} />
            <Stat label="Responded" value={String(responded)} sub={members.length ? fmtPct(responded / members.length, 1) : undefined} />
            <Stat label="Budget" value={fmtMoney(c.BudgetedCost)} sub={c.ActualCost ? `${fmtMoney(c.ActualCost)} spent` : "not yet spent"} />
            <Stat label="Expected pipeline" value={fmtMoney(c.ExpectedRevenue)} />
            <Stat label="Owner" value={userName(c.OwnerId).split(" ")[0]} sub={`Created ${fmtDate(c.CreatedDate)}`} />
          </div>
          <p className="text-xs text-muted-foreground">
            Targets: {c.Target_Facility_Types__c.join(", ")} in {c.Target_Regions__c.map((r) => REGION_BY_ID[r]?.name).join(", ")}
            {c.Target_Commodity__c ? ` · ${c.Target_Commodity__c}` : ""} · Season: {c.Season__c}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader>
            <CardTitle>Content</CardTitle>
          </CardHeader>
          <CardContent>
            <ContentEditor content={content} preview={rows[0] ? { FirstName: rows[0].person?.split(" ")[0], Company: rows[0].name } : undefined} />
          </CardContent>
        </Card>
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Members ({members.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <ul className="max-h-[640px] divide-y overflow-y-auto border-t">
              {rows.map((r) => (
                <li key={r.m.Id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <Link href={recordHref(r.targetId)} className="block truncate text-sm font-medium hover:underline">
                      {r.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.person ? `${r.person} · ` : ""}
                      {r.place}
                    </p>
                  </div>
                  <Badge variant={r.m.HasResponded ? "default" : "outline"} className="shrink-0">
                    {r.m.HasResponded ? <Mail className="size-3" /> : null}
                    {r.m.Status}
                  </Badge>
                </li>
              ))}
              {!rows.length && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No members yet.</li>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
