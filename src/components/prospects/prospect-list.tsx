"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Plus, Search } from "lucide-react";
import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { STATE_NAMES } from "@/data/reference/geo";
import { useStore } from "@/lib/data/store";
import { FACTOR_KEYS, FACTOR_META, sizeLabel, type FactorKey, type ScoredTarget } from "@/lib/scoring";
import { userName } from "@/lib/data/selectors";
import { recordHref, campaignBuilderHref } from "@/lib/links";
import type { ColumnDef } from "@/lib/columns";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { fmtMoney } from "@/lib/format";
import { COMMODITIES, FACILITY_TYPES, type Commodity, type RegionId } from "@/types/salesforce";
import { ScorePill, TierLabel } from "@/components/shared/badges";
import { MiniBreakdown, ScoreBreakdown } from "./score-breakdown";
import { OutreachDialog } from "@/components/outreach/outreach-dialog";
import { fmtRelative } from "@/lib/dates";
import { OutreachButtons } from "@/components/outreach/outreach-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/shared/data-table";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { AccountDrawer, LeadDrawer } from "@/components/records/forms";
import { HarvestWeightSlider } from "@/components/harvest/weight-slider";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";

type SortKey = "total" | "name" | FactorKey;

/** CSV columns for the prospect list; rank is the position in the full ranking */
export function prospectCsvColumns(rankOf: Map<string, number>): ColumnDef<ScoredTarget>[] {
  return [
    { key: "rank", label: "Rank", type: "number", value: (s) => rankOf.get(s.target.id) },
    { key: "score", label: "Score", type: "number", value: (s) => s.total },
    { key: "tier", label: "Tier", value: (s) => s.tier },
    { key: "record_type", label: "Record Type", value: (s) => (s.target.kind === "lead" ? "Lead" : "Account") },
    { key: "id", label: "Id", value: (s) => s.target.id },
    { key: "name", label: "Name", value: (s) => s.target.name },
    { key: "facility_type", label: "Facility Type", value: (s) => s.target.facilityType },
    { key: "city", label: "City", value: (s) => s.target.city },
    { key: "state", label: "State/Province", value: (s) => s.target.state },
    { key: "region", label: "Region", value: (s) => REGION_BY_ID[s.target.regionId].name },
    { key: "commodities", label: "Commodities", value: (s) => s.target.commodities.join("; ") },
    { key: "size", label: "Size", value: (s) => sizeLabel(s.target) },
    { key: "software", label: "Current Software", value: (s) => s.target.software },
    ...FACTOR_KEYS.map((k): ColumnDef<ScoredTarget> => ({ key: `factor_${k}`, label: FACTOR_META[k].label, type: "number", value: (s) => Math.round(s.factors[k].points) })),
    { key: "why_now", label: "Why Now", value: (s) => s.whyNow },
    { key: "owner", label: "Owner", value: (s) => userName(s.target.ownerId) },
  ];
}
const ALL = "all";

function useFilterState() {
  const params = useSearchParams();
  const router = useRouter();
  const get = (k: string, d = ALL) => params.get(k) ?? d;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === ALL || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.replace(`/prospects${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  return {
    q: get("q", ""),
    region: get("region"),
    state: get("state"),
    type: get("type"),
    commodity: get("commodity"),
    kind: get("kind"),
    min: Number(get("min", "0")) || 0,
    sort: (get("sort", "total") as SortKey) || "total",
    dir: get("dir", "desc") === "asc" ? "asc" : "desc",
    set,
  };
}

export function ProspectList() {
  const { ready, ranked: allRanked, asOf, data } = useStore();
  const f = useFilterState();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [emailFor, setEmailFor] = useState<ScoredTarget | null>(null);
  const [creating, setCreating] = useState<"account" | "lead" | null>(null);
  const [query, setQuery] = useState(f.q);
  // Converted leads live on as accounts; hide the lead
  const ranked = useMemo(() => {
    const converted = new Set(data.leads.filter((l) => l.IsConverted).map((l) => l.Id));
    return converted.size ? allRanked.filter((s) => !converted.has(s.target.id)) : allRanked;
  }, [allRanked, data.leads]);
  const { set: setParams, q: urlQ } = f;
  useEffect(() => {
    if (query === urlQ) return;
    const id = setTimeout(() => setParams({ q: query || null }), 300);
    return () => clearTimeout(id);
  }, [query, urlQ, setParams]);

  const csvColumns = useMemo(() => prospectCsvColumns(new Map(ranked.map((s, i) => [s.target.id, i + 1]))), [ranked]);

  const statesInScope = useMemo(() => {
    const src = f.region !== ALL ? REGION_BY_ID[f.region as RegionId]?.states ?? [] : REGIONS.flatMap((r) => r.states);
    return [...src].sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]));
  }, [f.region]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = ranked.filter((s) => {
      const t = s.target;
      if (f.region !== ALL && t.regionId !== f.region) return false;
      if (f.state !== ALL && t.state !== f.state) return false;
      if (f.type !== ALL && t.facilityType !== f.type) return false;
      if (f.commodity !== ALL && !t.commodities.includes(f.commodity as Commodity)) return false;
      if (f.kind !== ALL && t.kind !== f.kind) return false;
      if (s.total < f.min) return false;
      if (q && !`${t.name} ${t.city} ${t.state} ${t.software}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = f.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      if (f.sort === "name") return dir * a.target.name.localeCompare(b.target.name);
      if (f.sort === "total") return dir * (a.total - b.total);
      return dir * (a.factors[f.sort].points - b.factors[f.sort].points) || b.total - a.total;
    });
  }, [ranked, query, f.region, f.state, f.type, f.commodity, f.kind, f.min, f.sort, f.dir]);

  if (!ready) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-24" />
        <Skeleton className="h-[480px]" />
      </div>
    );
  }

  const hasFilters = query || f.region !== ALL || f.state !== ALL || f.type !== ALL || f.commodity !== ALL || f.kind !== ALL || f.min > 0;
  const hot = filtered.filter((s) => s.tier === "Hot").length;
  const pipeline = filtered.reduce((sum, s) => sum + s.engagement.openPipeline, 0);

  const open = expanded ? filtered.find((s) => s.target.id === expanded) : undefined;
  const columns: Column<ScoredTarget>[] = [
    {
      key: "total",
      header: "Score",
      className: "w-20",
      sortValue: (s) => s.total,
      cell: (s) => (
        <div>
          <ScorePill score={s.total} />
          <TierLabel tier={s.tier} className="mt-1.5" />
        </div>
      ),
    },
    {
      key: "name",
      header: "Prospect",
      sortValue: (s) => s.target.name,
      cell: (s) => {
        const t = s.target;
        return (
          <div className="min-w-0 max-w-72">
            <div className="flex items-center gap-1.5">
              <Link href={recordHref(t.id)} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                {t.name}
              </Link>
              {t.kind === "lead" && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  Lead
                </Badge>
              )}
              <LocalChangeTag id={t.id} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.facilityType} · {t.city}, {t.state} · {sizeLabel(t)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.software} · {userName(t.ownerId)}
            </p>
          </div>
        );
      },
    },
    {
      key: "why",
      header: "Why Now",
      hideBelow: "md",
      className: "align-top",
      cell: (s) => <p className="line-clamp-3 text-foreground/85">{s.whyNow}</p>,
    },
    {
      key: "last",
      header: "Last Activity",
      hideBelow: "lg",
      className: "w-36",
      sortValue: (s) => s.engagement.lastTouch?.getTime(),
      cell: (s) =>
        s.engagement.lastTouch ? (
          <div className="text-xs">
            <span className="block text-foreground">{fmtRelative(s.engagement.lastTouch, asOf).replace(/^./, (c) => c.toUpperCase())}</span>
            <span className="block max-w-36 truncate text-muted-foreground" title={s.engagement.lastTouchSubject}>
              {(s.engagement.lastTouchSubject ?? "").split(":")[0]} · Salesforce
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">None</span>
        ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      className: "w-32",
      cell: (s) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setEmailFor(s);
            }}
          >
            Email
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(s.target.id);
            }}
            aria-label={`Show details for ${s.target.name}`}
          >
            <ChevronRight />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-md border bg-panel p-4 lg:sticky lg:top-20 lg:self-start" aria-label="Filters">
          <h2 className="text-sm font-semibold">Filters</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, town, software…" className="bg-card pl-8" aria-label="Search prospects" />
            </div>
            <Select value={f.region} onValueChange={(v) => f.set({ region: v, state: null })}>
              <SelectTrigger className="w-full bg-card" aria-label="Region">
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All regions</SelectItem>
                {REGIONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.state} onValueChange={(v) => f.set({ state: v })}>
              <SelectTrigger className="w-full bg-card" aria-label="State or province">
                <SelectValue placeholder="State / province" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All states & provinces</SelectItem>
                {statesInScope.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATE_NAMES[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.type} onValueChange={(v) => f.set({ type: v })}>
              <SelectTrigger className="w-full bg-card" aria-label="Facility type">
                <SelectValue placeholder="Facility type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All facility types</SelectItem>
                {FACILITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.commodity} onValueChange={(v) => f.set({ commodity: v })}>
              <SelectTrigger className="w-full bg-card" aria-label="Commodity">
                <SelectValue placeholder="Commodity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All commodities</SelectItem>
                {COMMODITIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={f.kind} onValueChange={(v) => f.set({ kind: v })}>
              <SelectTrigger className="w-full bg-card" aria-label="Record type">
                <SelectValue placeholder="Accounts & leads" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Accounts & leads</SelectItem>
                <SelectItem value="account">Accounts only</SelectItem>
                <SelectItem value="lead">Leads only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-3 border-t border-slate-300/70 pt-3">
            <div className="flex items-center gap-3">
              <span className="text-xs whitespace-nowrap text-muted-foreground">Min score</span>
              <Slider value={[f.min]} min={0} max={90} step={5} onValueChange={([v]) => f.set({ min: v ? String(v) : null })} className="flex-1" aria-label="Minimum score" />
              <span className="w-6 text-sm font-medium tabular">{f.min}</span>
            </div>
            <HarvestWeightSlider />
            <div className="flex flex-wrap gap-2">
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={() => {
                    setQuery("");
                    router_reset(f.set);
                  }}>
                  Clear filters
                </Button>
              )}
              <ExportCsvButton
                size="sm"
                className="bg-card"
                disabled={!filtered.length}
                exportId="prospects"
                title="Export prospects"
                columns={csvColumns}
                rows={ranked}
                filteredRows={filtered}
                filename={`harvestsignal-prospects-${asOf.toISOString().slice(0, 10)}.csv`}
              />
              <Button asChild size="sm">
                <Link
                  href={campaignBuilderHref({
                    regions: f.region !== ALL ? [f.region] : undefined,
                    commodity: f.commodity !== ALL ? f.commodity : undefined,
                    types: f.type !== ALL ? [f.type] : undefined,
                  })}
                >
                  Campaign from these filters
                </Link>
              </Button>
            </div>
          </div>
      </aside>
      <div className="min-w-0 space-y-4">

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground tabular">{filtered.length}</strong> prospects · <strong className="text-foreground tabular">{hot}</strong> hot
          {pipeline > 0 && (
            <>
              {" "}
              · <strong className="text-foreground">{fmtMoney(pipeline)}</strong> open pipeline
            </>
          )}
        </p>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(s) => s.target.id}
        filterKey={`${query}|${f.region}|${f.state}|${f.type}|${f.commodity}|${f.kind}|${f.min}|${f.sort}|${f.dir}`}
        defaultSort={f.sort === "total" || f.sort === "name" ? { key: f.sort, dir: f.dir as "asc" | "desc" } : undefined}
        onRowClick={(s) => setExpanded(s.target.id)}
        rowClassName={(s) => (s.target.id === expanded ? "bg-muted/30" : undefined)}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setCreating("lead")}>
              <Plus /> New lead
            </Button>
            <Button size="sm" onClick={() => setCreating("account")}>
              <Plus /> New account
            </Button>
          </>
        }
        empty="No prospects match these filters."
        caption="Prospects"
      />
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setExpanded(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
          {open && (
            <>
              <div className="border-b px-5 py-4 pr-12">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  {open.target.kind === "lead" ? "Lead" : "Account"} · score {open.total} · <TierLabel tier={open.tier} />
                </p>
                <SheetTitle className="mt-0.5 text-base font-semibold">{open.target.name}</SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  {open.target.facilityType} · {open.target.city}, {open.target.state} · {REGION_BY_ID[open.target.regionId].name}
                </SheetDescription>
              </div>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <p className="text-sm">{open.whyNow}</p>
                <MiniBreakdown s={open} />
                <ScoreBreakdown s={open} />
                <p className="text-xs text-muted-foreground">Commodities: {open.target.commodities.join(", ")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
                <OutreachButtons target={open} />
                <Button asChild variant="ghost" size="sm" className="ml-auto">
                  <Link href={recordHref(open.target.id)}>Open record</Link>
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <AccountDrawer open={creating === "account"} onOpenChange={(o) => !o && setCreating(null)} />
      <LeadDrawer open={creating === "lead"} onOpenChange={(o) => !o && setCreating(null)} />
      {emailFor && <OutreachDialog s={emailFor} open onOpenChange={(o) => !o && setEmailFor(null)} tab="email" />}
    </div>
  );
}

function router_reset(set: (p: Record<string, string | null>) => void) {
  set({ q: null, region: null, state: null, type: null, commodity: null, kind: null, min: null });
}
