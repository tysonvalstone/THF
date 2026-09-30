"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Radar } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { STATE_NAMES } from "@/data/reference/geo";
import { newBuildToLeadMutations } from "@/lib/new-builds/convert";
import { capacityText, NEW_BUILD_STAGES } from "@/lib/new-builds/scan";
import { fmtDate, fmtMonthYear, fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import type { ColumnDef } from "@/lib/columns";
import { SEGMENTS, type NewBuild, type NewBuildStatus, type RegionId } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { SeasonalityMap, type MapFacility } from "@/components/map/seasonality-map";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { ScanDialog } from "./scan-dialog";

const ALL = "all";
const STAGE_COLOR: Record<NewBuild["Stage"], string> = {
  Announced: "#1f5f4a",
  Permitting: "#2a78d6",
  "Under Construction": "#eda100",
  Commissioning: "#a8431b",
};

export const NEW_BUILD_CSV: ColumnDef<NewBuild>[] = [
  { key: "id", label: "Id", value: (b) => b.Id },
  { key: "name", label: "Project", value: (b) => b.Name },
  { key: "company", label: "Company", value: (b) => b.Company },
  { key: "facility_type", label: "Facility Type", value: (b) => b.Facility_Type__c },
  { key: "segment", label: "Segment", value: (b) => b.Segment__c },
  { key: "city", label: "City", value: (b) => b.City },
  { key: "state", label: "State/Province", value: (b) => b.State },
  { key: "region", label: "Region", value: (b) => REGION_BY_ID[b.Region__c]?.name },
  { key: "stage", label: "Stage", value: (b) => b.Stage },
  { key: "status", label: "Status", value: (b) => b.Status },
  { key: "capacity", label: "Capacity", type: "number", value: (b) => b.Capacity },
  { key: "capacity_unit", label: "Capacity Unit", value: (b) => b.Capacity_Unit },
  { key: "investment", label: "Estimated Investment", type: "currency", value: (b) => b.Estimated_Investment },
  { key: "announced", label: "Announced", type: "date", value: (b) => b.Announced_Date },
  { key: "completion", label: "Expected Completion", type: "date", value: (b) => b.Expected_Completion },
  { key: "source", label: "Source", value: (b) => b.Source },
  { key: "source_detail", label: "Source Detail", value: (b) => b.Source_Detail },
  { key: "summary", label: "Summary", value: (b) => b.Summary },
  { key: "lead", label: "Lead Id", value: (b) => b.Lead_Id__c },
  { key: "latitude", label: "Latitude", type: "number", value: (b) => b.Latitude },
  { key: "longitude", label: "Longitude", type: "number", value: (b) => b.Longitude },
];

function StatusTag({ status }: { status: NewBuildStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-sm border px-1.5 py-px text-xs whitespace-nowrap",
        status === "New" && "border-primary/40 text-primary",
        status === "Converted" && "border-transparent bg-accent-soft text-primary",
        status === "Dismissed" && "text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function useFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string, d = ALL) => params.get(k) ?? d;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      // Status defaults to New, so "all" is kept in the URL
      const isDefault = k === "status" ? v === "New" : v === ALL;
      if (v === null || v === "" || isDefault) next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  return { stage: get("stage"), segment: get("segment"), region: get("region"), state: get("state"), status: get("status", "New"), set };
}

export function NewBuildsView() {
  const { ready, data, asOf, asOfISO } = useStore();
  const { run } = useCrud();
  const userId = useUserId();
  const f = useFilters();
  const [openId, setOpenId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const filtered = useMemo(
    () =>
      data.newBuilds.filter(
        (b) =>
          (f.status === ALL || b.Status === f.status) &&
          (f.stage === ALL || b.Stage === f.stage) &&
          (f.segment === ALL || b.Segment__c === f.segment) &&
          (f.region === ALL || b.Region__c === f.region) &&
          (f.state === ALL || b.State === f.state),
      ),
    [data.newBuilds, f.status, f.stage, f.segment, f.region, f.state],
  );
  const states = useMemo(() => {
    const src = f.region !== ALL ? (REGION_BY_ID[f.region as RegionId]?.states ?? []) : [...new Set(data.newBuilds.map((b) => b.State))];
    return [...src].sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b));
  }, [f.region, data.newBuilds]);

  const dots = useMemo<MapFacility[]>(
    () =>
      filtered.map((b) => ({
        id: b.Id,
        lat: b.Latitude,
        lon: b.Longitude,
        label: b.Name,
        sublabel: `${b.Stage} · ${capacityText(b)}`,
        covered: b.Status === "Converted",
        color: STAGE_COLOR[b.Stage],
        radius: 5,
      })),
    [filtered],
  );

  if (!ready) return <Skeleton className="h-[560px]" />;

  const current = openId ? data.newBuilds.find((b) => b.Id === openId) : undefined;
  const lead = current?.Lead_Id__c ? data.leads.find((l) => l.Id === current.Lead_Id__c) : undefined;
  const accountId = current?.Account_Id__c || lead?.ConvertedAccountId;
  const investment = filtered.reduce((s, b) => s + b.Estimated_Investment, 0);

  const convert = (b: NewBuild) => {
    const { mutations } = newBuildToLeadMutations(b, { data, asOf, userId });
    run(mutations, `Lead created for ${b.Company}`, { undoable: true });
  };
  const setStatus = (b: NewBuild, status: NewBuildStatus, message: string) => run([{ op: "update", object: "NewBuild", id: b.Id, changes: { Status: status } }], message, { undoable: true });

  const columns: Column<NewBuild>[] = [
    {
      key: "name",
      header: "Project",
      sortValue: (b) => b.Name,
      cell: (b) => (
        <div className="min-w-0 max-w-80">
          <p className="truncate font-medium">
            {b.Name}
            <LocalChangeTag id={b.Id} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {b.City}, {b.State} · {b.Segment__c}
          </p>
        </div>
      ),
    },
    {
      key: "stage",
      header: "Stage",
      sortValue: (b) => NEW_BUILD_STAGES.indexOf(b.Stage),
      cell: (b) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="size-2 rounded-full" style={{ backgroundColor: STAGE_COLOR[b.Stage] }} aria-hidden />
          {b.Stage}
        </span>
      ),
    },
    { key: "capacity", header: "Capacity", align: "right", hideBelow: "md", sortValue: (b) => b.Capacity, cell: (b) => <span className="whitespace-nowrap">{capacityText(b)}</span> },
    { key: "investment", header: "Investment", align: "right", sortValue: (b) => b.Estimated_Investment, cell: (b) => fmtMoney(b.Estimated_Investment) },
    { key: "completion", header: "Completion", hideBelow: "sm", sortValue: (b) => b.Expected_Completion, cell: (b) => <span className="whitespace-nowrap tabular">{fmtMonthYear(b.Expected_Completion)}</span> },
    { key: "announced", header: "Found", hideBelow: "lg", sortValue: (b) => b.Announced_Date, cell: (b) => <span className="whitespace-nowrap text-muted-foreground tabular">{fmtShortDate(b.Announced_Date)}</span> },
    { key: "status", header: "Status", sortValue: (b) => b.Status, cell: (b) => <StatusTag status={b.Status} /> },
  ];

  const sel = (label: string, value: string, key: string, options: [string, string][], patch: Record<string, string | null> = {}) => (
    <select value={value} onChange={(e) => f.set({ [key]: e.target.value, ...patch })} aria-label={label} className="h-8 rounded-md border border-input bg-card px-2 text-sm">
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">New Builds</h1>
        <div className="flex flex-wrap items-center gap-2">
          <ExportCsvButton
            size="sm"
            exportId="new-builds"
            title="Export new builds"
            columns={NEW_BUILD_CSV}
            rows={data.newBuilds}
            filteredRows={filtered}
            filename={`harvestsignal-new-builds-${asOfISO}.csv`}
            disabled={!filtered.length}
          />
          <Button size="sm" onClick={() => setScanning(true)}>
            <Radar /> Scan sources
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-2">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground tabular">{filtered.length}</strong> projects · <strong className="text-foreground">{fmtMoney(investment)}</strong> announced investment
          </p>
          <DataTable
            rows={filtered}
            columns={columns}
            rowKey={(b) => b.Id}
            search={{ placeholder: "Search project, company, town", text: (b) => `${b.Name} ${b.Company} ${b.City} ${b.State} ${b.Source}` }}
            filters={
              <>
                {sel("Status", f.status, "status", [["New", "New"], ["Converted", "Converted"], ["Dismissed", "Dismissed"], [ALL, "All statuses"]])}
                {sel("Stage", f.stage, "stage", [[ALL, "All stages"], ...NEW_BUILD_STAGES.map((s) => [s, s] as [string, string])])}
                {sel("Segment", f.segment, "segment", [[ALL, "All segments"], ...SEGMENTS.map((s) => [s, s] as [string, string])])}
                {sel("Region", f.region, "region", [[ALL, "All regions"], ...REGIONS.map((r) => [r.id, r.name] as [string, string])], { state: null })}
                {sel("State or province", f.state, "state", [[ALL, "All states"], ...states.map((s) => [s, STATE_NAMES[s] ?? s] as [string, string])])}
              </>
            }
            filterKey={`${f.status}|${f.stage}|${f.segment}|${f.region}|${f.state}`}
            defaultSort={{ key: "announced", dir: "desc" }}
            onRowClick={(b) => setOpenId(b.Id)}
            rowClassName={(b) => (b.Id === openId ? "bg-slate-50" : undefined)}
            minWidth={720}
            empty="No new builds match these filters"
            caption="New builds"
          />
        </div>
        <aside className="h-fit min-w-0 rounded-md border bg-card p-3 xl:sticky xl:top-20">
          <SeasonalityMap
            date={asOf}
            hideControls
            hideLegend
            facilities={dots}
            highlightId={openId}
            focusCodes={f.state !== ALL ? [f.state] : f.region !== ALL ? REGION_BY_ID[f.region as RegionId]?.states : undefined}
            onFacilityClick={(id) => setOpenId(id)}
            height={320}
          />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {NEW_BUILD_STAGES.map((s) => (
              <span key={s} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: STAGE_COLOR[s] }} aria-hidden /> {s}
              </span>
            ))}
          </div>
        </aside>
      </div>

      <Sheet open={!!current} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
          {current && (
            <>
              <div className="border-b px-5 py-4 pr-12">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  New build · {current.Facility_Type__c} <StatusTag status={current.Status} />
                </p>
                <SheetTitle className="mt-0.5 text-base font-semibold">{current.Name}</SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  {current.City}, {current.State} · {REGION_BY_ID[current.Region__c]?.name}
                </SheetDescription>
              </div>
              <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
                <p className="text-sm">{current.Summary}</p>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {(
                    [
                      ["Stage", current.Stage],
                      ["Segment", current.Segment__c],
                      ["Capacity", capacityText(current)],
                      ["Estimated investment", fmtMoney(current.Estimated_Investment, { compact: false })],
                      ["Announced", fmtDate(current.Announced_Date)],
                      ["Expected completion", fmtDate(current.Expected_Completion)],
                      ["Company", current.Company],
                      ["Source", current.Source],
                    ] as [string, string][]
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{k}</dt>
                      <dd className="mt-0.5">{v}</dd>
                    </div>
                  ))}
                  <div className="col-span-2">
                    <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Source detail</dt>
                    <dd className="mt-0.5">{current.Source_Detail}</dd>
                  </div>
                </dl>
                {lead && (
                  <p className="rounded-md border bg-accent-soft px-3 py-2 text-sm">
                    Lead{" "}
                    <Link href={`/leads/${lead.Id}`} className="font-medium text-primary hover:underline">
                      {lead.Company}
                    </Link>
                    {accountId ? (
                      <>
                        {" · converted to "}
                        <Link href={`/accounts/${accountId}`} className="font-medium text-primary hover:underline">
                          account
                        </Link>
                      </>
                    ) : null}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
                {current.Status === "New" && (
                  <Button variant="ghost" onClick={() => setStatus(current, "Dismissed", "New build dismissed")}>
                    Dismiss
                  </Button>
                )}
                {current.Status === "Dismissed" && (
                  <Button variant="ghost" onClick={() => setStatus(current, "New", "New build restored")}>
                    Restore
                  </Button>
                )}
                <div className="ml-auto flex gap-2">
                  {current.Status === "New" && <Button onClick={() => convert(current)}>Convert to lead</Button>}
                  {lead && !lead.IsConverted && (
                    <Button asChild>
                      <Link href={`/leads/${lead.Id}`}>Open lead</Link>
                    </Button>
                  )}
                  {lead?.IsConverted && accountId && (
                    <Button asChild>
                      <Link href={`/accounts/${accountId}`}>Open account</Link>
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ScanDialog open={scanning} onOpenChange={setScanning} onView={(id) => {
        f.set({ status: null, stage: null, segment: null, region: null, state: null });
        setOpenId(id);
      }} />
    </div>
  );
}
