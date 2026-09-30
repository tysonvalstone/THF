"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useAuth, useUserId } from "@/lib/auth";
import { commissionReport, repCommission, type CommissionLine, type CommissionStatus, type RepCommission } from "@/lib/commissions";
import { fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { opportunityHref } from "@/lib/links";
import type { ColumnDef } from "@/lib/columns";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RecordDrawer, type FieldDef, type FieldValue } from "@/components/shared/record-drawer";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const money = (n: number) => fmtMoney(n);
const compact = (n: number) => fmtMoney(n, { compact: true });
const pct = (x: number) => `${Math.round(x)}%`;
const rate = (x: number) => `${+x.toFixed(2)}%`;

const STATUS_CLS: Record<CommissionStatus, string> = {
  Paid: "border-primary/40 text-primary",
  Payable: "border-primary bg-primary text-primary-foreground",
  "Awaiting payment": "border-slate-300 text-slate-600",
  "Awaiting invoice": "border-dashed border-slate-300 text-slate-500",
};

function StatusChip({ status }: { status: CommissionStatus }) {
  return <span className={cn("inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium whitespace-nowrap", STATUS_CLS[status])}>{status}</span>;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-4 py-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular">{value}</p>
      <p className="mt-0.5 h-4 truncate text-xs text-muted-foreground tabular">{sub ?? ""}</p>
    </div>
  );
}

/** Bookings against the annual quota; the part past quota is drawn solid (accelerated) */
function AttainmentBar({ r }: { r: RepCommission }) {
  const quota = r.plan.AnnualQuota;
  const max = Math.max(quota * 1.25, r.bookings, 1);
  const below = Math.min(r.bookings, quota);
  const above = Math.max(0, r.bookings - quota);
  return (
    <div>
      <div
        className="relative h-3 rounded-[3px] bg-slate-100"
        role="img"
        aria-label={`Bookings ${fmtMoney(r.bookings)} of ${fmtMoney(quota)} quota, ${pct(r.attainmentPct)}`}
      >
        <span className="absolute inset-y-0 left-0 bg-primary/55" style={{ width: `${(below / max) * 100}%` }} />
        {above > 0 && <span className="absolute inset-y-0 bg-primary" style={{ left: `${(quota / max) * 100}%`, width: `${(above / max) * 100}%` }} />}
        {quota > 0 && <span className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `calc(${(quota / max) * 100}% - 1px)` }} />}
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted-foreground tabular">
        <span>
          <span className="font-medium text-foreground">{compact(r.bookings)}</span> booked · {pct(r.attainmentPct)}
        </span>
        <span>Quota {compact(quota)}</span>
      </div>
    </div>
  );
}

function breakdown(l: CommissionLine, r: RepCommission): string {
  const parts: string[] = [];
  if (l.belowQuota > 0) parts.push(`${compact(l.belowQuota)} × ${rate(r.plan.BaseRatePct)}`);
  if (l.aboveQuota > 0) parts.push(`${compact(l.aboveQuota)} × ${rate(r.plan.AcceleratorPct)} accel.`);
  if (l.bonus > 0) parts.push(`${compact(l.firstYearValue)} × ${rate(r.plan.MultiYearBonusPct)} multi-year`);
  return parts.join(" + ");
}

function Statement({ r }: { r: RepCommission }) {
  const { lightningBaseUrl } = useStore();
  const columns: Column<CommissionLine>[] = [
    {
      key: "deal",
      header: "Deal",
      sortValue: (l) => l.accountName,
      cell: (l) => (
        <div className="min-w-0">
          <Link href={opportunityHref(l.opp.Id, lightningBaseUrl)} className="block max-w-[240px] truncate font-medium hover:underline">
            {l.accountName || l.opp.Name}
          </Link>
          <span className="block max-w-[240px] truncate text-xs text-muted-foreground">{breakdown(l, r)}</span>
        </div>
      ),
    },
    { key: "close", header: "Closed", sortValue: (l) => l.closeDate, cell: (l) => <span className="tabular">{fmtShortDate(l.closeDate)}</span> },
    {
      key: "fyv",
      header: "First-year value",
      align: "right",
      sortValue: (l) => l.firstYearValue,
      cell: (l) => (
        <div>
          {money(l.firstYearValue)}
          <span className="block text-xs text-muted-foreground">{l.valueSource === "Contract" ? "Contract" : "Opportunity"}</span>
        </div>
      ),
    },
    {
      key: "term",
      header: "Term",
      align: "right",
      sortValue: (l) => l.termMonths,
      cell: (l) => (
        <span className="tabular" title={`From ${l.termSource.toLowerCase()}`}>
          {l.termMonths} mo
        </span>
      ),
      hideBelow: "md",
    },
    { key: "base", header: "Base", align: "right", sortValue: (l) => l.base, cell: (l) => money(l.base), hideBelow: "lg" },
    { key: "accel", header: "Accelerator", align: "right", sortValue: (l) => l.accelerator, cell: (l) => (l.accelerator ? money(l.accelerator) : "–"), hideBelow: "lg" },
    { key: "bonus", header: "Multi-year", align: "right", sortValue: (l) => l.bonus, cell: (l) => (l.bonus ? money(l.bonus) : "–"), hideBelow: "lg" },
    { key: "total", header: "Commission", align: "right", sortValue: (l) => l.total, cell: (l) => <span className="font-medium">{money(l.total)}</span> },
    {
      key: "status",
      header: "Status",
      sortValue: (l) => l.status,
      cell: (l) => (
        <div>
          <StatusChip status={l.status} />
          {l.payoutDate && <span className="block text-xs text-muted-foreground tabular">{l.status === "Paid" ? `Paid ${fmtShortDate(l.payoutDate)}` : `Payroll ${fmtShortDate(l.payoutDate)}`}</span>}
        </div>
      ),
    },
  ];
  return (
    <DataTable
      rows={r.lines}
      columns={columns}
      rowKey={(l) => l.opp.Id}
      search={{ placeholder: "Search deals", text: (l) => `${l.accountName} ${l.opp.Name}` }}
      defaultSort={{ key: "close", dir: "desc" }}
      param="statement"
      minWidth={820}
      caption={`${r.name} commission statement ${r.year}`}
      empty="No closed-won deals this year"
    />
  );
}

function RepSummary({ r }: { r: RepCommission }) {
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Commission summary">
        <Kpi label="Earned YTD" value={money(r.earned)} sub={`${r.lines.length} deals`} />
        <Kpi label="Payable" value={money(r.payable)} sub="Next payroll" />
        <Kpi label="Paid" value={money(r.paid)} />
        <Kpi label="Awaiting invoice payment" value={money(r.pending)} />
      </section>
      <section className="grid gap-4 rounded-md border bg-card p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" aria-label="Plan">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Base rate</dt>
          <dd className="text-right tabular">{rate(r.plan.BaseRatePct)}</dd>
          <dt className="text-muted-foreground">Above quota</dt>
          <dd className="text-right tabular">{rate(r.plan.AcceleratorPct)}</dd>
          <dt className="text-muted-foreground">Multi-year (24+ mo)</dt>
          <dd className="text-right tabular">+{rate(r.plan.MultiYearBonusPct)}</dd>
          <dt className="text-muted-foreground">Annual quota</dt>
          <dd className="text-right tabular">{money(r.plan.AnnualQuota)}</dd>
        </dl>
        <div className="self-center">
          <AttainmentBar r={r} />
          {!r.hasPlan && <p className="mt-2 text-xs text-muted-foreground">Default plan: no {r.year} plan on file</p>}
        </div>
      </section>
    </div>
  );
}

const PLAN_FIELDS: FieldDef[] = [
  { name: "BaseRatePct", label: "Base rate", type: "percent", required: true, min: 0, max: 50, step: 0.25 },
  { name: "AcceleratorPct", label: "Rate above quota", type: "percent", required: true, min: 0, max: 50, step: 0.25 },
  { name: "MultiYearBonusPct", label: "Multi-year bonus", type: "percent", required: true, min: 0, max: 20, step: 0.25, help: "Deals with a 24+ month term" },
  { name: "AnnualQuota", label: "Annual quota", type: "currency", required: true, min: 0 },
];

const CSV_COLUMNS: ColumnDef<RepCommission>[] = [
  { key: "rep", label: "Rep", value: (r) => r.name, required: true },
  { key: "year", label: "Year", type: "number", value: (r) => r.year },
  { key: "base", label: "Base rate %", type: "number", value: (r) => r.plan.BaseRatePct },
  { key: "accel", label: "Accelerator %", type: "number", value: (r) => r.plan.AcceleratorPct },
  { key: "multi", label: "Multi-year bonus %", type: "number", value: (r) => r.plan.MultiYearBonusPct },
  { key: "quota", label: "Annual quota", type: "currency", value: (r) => r.plan.AnnualQuota },
  { key: "bookings", label: "Bookings", type: "currency", value: (r) => r.bookings },
  { key: "attainment", label: "Attainment %", type: "number", value: (r) => Math.round(r.attainmentPct * 10) / 10 },
  { key: "earned", label: "Earned", type: "currency", value: (r) => r.earned },
  { key: "payable", label: "Payable", type: "currency", value: (r) => r.payable },
  { key: "paid", label: "Paid", type: "currency", value: (r) => r.paid },
  { key: "pending", label: "Awaiting invoice payment", type: "currency", value: (r) => r.pending },
  { key: "deals", label: "Deals", type: "number", value: (r) => r.lines.length },
];

export function CommissionsView() {
  const { data, asOf, ready } = useStore();
  const { role } = useAuth();
  const userId = useUserId();
  const { update, create } = useCrud();
  const seesAll = role === "manager" || role === "finance" || role === "admin";
  const canEditPlans = role === "finance" || role === "admin";

  const years = useMemo(() => [...new Set([...data.commissionPlans.map((p) => p.Year), asOf.getUTCFullYear()])].sort((a, b) => b - a), [data.commissionPlans, asOf]);
  const [year, setYear] = useState(asOf.getUTCFullYear());
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<RepCommission | null>(null);

  const report = useMemo(() => (seesAll ? commissionReport(data, year, asOf) : []), [seesAll, data, year, asOf]);
  const mine = useMemo(() => (seesAll ? null : repCommission(data, userId, year, asOf)), [seesAll, data, userId, year, asOf]);
  const current = seesAll ? (report.find((r) => r.ownerId === selected) ?? null) : mine;

  const totals = useMemo(
    () => report.reduce((t, r) => ({ earned: t.earned + r.earned, payable: t.payable + r.payable, paid: t.paid + r.paid, pending: t.pending + r.pending }), { earned: 0, payable: 0, paid: 0, pending: 0 }),
    [report],
  );

  if (!ready) return <Skeleton className="h-[640px]" />;

  const columns: Column<RepCommission>[] = [
    { key: "rep", header: "Rep", sortValue: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
    {
      key: "plan",
      header: "Plan",
      sortValue: (r) => r.plan.BaseRatePct,
      cell: (r) => (
        <span className={cn("text-xs tabular", !r.hasPlan && "text-muted-foreground italic")}>
          {rate(r.plan.BaseRatePct)} / {rate(r.plan.AcceleratorPct)} / +{rate(r.plan.MultiYearBonusPct)}
        </span>
      ),
      hideBelow: "md",
    },
    { key: "quota", header: "Quota", align: "right", sortValue: (r) => r.plan.AnnualQuota, cell: (r) => compact(r.plan.AnnualQuota), hideBelow: "lg" },
    { key: "bookings", header: "Bookings", align: "right", sortValue: (r) => r.bookings, cell: (r) => compact(r.bookings), hideBelow: "sm" },
    { key: "att", header: "Attainment", align: "right", sortValue: (r) => r.attainmentPct, cell: (r) => <span className={cn(r.attainmentPct >= 100 && "font-medium text-primary")}>{pct(r.attainmentPct)}</span> },
    { key: "earned", header: "Earned", align: "right", sortValue: (r) => r.earned, cell: (r) => money(r.earned) },
    { key: "payable", header: "Payable", align: "right", sortValue: (r) => r.payable, cell: (r) => <span className={cn(r.payable > 0 && "font-medium")}>{money(r.payable)}</span> },
    { key: "paid", header: "Paid", align: "right", sortValue: (r) => r.paid, cell: (r) => money(r.paid), hideBelow: "md" },
    ...(canEditPlans
      ? [
          {
            key: "edit",
            header: <span className="sr-only">Edit plan</span>,
            cell: (r: RepCommission) => (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(r);
                }}
              >
                Edit plan
              </Button>
            ),
          },
        ]
      : []),
  ];

  const savePlan = (values: Record<string, FieldValue>) => {
    if (!editing) return;
    const changes = {
      BaseRatePct: Number(values.BaseRatePct),
      AcceleratorPct: Number(values.AcceleratorPct),
      MultiYearBonusPct: Number(values.MultiYearBonusPct),
      AnnualQuota: Number(values.AnnualQuota),
    };
    if (editing.hasPlan) update("CommissionPlan", editing.plan.Id, changes, `${editing.name} ${year} plan`);
    else create("CommissionPlan", { OwnerId: editing.ownerId, Year: year, ...changes }, `${editing.name} ${year} plan`);
    setEditing(null);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">{seesAll ? "Commissions" : "My Commissions"}</h1>
          {!seesAll && mine && <span className="text-sm text-muted-foreground">{mine.name}</span>}
        </div>
        <select className="h-8 rounded-md border border-input bg-card px-2 text-sm" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Plan year">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </header>

      {seesAll ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Payout summary">
            <Kpi label="Earned" value={money(totals.earned)} sub={`${report.length} reps · ${year}`} />
            <Kpi label="Payable" value={money(totals.payable)} sub="Next payroll" />
            <Kpi label="Paid" value={money(totals.paid)} />
            <Kpi label="Awaiting invoice payment" value={money(totals.pending)} />
          </section>
          <section className="space-y-2" aria-labelledby="payout-title">
            <h2 id="payout-title" className="text-sm font-semibold">
              Payout report
            </h2>
            <DataTable
              rows={report}
              columns={columns}
              rowKey={(r) => r.plan.Id || `${r.ownerId}-${r.year}`}
              onRowClick={(r) => setSelected(selected === r.ownerId ? null : r.ownerId)}
              rowClassName={(r) => (r.ownerId === selected ? "bg-accent-soft" : undefined)}
              actions={
                <ExportCsvButton
                  size="sm"
                  exportId="commission-payouts"
                  title="Export payout report"
                  columns={CSV_COLUMNS}
                  rows={report}
                  filename={`commissions-${year}-${asOf.toISOString().slice(0, 10)}.csv`}
                />
              }
              defaultSort={{ key: "earned", dir: "desc" }}
              pageSizes={[]}
              param="reps"
              minWidth={720}
              caption={`Commission payout report ${year}`}
              empty="No plans or closed-won deals this year"
            />
          </section>
          {current && (
            <section className="space-y-3" aria-labelledby="statement-title">
              <div className="flex items-center justify-between gap-2">
                <h2 id="statement-title" className="text-sm font-semibold">
                  {current.name} · {year} statement
                </h2>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelected(null)}>
                  Close
                </Button>
              </div>
              <RepSummary r={current} />
              <Statement r={current} />
            </section>
          )}
        </>
      ) : (
        current && (
          <>
            <RepSummary r={current} />
            <section className="space-y-2" aria-labelledby="statement-title">
              <h2 id="statement-title" className="text-sm font-semibold">
                Statement
              </h2>
              <Statement r={current} />
            </section>
          </>
        )
      )}

      <RecordDrawer
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `${editing.name} · ${year} plan` : "Plan"}
        fields={PLAN_FIELDS}
        initial={
          editing
            ? { BaseRatePct: editing.plan.BaseRatePct, AcceleratorPct: editing.plan.AcceleratorPct, MultiYearBonusPct: editing.plan.MultiYearBonusPct, AnnualQuota: editing.plan.AnnualQuota }
            : {}
        }
        submitLabel="Save plan"
        onSubmit={savePlan}
      />
    </div>
  );
}
