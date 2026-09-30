"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, LifeBuoy, SlidersHorizontal, TrendingUp, UserRoundX } from "lucide-react";
import type { HealthSignal, SupportTicket } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { newId, useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { userName } from "@/lib/data/selectors";
import { fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { healthFor } from "@/lib/success/health";
import { arrFor, renewalDateFor } from "@/lib/success/common";
import { expansionCandidates, startExpansionMutations } from "@/lib/success/expansion";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { RecordDrawer, type FieldDef } from "@/components/shared/record-drawer";
import { HealthBadge, TrendMark } from "./shared";

const PRIORITIES: SupportTicket["Priority"][] = ["Low", "Normal", "High", "Urgent"];
const TICKET_STATUSES: SupportTicket["Status"][] = ["Open", "Pending", "Closed"];
const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

export function CustomerDrawer({ accountId, onOpenChange }: { accountId: string | null; onOpenChange: (open: boolean) => void }) {
  const { data, asOf, asOfISO } = useStore();
  const { create, update, run } = useCrud();
  const userId = useUserId();
  const router = useRouter();
  const [form, setForm] = useState<null | "ticket" | "signal">(null);

  const account = accountId ? data.accounts.find((a) => a.Id === accountId) : undefined;
  const health = useMemo(() => (accountId ? healthFor(data, accountId, asOf) : null), [data, accountId, asOf]);
  const expansion = useMemo(() => (accountId ? expansionCandidates(data, asOf).find((c) => c.account.Id === accountId) : undefined), [data, asOf, accountId]);
  const tickets = useMemo(
    () => (accountId ? data.supportTickets.filter((t) => t.AccountId === accountId && t.CreatedDate.slice(0, 10) <= asOfISO).sort((a, b) => b.CreatedDate.localeCompare(a.CreatedDate)) : []),
    [data.supportTickets, accountId, asOfISO],
  );

  const products = useMemo(() => data.products.filter((p) => p.IsActive && p.Pricing_Unit__c !== "one-time"), [data.products]);
  const ticketFields: FieldDef[] = [
    { name: "Subject", label: "Subject", required: true, wide: true },
    { name: "Priority", label: "Priority", type: "select", required: true, options: opts(PRIORITIES) },
    { name: "Status", label: "Status", type: "select", required: true, options: opts(TICKET_STATUSES) },
    { name: "Product2Id", label: "Product", type: "select", options: products.map((p) => ({ value: p.Id, label: p.Name })), wide: true },
  ];
  const signalFields: FieldDef[] = [
    { name: "UsageScore", label: "Usage (0–100)", type: "number", required: true, min: 0, max: 100 },
    { name: "CSAT", label: "CSAT (0–10)", type: "number", required: true, min: 0, max: 10, step: 0.1 },
    { name: "LocationsLive", label: "Locations live", type: "number", required: true, min: 0, max: Math.max(1, account?.Number_of_Locations__c ?? 1) },
    { name: "StakeholderChange", label: "Key contact changed", type: "checkbox" },
  ];

  function saveSignal(changes: Partial<HealthSignal>, message: string) {
    if (!account) return;
    const sig = health?.signal;
    if (sig) {
      run([{ op: "update", object: "HealthSignal", id: sig.Id, changes: { ...changes, AsOfDate: asOfISO } }], message);
      return;
    }
    const record: HealthSignal = {
      Id: newId("HealthSignal"),
      AccountId: account.Id,
      UsageScore: health?.usage ?? 60,
      SupportTickets90d: health?.tickets90d ?? 0,
      CSAT: health?.csat ?? 7,
      StakeholderChange: false,
      LocationsLive: account.Number_of_Locations__c,
      AsOfDate: asOfISO,
      ...changes,
    };
    run([{ op: "create", object: "HealthSignal", record }], message);
  }

  function startExpansion() {
    if (!account) return;
    const res = startExpansionMutations(data, account.Id, asOf, userId);
    if (!res) return;
    run(res.mutations);
    toast.success("Expansion opportunity created", { action: { label: "Open", onClick: () => router.push(`/opportunities/${res.opportunityId}`) } });
  }

  const open = !!accountId && !!account && !!health;
  const renewal = account ? renewalDateFor(data, account.Id, asOf) : undefined;
  const arr = account ? arrFor(data, account.Id, asOf) : 0;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
          {account && health && (
            <>
              <div className="border-b px-5 py-4 pr-12">
                <SheetTitle className="text-base font-semibold">{account.Name}</SheetTitle>
                <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
                  {account.Segment__c} · {account.BillingCity}, {account.BillingState} · {userName(account.OwnerId)}
                </SheetDescription>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <HealthBadge band={health.band} score={health.score} />
                  <TrendMark health={health} />
                  <span className="text-xs text-muted-foreground">{health.previous} 90 days ago</span>
                  <Link href={`/accounts/${account.Id}`} className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline">
                    Account
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </div>

              <div className="space-y-5 px-5 py-4">
                <section aria-label="Score breakdown">
                  <h3 className="mb-2 text-sm font-semibold">Score breakdown</h3>
                  <ul className="space-y-2">
                    {health.parts.map((p) => (
                      <li key={p.key} className="grid grid-cols-[110px_minmax(0,1fr)_64px] items-center gap-3 text-sm">
                        <span className="text-muted-foreground">{p.label}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs">{p.input}</span>
                          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full bg-primary" style={{ width: `${(p.points / p.max) * 100}%` }} />
                          </span>
                        </span>
                        <span className="text-right tabular">
                          {p.points}
                          <span className="text-muted-foreground"> / {p.max}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">ARR</dt>
                    <dd className="tabular">{arr ? fmtMoney(arr, { compact: false }) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Renewal</dt>
                    <dd className="tabular">{renewal ? fmtShortDate(renewal) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Locations live</dt>
                    <dd className="tabular">
                      {health.locationsLive} of {health.locations}
                    </dd>
                  </div>
                </dl>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setForm("ticket")}>
                    <LifeBuoy />
                    Log ticket
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setForm("signal")}>
                    <SlidersHorizontal />
                    Update CSAT / usage
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveSignal({ StakeholderChange: !health.stakeholderChange }, health.stakeholderChange ? "Stakeholder change cleared" : "Stakeholder change flagged")}
                  >
                    <UserRoundX />
                    {health.stakeholderChange ? "Clear stakeholder change" : "Flag stakeholder change"}
                  </Button>
                  {expansion &&
                    (expansion.openOpportunity ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link href={`/opportunities/${expansion.openOpportunity.Id}`}>
                          <TrendingUp />
                          Expansion opportunity
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" onClick={startExpansion}>
                        <TrendingUp />
                        Start expansion ({expansion.remaining} locations)
                      </Button>
                    ))}
                </div>

                <section aria-label="Support tickets">
                  <h3 className="mb-2 text-sm font-semibold">Support tickets</h3>
                  {tickets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {tickets.slice(0, 8).map((t) => (
                        <li key={t.Id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{t.Subject}</span>
                            <span className="text-xs text-muted-foreground">
                              {fmtShortDate(t.CreatedDate.slice(0, 10))} · {t.Priority}
                            </span>
                          </span>
                          <span className="text-xs whitespace-nowrap text-muted-foreground">{t.Status}</span>
                          {t.Status !== "Closed" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7"
                              onClick={() => update("SupportTicket", t.Id, { Status: "Closed", ClosedDate: `${asOfISO}T00:00:00.000Z` }, "Ticket")}
                            >
                              Close
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <RecordDrawer
        open={form === "ticket"}
        onOpenChange={(o) => !o && setForm(null)}
        title="Log ticket"
        description={account?.Name}
        fields={ticketFields}
        initial={{ Subject: "", Priority: "Normal", Status: "Open", Product2Id: "" }}
        submitLabel="Log ticket"
        onSubmit={(v) => {
          if (!account) return;
          const status = v.Status as SupportTicket["Status"];
          create(
            "SupportTicket",
            {
              AccountId: account.Id,
              Subject: String(v.Subject).trim(),
              Priority: v.Priority as SupportTicket["Priority"],
              Status: status,
              Product2Id: v.Product2Id ? String(v.Product2Id) : undefined,
              CreatedDate: `${asOfISO}T00:00:00.000Z`,
              ClosedDate: status === "Closed" ? `${asOfISO}T00:00:00.000Z` : undefined,
            },
            "Ticket",
          );
          setForm(null);
        }}
      />

      <RecordDrawer
        open={form === "signal"}
        onOpenChange={(o) => !o && setForm(null)}
        title="Update health inputs"
        description={account?.Name}
        fields={signalFields}
        initial={{
          UsageScore: health ? Math.round(health.usage) : 60,
          CSAT: health?.csat ?? 7,
          LocationsLive: health?.locationsLive ?? account?.Number_of_Locations__c ?? 1,
          StakeholderChange: health?.stakeholderChange ?? false,
        }}
        onSubmit={(v) => {
          saveSignal(
            { UsageScore: Number(v.UsageScore), CSAT: Math.round(Number(v.CSAT) * 10) / 10, LocationsLive: Number(v.LocationsLive), StakeholderChange: !!v.StakeholderChange },
            "Health inputs updated",
          );
          setForm(null);
        }}
      />
    </>
  );
}
