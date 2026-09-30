"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Megaphone, Pencil, Plus, Trash2, X } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { CampaignDrawer } from "@/components/records/forms";
import { campaignDeletePlan, campaignMemberDeletePlan, type DeletePlan } from "@/components/records/delete-rules";
import { AddMembersDialog } from "./add-members-dialog";
import { REGION_BY_ID } from "@/data/reference/regions";
import { contactName, userName } from "@/lib/data/selectors";
import { fmtDate, fmtShortDate } from "@/lib/dates";
import { fmtMoney, fmtPct } from "@/lib/format";
import { recordHref } from "@/lib/links";
import { templateCampaignContent } from "@/lib/content/templates";
import { MAIL_LIST_COLUMNS, mailListFilename, recipientFor } from "@/lib/campaigns";
import { ExportCsvButton } from "@/components/shared/column-picker";
import type { CampaignMember, Commodity } from "@/types/salesforce";
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
  const { remove } = useCrud();
  const router = useRouter();
  const SENDER = useSender();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<DeletePlan | null>(null);
  const [gone, setGone] = useState(false);
  const [removing, setRemoving] = useState<{ m: CampaignMember; name: string; plan: DeletePlan } | null>(null);
  if (!ready || gone) return <Skeleton className="h-[520px]" />;
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
  const opened = members.filter((m) => m.Status === "Opened" || m.Status === "Responded" || m.HasResponded).length;
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

  type MemberRow = (typeof rows)[number];
  const memberColumns: Column<MemberRow>[] = [
    {
      key: "name",
      header: "Recipient",
      sortValue: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0 max-w-56">
          <Link href={recordHref(r.targetId)} className="block truncate font-medium hover:underline">
            {r.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            <span className={cn(r.m.HasResponded && "font-medium text-primary")}>{r.m.Status}</span>
            {r.person ? ` · ${r.person}` : ""}
            {r.place ? ` · ${r.place}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "remove",
      header: <span className="sr-only">Remove</span>,
      align: "right",
      cell: (r) => (
        <Button variant="ghost" size="icon-xs" aria-label={`Remove ${r.name}`} onClick={() => setRemoving({ m: r.m, name: r.name, plan: campaignMemberDeletePlan(data, r.m.Id) })}>
          <X />
        </Button>
      ),
    },
  ];

  const recips = rows
    .map((r) => scoredById.get(r.targetId))
    .filter(Boolean)
    .map((s) => recipientFor(data, s!))
    .filter(Boolean) as NonNullable<ReturnType<typeof recipientFor>>[];

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
                <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
                  {c.Name}
                  <LocalChangeTag id={c.Id} />
                </h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{c.Description}</p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button variant="outline" onClick={() => setDeleting(campaignDeletePlan(data, c.Id))}>
              <Trash2 /> Delete
            </Button>
            <ExportCsvButton
              disabled={!rows.length}
              className="shrink-0"
              label={
                <>
                  <Download className="size-4" /> Mail list CSV
                </>
              }
              exportId="campaign-mail-list"
              title="Export mail list"
              columns={MAIL_LIST_COLUMNS}
              rows={recips}
              filename={mailListFilename(c.Name)}
            />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6" data-demo="campaign-stats">
            <Stat label="Dates" value={`${fmtShortDate(c.StartDate)} – ${fmtShortDate(c.EndDate)}`} />
            <Stat label="Members" value={String(members.length)} sub={opened ? `${opened} opened` : undefined} />
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
        <section className="min-w-0 space-y-2 lg:col-span-2">
          <h2 className="text-base font-semibold">Members ({members.length})</h2>
          <DataTable
            rows={rows}
            columns={memberColumns}
            rowKey={(r) => r.m.Id}
            param="mp"
            dense
            pageSizes={[]}
            search={{ placeholder: "Search members", text: (r) => `${r.name} ${r.person ?? ""} ${r.place}` }}
            actions={
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus /> Add
              </Button>
            }
            empty="No members yet"
          />
        </section>
      </div>

      <CampaignDrawer
        open={editing}
        onOpenChange={setEditing}
        record={c}
        onDelete={() => {
          setEditing(false);
          setDeleting(campaignDeletePlan(data, c.Id));
        }}
      />
      <AddMembersDialog campaign={c} open={adding} onOpenChange={setAdding} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${c.Name}?`}
        description={[deleting?.detail, "You can undo this for a few seconds afterwards."].filter(Boolean).join(" ")}
        onConfirm={() => {
          if (!deleting) return;
          setGone(true);
          remove("Campaign", c.Id, "Campaign", deleting.cascade);
          router.push("/campaigns");
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? "member"} from this campaign?`}
        description={[removing?.plan.detail, "You can undo this for a few seconds afterwards."].filter(Boolean).join(" ")}
        confirmLabel="Remove"
        onConfirm={() => removing && remove("CampaignMember", removing.m.Id, "Campaign member", removing.plan.cascade)}
      />
    </div>
  );
}
