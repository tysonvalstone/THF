"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { prioritize } from "@/lib/prioritization";
import { userName } from "@/lib/data/selectors";
import { USERS } from "@/data/reference/users";
import { fmtShortDate, toISODate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import type { ColumnDef } from "@/lib/columns";
import { ALL_STAGES, OPEN_STAGES, SEGMENTS, type Account, type Opportunity, type Segment } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { OpportunityDrawer } from "./forms";
import { StageSelect, useStageChange } from "./stage-control";

const ALL = "all";
type Status = "open" | "closed" | "won" | "lost" | "all";
const STATUS_LABEL: Record<Status, string> = { open: "Open", closed: "Closed", won: "Closed won", lost: "Closed lost", all: "Open & closed" };

interface Row {
  opp: Opportunity;
  account?: Account;
  segment?: Segment;
  expected: number | null;
}

const CSV: ColumnDef<Row>[] = [
  { key: "id", label: "Opportunity Id", value: (r) => r.opp.Id },
  { key: "name", label: "Opportunity", value: (r) => r.opp.Name },
  { key: "account", label: "Account", value: (r) => r.account?.Name },
  { key: "segment", label: "Segment", value: (r) => r.segment },
  { key: "stage", label: "Stage", value: (r) => r.opp.StageName },
  { key: "amount", label: "Amount", type: "currency", value: (r) => r.opp.Amount },
  { key: "probability", label: "Probability", type: "percent", value: (r) => r.opp.Probability / 100 },
  { key: "expected", label: "Expected value", type: "currency", value: (r) => r.expected ?? undefined },
  { key: "close", label: "Close date", type: "date", value: (r) => r.opp.CloseDate },
  { key: "forecast", label: "Forecast category", value: (r) => r.opp.ForecastCategoryName },
  { key: "owner", label: "Owner", value: (r) => userName(r.opp.OwnerId) },
  { key: "next", label: "Next step", value: (r) => r.opp.NextStep },
];

function useFilters() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const get = (k: string, d = ALL) => params.get(k) ?? d;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === ALL || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`, { scroll: false });
  };
  return {
    status: (get("status", "open") as Status) || "open",
    stage: get("stage"),
    owner: get("owner"),
    segment: get("segment"),
    view: get("view", "table") === "board" ? "board" : "table",
    sort: get("sort", ""),
    set,
  };
}

export function PipelineView() {
  const { ready, data, asOf } = useStore();
  const f = useFilters();
  const stage = useStageChange();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const prio = useMemo(() => (ready ? prioritize(data, asOf) : null), [ready, data, asOf]);

  const rows = useMemo<Row[]>(() => {
    if (!prio) return [];
    const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
    const value = new Map(prio.allOpen.map((v) => [v.opp.Id, v]));
    return data.opportunities.map((o) => {
      const account = accounts.get(o.AccountId);
      const parent = account?.ParentId ? accounts.get(account.ParentId) : undefined;
      const v = value.get(o.Id);
      return { opp: o, account, segment: v?.segment ?? parent?.Segment__c ?? account?.Segment__c, expected: o.IsClosed ? null : (v?.expectedAmount ?? (o.Amount * o.Probability) / 100) };
    });
  }, [prio, data.opportunities, data.accounts]);

  const filtered = useMemo(
    () =>
      rows.filter(({ opp: o, segment }) => {
        if (f.status === "open" && o.IsClosed) return false;
        if (f.status === "closed" && !o.IsClosed) return false;
        if (f.status === "won" && !o.IsWon) return false;
        if (f.status === "lost" && (!o.IsClosed || o.IsWon)) return false;
        if (f.stage !== ALL && o.StageName !== f.stage) return false;
        if (f.owner !== ALL && o.OwnerId !== f.owner) return false;
        if (f.segment !== ALL && segment !== f.segment) return false;
        return true;
      }),
    [rows, f.status, f.stage, f.owner, f.segment],
  );

  if (!ready || !prio) return <Skeleton className="h-[560px]" />;

  const total = filtered.reduce((s, r) => s + r.opp.Amount, 0);
  const weighted = filtered.reduce((s, r) => s + (r.expected ?? 0), 0);
  const asOfISO = toISODate(asOf);

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Opportunity",
      sortValue: (r) => r.opp.Name,
      cell: (r) => (
        <div className="min-w-0 max-w-80">
          <Link href={`/opportunities/${r.opp.Id}`} className="font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.account ? r.opp.Name.replace(`${r.account.Name} - `, "") : r.opp.Name}
          </Link>
          <LocalChangeTag id={r.opp.Id} />
          <p className="truncate text-xs text-muted-foreground">
            {r.account ? (
              <Link href={`/accounts/${r.account.Id}`} className="hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                {r.account.Name}
              </Link>
            ) : (
              "No account"
            )}
            {r.account ? ` · ${r.account.BillingState}` : ""}
          </p>
        </div>
      ),
    },
    { key: "segment", header: "Segment", hideBelow: "lg", sortValue: (r) => r.segment, cell: (r) => <span className="text-muted-foreground">{r.segment ?? "—"}</span> },
    { key: "stage", header: "Stage", sortValue: (r) => ALL_STAGES.indexOf(r.opp.StageName), cell: (r) => <StageSelect opp={r.opp} onChange={stage.move} /> },
    { key: "amount", header: "Amount", align: "right", sortValue: (r) => r.opp.Amount, cell: (r) => fmtMoney(r.opp.Amount) },
    {
      key: "expected",
      header: "Expected",
      align: "right",
      hideBelow: "sm",
      sortValue: (r) => r.expected,
      cell: (r) => (r.expected === null ? <span className="text-muted-foreground">—</span> : fmtMoney(r.expected)),
    },
    {
      key: "close",
      header: "Close",
      sortValue: (r) => r.opp.CloseDate,
      cell: (r) => <span className={cn("whitespace-nowrap tabular", !r.opp.IsClosed && r.opp.CloseDate < asOfISO && "font-medium text-[#a8431b]")}>{fmtShortDate(r.opp.CloseDate)}</span>,
    },
    { key: "owner", header: "Owner", hideBelow: "md", sortValue: (r) => userName(r.opp.OwnerId), cell: (r) => <span className="whitespace-nowrap text-muted-foreground">{userName(r.opp.OwnerId)}</span> },
  ];

  const select = (label: string, value: string, key: string, options: [string, string][]) => (
    <select
      value={value}
      onChange={(e) => f.set({ [key]: e.target.value })}
      aria-label={label}
      className="h-8 rounded-md border border-input bg-card px-2 text-sm"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  const filters = (
    <>
      {select("Status", f.status, "status", (Object.keys(STATUS_LABEL) as Status[]).map((s) => [s, STATUS_LABEL[s]]))}
      {f.view === "table" && select("Stage", f.stage, "stage", [[ALL, "All stages"], ...ALL_STAGES.map((s) => [s, s] as [string, string])])}
      {select("Owner", f.owner, "owner", [[ALL, "All owners"], ...USERS.map((u) => [u.Id, u.Name] as [string, string])])}
      {select("Segment", f.segment, "segment", [[ALL, "All segments"], ...SEGMENTS.map((s) => [s, s] as [string, string])])}
    </>
  );

  const viewToggle = (
    <div className="inline-flex rounded-md border bg-card p-0.5 text-sm" role="group" aria-label="View">
      {(["table", "board"] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={f.view === v}
          onClick={() => f.set({ view: v === "table" ? null : v })}
          className={cn("rounded-[5px] px-3 py-1", f.view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {v === "table" ? "Table" : "Board"}
        </button>
      ))}
    </div>
  );

  const actions = (
    <>
      <ExportCsvButton
        size="sm"
        exportId="pipeline"
        title="Export opportunities"
        columns={CSV}
        rows={rows}
        filteredRows={filtered}
        filename={`harvestsignal-pipeline-${asOfISO}.csv`}
        disabled={!filtered.length}
      />
      <Button size="sm" onClick={() => setCreating(true)}>
        <Plus /> New opportunity
      </Button>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        {viewToggle}
      </div>
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground tabular">{filtered.length.toLocaleString()}</strong> deals · <strong className="text-foreground">{fmtMoney(total)}</strong>
        {weighted > 0 && (
          <>
            {" "}
            · <strong className="text-foreground">{fmtMoney(weighted)}</strong> expected
          </>
        )}
      </p>

      {f.view === "table" ? (
        <DataTable
          rows={filtered}
          columns={columns}
          rowKey={(r) => r.opp.Id}
          search={{ placeholder: "Search deals or accounts", text: (r) => `${r.opp.Name} ${r.account?.Name ?? ""} ${r.account?.BillingCity ?? ""}` }}
          filters={filters}
          filterKey={`${f.status}|${f.stage}|${f.owner}|${f.segment}`}
          actions={actions}
          defaultSort={f.sort === "expected" ? { key: "expected", dir: "desc" } : f.sort === "amount" ? { key: "amount", dir: "desc" } : { key: "close", dir: "asc" }}
          onRowClick={(r) => router.push(`/opportunities/${r.opp.Id}`)}
          minWidth={760}
          empty="No opportunities match these filters"
          caption="Opportunities"
        />
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {filters}
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </div>
          <Board rows={filtered.filter((r) => !r.opp.IsClosed)} onMove={stage.move} />
        </div>
      )}

      {stage.dialog}
      <OpportunityDrawer open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function Board({ rows, onMove }: { rows: Row[]; onMove: ReturnType<typeof useStageChange>["move"] }) {
  const { recentIds } = useStore();
  return (
    <div className="grid gap-3 overflow-x-auto pb-2 [grid-template-columns:repeat(6,minmax(200px,1fr))]">
      {OPEN_STAGES.map((s) => {
        const list = rows.filter((r) => r.opp.StageName === s).sort((a, b) => b.opp.Amount - a.opp.Amount);
        const sum = list.reduce((t, r) => t + r.opp.Amount, 0);
        return (
          <section key={s} className="flex min-w-0 flex-col rounded-md border bg-panel" aria-label={s}>
            <header className="border-b px-3 py-2">
              <h2 className="truncate text-sm font-semibold">{s}</h2>
              <p className="text-xs text-muted-foreground tabular">
                {list.length} · {fmtMoney(sum)}
              </p>
            </header>
            <ol className="max-h-[620px] space-y-2 overflow-y-auto p-2">
              {list.map((r) => (
                <li key={r.opp.Id} className={cn("rounded-md border bg-card p-2.5 transition-colors duration-700", recentIds.has(r.opp.Id) && "bg-accent-soft")}>
                  <Link href={`/opportunities/${r.opp.Id}`} className="line-clamp-2 text-sm font-medium hover:text-primary hover:underline">
                    {r.account?.Name ?? r.opp.Name}
                  </Link>
                  <LocalChangeTag id={r.opp.Id} />
                  <p className="mt-0.5 flex justify-between gap-2 text-xs text-muted-foreground tabular">
                    <span>{fmtMoney(r.opp.Amount)}</span>
                    <span>{fmtShortDate(r.opp.CloseDate)}</span>
                  </p>
                  <StageSelect opp={r.opp} onChange={onMove} className="mt-2 w-full" />
                </li>
              ))}
              {!list.length && <li className="px-1 py-4 text-center text-xs text-muted-foreground">No deals</li>}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
