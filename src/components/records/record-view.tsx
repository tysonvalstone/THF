"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck, Check, Clock, ListTodo, Mail, Mailbox, Phone } from "lucide-react";
import { blackoutStatus, closeDateFlags, harvestWindowFor, nextBoardMeeting } from "@/lib/seasonality";
import { StagePath } from "./opportunity-view";
import { useStore } from "@/lib/data/store";
import { contactName, contactsFor, findAccount, findLead, opportunitiesFor, timelineFor, userName, type TimelineItem } from "@/lib/data/selectors";
import { scoreOne, sizeLabel, type ScoredTarget } from "@/lib/scoring";
import { targetFromAccount, targetFromLead } from "@/lib/scoring/target";
import { nextBestAction, type NextBestAction } from "@/lib/nba";
import { PRODUCT_BY_ID } from "@/data/reference/products";
import { VENDOR_BY_NAME } from "@/data/reference/software";
import { fmtDate, fmtMonthYear, fmtRelative, fmtShortDate, toISODate } from "@/lib/dates";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { type Account, type Contact, type Lead, type Opportunity } from "@/types/salesforce";
import { ScorePill, TierLabel } from "@/components/shared/badges";
import { ScoreBreakdown } from "@/components/prospects/score-breakdown";
import { SeasonStrip } from "@/components/season/season-strip";
import { OutreachDialog, type OutreachTab } from "@/components/outreach/outreach-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { DocTitle } from "@/components/shared/doc-title";
import { cn } from "@/lib/utils";

export function RecordView({ id }: { id: string }) {
  const { ready, data, asOf } = useStore();
  const [tab, setTab] = useState<OutreachTab | null>(null);

  if (!ready) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  const account = findAccount(data, id);
  const lead = account ? undefined : findLead(data, id);
  if (!account && !lead) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center">
        <p className="font-medium">Record not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/prospects">Back to prospects</Link>
        </Button>
      </div>
    );
  }

  const target = account ? targetFromAccount(account) : targetFromLead(lead!);
  const scored = scoreOne(data, target, asOf);
  const contacts = account ? contactsFor(data, account.Id) : [];
  const opps = account ? opportunitiesFor(data, account.Id) : [];
  const openOpps = opps.filter((o) => !o.IsClosed);
  const timeline = timelineFor(data, id);
  const openTasks = timeline.filter((i) => i.kind === "task" && i.record.Status !== "Completed").map((i) => i.record as never);
  const nba = nextBestAction(scored, { contacts, openOpps, openTasks, asOf });
  const children = account ? data.accounts.filter((c) => c.ParentId === account.Id) : [];
  const parent = account?.ParentId ? findAccount(data, account.ParentId) : undefined;

  return (
    <div className="space-y-5">
      <DocTitle title={target.name} />
      <Link href="/prospects" className="text-sm text-muted-foreground hover:text-foreground">
        Prospects
      </Link>

      <Highlights account={account} lead={lead} scored={scored} onAction={setTab} parent={parent} locations={children.length + 1} />

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="min-w-0 space-y-5 lg:col-span-8">
          <NbaCard nba={nba} onAction={setTab} />
          <Card>
            <CardHeader>
              <CardTitle>Seasonal Calendar</CardTitle>
            </CardHeader>
            <CardContent>
              <SeasonStrip entity={{ Region__c: target.regionId, Facility_Type__c: target.facilityType, Primary_Commodities__c: target.commodities }} asOf={asOf} />
            </CardContent>
          </Card>

          <Tabs defaultValue="activity">
            <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value="activity">Activity ({timeline.filter((i) => i.date <= asOf || i.kind === "event" || i.record.Status !== "Completed").length})</TabsTrigger>
              {account && <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>}
              {account && <TabsTrigger value="opps">Opportunities ({opps.length})</TabsTrigger>}
              {account && children.length > 0 && <TabsTrigger value="locations">Locations ({children.length + 1})</TabsTrigger>}
              <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>
            <TabsContent value="activity">
              <ActivityTimeline items={timeline} />
            </TabsContent>
            {account && (
              <TabsContent value="contacts">
                <ContactsList contacts={contacts} />
              </TabsContent>
            )}
            {account && (
              <TabsContent value="opps">
                <OppList opps={opps} />
              </TabsContent>
            )}
            {account && children.length > 0 && (
              <TabsContent value="locations">
                <Card className="py-0">
                  <ul className="divide-y">
                    {[account, ...children].map((c) => (
                      <li key={c.Id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                        <span>
                          {c.Id === account.Id ? `${c.Name} (headquarters)` : c.Name}
                          <span className="block text-xs text-muted-foreground">
                            {c.County__c ? `${c.County__c} County, ` : ""}
                            {c.BillingState}
                            {c.Railroad__c ? ` · ${c.Railroad__c}` : ""}
                            {c.Shuttle_Loader__c ? " · shuttle loader" : ""}
                          </span>
                        </span>
                        <span className="text-xs text-muted-foreground tabular">{c.Storage_Capacity_Bu__c ? `${(c.Storage_Capacity_Bu__c / 1e6).toFixed(1)}M bu` : ""}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </TabsContent>
            )}
            <TabsContent value="campaigns">
              <CampaignHistory id={id} />
            </TabsContent>
            <TabsContent value="details">
              <Details account={account} lead={lead} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Score
                <TierLabel tier={scored.tier} />
              </CardTitle>
              <CardDescription>As of {fmtDate(asOf)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {target.isCustomer ? (
                <p className="text-sm text-muted-foreground">Current customer</p>
              ) : null}
              <div className="flex items-center gap-4">
                <ScorePill score={scored.total} size="lg" />
                <p className="text-sm">{scored.whyNow}</p>
              </div>
              <ScoreBreakdown s={scored} />
            </CardContent>
          </Card>
        </div>
      </div>

      <OutreachDialog s={scored} open={tab !== null} onOpenChange={(o) => !o && setTab(null)} tab={tab ?? "email"} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 truncate text-sm">{children}</div>
    </div>
  );
}

function Highlights({
  account,
  lead,
  scored,
  onAction,
  parent,
  locations,
}: {
  account?: Account;
  lead?: Lead;
  scored: ScoredTarget;
  onAction: (t: OutreachTab) => void;
  parent?: Account;
  locations: number;
}) {
  const t = scored.target;
  const vendor = VENDOR_BY_NAME[t.software];
  const { asOf } = useStore();
  const entity = { Segment__c: t.segment, BillingLatitude: t.lat, BillingCountry: t.country };
  const harvest = harvestWindowFor(entity, asOf.getUTCFullYear());
  const blackout = blackoutStatus(entity, asOf);
  const meeting = account ? nextBoardMeeting(account.Board_Meeting_Months__c, asOf) : null;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return (
    <Card className="py-5">
      <CardContent className="space-y-4 px-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {lead ? `Lead · ${lead.Status} · ${lead.Rating}` : account!.Type === "Customer - Direct" ? "Account · Customer" : "Account · Prospect"}
              </p>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.name}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>{t.facilityType}</span>
                <span aria-hidden>·</span>
                <span>
                  {t.city}, {t.state}
                  {account?.County__c ? ` (${account.County__c} County)` : ""}
                </span>
                <span aria-hidden>·</span>
                <span>{t.commodities.join(", ")}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction("email")}>
              Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAction("call")}>
              Log call
            </Button>
            <Button size="sm" onClick={() => onAction("campaign")}>
              Add to campaign
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Size">{sizeLabel(t)}</Field>
          <Field label="Locations">{t.locations}</Field>
          <Field label="Current software">
            <span title={vendor?.note}>{t.software}</span>
          </Field>
          <Field label={vendor?.kind === "legacy" ? "Support ends" : "Contract end"}>{t.softwareEnd ? fmtMonthYear(t.softwareEnd) : "—"}</Field>
          <Field label="Annual revenue">{fmtMoney(t.revenue)}</Field>
          <Field label="Owner">{userName(t.ownerId)}</Field>
          <Field label="Segment">{t.segment}</Field>
          <Field label="Harvest window">{harvest ? `${fmtShortDate(harvest.start)} – ${fmtShortDate(harvest.end)}` : "Year-round"}</Field>
          <Field label="Contact status">
            <span className={cn(blackout.status === "hard" && "font-medium text-amber-800")}>
              {blackout.status === "hard" ? `Harvest blackout to ${fmtShortDate(blackout.blackout!.end)}` : blackout.status === "light" ? `Planting (light) to ${fmtShortDate(blackout.blackout!.end)}` : "Open"}
            </span>
          </Field>
          <Field label="Fiscal year end">{account ? fmtShortDate(`2026-${account.Fiscal_Year_End__c}`) : "—"}</Field>
          <Field label="Board meets">
            {account?.Board_Meeting_Months__c.length ? account.Board_Meeting_Months__c.map((m) => MONTHS[m - 1]).join(", ") : "—"}
            {meeting ? <span className="block text-xs text-muted-foreground">next {fmtShortDate(meeting)}</span> : null}
          </Field>
          <Field label={parent ? "Parent co-op" : "Locations"}>
            {parent ? (
              <Link href={`/accounts/${parent.Id}`} className="text-primary hover:underline">
                {parent.Name}
              </Link>
            ) : (
              locations
            )}
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

const URGENCY: Record<NextBestAction["urgency"], { label: string; cls: string }> = {
  now: { label: "Do it now", cls: "bg-[#fdeee6] text-[#a8431b]" },
  "this-week": { label: "This week", cls: "bg-[#e6f0fc] text-[#1c5cab]" },
  soon: { label: "Soon", cls: "bg-muted text-muted-foreground" },
  later: { label: "Later", cls: "bg-muted text-muted-foreground" },
};

function NbaCard({ nba, onAction }: { nba: NextBestAction; onAction: (t: OutreachTab) => void }) {
  const u = URGENCY[nba.urgency];
  const action: OutreachTab | null = nba.channel === "call" ? "call" : nba.channel === "email" ? "email" : nba.channel === "campaign" ? "campaign" : null;
  return (
    <Card className="border-border bg-accent-soft">
      <CardContent className="flex flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
              Next best action
              <span className={cn("rounded-full px-2 py-0.5 text-[11px]", u.cls)}>{u.label}</span>
              {nba.contact && (
                <span>
                  · {nba.contact.Name}, {nba.contact.Title}
                </span>
              )}
            </p>
            <p className="mt-1 font-medium">{nba.title}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{nba.detail}</p>
          </div>
        </div>
        {action && (
          <Button onClick={() => onAction(action)} className="shrink-0">
            {action === "call" ? "Call & log" : action === "email" ? "Write email" : "Add to campaign"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

const ITEM_ICON = { Call: Phone, Email: Mail, "Mail Drop": Mailbox, Meeting: CalendarCheck, "Follow-up": ListTodo, Other: ListTodo };

function ActivityTimeline({ items }: { items: TimelineItem[] }) {
  const { data, asOf } = useStore();
  const asOfISO = toISODate(asOf);
  // Hide completed history that "hasn't happened yet" when time-travelling backwards
  const visible = items.filter((i) => (i.kind === "task" ? i.record.Status !== "Completed" || i.record.ActivityDate <= asOfISO : true));
  const upcoming = visible.filter((i) => (i.kind === "task" ? i.record.Status !== "Completed" : i.date > asOf)).reverse();
  const past = visible.filter((i) => !upcoming.includes(i));
  const [limit, setLimit] = useState(15);

  const Row = ({ i }: { i: TimelineItem }) => {
    const Icon = i.kind === "event" ? CalendarCheck : ITEM_ICON[i.record.Type as keyof typeof ITEM_ICON] ?? ListTodo;
    const who = contactName(data, i.record.WhoId);
    const overdue = i.kind === "task" && i.record.Status !== "Completed" && i.record.ActivityDate < asOfISO;
    return (
      <li className="relative flex gap-3 pb-4 last:pb-0">
        <span className="z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card">
          <Icon className="size-3.5 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium">{i.record.Subject}</p>
            <p className={cn("text-xs text-muted-foreground tabular", overdue && "font-medium text-[#a8431b]")}>
              {overdue ? "Overdue · " : ""}
              {fmtShortDate(i.date)} · {fmtRelative(i.date, asOf)}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            {[who, userName(i.record.OwnerId), i.kind === "task" && i.record.CallDisposition ? i.record.CallDisposition : null].filter(Boolean).join(" · ")}
          </p>
          {i.record.Description && <p className="mt-1 line-clamp-3 text-sm whitespace-pre-line text-foreground/80">{i.record.Description}</p>}
        </div>
      </li>
    );
  };

  if (!visible.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No activity</p>;

  return (
    <Card>
      <CardContent className="space-y-5 px-5">
        {upcoming.length > 0 && (
          <section>
            <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Clock className="size-3.5" /> Upcoming & open
            </h3>
            <ol className="relative before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
              {upcoming.map((i) => (
                <Row key={i.record.Id} i={i} />
              ))}
            </ol>
          </section>
        )}
        <section>
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Check className="size-3.5" /> History
          </h3>
          <ol className="relative before:absolute before:top-2 before:bottom-2 before:left-4 before:w-px before:bg-border">
            {past.slice(0, limit).map((i) => (
              <Row key={i.record.Id} i={i} />
            ))}
          </ol>
          {past.length > limit && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((l) => l + 20)}>
              Show older activity ({past.length - limit})
            </Button>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function ContactsList({ contacts }: { contacts: Contact[] }) {
  return (
    <Card className="py-0">
      <ul className="divide-y">
        {contacts.map((c) => (
          <li key={c.Id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">
                {c.Name} <span className="font-normal text-muted-foreground">· {c.Title}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {c.Buying_Role__c}
                {c.HasOptedOutOfEmail ? " · email opt-out" : ""}
              </p>
            </div>
            <div className="flex flex-col text-sm sm:items-end">
              <span className="text-muted-foreground">{c.Email}</span>
              <span className="text-muted-foreground tabular">{c.MobilePhone ?? c.Phone}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OppList({ opps }: { opps: Opportunity[] }) {
  const { data, asOf } = useStore();
  if (!opps.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No opportunities</p>;
  return (
    <div className="space-y-3">
      {opps.map((o) => {
        const lines = data.lineItems.filter((l) => l.OpportunityId === o.Id);
        return (
          <Card key={o.Id} className="py-4">
            <CardContent className="space-y-3 px-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/opportunities/${o.Id}`} className="font-medium text-primary hover:underline">
                    {o.Name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {o.Type} · {o.ForecastCategoryName} · {o.Probability}% · close {fmtShortDate(o.CloseDate)} · {userName(o.OwnerId)}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular">{fmtMoney(o.Amount, { compact: false })}</p>
              </div>
              <StagePath stage={o.StageName} />
              {closeDateFlags(o, findAccount(data, o.AccountId), asOf).map((f) => (
                <p key={f.kind} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                  {f.message}
                </p>
              ))}
              {!o.IsClosed && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Next step:</span> {o.NextStep}
                </p>
              )}
              {o.Loss_Reason__c && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Loss reason:</span> {o.Loss_Reason__c}
                </p>
              )}
              {lines.length > 0 && (
                <ul className="divide-y rounded-md border text-sm">
                  {lines.map((l) => (
                    <li key={l.Id} className="flex justify-between gap-3 px-3 py-1.5">
                      <span>
                        {PRODUCT_BY_ID[l.Product2Id]?.Name ?? l.Product2Id}
                        {l.Quantity > 1 ? <span className="text-muted-foreground"> × {l.Quantity}</span> : null}
                        {l.Description ? <span className="text-muted-foreground"> · {l.Description}</span> : null}
                      </span>
                      <span className="text-muted-foreground tabular">{fmtMoney(l.TotalPrice, { compact: false })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function CampaignHistory({ id }: { id: string }) {
  const { data } = useStore();
  const members = data.campaignMembers.filter((m) => m.AccountId === id || m.LeadId === id);
  if (!members.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No campaigns</p>;
  return (
    <Card className="py-0">
      <ul className="divide-y">
        {members.map((m) => {
          const c = data.campaigns.find((x) => x.Id === m.CampaignId);
          return (
            <li key={m.Id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <Link href={`/campaigns/${m.CampaignId}`} className="font-medium hover:underline">
                  {c?.Name ?? "Campaign"}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {c?.Type} · {c ? fmtShortDate(c.StartDate) : ""}
                </p>
              </div>
              <Badge variant={m.HasResponded ? "default" : "outline"}>
                {m.Status}
                {m.FirstRespondedDate ? ` ${fmtShortDate(m.FirstRespondedDate)}` : ""}
              </Badge>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Details({ account, lead }: { account?: Account; lead?: Lead }) {
  const rows: [string, React.ReactNode][] = account
    ? [
        ["Description", account.Description],
        ["Billing address", `${account.BillingStreet}, ${account.BillingCity}, ${account.BillingState} ${account.BillingPostalCode}, ${account.BillingCountry}`],
        ["Phone", account.Phone],
        ["Website", account.Website],
        ["Storage capacity", account.Storage_Capacity_Bu__c ? `${fmtNumber(account.Storage_Capacity_Bu__c)} bu` : "—"],
        ["Annual production", account.Annual_Production_Gal__c ? `${fmtNumber(account.Annual_Production_Gal__c)} gal` : account.Annual_Production_Tons__c ? `${fmtNumber(account.Annual_Production_Tons__c)} tons` : "—"],
        ["Livestock focus", account.Livestock_Focus__c ?? "—"],
        ["Rail served", account.Rail_Served__c ? `Yes${account.Railroad__c ? ` (${account.Railroad__c})` : ""}` : "No"],
        ["Employees", fmtNumber(account.NumberOfEmployees)],
        ["Customer since / created", fmtDate(account.CreatedDate)],
        ["Salesforce Id", <code key="id" className="text-xs">{account.Id}</code>],
      ]
    : [
        ["Company", lead!.Company],
        ["Contact", `${lead!.Name}, ${lead!.Title}`],
        ["Email", lead!.Email],
        ["Phone", lead!.Phone],
        ["Address", `${lead!.Street}, ${lead!.City}, ${lead!.State} ${lead!.PostalCode}, ${lead!.Country}`],
        ["Lead source", lead!.LeadSource],
        ["Status / rating", `${lead!.Status} · ${lead!.Rating}`],
        ["Created", fmtDate(lead!.CreatedDate)],
        ["Salesforce Id", <code key="id" className="text-xs">{lead!.Id}</code>],
      ];
  return (
    <Card>
      <CardContent className="px-5">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className={cn(k === "Description" && "sm:col-span-2")}>
              <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 text-sm">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
