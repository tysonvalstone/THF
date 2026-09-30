"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { UserRoundX } from "lucide-react";
import { SEGMENTS, type Segment } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { diffDays, fmtShortDate, parseDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { customerRows, HEALTH_BANDS, type HealthBand } from "@/lib/success/health";
import { expansionCandidates } from "@/lib/success/expansion";
import { DataTable, type Column } from "@/components/shared/data-table";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthBadge, StatTile, TrendMark, selectCls, useCustomerScope } from "./shared";
import { CustomerDrawer } from "./customer-drawer";

type Row = ReturnType<typeof customerRows>[number] & { expansion: boolean };

const RENEWAL_WINDOWS = ["30", "60", "90", "180"] as const;

export function CustomersView() {
  const { ready, data, asOf } = useStore();
  const scope = useCustomerScope();
  const params = useSearchParams();
  const [band, setBand] = useState<"" | HealthBand>((params.get("band") as HealthBand) || "");
  const [segment, setSegment] = useState<"" | Segment>("");
  const [renewal, setRenewal] = useState<"" | (typeof RENEWAL_WINDOWS)[number]>("");
  const [expansionOnly, setExpansionOnly] = useState(params.get("expansion") === "1");
  const [openId, setOpenId] = useState<string | null>(params.get("account"));

  const all = useMemo<Row[]>(() => {
    const expansion = new Set(expansionCandidates(data, asOf).map((c) => c.account.Id));
    return customerRows(data, asOf)
      .filter((r) => scope.visible(r.account.OwnerId))
      .map((r) => ({ ...r, expansion: expansion.has(r.account.Id) }));
  }, [data, asOf, scope]);

  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (band && r.health.band !== band) return false;
        if (segment && r.account.Segment__c !== segment) return false;
        if (expansionOnly && !r.expansion) return false;
        if (renewal) {
          if (!r.renewalDate) return false;
          const d = diffDays(parseDate(r.renewalDate), asOf);
          if (d < 0 || d > Number(renewal)) return false;
        }
        return true;
      }),
    [all, band, segment, renewal, expansionOnly, asOf],
  );

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: "account",
        header: "Account",
        sortValue: (r) => r.account.Name,
        cell: (r) => (
          <div className="max-w-[260px] min-w-[180px]">
            <p className="truncate font-medium">
              {r.account.Name}
              <LocalChangeTag id={r.health.signal?.Id ?? ""} />
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {r.account.Segment__c}
              {r.expansion && <span className="ml-1.5 text-primary">· Expansion</span>}
            </p>
          </div>
        ),
      },
      { key: "arr", header: "ARR", align: "right", sortValue: (r) => r.arr, cell: (r) => <span className="tabular">{r.arr ? fmtMoney(r.arr, { compact: false }) : "—"}</span> },
      { key: "health", header: "Health", sortValue: (r) => r.health.score, cell: (r) => <HealthBadge band={r.health.band} score={r.health.score} /> },
      { key: "trend", header: "Trend", sortValue: (r) => r.health.delta, cell: (r) => <TrendMark health={r.health} /> },
      { key: "usage", header: "Usage", align: "right", hideBelow: "md", sortValue: (r) => r.health.usage, cell: (r) => <span className="tabular">{Math.round(r.health.usage)}</span> },
      { key: "csat", header: "CSAT", align: "right", hideBelow: "md", sortValue: (r) => r.health.csat, cell: (r) => <span className="tabular">{r.health.csat.toFixed(1)}</span> },
      {
        key: "tickets",
        header: "Tickets 90d",
        align: "right",
        hideBelow: "lg",
        sortValue: (r) => r.health.tickets90d,
        cell: (r) => (
          <span className="tabular">
            {r.health.tickets90d}
            {r.health.openTickets > 0 && <span className="ml-1 text-xs text-muted-foreground">({r.health.openTickets} open)</span>}
          </span>
        ),
      },
      {
        key: "overdue",
        header: "Overdue",
        align: "right",
        hideBelow: "lg",
        sortValue: (r) => r.health.overdueAmount,
        cell: (r) => (r.health.overdueAmount > 0 ? <span className="tabular text-status-critical">{fmtMoney(r.health.overdueAmount, { compact: false })}</span> : <span className="text-muted-foreground">—</span>),
      },
      {
        key: "stakeholder",
        header: "Contacts",
        hideBelow: "lg",
        sortValue: (r) => Number(r.health.stakeholderChange),
        cell: (r) =>
          r.health.stakeholderChange ? (
            <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-amber-800">
              <UserRoundX className="size-3.5" aria-hidden />
              Changed
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Stable</span>
          ),
      },
      {
        key: "renewal",
        header: "Renewal",
        sortValue: (r) => r.renewalDate ?? "9999",
        cell: (r) => {
          if (!r.renewalDate) return <span className="text-muted-foreground">—</span>;
          const d = diffDays(parseDate(r.renewalDate), asOf);
          return (
            <span className="tabular whitespace-nowrap">
              {fmtShortDate(r.renewalDate)}
              {d >= 0 && d <= 90 && <span className="ml-1 text-xs text-muted-foreground">({d}d)</span>}
            </span>
          );
        },
      },
    ],
    [asOf],
  );

  if (!ready) return <Skeleton className="h-[480px]" />;

  const count = (b: HealthBand) => all.filter((r) => r.health.band === b).length;
  const arrAtRisk = all.filter((r) => r.health.band === "At Risk").reduce((s, r) => s + r.arr, 0);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Customers" value={String(all.length)} active={!band && !expansionOnly} onClick={() => (setBand(""), setExpansionOnly(false))} />
        {HEALTH_BANDS.map((b) => (
          <StatTile key={b} label={b} value={String(count(b))} active={band === b} onClick={() => setBand(band === b ? "" : b)} />
        ))}
        <StatTile label="ARR at risk" value={fmtMoney(arrAtRisk)} active={band === "At Risk"} onClick={() => setBand("At Risk")} />
      </dl>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.account.Id}
        caption="Customer health"
        search={{ placeholder: "Search customers", text: (r) => `${r.account.Name} ${r.account.BillingCity} ${r.account.BillingState}` }}
        filterKey={`${band}|${segment}|${renewal}|${expansionOnly}`}
        defaultSort={{ key: "health", dir: "asc" }}
        onRowClick={(r) => setOpenId(r.account.Id)}
        minWidth={1000}
        empty="No customers match"
        filters={
          <>
            <select aria-label="Health" value={band} onChange={(e) => setBand(e.target.value as typeof band)} className={selectCls}>
              <option value="">All health</option>
              {HEALTH_BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
            <select aria-label="Segment" value={segment} onChange={(e) => setSegment(e.target.value as typeof segment)} className={selectCls}>
              <option value="">All segments</option>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select aria-label="Renewal" value={renewal} onChange={(e) => setRenewal(e.target.value as typeof renewal)} className={selectCls}>
              <option value="">Any renewal date</option>
              {RENEWAL_WINDOWS.map((d) => (
                <option key={d} value={d}>
                  Renewal within {d} days
                </option>
              ))}
            </select>
            <select aria-label="Expansion" value={expansionOnly ? "1" : ""} onChange={(e) => setExpansionOnly(e.target.value === "1")} className={selectCls}>
              <option value="">All customers</option>
              <option value="1">Expansion candidates</option>
            </select>
          </>
        }
        actions={
          <Link href="/customers/renewals" className="text-sm text-primary hover:underline">
            Renewals
          </Link>
        }
      />
      <CustomerDrawer accountId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}
