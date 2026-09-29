"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import type { Prioritization } from "@/lib/prioritization";
import { areaCodes, areaName, blackoutLabel, computeAreaInsights, estimateDeal, inArea, nextArea, type Area } from "@/lib/regionInsights";
import { MAP_COMMODITIES, type MapCommodity } from "@/lib/cropCalendar";
import { COLOR_COMMODITIES, dominantCommodity, toColorCommodity, useCommodityColors, type ColorCommodity } from "@/lib/commodityColors";
import { REGION_BY_ID } from "@/data/reference/regions";
import { recordHref } from "@/lib/links";
import { parseDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { SEGMENTS, type Account, type Segment } from "@/types/salesforce";
import { SeasonalityMap, type MapFacility } from "@/components/map/seasonality-map";
import { RDBU_STOPS, NOT_GROWN_COLOR } from "@/components/map/rdbu";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { SourceNote } from "@/components/shared/source-note";

type Status = "prospects" | "customers" | "all";
type Size = "all" | "large" | "mid" | "small";
type Sort = "score" | "deal" | "name";

const SIZE_LABEL: Record<Size, string> = { all: "All sizes", large: "Large (> $100M)", mid: "Mid ($25–100M)", small: "Small (< $25M)" };
const sizeOf = (rev: number): Size => (rev > 100e6 ? "large" : rev >= 25e6 ? "mid" : "small");

interface Row {
  account: Account;
  score: number | null;
  deal: number;
  commodity: ColorCommodity;
  blackout: { text: string; blocked: boolean };
}

function Select<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="h-8 w-full min-w-0 rounded-md border border-input bg-card px-2 text-sm text-foreground">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

export function OpportunityMap({ prio }: { prio: Prioritization }) {
  const { data, asOf, ranked } = useStore();
  const { colors, setColor, reset } = useCommodityColors();
  const [area, setArea] = useState<Area>({ level: "all" });
  const [mode, setMode] = useState<"season" | "commodity">("season");
  const [crop, setCrop] = useState<MapCommodity>("Corn");
  const [commodity, setCommodity] = useState<ColorCommodity | "all">("all");
  const [status, setStatus] = useState<Status>("prospects");
  const [size, setSize] = useState<Size>("all");
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [sort, setSort] = useState<Sort>("score");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);
  const listRef = useRef<HTMLOListElement>(null);

  const scoreById = useMemo(() => new Map(ranked.map((s) => [s.target.id, s.total])), [ranked]);
  const openByAccount = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of data.opportunities) {
      if (parseDate(o.CreatedDate) <= asOf && !(o.IsClosed && parseDate(o.CloseDate) <= asOf)) m.set(o.AccountId, Math.max(m.get(o.AccountId) ?? 0, o.Amount));
    }
    return m;
  }, [data.opportunities, asOf]);

  const rows = useMemo<Row[]>(() => {
    const list = data.accounts
      .filter((a) => !a.ParentId && inArea(area, a.BillingState))
      .filter((a) => (status === "all" ? true : status === "customers" ? a.Type === "Customer - Direct" : a.Type !== "Customer - Direct"))
      .filter((a) => size === "all" || sizeOf(a.AnnualRevenue) === size)
      .filter((a) => segment === "all" || a.Segment__c === segment)
      .filter((a) => commodity === "all" || a.Primary_Commodities__c.some((c) => toColorCommodity(c) === commodity))
      .map((a) => ({
        account: a,
        score: scoreById.get(a.Id) ?? null,
        deal: estimateDeal(a, openByAccount, prio),
        commodity: toColorCommodity(a.Primary_Commodities__c[0] ?? "Corn"),
        blackout: blackoutLabel(a, asOf),
      }));
    return list.sort((x, y) =>
      sort === "name" ? x.account.Name.localeCompare(y.account.Name) : sort === "deal" ? y.deal - x.deal : (y.score ?? -1) - (x.score ?? -1) || y.deal - x.deal,
    );
  }, [data.accounts, area, status, size, segment, commodity, sort, scoreById, openByAccount, prio, asOf]);

  const facilities = useMemo<MapFacility[]>(
    () =>
      rows.slice(0, 600).map((r) => ({
        id: r.account.Id,
        lat: r.account.BillingLatitude,
        lon: r.account.BillingLongitude,
        label: `${r.account.Name}${r.score !== null ? ` · score ${r.score}` : ""}`,
        covered: r.account.Type === "Customer - Direct",
        color: mode === "commodity" ? colors[r.commodity] : undefined,
      })),
    [rows, mode, colors],
  );

  const insights = useMemo(() => computeAreaInsights(data, area, asOf, crop, ranked, prio), [data, area, asOf, crop, ranked, prio]);
  const regionColor = useCallback(
    (code: string) => {
      const c = dominantCommodity(code);
      if (!c || (commodity !== "all" && c !== commodity)) return null;
      return `${colors[c]}55`;
    },
    [colors, commodity],
  );

  // Clicking a dot selects its row and scrolls it into view
  useEffect(() => {
    if (!selectedId) return;
    listRef.current?.querySelector(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const crumbs: { label: string; area: Area }[] = [{ label: "North America", area: { level: "all" } }];
  if (area.regionId) crumbs.push({ label: REGION_BY_ID[area.regionId].name, area: { level: "region", regionId: area.regionId } });
  if (area.level === "state") crumbs.push({ label: areaName(area), area });
  const activeId = hoverId ?? selectedId;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Opportunity Map</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border bg-card p-0.5 text-sm" role="tablist" aria-label="Map view">
            {(["season", "commodity"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn("rounded-[5px] px-3 py-1", mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {m === "season" ? "Season" : "Commodities"}
              </button>
            ))}
          </div>
          {mode === "season" ? (
            <select value={crop} onChange={(e) => setCrop(e.target.value as MapCommodity)} aria-label="Crop" className="h-8 rounded-md border border-input bg-card px-2 text-sm">
              {MAP_COMMODITIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm">
                  Colors
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <p className="text-sm font-semibold">Commodity colors</p>
                <ul className="mt-2 space-y-1.5">
                  {COLOR_COMMODITIES.map((c) => (
                    <li key={c} className="flex items-center justify-between gap-2 text-sm">
                      <span>{c}</span>
                      <input type="color" value={colors[c]} onChange={(e) => setColor(c, e.target.value)} aria-label={`${c} color`} className="h-7 w-10 cursor-pointer rounded border bg-card" />
                    </li>
                  ))}
                </ul>
                <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={reset}>
                  Reset colors
                </Button>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Map */}
        <div className="min-w-0 rounded-md border bg-card p-3">
          <div className="mb-2 flex h-8 items-center justify-between gap-2">
            <nav aria-label="Map location" className="flex min-w-0 items-center gap-1.5 text-sm">
              {crumbs.map((c, i) => (
                <span key={c.label} className="flex items-center gap-1.5 truncate">
                  {i > 0 && <span className="text-slate-400">›</span>}
                  {i < crumbs.length - 1 ? (
                    <button type="button" className="text-primary hover:underline" onClick={() => setArea(c.area)}>
                      {c.label}
                    </button>
                  ) : (
                    <span className="font-medium">{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
            {area.level !== "all" && (
              <Button variant="ghost" size="sm" onClick={() => setArea(crumbs[crumbs.length - 2].area)}>
                Back
              </Button>
            )}
          </div>
          <SeasonalityMap
            date={asOf}
            commodity={crop}
            onCommodityChange={setCrop}
            hideControls
            hideLegend
            fillMode={mode}
            regionColor={regionColor}
            focusCodes={areaCodes(area)}
            facilities={facilities}
            highlightId={activeId}
            onFacilityHover={setHoverId}
            onAreaClick={(code) => {
              const next = nextArea(area, code);
              if (next) {
                setArea(next);
                setLimit(40);
              }
            }}
            onFacilityClick={(id) => setSelectedId(id)}
          />
          {/* Legend */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {mode === "season" ? (
              <>
                <span className="flex items-center gap-2">
                  Planting
                  <span className="flex h-2 w-40 overflow-hidden rounded-sm">
                    {RDBU_STOPS.map((c) => (
                      <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                    ))}
                  </span>
                  Harvest
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm border" style={{ backgroundColor: NOT_GROWN_COLOR }} /> Not grown
                </span>
              </>
            ) : (
              COLOR_COMMODITIES.map((c) => (
                <span key={c} className="flex items-center gap-1.5">
                  <span className="size-3 rounded-sm" style={{ backgroundColor: colors[c] }} /> {c}
                </span>
              ))
            )}
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border-2 border-slate-900 bg-white" /> Customer
            </span>
            {mode === "season" && <SourceNote className="ml-auto text-xs text-muted-foreground" />}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="min-w-0 rounded-md border bg-card">
          <Tabs defaultValue="prospects" className="gap-0">
            <TabsList className="m-3 mb-0 grid w-[calc(100%-1.5rem)] grid-cols-2">
              <TabsTrigger value="prospects">Prospects</TabsTrigger>
              <TabsTrigger value="area">Area</TabsTrigger>
            </TabsList>

            <TabsContent value="prospects" className="mt-0">
              <div className="grid grid-cols-2 gap-2 border-b bg-panel p-3">
                <Select<Status> label="Status" value={status} onChange={setStatus} options={[["prospects", "Prospects"], ["customers", "Customers"], ["all", "All"]]} />
                <Select<ColorCommodity | "all"> label="Commodity" value={commodity} onChange={setCommodity} options={[["all", "All"], ...COLOR_COMMODITIES.map((c) => [c, c] as [ColorCommodity, string])]} />
                <Select<Size> label="Size" value={size} onChange={setSize} options={(Object.keys(SIZE_LABEL) as Size[]).map((s) => [s, SIZE_LABEL[s]])} />
                <Select<Segment | "all"> label="Segment" value={segment} onChange={setSegment} options={[["all", "All"], ...SEGMENTS.map((s) => [s, s] as [Segment, string])]} />
                <div className="col-span-2">
                  <Select<Sort> label="Sort by" value={sort} onChange={setSort} options={[["score", "Score"], ["deal", "Est. deal size"], ["name", "Name"]]} />
                </div>
              </div>
              <p className="px-3 pt-2 text-xs text-muted-foreground tabular">
                {rows.length.toLocaleString()} on map{rows.length > 600 ? " (top 600 shown)" : ""}
              </p>
              <ol ref={listRef} className="max-h-[460px] divide-y overflow-y-auto" onMouseLeave={() => setHoverId(null)}>
                {rows.slice(0, limit).map((r) => {
                  const active = activeId === r.account.Id;
                  const open = selectedId === r.account.Id;
                  return (
                    <li
                      key={r.account.Id}
                      data-id={r.account.Id}
                      onMouseEnter={() => setHoverId(r.account.Id)}
                      onClick={() => setSelectedId(open ? null : r.account.Id)}
                      className={cn("cursor-pointer px-3 py-2", active && "bg-accent-soft")}
                    >
                      <div className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[r.commodity] }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.account.Name}</span>
                        {r.score !== null ? <span className="shrink-0 text-sm font-semibold tabular">{r.score}</span> : <span className="shrink-0 text-xs text-primary">Customer</span>}
                      </div>
                      <p className="mt-0.5 flex justify-between gap-2 pl-4.5 text-xs text-muted-foreground">
                        <span className="truncate">
                          {r.account.Segment__c} · {r.account.BillingCity}, {r.account.BillingState}
                        </span>
                        <span className="shrink-0 tabular">{fmtMoney(r.deal)}</span>
                      </p>
                      {open && (
                        <div className="mt-2 flex items-center justify-between gap-2 pl-4.5 text-xs">
                          <span className={cn(r.blackout.blocked ? "text-amber-800" : "text-muted-foreground")}>
                            {r.account.Number_of_Locations__c} loc. · {r.blackout.text}
                          </span>
                          <Link href={recordHref(r.account.Id)} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                            Open
                          </Link>
                        </div>
                      )}
                    </li>
                  );
                })}
                {!rows.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</li>}
              </ol>
              {rows.length > limit && (
                <div className="border-t p-2 text-center">
                  <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 40)}>
                    Show more
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="area" className="mt-0 space-y-5 p-4">
              <div>
                <h3 className="text-base font-semibold">{insights.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{insights.summary}</p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Facilities</dt>
                  <dd className="font-semibold tabular">{insights.facilities.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Customers</dt>
                  <dd className="font-semibold tabular">{insights.customers.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Penetration</dt>
                  <dd className="font-semibold tabular">
                    {insights.penetration.covered} of {insights.penetration.total}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Open Pipeline</dt>
                  <dd className="font-semibold tabular">{fmtMoney(insights.openPipeline)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">{crop} season</dt>
                  <dd className="font-semibold">{insights.phase}</dd>
                </div>
              </dl>
              <div>
                <h4 className="text-xs font-medium text-muted-foreground">Key Insights</h4>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                  {insights.insights.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
