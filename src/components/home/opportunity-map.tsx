"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { setHandoff } from "@/lib/ai/handoff";
import { usePublishCommodity } from "@/lib/ai/page-context";
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
import { TripPlanner } from "@/components/map/trip-planner";
import type { TripPlan } from "@/lib/trips";
import { USER_BY_ID } from "@/data/reference/users";
import { REGION_BY_STATE } from "@/data/reference/regions";
import { addDays, fmtShortDate } from "@/lib/dates";
import type { Opportunity } from "@/types/salesforce";
import { ScheduleCallButton } from "@/components/call-desk/schedule-call";
import { DataTable, type Column } from "@/components/shared/data-table";

/** Rows per page in the sidebar lists */
const LIST_SIZE = 5;
const LIST_PARAM = "mp";

type Range = 30 | 60 | 90 | 365;
const RANGE_LABEL: Record<Range, string> = { 30: "Last 30 days", 60: "Last 60 days", 90: "Last 90 days", 365: "Last 12 months" };
const RANGE_SHORT: Record<Range, string> = { 30: "last 30 days", 60: "last 60 days", 90: "last 90 days", 365: "last 12 months" };
/** Stands out against both ends of the red/blue heat map */
const SALE_COLOR = "#facc15";

interface Win {
  opp: Opportunity;
  account: Account;
}

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

export function OpportunityMap({ prio, initialArea, initialTrip, initialSales = false }: { prio: Prioritization; initialArea?: Area; initialTrip?: string; initialSales?: boolean }) {
  const { data, asOf, ranked } = useStore();
  const { colors, setColor, reset } = useCommodityColors();
  const [area, setArea] = useState<Area>(initialArea ?? { level: "all" });
  const [sales, setSales] = useState(initialSales);
  const [range, setRange] = useState<Range>(90);
  const [salePop, setSalePop] = useState<{ id: string; x: number; y: number } | null>(null);
  const [tab, setTab] = useState<"prospects" | "area" | "trip">(initialTrip ? "trip" : "prospects");
  const [trip, setTrip] = useState<TripPlan | null>(null);
  const [mode, setMode] = useState<"season" | "commodity">("season");
  const [crop, setCrop] = useState<MapCommodity>("Corn");
  const [commodity, setCommodity] = useState<ColorCommodity | "all">("all");
  const [status, setStatus] = useState<Status>("prospects");
  const [size, setSize] = useState<Size>("all");
  const [segment, setSegment] = useState<Segment | "all">("all");
  const [sort, setSort] = useState<Sort>("score");
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  usePublishCommodity(mode === "season" ? crop : commodity === "all" ? undefined : commodity);

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

  const wins = useMemo<Win[]>(() => {
    const byId = new Map(data.accounts.map((a) => [a.Id, a]));
    const since = addDays(asOf, -range);
    return data.opportunities
      .filter((o) => o.IsWon && parseDate(o.CloseDate) > since && parseDate(o.CloseDate) <= asOf)
      .map((o) => ({ opp: o, account: byId.get(o.AccountId)! }))
      .filter((w) => w.account && inArea(area, w.account.BillingState))
      .sort((x, y) => y.opp.CloseDate.localeCompare(x.opp.CloseDate));
  }, [data.opportunities, data.accounts, asOf, range, area]);
  const winsTotal = wins.reduce((t, w) => t + w.opp.Amount, 0);

  const saleDots = useMemo<MapFacility[]>(() => {
    if (!sales) return [];
    const max = Math.max(1, ...wins.map((w) => w.opp.Amount));
    return wins.map((w) => ({
      id: `sale:${w.opp.Id}`,
      lat: w.account.BillingLatitude,
      lon: w.account.BillingLongitude,
      label: w.account.Name,
      sublabel: `Won ${fmtMoney(w.opp.Amount)} · ${fmtShortDate(w.opp.CloseDate)}`,
      covered: true,
      color: SALE_COLOR,
      radius: 4 + 8 * Math.sqrt(w.opp.Amount / max),
    }));
  }, [sales, wins]);

  const tripMode = tab === "trip" && !!trip?.stops.length;
  const stopPins = useMemo<MapFacility[]>(
    () =>
      tripMode && trip
        ? trip.stops.map((st, i) => ({
            id: st.account.Id,
            lat: st.account.BillingLatitude,
            lon: st.account.BillingLongitude,
            label: `${i + 1}. ${st.account.Name}`,
            sublabel: `Day ${st.day} · ${st.blackout.text}`,
            covered: false,
            number: i + 1,
            color: st.blackout.status === "hard" ? "#b45309" : undefined,
          }))
        : [],
    [tripMode, trip],
  );
  const routes = useMemo(() => {
    if (!tripMode || !trip) return undefined;
    return trip.days.map((d, i) => {
      const pts = d.stops.map((st) => ({ lat: st.account.BillingLatitude, lon: st.account.BillingLongitude }));
      return i === 0 && trip.start ? [{ lat: trip.start.lat, lon: trip.start.lon }, ...pts] : pts;
    });
  }, [tripMode, trip]);

  const onTripPlan = useCallback((p: TripPlan | null) => {
    setTrip(p);
    if (!p) return;
    const dest = p.request.destination;
    const isRegion = dest in REGION_BY_ID;
    const regionId = (isRegion ? dest : REGION_BY_STATE[dest.toUpperCase()]) as Area["regionId"];
    if (!regionId) return;
    const next: Area = isRegion ? { level: "region", regionId } : { level: "state", regionId, state: dest.toUpperCase() };
    setArea((cur) => (cur.level === next.level && cur.regionId === next.regionId && cur.state === next.state ? cur : next));
  }, []);

  const baseDots = useMemo<MapFacility[]>(
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
  const facilities = useMemo(() => [...(tripMode ? stopPins : baseDots), ...saleDots], [tripMode, stopPins, baseDots, saleDots]);
  const popWin = salePop ? wins.find((w) => `sale:${w.opp.Id}` === salePop.id) : undefined;

  const insights = useMemo(() => computeAreaInsights(data, area, asOf, crop, ranked, prio), [data, area, asOf, crop, ranked, prio]);
  const regionColor = useCallback(
    (code: string) => {
      const c = dominantCommodity(code);
      if (!c || (commodity !== "all" && c !== commodity)) return null;
      return `${colors[c]}55`;
    },
    [colors, commodity],
  );

  // Clicking a dot selects its row and turns the list to that row's page
  const selectFromMap = (id: string) => {
    setSelectedId(id);
    setTab("prospects");
    const i = rows.findIndex((r) => r.account.Id === id);
    if (i < 0) return;
    const next = new URLSearchParams(params.toString());
    const page = Math.floor(i / LIST_SIZE) + 1;
    if (page <= 1) next.delete(LIST_PARAM);
    else next.set(LIST_PARAM, String(page));
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  const productName = useMemo(() => new Map(data.products.map((p) => [p.Id, p.Name])), [data.products]);

  const prospectColumns: Column<Row>[] = [
    {
      key: "facility",
      header: "Facility",
      cell: (r) => {
        const open = selectedId === r.account.Id;
        return (
          <div data-id={r.account.Id} className="min-w-0">
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
                <span className="flex shrink-0 items-center gap-2">
                  <ScheduleCallButton iconOnly prefill={{ accountId: r.account.Id }} />
                  <Link href={recordHref(r.account.Id)} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                    Open
                  </Link>
                </span>
              </div>
            )}
          </div>
        );
      },
    },
  ];
  const winColumns: Column<Win>[] = [
    {
      key: "account",
      header: "Account",
      cell: (w) => (
        <Link href={recordHref(w.account.Id)} className="block max-w-44 truncate hover:text-primary hover:underline">
          {w.account.Name}
        </Link>
      ),
    },
    {
      key: "won",
      header: "Won",
      align: "right",
      cell: (w) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular">
          {fmtMoney(w.opp.Amount)} · {fmtShortDate(w.opp.CloseDate)}
        </span>
      ),
    },
  ];

  const crumbs: { label: string; area: Area }[] = [{ label: "North America", area: { level: "all" } }];
  if (area.regionId) crumbs.push({ label: REGION_BY_ID[area.regionId].name, area: { level: "region", regionId: area.regionId } });
  if (area.level === "state") crumbs.push({ label: areaName(area), area });
  const activeId = hoverId ?? selectedId;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Map</h1>
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
          <Button variant={sales ? "default" : "outline"} size="sm" aria-pressed={sales} onClick={() => setSales((v) => !v)}>
            <span className="size-2.5 rounded-full border border-slate-900" style={{ backgroundColor: SALE_COLOR }} aria-hidden />
            Recent sales
          </Button>
          {sales && (
            <select value={range} onChange={(e) => setRange(Number(e.target.value) as Range)} aria-label="Sales time range" className="h-8 rounded-md border border-input bg-card px-2 text-sm">
              {([30, 60, 90, 365] as Range[]).map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABEL[r]}
                </option>
              ))}
            </select>
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
          {sales && (
            <p className="mb-2 rounded-md bg-panel px-3 py-1.5 text-sm tabular">
              <span className="font-semibold">
                {wins.length} deal{wins.length === 1 ? "" : "s"} · {fmtMoney(winsTotal)}
              </span>{" "}
              <span className="text-muted-foreground">
                · {RANGE_SHORT[range]}
                {area.level !== "all" ? ` · ${areaName(area)}` : ""}
              </span>
            </p>
          )}
          <div className="relative">
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
              if (next) setArea(next);
            }}
            onFacilityClick={(id, pt) => {
              if (id.startsWith("sale:")) setSalePop({ id, ...pt });
              else if (!tripMode) selectFromMap(id);
            }}
            routes={routes}
          />
          {popWin && salePop && (
            <div
              className="absolute z-20 w-64 rounded-md border bg-card p-3 text-sm shadow-lg"
              style={{ left: Math.max(8, salePop.x - 128), top: salePop.y + 14 }}
              role="dialog"
              aria-label="Closed deal"
            >
              <div className="flex items-start justify-between gap-2">
                <Link href={recordHref(popWin.account.Id)} className="font-semibold hover:text-primary hover:underline">
                  {popWin.account.Name}
                </Link>
                <button type="button" aria-label="Close" className="text-muted-foreground hover:text-foreground" onClick={() => setSalePop(null)}>
                  ×
                </button>
              </div>
              <dl className="mt-2 grid grid-cols-[80px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium tabular">{fmtMoney(popWin.opp.Amount)}</dd>
                <dt className="text-muted-foreground">Products</dt>
                <dd>
                  {data.lineItems
                    .filter((li) => li.OpportunityId === popWin.opp.Id)
                    .map((li) => productName.get(li.Product2Id) ?? li.Product2Id)
                    .join(", ") || "—"}
                </dd>
                <dt className="text-muted-foreground">Closed</dt>
                <dd className="tabular">{fmtShortDate(popWin.opp.CloseDate)}</dd>
                <dt className="text-muted-foreground">Owner</dt>
                <dd>{USER_BY_ID[popWin.opp.OwnerId]?.Name ?? "—"}</dd>
              </dl>
              <Link href={`/opportunities/${popWin.opp.Id}`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
                Open record
              </Link>
            </div>
          )}
          </div>
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
          <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="gap-0">
            <TabsList className="m-3 mb-0 grid w-[calc(100%-1.5rem)] grid-cols-3">
              <TabsTrigger value="prospects">Prospects</TabsTrigger>
              <TabsTrigger value="area">Area</TabsTrigger>
              <TabsTrigger value="trip">Plan a Trip</TabsTrigger>
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
              <div className="flex items-center justify-between gap-2 px-3 pt-2">
                <p className="text-xs text-muted-foreground tabular">
                  {rows.length.toLocaleString()} on map{rows.length > 600 ? " (top 600 shown)" : ""}
                </p>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={!rows.length}
                  onClick={() => {
                    setHandoff("enroll", { accountIds: rows.slice(0, 25).map((r) => r.account.Id), from: `Map: ${areaName(area)}` });
                    router.push("/outreach/sequences?enroll=1");
                  }}
                >
                  Enroll top {Math.min(25, rows.length)} in sequence
                </Button>
              </div>
              <div
                className="p-3 pt-2"
                onMouseOver={(e) => {
                  const id = (e.target as HTMLElement).closest<HTMLElement>("[data-id]")?.dataset.id;
                  if (id && id !== hoverId) setHoverId(id);
                }}
                onMouseLeave={() => setHoverId(null)}
              >
                <DataTable
                  rows={rows}
                  columns={prospectColumns}
                  rowKey={(r) => r.account.Id}
                  param={LIST_PARAM}
                  pageSize={LIST_SIZE}
                  pageSizes={[]}
                  dense
                  filterKey={`${area.level}|${area.regionId ?? ""}|${area.state ?? ""}|${status}|${size}|${segment}|${commodity}|${sort}`}
                  onRowClick={(r) => setSelectedId(selectedId === r.account.Id ? null : r.account.Id)}
                  rowClassName={(r) => (activeId === r.account.Id ? "bg-accent-soft hover:bg-accent-soft" : undefined)}
                  empty="No matches"
                  caption="Facilities on the map"
                />
              </div>
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
                <h4 className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span>Recent Wins</span>
                  <span className="font-normal tabular">
                    {wins.length} · {fmtMoney(winsTotal)} · {RANGE_SHORT[range]}
                  </span>
                </h4>
                <DataTable
                  className="mt-2"
                  rows={wins}
                  columns={winColumns}
                  rowKey={(w) => w.opp.Id}
                  param="wp"
                  pageSize={LIST_SIZE}
                  pageSizes={[]}
                  dense
                  filterKey={`${area.level}|${area.regionId ?? ""}|${area.state ?? ""}|${range}`}
                  empty="No wins in this range"
                  caption="Recent wins"
                />
              </div>
              <div>
                <h4 className="text-xs font-medium text-muted-foreground">Key Insights</h4>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                  {insights.insights.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </div>
            </TabsContent>

            <TabsContent value="trip" className="mt-0 max-h-[760px] overflow-y-auto">
              <TripPlanner
                prio={prio}
                defaultDestination={area.state ?? area.regionId ?? "IL"}
                onPlan={onTripPlan}
                initialRequest={initialTrip}
                highlightId={activeId}
                onHover={setHoverId}
              />
            </TabsContent>
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
