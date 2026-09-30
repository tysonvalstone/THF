"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { addToCampaign, type MemberInput } from "@/lib/actions/outreach";
import type { ScoredTarget } from "@/lib/scoring";
import type { Campaign, Contact } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ScorePill } from "@/components/shared/badges";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const ROLE_ORDER = ["Decision Maker", "Economic Buyer", "Champion", "Influencer", "Board Member", "End User"];

/** The contact a campaign goes to at an account: the decision maker first */
export function primaryContact(contacts: Contact[]): Contact | undefined {
  return [...contacts].sort((a, b) => ROLE_ORDER.indexOf(a.Buying_Role__c) - ROLE_ORDER.indexOf(b.Buying_Role__c))[0];
}

/** Pick accounts and leads to add to a campaign (creates members and their tasks) */
export function AddMembersDialog({ campaign, open, onOpenChange }: { campaign: Campaign; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, asOf, ranked } = useStore();
  const { run } = useCrud();
  const userId = useUserId();
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const existing = useMemo(() => new Set(data.campaignMembers.filter((m) => m.CampaignId === campaign.Id).map((m) => m.AccountId ?? m.LeadId)), [data.campaignMembers, campaign.Id]);
  const converted = useMemo(() => new Set(data.leads.filter((l) => l.IsConverted).map((l) => l.Id)), [data.leads]);
  const rows = useMemo(() => ranked.filter((s) => !existing.has(s.target.id) && !converted.has(s.target.id)), [ranked, existing, converted]);

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: Column<ScoredTarget>[] = [
    {
      key: "pick",
      header: <span className="sr-only">Select</span>,
      className: "w-8",
      cell: (s) => (
        <input
          type="checkbox"
          checked={picked.has(s.target.id)}
          onChange={() => toggle(s.target.id)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${s.target.name}`}
          className="size-4 accent-[#1f5f4a]"
        />
      ),
    },
    { key: "score", header: "Score", sortValue: (s) => s.total, cell: (s) => <ScorePill score={s.total} /> },
    {
      key: "name",
      header: "Prospect",
      sortValue: (s) => s.target.name,
      cell: (s) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {s.target.name}
            {s.target.kind === "lead" ? <span className="text-xs font-normal text-muted-foreground"> · lead</span> : null}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {s.target.facilityType} · {s.target.city}, {s.target.state}
          </p>
        </div>
      ),
    },
  ];

  const add = () => {
    const members: MemberInput[] = [...picked].map((id) => ({
      targetId: id,
      whoId: id.startsWith("00Q") ? undefined : primaryContact(data.contacts.filter((c) => c.AccountId === id))?.Id,
    }));
    const res = addToCampaign({ data, asOf, userId }, { campaignId: campaign.Id, members });
    run(res.mutations, res.summary[0], { undoable: true });
    setPicked(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPicked(new Set());
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add recipients</DialogTitle>
          <DialogDescription>{campaign.Name}</DialogDescription>
        </DialogHeader>
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(s) => s.target.id}
          search={{ placeholder: "Search name, town, state", text: (s) => `${s.target.name} ${s.target.city} ${s.target.state} ${s.target.facilityType}` }}
          urlState={false}
          pageSize={8}
          pageSizes={[]}
          dense
          onRowClick={(s) => toggle(s.target.id)}
          rowClassName={(s) => (picked.has(s.target.id) ? "bg-accent-soft" : undefined)}
          empty="Everyone matching is already in this campaign"
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!picked.size} onClick={add}>
            Add {picked.size || ""} {picked.size === 1 ? "recipient" : "recipients"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
