"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useAuth, useUserId } from "@/lib/auth";
import { userName } from "@/lib/data/selectors";
import { USERS } from "@/data/reference/users";
import { fmtDate, fmtShortDate } from "@/lib/dates";
import { CONTRACT_STATUSES, type Contract, type ContractStatus } from "@/types/salesforce";
import type { ColumnDef } from "@/lib/columns";
import { fmtCurrency } from "@/lib/quotes/pricing";
import { LIVE_CONTRACT, contractAlerts, contractInfo, type ContractAlert, type ContractInfo } from "@/lib/contracts";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContractFlags, ContractStatusPill, selectCls } from "./shared";
import { NewContractDrawer } from "./new-contract-drawer";

export interface ContractRow {
  contract: Contract;
  account: string;
  owner: string;
  info: ContractInfo;
  alerts: ContractAlert[];
}

const IN_FLIGHT: ContractStatus[] = ["Draft", "Legal Review", "Sent for Signature"];

export function useContractRows(): { rows: ContractRow[]; alerts: ContractAlert[] } {
  const { data, asOf } = useStore();
  return useMemo(() => {
    const alerts = contractAlerts(data, asOf);
    const byContract = new Map<string, ContractAlert[]>();
    for (const a of alerts) byContract.set(a.contractId, [...(byContract.get(a.contractId) ?? []), a]);
    const names = new Map(data.accounts.map((a) => [a.Id, a.Name]));
    const rows = data.contracts.map((c) => ({
      contract: c,
      account: names.get(c.AccountId) ?? "",
      owner: userName(c.OwnerId),
      info: contractInfo(c, asOf),
      alerts: byContract.get(c.Id) ?? [],
    }));
    return { rows, alerts };
  }, [data, asOf]);
}

function NoticeCell({ row }: { row: ContractRow }) {
  const live = LIVE_CONTRACT.includes(row.contract.Status);
  if (!live) return <span className="text-muted-foreground">—</span>;
  const d = row.info.daysToNotice;
  const soon = d >= 0 && d <= 60;
  return (
    <span className={cn("tabular whitespace-nowrap", soon && "font-medium text-amber-800", d < 0 && "text-muted-foreground")} title={d >= 0 ? `${d} days left` : "Passed"}>
      {fmtDate(row.info.noticeDeadline)}
      {soon && <span className="ml-1 text-xs">({d}d)</span>}
    </span>
  );
}

const money = (r: ContractRow, n: number) => fmtCurrency(n, r.contract.CurrencyIsoCode, { cents: false });

const COLUMNS: Column<ContractRow>[] = [
  {
    key: "number",
    header: "Contract",
    sortValue: (r) => r.contract.ContractNumber,
    cell: (r) => (
      <Link href={`/contracts/${r.contract.Id}`} className="font-medium whitespace-nowrap text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
        {r.contract.ContractNumber}
      </Link>
    ),
  },
  {
    key: "account",
    header: "Account",
    sortValue: (r) => r.account,
    cell: (r) => (
      <div className="max-w-[260px] min-w-[160px]">
        <p className="truncate">
          {r.account}
          <LocalChangeTag id={r.contract.Id} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{r.owner}</p>
      </div>
    ),
  },
  { key: "status", header: "Status", sortValue: (r) => CONTRACT_STATUSES.indexOf(r.contract.Status), cell: (r) => <ContractStatusPill status={r.contract.Status} /> },
  { key: "arr", header: "ARR", align: "right", sortValue: (r) => r.contract.ARR, cell: (r) => money(r, r.contract.ARR) },
  { key: "tcv", header: "TCV", align: "right", sortValue: (r) => r.contract.TCV, hideBelow: "lg", cell: (r) => money(r, r.contract.TCV) },
  { key: "start", header: "Start", sortValue: (r) => r.contract.StartDate, hideBelow: "md", cell: (r) => <span className="tabular whitespace-nowrap">{fmtDate(r.contract.StartDate)}</span> },
  { key: "end", header: "End", sortValue: (r) => r.contract.EndDate, cell: (r) => <span className="tabular whitespace-nowrap">{fmtDate(r.contract.EndDate)}</span> },
  { key: "auto", header: "Auto-renew", sortValue: (r) => (r.contract.AutoRenew ? 1 : 0), hideBelow: "lg", cell: (r) => (r.contract.AutoRenew ? "Yes" : "No") },
  { key: "notice", header: "Notice by", sortValue: (r) => (LIVE_CONTRACT.includes(r.contract.Status) ? r.info.noticeDeadline : null), cell: (r) => <NoticeCell row={r} /> },
  { key: "flags", header: "Flags", cell: (r) => <ContractFlags info={r.info} autoRenew={r.contract.AutoRenew} /> },
];

const CSV: ColumnDef<ContractRow>[] = [
  { key: "number", label: "Contract Number", value: (r) => r.contract.ContractNumber, required: true },
  { key: "name", label: "Name", value: (r) => r.contract.Name },
  { key: "account", label: "Account", value: (r) => r.account },
  { key: "status", label: "Status", value: (r) => r.contract.Status },
  { key: "currency", label: "Currency", value: (r) => r.contract.CurrencyIsoCode },
  { key: "arr", label: "ARR", type: "currency", value: (r) => r.contract.ARR },
  { key: "oneTime", label: "One-time", type: "currency", value: (r) => r.contract.OneTimeFees },
  { key: "tcv", label: "TCV", type: "currency", value: (r) => r.contract.TCV },
  { key: "start", label: "Start", type: "date", value: (r) => r.contract.StartDate },
  { key: "end", label: "End", type: "date", value: (r) => r.contract.EndDate },
  { key: "term", label: "Term (months)", type: "number", value: (r) => r.contract.TermMonths },
  { key: "auto", label: "Auto-renew", value: (r) => (r.contract.AutoRenew ? "Yes" : "No") },
  { key: "noticeDays", label: "Notice days", type: "number", value: (r) => r.contract.NoticeDays },
  { key: "notice", label: "Notice deadline", type: "date", value: (r) => r.info.noticeDeadline },
  { key: "increase", label: "Price increase %", type: "number", value: (r) => r.contract.PriceIncreasePct },
  { key: "payment", label: "Payment terms", value: (r) => r.contract.PaymentTerms },
  { key: "harvest", label: "Harvest terms", value: (r) => (r.contract.HarvestTerms ? "Yes" : "No") },
  { key: "dpa", label: "DPA", value: (r) => (r.contract.DPA ? "Yes" : "No") },
  { key: "nonStandard", label: "Non-standard", value: (r) => (r.contract.NonStandard ? "Yes" : "No") },
  { key: "alerts", label: "Alerts", value: (r) => r.alerts.map((a) => a.message).join("; ") },
  { key: "owner", label: "Owner", value: (r) => r.owner },
  { key: "signed", label: "Signed", type: "date", value: (r) => r.contract.SignedDate?.slice(0, 10) ?? "", defaultOn: false },
  { key: "id", label: "Contract Id", value: (r) => r.contract.Id, defaultOn: false },
];

/** Compact alert list with links */
export function ContractAlertList({ alerts, limit = 5 }: { alerts: ContractAlert[]; limit?: number }) {
  const [all, setAll] = useState(false);
  if (!alerts.length) return null;
  const shown = all ? alerts : alerts.slice(0, limit);
  return (
    <section className="rounded-md border bg-card" aria-label="Contract alerts">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h2 className="text-sm font-semibold">Alerts</h2>
        <span className="text-xs text-muted-foreground tabular">{alerts.length}</span>
      </div>
      <ul className="divide-y text-sm">
        {shown.map((a) => (
          <li key={`${a.kind}-${a.contractId}`} className="flex items-center gap-3 px-4 py-2">
            <span className={cn("size-2 shrink-0 rounded-full", a.severity === "critical" ? "bg-status-critical" : "bg-amber-500")} aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{a.message}</span>
              <span className="text-muted-foreground"> · </span>
              <Link href={`/contracts/${a.contractId}`} className="text-primary hover:underline">
                {a.contractNumber}
              </Link>
              <span className="text-muted-foreground"> · {a.accountName}</span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular">{fmtShortDate(a.date)}</span>
          </li>
        ))}
      </ul>
      {alerts.length > limit && (
        <button type="button" onClick={() => setAll((x) => !x)} className="w-full border-t px-4 py-1.5 text-left text-xs text-primary hover:underline">
          {all ? "Show fewer" : `Show all ${alerts.length}`}
        </button>
      )}
    </section>
  );
}

type StatusFilter = "" | "flight" | "force" | ContractStatus;

export function ContractsList() {
  const { ready } = useStore();
  const { role } = useAuth();
  const userId = useUserId();
  const router = useRouter();
  const { rows: all, alerts: allAlerts } = useContractRows();
  const rep = role === "rep";
  const [status, setStatus] = useState<StatusFilter>("");
  const [owner, setOwner] = useState<string>("all");
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [expiring, setExpiring] = useState<"" | "30" | "60" | "90" | "180">("");
  const [creating, setCreating] = useState(false);

  const visible = useMemo(() => (rep ? all.filter((r) => r.contract.OwnerId === userId) : all), [all, rep, userId]);
  const alerts = useMemo(() => (rep ? allAlerts.filter((a) => a.ownerId === userId) : allAlerts), [allAlerts, rep, userId]);
  const rows = useMemo(
    () =>
      visible.filter((r) => {
        const s = r.contract.Status;
        if (status === "flight" ? !IN_FLIGHT.includes(s) : status === "force" ? !LIVE_CONTRACT.includes(s) : status && s !== status) return false;
        if (!rep && owner !== "all" && r.contract.OwnerId !== (owner === "mine" ? userId : owner)) return false;
        if (alertsOnly && !r.alerts.length) return false;
        if (expiring && !(LIVE_CONTRACT.includes(s) && r.info.daysToEnd >= 0 && r.info.daysToEnd <= Number(expiring))) return false;
        return true;
      }),
    [visible, status, owner, alertsOnly, expiring, rep, userId],
  );

  if (!ready) return <Skeleton className="h-[480px]" />;
  const force = visible.filter((r) => LIVE_CONTRACT.includes(r.contract.Status));
  const usd = (list: ContractRow[]) => list.filter((r) => r.contract.CurrencyIsoCode === "USD").reduce((s, r) => s + r.contract.ARR, 0);
  const flight = visible.filter((r) => IN_FLIGHT.includes(r.contract.Status));
  const exp90 = force.filter((r) => r.info.expiring);
  const reset = () => (setStatus(""), setAlertsOnly(false), setExpiring(""));

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["ARR in force (USD)", fmtCurrency(usd(force), "USD", { cents: false }), () => (reset(), setStatus("force"))],
            ["In progress", String(flight.length), () => (reset(), setStatus("flight"))],
            ["Alerts", String(alerts.length), () => (reset(), setAlertsOnly(true))],
            ["Ending in 90 days", String(exp90.length), () => (reset(), setExpiring("90"))],
          ] as const
        ).map(([label, value, onClick]) => (
          <button key={label} type="button" onClick={onClick} className="rounded-md border bg-card px-4 py-3 text-left hover:border-primary/40">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">{value}</dd>
          </button>
        ))}
      </dl>

      <ContractAlertList alerts={alerts} />

      <DataTable
        rows={rows}
        columns={COLUMNS}
        rowKey={(r) => r.contract.Id}
        caption="Contracts"
        search={{ placeholder: "Search contracts", text: (r) => `${r.contract.ContractNumber} ${r.contract.Name} ${r.account} ${r.owner}` }}
        filterKey={`${status}|${owner}|${alertsOnly}|${expiring}`}
        defaultSort={{ key: "number", dir: "desc" }}
        onRowClick={(r) => router.push(`/contracts/${r.contract.Id}`)}
        minWidth={980}
        empty="No contracts match"
        filters={
          <>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectCls}>
              <option value="">All statuses</option>
              <option value="flight">In progress</option>
              <option value="force">Signed or active</option>
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {!rep && (
              <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={selectCls}>
                <option value="all">All owners</option>
                <option value="mine">My contracts</option>
                {USERS.map((u) => (
                  <option key={u.Id} value={u.Id}>
                    {u.Name}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Ending within" value={expiring} onChange={(e) => setExpiring(e.target.value as typeof expiring)} className={selectCls}>
              <option value="">Any end date</option>
              <option value="30">Ending in 30 days</option>
              <option value="60">Ending in 60 days</option>
              <option value="90">Ending in 90 days</option>
              <option value="180">Ending in 180 days</option>
            </select>
            <label className="flex h-8 items-center gap-1.5 rounded-md border border-input bg-card px-2 text-sm">
              <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} className="size-3.5 accent-[#1f5f4a]" />
              Alerts only
            </label>
          </>
        }
        actions={
          <>
            <ExportCsvButton exportId="contracts" columns={CSV} rows={visible} filteredRows={rows} filename="contracts.csv" size="sm" title="Export contracts" />
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              New contract
            </Button>
          </>
        }
      />
      <NewContractDrawer open={creating} onOpenChange={setCreating} />
    </div>
  );
}
