"use client";

import Link from "next/link";
import { ArrowRight, Briefcase, Flame, Target, Trophy } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { pipelineSummary } from "@/lib/data/selectors";
import { fmtDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { cropNoun, type RegionStatus } from "@/lib/season";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SeasonMap } from "./season-map";
import { StageChart } from "./stage-chart";
import { MarketStrip } from "./market-strip";
import { LaunchWindows } from "./launch-windows";
import { ProspectRowCard } from "@/components/prospects/prospect-row-card";
import { OutreachButtons } from "@/components/outreach/outreach-buttons";

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const weeks = (days: number) => {
  const w = Math.max(1, Math.round(days / 7));
  return `${w} wk${w === 1 ? "" : "s"}`;
};

export function seasonSentence(regions: RegionStatus[]): string {
  const harvest = regions.filter((r) => r.headline.phase === "Harvest");
  const pre = regions.filter((r) => r.headline.phase === "Pre-harvest").sort((a, b) => a.headline.daysToHarvest - b.headline.daysToHarvest);
  const post = regions.filter((r) => r.headline.phase === "Post-harvest");
  const parts: string[] = [];
  if (harvest.length) {
    const crops = [...new Set(harvest.map((r) => cropNoun(r.headline.commodity).toLowerCase()))];
    parts.push(`${listJoin(crops).replace(/^./, (c) => c.toUpperCase())} harvest is rolling in ${listJoin(harvest.map((r) => r.region.shortName))}.`);
  }
  if (pre.length) {
    parts.push(
      `${listJoin(pre.slice(0, 3).map((r) => `${r.region.shortName} (${cropNoun(r.headline.commodity).toLowerCase()} in ${weeks(r.headline.daysToHarvest)})`))} ${pre.length === 1 ? "is" : "are"} in the pre-harvest launch window.`,
    );
  }
  if (post.length) parts.push(`${listJoin(post.map((r) => r.region.shortName))} ${post.length === 1 ? "is" : "are"} into post-harvest settlements.`);
  if (!parts.length) parts.push("It's the quiet season: planting prep, prepay and year-end planning.");
  return parts.join(" ");
}

function Kpi({ icon: Icon, label, value, sub }: { icon: typeof Target; label: string; value: string; sub: string }) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
          {label}
        </p>
        <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-2/3" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

export function Dashboard() {
  const { ready, data, asOf, ranked, regions } = useStore();
  if (!ready) return <DashboardSkeleton />;
  const pipe = pipelineSummary(data, asOf);
  const hot = ranked.filter((s) => s.tier === "Hot");
  const warm = ranked.filter((s) => s.tier === "Warm");
  const top = ranked.slice(0, 8);

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-primary">Right now · {fmtDate(asOf)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Who to call this week, and why</h1>
          <p className="mt-2 text-muted-foreground">{seasonSentence(regions)}</p>
        </div>
        <Button asChild variant="outline" className="self-start md:self-auto">
          <Link href="/prospects">
            All {ranked.length} prospects <ArrowRight className="size-4" />
          </Link>
        </Button>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Headline numbers">
        <Kpi icon={Briefcase} label="Open pipeline" value={fmtMoney(pipe.total)} sub={`${pipe.open.length} open deals`} />
        <Kpi icon={Target} label="Weighted forecast" value={fmtMoney(pipe.weighted)} sub={`${fmtMoney(pipe.commit)} commit · ${fmtMoney(pipe.bestCase)} best case`} />
        <Kpi icon={Flame} label="Hot prospects right now" value={String(hot.length)} sub={`${warm.length} warm · scored for ${fmtDate(asOf).replace(/, \d{4}$/, "")}`} />
        <Kpi icon={Trophy} label="Closed won, last 90 days" value={fmtMoney(pipe.wonLast90)} sub="New and add-on business" />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Season map</CardTitle>
          <CardDescription>Where each region is in its crop year. Pick a state or province to see what&apos;s happening there.</CardDescription>
        </CardHeader>
        <CardContent>
          <SeasonMap />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="min-w-0 lg:col-span-7">
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>Top prospects to reach now</CardTitle>
              <CardDescription>Ranked by season timing, market, fit, displacement, engagement and climate.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm" className="shrink-0">
              <Link href="/prospects">
                See all <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="divide-y">
            {top.map((s, i) => (
              <ProspectRowCard key={s.target.id} s={s} rank={i + 1} actions={<OutreachButtons target={s} size="xs" />} />
            ))}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-6 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>Campaign launch windows</CardTitle>
              <CardDescription>Best practice: land 4–6 weeks before harvest starts.</CardDescription>
            </CardHeader>
            <CardContent>
              <LaunchWindows />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Open pipeline by stage</CardTitle>
              <CardDescription>
                {fmtMoney(pipe.total)} across {pipe.open.length} deals
              </CardDescription>
            </CardHeader>
            <CardContent>
              <StageChart data={pipe.byStage} />
            </CardContent>
          </Card>
        </div>
      </div>

      <section aria-label="Markets">
        <h2 className="mb-3 text-sm font-semibold">Markets that move our prospects</h2>
        <MarketStrip />
      </section>
    </div>
  );
}
