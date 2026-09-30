"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { OctagonAlert, RefreshCw } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { userName } from "@/lib/data/selectors";
import { fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { renewalMutations, upcomingRenewals, type RenewalRow } from "@/lib/success/renewals";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { HealthBadge, StatTile, TrendMark, selectCls, useCustomerScope } from "./shared";
import { CustomerDrawer } from "./customer-drawer";

const WINDOWS = ["30", "60", "90", "120", "180"] as const;

export function RenewalsView() {
  const { ready, data, asOf } = useStore();
  const { run } = useCrud();
  const userId = useUserId();
  const scope = useCustomerScope();
  const [within, setWithin] = useState<(typeof WINDOWS)[number]>("180");
  const [riskOnly, setRiskOnly] = useState(false);
  const [owner, setOwner] = useState<"all" | "mine">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const all = useMemo(() => upcomingRenewals(data, asOf).filter((r) => scope.visible(r.contract.OwnerId)), [data, asOf, scope]);
  const pending = useMemo(() => renewalMutations({ ...data, contracts: data.contracts.filter((c) => scope.visible(c.OwnerId)) }, asOf), [data, asOf, scope]);
  const pendingCount = pending.filter((m) => m.op === "update").length;

  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (r.daysToEnd > Number(within)) return false;
        if (riskOnly && !r.atRisk) return false;
        if (owner === "mine" && r.contract.OwnerId !== userId) return false;
        return true;
      }),
    [all, within, riskOnly, owner, userId],
  );

  const columns = useMemo<Column<RenewalRow>[]>(
    () => [
      {
        key: "account",
        header: "Account",
        sortValue: (r) => r.account?.Name ?? "",
        cell: (r) => (
          <div className="max-w-[240px] min-w-[170px]">
            <p className="truncate font-medium">{r.account?.Name ?? r.contract.Name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {r.contract.ContractNumber} · {userName(r.contract.OwnerId)}
            </p>
          </div>
        ),
      },
      {
        key: "end",
        header: "Contract end",
        sortValue: (r) => r.contract.EndDate,
        cell: (r) => (
          <span className="tabular whitespace-nowrap">
            {fmtShortDate(r.contract.EndDate)}
            <span className="ml-1 text-xs text-muted-foreground">({r.daysToEnd < 0 ? `${-r.daysToEnd}d ago` : `${r.daysToEnd}d`})</span>
          </span>
        ),
      },
      { key: "arr", header: "ARR", align: "right", sortValue: (r) => r.arr, cell: (r) => <span className="tabular">{fmtMoney(r.arr, { compact: false })}</span> },
      {
        key: "opp",
        header: "Renewal opportunity",
        sortValue: (r) => r.opportunity?.StageName ?? "",
        cell: (r) =>
          r.opportunity ? (
            <Link href={`/opportunities/${r.opportunity.Id}`} className="whitespace-nowrap text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
              {r.opportunity.StageName}
              <span className="ml-1 text-xs text-muted-foreground tabular">{fmtMoney(r.opportunity.Amount)}</span>
            </Link>
          ) : (
            <span className="text-xs text-muted-foreground">None yet</span>
          ),
      },
      {
        key: "health",
        header: "Health",
        sortValue: (r) => r.health?.score ?? -1,
        cell: (r) =>
          r.health ? (
            <span className="inline-flex items-center gap-2">
              <HealthBadge band={r.health.band} score={r.health.score} />
              <TrendMark health={r.health} showDelta={false} />
            </span>
          ) : (
            "—"
          ),
      },
      {
        key: "notice",
        header: "Notice deadline",
        sortValue: (r) => r.noticeDeadline,
        hideBelow: "md",
        cell: (r) => (
          <span className={cn("tabular whitespace-nowrap", r.daysToNotice < 0 ? "text-muted-foreground" : r.daysToNotice <= 30 && "font-medium text-amber-800")}>
            {fmtShortDate(r.noticeDeadline)}
            <span className="ml-1 text-xs">{r.daysToNotice < 0 ? "(passed)" : `(${r.daysToNotice}d)`}</span>
          </span>
        ),
      },
      {
        key: "risk",
        header: "Risk",
        sortValue: (r) => Number(r.atRisk),
        cell: (r) =>
          r.atRisk ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap text-status-critical">
              <OctagonAlert className="size-3.5" aria-hidden />
              At risk
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">On track</span>
          ),
      },
    ],
    [],
  );

  if (!ready) return <Skeleton className="h-[480px]" />;

  const atRisk = all.filter((r) => r.atRisk);
  const in90 = all.filter((r) => r.daysToEnd >= 0 && r.daysToEnd <= 90);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Renewals in 180 days" value={String(all.length)} active={!riskOnly && within === "180"} onClick={() => (setRiskOnly(false), setWithin("180"))} />
        <StatTile label="ARR renewing in 90 days" value={fmtMoney(in90.reduce((s, r) => s + r.arr, 0))} active={within === "90" && !riskOnly} onClick={() => (setRiskOnly(false), setWithin("90"))} />
        <StatTile label="At risk" value={String(atRisk.length)} active={riskOnly} onClick={() => setRiskOnly(true)} />
        <StatTile label="ARR at risk" value={fmtMoney(atRisk.reduce((s, r) => s + r.arr, 0))} active={riskOnly} onClick={() => setRiskOnly(true)} />
      </dl>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.contract.Id}
        caption="Upcoming renewals"
        search={{ placeholder: "Search renewals", text: (r) => `${r.account?.Name ?? ""} ${r.contract.ContractNumber} ${r.contract.Name}` }}
        filterKey={`${within}|${riskOnly}|${owner}`}
        onRowClick={(r) => setOpenId(r.contract.AccountId)}
        minWidth={980}
        empty="No renewals in this window"
        filters={
          <>
            <select aria-label="Ending within" value={within} onChange={(e) => setWithin(e.target.value as typeof within)} className={selectCls}>
              {WINDOWS.map((d) => (
                <option key={d} value={d}>
                  Ending within {d} days
                </option>
              ))}
            </select>
            <select aria-label="Risk" value={riskOnly ? "1" : ""} onChange={(e) => setRiskOnly(e.target.value === "1")} className={selectCls}>
              <option value="">All renewals</option>
              <option value="1">At risk only</option>
            </select>
            <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)} className={selectCls}>
              <option value="all">All owners</option>
              <option value="mine">My renewals</option>
            </select>
          </>
        }
        actions={
          <Button size="sm" variant="outline" disabled={!pendingCount} onClick={() => run(pending, `${pendingCount} renewal ${pendingCount === 1 ? "opportunity" : "opportunities"} created`)}>
            <RefreshCw />
            {pendingCount ? `Create renewal opportunities (${pendingCount})` : "Renewal opportunities up to date"}
          </Button>
        }
      />
      <CustomerDrawer accountId={openId} onOpenChange={(o) => !o && setOpenId(null)} />
    </div>
  );
}
