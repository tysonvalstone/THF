"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarCheck,
  Check,
  ChevronRight,
  Clock,
  Globe,
  ListTodo,
  Mail,
  Mailbox,
  MapPin,
  Megaphone,
  Phone,
  Train,
  UserRound,
  Zap,
} from "lucide-react";
import { useStore } from "@/lib/data/store";
import { contactName, contactsFor, findAccount, findLead, opportunitiesFor, timelineFor, userName, type TimelineItem } from "@/lib/data/selectors";
import { scoreOne, sizeLabel, type ScoredTarget } from "@/lib/scoring";
import { targetFromAccount, targetFromLead } from "@/lib/scoring/target";
import { nextBestAction, type NextBestAction } from "@/lib/nba";
import { PRODUCT_BY_ID } from "@/data/reference/products";
import { REGION_BY_ID } from "@/data/reference/regions";
import { VENDOR_BY_NAME } from "@/data/reference/software";
import { fmtDate, fmtMonthYear, fmtRelative, fmtShortDate, parseDate, toISODate } from "@/lib/dates";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { ALL_STAGES, type Account, type Contact, type Lead, type Opportunity } from "@/types/salesforce";
import { ScorePill, TierLabel } from "@/components/shared/badges";
import { ScoreBreakdown } from "@/components/prospects/score-breakdown";
import { SeasonStrip } from "@/components/season/season-strip";
import { OutreachDialog, type OutreachTab } from "@/components/outreach/outreach-dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
        <p className="mt-1 text-sm text-muted-foreground">It may have been removed when the demo data was reset.</p>
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
  const region = REGION_BY_ID[target.regionId];

  return (
    <div className="space-y-5">
      <Link href="/prospects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Prospects
      </Link>

      <Highlights account={account} lead={lead} scored={scored} onAction={setTab} />

      <div className="grid gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-8">
          <NbaCard nba={nba} onAction={setTab} />
          <Card>
            <CardHeader>
              <CardTitle>Seasonal calendar</CardTitle>
              <CardDescription>
                {region.name}: {region.summary}
              </CardDescription>
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
            <TabsContent value="campaigns">
              <CampaignHistory id={id} />
            </TabsContent>
            <TabsContent value="details">
              <Details account={account} lead={lead} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="space-y-5 lg:col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Prospect score
                <TierLabel tier={scored.tier} />
              </CardTitle>
              <CardDescription>As of {fmtDate(asOf)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {target.isCustomer ? (
                <p className="text-sm text-muted-foreground">
                  Current ThiboLiSoft customer. Scores are shown for context; customers are not ranked as prospects.
                </p>
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

function Highlights({ account, lead, scored, onAction }: { account?: Account; lead?: Lead; scored: ScoredTarget; onAction: (t: OutreachTab) => void }) {
  const t = scored.target;
  const vendor = VENDOR_BY_NAME[t.software];
  return (
    <Card className="py-5">
      <CardContent className="space-y-4 px-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-green-soft text-primary">
              {lead ? <UserRound className="size-5" /> : <Building2 className="size-5" />}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-muted-foreground">
                {lead ? `Lead · ${lead.Status} · ${lead.Rating}` : account!.Type === "Customer - Direct" ? "Account · Customer" : "Account · Prospect"}
              </p>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t.name}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>{t.facilityType}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" /> {t.city}, {t.state}
                </span>
                <span aria-hidden>·</span>
                <span>{t.commodities.join(", ")}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => onAction("email")}>
              <Mail className="size-4" /> Email
            </Button>
            <Button size="sm" variant="outline" onClick={() => onAction("call")}>
              <Phone className="size-4" /> Log call
            </Button>
            <Button size="sm" onClick={() => onAction("campaign")}>
              <Megaphone className="size-4" /> Add to campaign
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
    <Card className="border-primary/30 bg-brand-green-soft/40">
      <CardContent className="flex flex-col gap-4 px-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Zap className="size-4" />
          </span>
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
            {action === "call" ? <Phone className="size-4" /> : action === "email" ? <Mail className="size-4" /> : <Megaphone className="size-4" />}
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

  if (!visible.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No activity yet. Your first touch will show up here.</p>;

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

function StagePath({ stage }: { stage: Opportunity["StageName"] }) {
  const path = ALL_STAGES.filter((s) => s !== "Closed Lost");
  const idx = stage === "Closed Lost" ? -1 : path.indexOf(stage);
  return (
    <ol className="flex w-full overflow-hidden rounded-md text-[11px] font-medium" aria-label={`Stage: ${stage}`}>
      {path.map((s, i) => (
        <li
          key={s}
          className={cn(
            "flex flex-1 items-center justify-center gap-1 px-1 py-1.5 text-center",
            i < idx && "bg-[#cfe3d6] text-primary",
            i === idx && (stage === "Closed Won" ? "bg-status-good text-white" : "bg-primary text-primary-foreground"),
            i > idx && "bg-muted text-muted-foreground",
            stage === "Closed Lost" && "bg-muted text-muted-foreground",
          )}
          title={s}
        >
          {i < idx && <Check className="size-3" />}
          <span className="truncate">{s}</span>
          {i < path.length - 1 && <ChevronRight className="hidden size-3 opacity-40 sm:inline" />}
        </li>
      ))}
    </ol>
  );
}

function OppList({ opps }: { opps: Opportunity[] }) {
  const { data } = useStore();
  if (!opps.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No opportunities yet. Book a demo from a call to create one automatically.</p>;
  return (
    <div className="space-y-3">
      {opps.map((o) => {
        const lines = data.lineItems.filter((l) => l.OpportunityId === o.Id);
        return (
          <Card key={o.Id} className="py-4">
            <CardContent className="space-y-3 px-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{o.Name}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.Type} · {o.ForecastCategoryName} · {o.Probability}% · close {fmtShortDate(o.CloseDate)} · {userName(o.OwnerId)}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular">{fmtMoney(o.Amount, { compact: false })}</p>
              </div>
              <StagePath stage={o.StageName} />
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
  if (!members.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">Not in any campaigns yet.</p>;
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
        ["Website", <span key="w" className="inline-flex items-center gap-1"><Globe className="size-3.5" />{account.Website}</span>],
        ["Storage capacity", account.Storage_Capacity_Bu__c ? `${fmtNumber(account.Storage_Capacity_Bu__c)} bu` : "—"],
        ["Annual production", account.Annual_Production_Gal__c ? `${fmtNumber(account.Annual_Production_Gal__c)} gal` : account.Annual_Production_Tons__c ? `${fmtNumber(account.Annual_Production_Tons__c)} tons` : "—"],
        ["Livestock focus", account.Livestock_Focus__c ?? "—"],
        ["Rail served", <span key="r" className="inline-flex items-center gap-1"><Train className="size-3.5" />{account.Rail_Served__c ? "Yes" : "No"}</span>],
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
        <p className="mt-4 text-xs text-muted-foreground">Last scored {fmtDate(parseDate(toISODate(new Date())))} for the as-of date shown in the header.</p>
      </CardContent>
    </Card>
  );
}
