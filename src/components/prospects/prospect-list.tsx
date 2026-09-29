"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, Download, FilterX, Megaphone, Search } from "lucide-react";
import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { STATE_NAMES } from "@/data/reference/geo";
import { useStore } from "@/lib/data/store";
import { FACTOR_KEYS, FACTOR_META, sizeLabel, type FactorKey, type ScoredTarget } from "@/lib/scoring";
import { userName } from "@/lib/data/selectors";
import { recordHref, campaignBuilderHref } from "@/lib/links";
import { toCSV, downloadText } from "@/lib/csv";
import { fmtMoney } from "@/lib/format";
import { COMMODITIES, FACILITY_TYPES, type Commodity, type RegionId } from "@/types/salesforce";
import { ScorePill, TierLabel } from "@/components/shared/badges";
import { BreakdownLegend, MiniBreakdown, ScoreBreakdown } from "./score-breakdown";
import { OutreachButtons } from "@/components/outreach/outreach-buttons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SortKey = "total" | "name" | FactorKey;
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
  const { ready, ranked, asOf } = useStore();
  const f = useFilterState();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(50);
  const [query, setQuery] = useState(f.q);
  const { set: setParams, q: urlQ } = f;
  useEffect(() => {
    if (query === urlQ) return;
    const id = setTimeout(() => setParams({ q: query || null }), 300);
    return () => clearTimeout(id);
  }, [query, urlQ, setParams]);

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

  const sortBy = (k: SortKey) => f.set({ sort: k, dir: f.sort === k && f.dir === "desc" ? "asc" : "desc" });

  const exportCsv = () => {
    const csv = toCSV(filtered, [
      { header: "Rank", value: (s) => ranked.indexOf(s) + 1 },
      { header: "Score", value: (s) => s.total },
      { header: "Tier", value: (s) => s.tier },
      { header: "Record Type", value: (s) => (s.target.kind === "lead" ? "Lead" : "Account") },
      { header: "Id", value: (s) => s.target.id },
      { header: "Name", value: (s) => s.target.name },
      { header: "Facility Type", value: (s) => s.target.facilityType },
      { header: "City", value: (s) => s.target.city },
      { header: "State/Province", value: (s) => s.target.state },
      { header: "Region", value: (s) => REGION_BY_ID[s.target.regionId].name },
      { header: "Commodities", value: (s) => s.target.commodities.join("; ") },
      { header: "Size", value: (s) => sizeLabel(s.target) },
      { header: "Current Software", value: (s) => s.target.software },
      ...FACTOR_KEYS.map((k) => ({ header: FACTOR_META[k].label, value: (s: ScoredTarget) => Math.round(s.factors[k].points) })),
      { header: "Why Now", value: (s) => s.whyNow },
      { header: "Owner", value: (s) => userName(s.target.ownerId) },
    ]);
    downloadText(`harvestsignal-prospects-${asOf.toISOString().slice(0, 10)}.csv`, csv);
  };

  return (
    <div className="space-y-4">
      <Card className="py-4">
        <CardContent className="space-y-3 px-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(5,minmax(0,1fr))]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, town, software…" className="pl-8" aria-label="Search prospects" />
            </div>
            <Select value={f.region} onValueChange={(v) => f.set({ region: v, state: null })}>
              <SelectTrigger className="w-full" aria-label="Region">
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
              <SelectTrigger className="w-full" aria-label="State or province">
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
              <SelectTrigger className="w-full" aria-label="Facility type">
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
              <SelectTrigger className="w-full" aria-label="Commodity">
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
              <SelectTrigger className="w-full" aria-label="Record type">
                <SelectValue placeholder="Accounts & leads" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Accounts & leads</SelectItem>
                <SelectItem value="account">Accounts only</SelectItem>
                <SelectItem value="lead">Leads only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xs whitespace-nowrap text-muted-foreground">Min score</span>
              <Slider value={[f.min]} min={0} max={90} step={5} onValueChange={([v]) => f.set({ min: v ? String(v) : null })} className="w-40" aria-label="Minimum score" />
              <span className="w-6 text-sm font-medium tabular">{f.min}</span>
              {hasFilters && (
                <Button variant="ghost" size="sm" onClick={() => {
                    setQuery("");
                    router_reset(f.set);
                  }}>
                  <FilterX className="size-4" /> Clear
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                <Download className="size-4" /> Export CSV
              </Button>
              <Button asChild size="sm">
                <Link
                  href={campaignBuilderHref({
                    regions: f.region !== ALL ? [f.region] : undefined,
                    commodity: f.commodity !== ALL ? f.commodity : undefined,
                    types: f.type !== ALL ? [f.type] : undefined,
                  })}
                >
                  <Megaphone className="size-4" /> Campaign from these filters
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

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
        <BreakdownLegend />
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-20 px-3 py-2.5 font-medium">
                <button type="button" onClick={() => sortBy("total")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Score <SortIcon k="total" sort={f.sort} dir={f.dir} />
                </button>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <button type="button" onClick={() => sortBy("name")} className="inline-flex items-center gap-1 hover:text-foreground">
                  Prospect <SortIcon k="name" sort={f.sort} dir={f.dir} />
                </button>
              </th>
              <th className="px-3 py-2.5 font-medium">Why now</th>
              <th className="w-40 px-3 py-2.5 font-medium">
                <select
                  className="bg-transparent font-medium outline-none hover:text-foreground"
                  value={FACTOR_KEYS.includes(f.sort as FactorKey) ? f.sort : ""}
                  onChange={(e) => e.target.value && f.set({ sort: e.target.value, dir: "desc" })}
                  aria-label="Sort by factor"
                >
                  <option value="">Breakdown</option>
                  {FACTOR_KEYS.map((k) => (
                    <option key={k} value={k}>
                      Sort: {FACTOR_META[k].label}
                    </option>
                  ))}
                </select>
              </th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((s) => {
              const t = s.target;
              const open = expanded === t.id;
              return (
                <Fragment key={t.id}>
                  <tr className={cn("border-b align-top last:border-0 hover:bg-muted/30", open && "bg-muted/30")}>
                    <td className="px-3 py-3">
                      <ScorePill score={s.total} />
                      <TierLabel tier={s.tier} className="mt-1.5" />
                    </td>
                    <td className="max-w-64 px-3 py-3">
                      <div className="flex items-center gap-1.5">
                        <Link href={recordHref(t.id)} className="font-medium hover:underline">
                          {t.name}
                        </Link>
                        {t.kind === "lead" && (
                          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                            Lead
                          </Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.facilityType} · {t.city}, {t.state} · {sizeLabel(t)}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {t.software} · {userName(t.ownerId)}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-foreground/85">
                      <p className="line-clamp-3">{s.whyNow}</p>
                    </td>
                    <td className="px-3 py-3">
                      <MiniBreakdown s={s} className="mt-1.5" />
                    </td>
                    <td className="px-2 py-2.5">
                      <Button variant="ghost" size="icon-sm" onClick={() => setExpanded(open ? null : t.id)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} details for ${t.name}`}>
                        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
                      </Button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b bg-muted/30">
                      <td colSpan={5} className="px-4 pt-1 pb-5">
                        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                          <ScoreBreakdown s={s} />
                          <div className="space-y-3">
                            <p className="text-sm font-medium">Act now</p>
                            <OutreachButtons target={s} />
                            <p className="text-xs text-muted-foreground">
                              Commodities: {t.commodities.join(", ")} · Region: {REGION_BY_ID[t.regionId].name}
                            </p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {filtered.slice(0, limit).map((s) => (
          <Card key={s.target.id} className="py-4">
            <CardContent className="space-y-3 px-4">
              <div className="flex gap-3">
                <ScorePill score={s.total} />
                <div className="min-w-0">
                  <Link href={recordHref(s.target.id)} className="font-medium hover:underline">
                    {s.target.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {s.target.facilityType} · {s.target.city}, {s.target.state}
                  </p>
                </div>
                <TierLabel tier={s.tier} className="ml-auto self-start" />
              </div>
              <p className="text-sm">{s.whyNow}</p>
              <MiniBreakdown s={s} />
              <OutreachButtons target={s} size="xs" />
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No prospects match these filters.</div>
      )}
      {filtered.length > limit && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => setLimit((l) => l + 50)}>
            Show more ({filtered.length - limit} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}

function SortIcon({ k, sort, dir }: { k: SortKey; sort: SortKey; dir: string }) {
  if (sort !== k) return null;
  return dir === "desc" ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />;
}

function router_reset(set: (p: Record<string, string | null>) => void) {
  set({ q: null, region: null, state: null, type: null, commodity: null, kind: null, min: null });
}
