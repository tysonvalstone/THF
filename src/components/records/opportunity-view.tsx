"use client";

import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { contactName, contactsFor, findAccount, userName } from "@/lib/data/selectors";
import { closeDateFlags, nextBoardMeeting } from "@/lib/seasonality";
import { prioritize } from "@/lib/prioritization";
import { PRODUCT_BY_ID } from "@/data/reference/products";
import { fmtDate, fmtShortDate, MONTHS_SHORT, parseDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { formatRate } from "@/lib/stats";
import { ALL_STAGES, type BuyingRole, type Opportunity } from "@/types/salesforce";
import { DocTitle } from "@/components/shared/doc-title";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMemo } from "react";

export function StagePath({ stage }: { stage: Opportunity["StageName"] }) {
  const path = ALL_STAGES.filter((s) => s !== "Closed Lost");
  const idx = stage === "Closed Lost" ? -1 : path.indexOf(stage);
  return (
    <ol className="flex w-full overflow-hidden rounded-md border text-[11px] font-medium" aria-label={`Stage: ${stage}`}>
      {path.map((s, i) => (
        <li
          key={s}
          className={cn(
            "flex-1 truncate border-r px-1 py-1.5 text-center last:border-r-0",
            i < idx && "bg-accent-soft text-primary",
            i === idx && "bg-primary text-primary-foreground",
            (i > idx || stage === "Closed Lost") && "bg-card text-muted-foreground",
          )}
          title={s}
        >
          {s}
        </li>
      ))}
    </ol>
  );
}

const COMMITTEE: { role: BuyingRole; label: string }[] = [
  { role: "Decision Maker", label: "Decision maker (GM)" },
  { role: "Economic Buyer", label: "Economic buyer (controller)" },
  { role: "Champion", label: "Champion (merchandiser)" },
  { role: "Board Member", label: "Board" },
];

export function OpportunityView({ id }: { id: string }) {
  const { ready, data, asOf } = useStore();
  const prio = useMemo(() => (ready ? prioritize(data, asOf) : null), [ready, data, asOf]);
  if (!ready || !prio) return <Skeleton className="h-[520px]" />;
  const o = data.opportunities.find((x) => x.Id === id);
  if (!o) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center">
        <p className="font-medium">Opportunity not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/">Back to segments</Link>
        </Button>
      </div>
    );
  }
  const a = findAccount(data, o.AccountId);
  const flags = closeDateFlags(o, a, asOf);
  const contacts = a ? contactsFor(data, a.Id) : [];
  const lines = data.lineItems.filter((l) => l.OpportunityId === o.Id);
  const seg = prio.segments.find((s) => s.segment === a?.Segment__c);
  const createdMonth = parseDate(o.CreatedDate).getUTCMonth();
  const rate = seg?.stats.byCreatedMonth[createdMonth];
  const meeting = nextBoardMeeting(a?.Board_Meeting_Months__c, asOf);
  const activity = [
    ...data.tasks.filter((t) => t.WhatId === o.Id).map((t) => ({ id: t.Id, date: t.ActivityDate, subject: t.Subject, who: contactName(data, t.WhoId), status: t.Status })),
    ...data.events.filter((e) => e.WhatId === o.Id).map((e) => ({ id: e.Id, date: e.StartDateTime.slice(0, 10), subject: e.Subject, who: contactName(data, e.WhoId), status: "Event" })),
  ].sort((x, y) => y.date.localeCompare(x.date));

  return (
    <div className="space-y-5">
      <DocTitle title={o.Name} />
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        Segments
      </Link>
      <section className="space-y-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Opportunity · {o.Type}</p>
            <h1 className="text-xl font-semibold">{o.Name}</h1>
            {a && (
              <p className="mt-0.5 text-sm text-muted-foreground">
                <Link href={`/accounts/${a.Id}`} className="text-primary hover:underline">
                  {a.Name}
                </Link>{" "}
                · {a.Segment__c} · {a.BillingCity}, {a.BillingState}
              </p>
            )}
          </div>
          <p className="text-2xl font-semibold tabular">{fmtMoney(o.Amount, { compact: false })}</p>
        </div>
        <StagePath stage={o.StageName} />
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <dt className="text-xs text-muted-foreground">Close date</dt>
            <dd className="tabular">{fmtDate(o.CloseDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Probability</dt>
            <dd className="tabular">{o.Probability}%</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Forecast</dt>
            <dd>{o.ForecastCategoryName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Segment close rate ({MONTHS_SHORT[createdMonth]}-created)</dt>
            <dd>{rate ? formatRate(rate) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Next board meeting</dt>
            <dd className="tabular">{meeting ? fmtShortDate(meeting) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Owner</dt>
            <dd>{userName(o.OwnerId)}</dd>
          </div>
        </dl>
        {!o.IsClosed && (
          <p className="text-sm">
            <span className="text-muted-foreground">Next step:</span> {o.NextStep}
          </p>
        )}
        {flags.length > 0 && (
          <ul className="space-y-1.5">
            {flags.map((f) => (
              <li key={f.kind} className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {f.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-md border bg-card">
          <header className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Buying committee</h2>
            <p className="text-xs text-muted-foreground">
              Economic buyer {o.Economic_Buyer_Identified__c ? `identified: ${contactName(data, o.Economic_Buyer__c) ?? "yes"}` : "not identified yet (required before Qualification)"}.
            </p>
          </header>
          <ul className="divide-y">
            {COMMITTEE.map(({ role, label }) => {
              const people = contacts.filter((c) => c.Buying_Role__c === role);
              return (
                <li key={role} className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-right">{people.length ? people.map((p) => `${p.Name} (${p.Title})`).join(", ") : <span className="text-amber-800">Missing</span>}</span>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="rounded-md border bg-card">
          <header className="border-b px-4 py-3">
            <h2 className="text-base font-semibold">Products</h2>
          </header>
          {lines.length ? (
            <ul className="divide-y text-sm">
              {lines.map((l) => (
                <li key={l.Id} className="flex justify-between gap-3 px-4 py-2">
                  <span>
                    {PRODUCT_BY_ID[l.Product2Id]?.Name ?? l.Product2Id}
                    {l.Quantity > 1 ? <span className="text-muted-foreground"> × {l.Quantity}</span> : null}
                  </span>
                  <span className="tabular text-muted-foreground">{fmtMoney(l.TotalPrice, { compact: false })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">No line items on this deal.</p>
          )}
        </section>
      </div>

      <section className="rounded-md border bg-card">
        <header className="border-b px-4 py-3">
          <h2 className="text-base font-semibold">Activity</h2>
        </header>
        {activity.length ? (
          <ul className="divide-y text-sm">
            {activity.map((x) => (
              <li key={x.id} className="flex justify-between gap-3 px-4 py-2">
                <span>
                  {x.subject}
                  {x.who ? <span className="text-muted-foreground"> · {x.who}</span> : null}
                </span>
                <span className="shrink-0 tabular text-muted-foreground">
                  {fmtShortDate(x.date)} · {x.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-3 text-sm text-muted-foreground">No activity logged on this deal.</p>
        )}
      </section>
    </div>
  );
}
