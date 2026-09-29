"use client";

import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { SELLING_WINDOWS, sellingWindowAt, windowRange, type SellingWindowId } from "@/lib/seasonality";
import { WEBINAR_NAME, WEBINAR_PRESET, webinarDate } from "@/lib/content/webinar";
import { campaignBuilderHref } from "@/lib/links";
import { fmtShortDate } from "@/lib/dates";
import { SellingWindowStrip } from "@/components/season/selling-windows";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PLAYS: { id: SellingWindowId; play: string; campaign: string; audience: string; channel: string }[] = [
  {
    id: "year-end",
    play: "Year-end",
    campaign: "Price-later contract compliance webinar, then year-end reviews",
    audience: "Controllers + GMs at elevators and co-ops",
    channel: "Webinar invite, 3-email sequence, call follow-up",
  },
  {
    id: "implementation",
    play: "Implementation",
    campaign: "Live before planting: fixed-scope go-lives",
    audience: "GMs with open proposals; co-ops after board approval",
    channel: "Call blitz + proposal follow-up",
  },
  {
    id: "budget",
    play: "Budget window",
    campaign: "Get into next fiscal year's budget (FY ends Aug 31 / Sep 30)",
    audience: "Controllers and CFOs",
    channel: "Direct mail letter + budget-ready proposal",
  },
  {
    id: "quick-wins",
    play: "Quick wins",
    campaign: "Mobile add-ons and one-location pilots",
    audience: "Existing customers and warm prospects",
    channel: "Email + short call",
  },
];

export function CampaignCalendar() {
  const { ready, asOf } = useStore();
  if (!ready) return <Skeleton className="h-80" />;
  const current = sellingWindowAt(asOf);
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-4">
        <h2 className="text-base font-semibold">Selling windows for elevators and co-ops</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Harvest (mid-Aug to Thanksgiving) is no-contact, and spring planting is light no-contact, both a week or two later in the north and later still in Canada.
          Ethanol plants, feed mills and processors can be worked all year.
        </p>
        <div className="mt-4">
          <SellingWindowStrip />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {PLAYS.map((p) => {
          const w = SELLING_WINDOWS.find((x) => x.id === p.id)!;
          const range = windowRange(w, asOf);
          const isNow = current.id === p.id;
          return (
            <article key={p.id} className={cn("flex flex-col rounded-md border bg-card p-4", isNow && "border-primary")}>
              <p className="text-xs text-muted-foreground">
                {w.when}
                {isNow ? " · now" : ` · next ${fmtShortDate(range.start)}`}
              </p>
              <h3 className="mt-0.5 font-semibold">{w.name}</h3>
              <p className="mt-2 text-sm">{p.campaign}</p>
              <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>
                  <dt className="inline">Who: </dt>
                  <dd className="inline">{p.audience}</dd>
                </div>
                <div>
                  <dt className="inline">How: </dt>
                  <dd className="inline">{p.channel}</dd>
                </div>
              </dl>
              <div className="mt-auto pt-3">
                <Button asChild size="sm" variant={isNow ? "default" : "outline"} className="w-full">
                  <Link href={p.id === "year-end" ? `/campaigns/new?preset=${WEBINAR_PRESET}` : campaignBuilderHref({ types: ["Grain Elevator", "Cooperative"], season: p.play })}>
                    {p.id === "year-end" ? "Plan the webinar" : `Plan ${p.play.toLowerCase()} campaign`}
                  </Link>
                </Button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="rounded-md border bg-card p-4">
        <p className="text-xs text-muted-foreground">First campaign</p>
        <h3 className="font-semibold">{WEBINAR_NAME}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          45 minutes for controllers and GMs on what examiners look for in price-later (DP) contracts. Proposed date {fmtShortDate(webinarDate(asOf))}, 10:00 CT. Includes
          invite copy, a controller + GM target list, a 3-email sequence (invite, reminder, recording) and a call script.
        </p>
        <Button asChild size="sm" className="mt-3">
          <Link href={`/campaigns/new?preset=${WEBINAR_PRESET}`}>Open in campaign builder</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">During harvest, the plan is to support customers, collect NPS and testimonials, and sell to year-round segments.</p>
    </div>
  );
}
