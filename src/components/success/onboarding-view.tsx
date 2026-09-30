"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { OnboardingProject } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useUserId } from "@/lib/auth";
import { userName } from "@/lib/data/selectors";
import { fmtShortDate, parseDate, diffDays } from "@/lib/dates";
import { onboardingForContractMutations, ONBOARDING_STATUSES, projectProgress, type ProjectProgress } from "@/lib/success/onboarding";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RecordDrawer } from "@/components/shared/record-drawer";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProgressBar, ProjectStatusPill, StatTile, selectCls, useCustomerScope } from "./shared";

interface Row {
  project: OnboardingProject;
  account: string;
  contract: string;
  owner: string;
  progress: ProjectProgress;
}

export function OnboardingView() {
  const { ready, data, asOf } = useStore();
  const { run } = useCrud();
  const userId = useUserId();
  const router = useRouter();
  const scope = useCustomerScope();
  const [status, setStatus] = useState<"" | "open" | OnboardingProject["Status"]>("open");
  const [owner, setOwner] = useState<"all" | "mine">("all");
  const [creating, setCreating] = useState(false);

  const all = useMemo<Row[]>(() => {
    const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
    const contracts = new Map(data.contracts.map((c) => [c.Id, c]));
    const tasks = new Map<string, typeof data.onboardingTasks>();
    for (const t of data.onboardingTasks) tasks.set(t.ProjectId, [...(tasks.get(t.ProjectId) ?? []), t]);
    return data.onboardingProjects
      .filter((p) => scope.visible(p.OwnerId) || scope.visible(accounts.get(p.AccountId)?.OwnerId ?? ""))
      .map((p) => ({
        project: p,
        account: accounts.get(p.AccountId)?.Name ?? "",
        contract: contracts.get(p.ContractId)?.ContractNumber ?? "",
        owner: userName(p.OwnerId),
        progress: projectProgress(
          p,
          (tasks.get(p.Id) ?? []).sort((a, b) => a.SortOrder - b.SortOrder),
          asOf,
        ),
      }));
  }, [data, asOf, scope]);

  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (status === "open" ? r.project.Status === "Live" : status && r.project.Status !== status) return false;
        if (owner === "mine" && r.project.OwnerId !== userId) return false;
        return true;
      }),
    [all, status, owner, userId],
  );

  const withoutProject = useMemo(() => {
    const has = new Set(data.onboardingProjects.map((p) => p.ContractId));
    const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
    return data.contracts
      .filter((c) => (c.Status === "Signed" || c.Status === "Active") && !has.has(c.Id) && scope.visible(c.OwnerId))
      .sort((a, b) => (b.SignedDate ?? "").localeCompare(a.SignedDate ?? ""))
      .map((c) => ({ value: c.Id, label: `${c.ContractNumber} · ${accounts.get(c.AccountId)?.Name ?? c.Name}` }));
  }, [data.contracts, data.onboardingProjects, data.accounts, scope]);

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: "account",
        header: "Account",
        sortValue: (r) => r.account,
        cell: (r) => (
          <div className="max-w-[260px] min-w-[180px]">
            <p className="truncate font-medium">
              {r.account}
              <LocalChangeTag id={r.project.Id} />
            </p>
            <p className="truncate text-xs text-muted-foreground">{r.contract}</p>
          </div>
        ),
      },
      { key: "owner", header: "Owner", sortValue: (r) => r.owner, hideBelow: "lg", cell: (r) => <span className="whitespace-nowrap">{r.owner}</span> },
      { key: "status", header: "Status", sortValue: (r) => ONBOARDING_STATUSES.indexOf(r.project.Status), cell: (r) => <ProjectStatusPill status={r.project.Status} /> },
      { key: "golive", header: "Target go-live", sortValue: (r) => r.project.TargetGoLive, cell: (r) => <span className="tabular whitespace-nowrap">{fmtShortDate(r.project.TargetGoLive)}</span> },
      { key: "progress", header: "Progress", sortValue: (r) => r.progress.pct, cell: (r) => <ProgressBar pct={r.progress.pct} /> },
      {
        key: "next",
        header: "Next task",
        hideBelow: "md",
        sortValue: (r) => r.progress.nextTask?.DueDate ?? "9999",
        cell: (r) =>
          r.progress.nextTask ? (
            <div className="max-w-[240px]">
              <p className="truncate">{r.progress.nextTask.Phase}</p>
              <p className={cn("text-xs tabular", parseDate(r.progress.nextTask.DueDate) < asOf ? "font-medium text-status-critical" : "text-muted-foreground")}>
                Due {fmtShortDate(r.progress.nextTask.DueDate)}
                {r.progress.overdue > 0 && ` · ${r.progress.overdue} overdue`}
              </p>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        key: "days",
        header: "Days to go-live",
        align: "right",
        sortValue: (r) => (r.project.Status === "Live" ? 99999 : r.progress.daysToGoLive),
        cell: (r) =>
          r.project.Status === "Live" ? (
            <span className="text-xs text-muted-foreground">Live {r.project.GoLiveDate ? fmtShortDate(r.project.GoLiveDate) : ""}</span>
          ) : (
            <span className={cn("tabular", r.progress.daysToGoLive < 0 && "font-medium text-status-critical")}>{r.progress.daysToGoLive}</span>
          ),
      },
    ],
    [asOf],
  );

  if (!ready) return <Skeleton className="h-[480px]" />;

  const open = all.filter((r) => r.project.Status !== "Live");
  const atRisk = all.filter((r) => r.project.Status === "At Risk").length;
  const soon = open.filter((r) => r.progress.daysToGoLive >= 0 && r.progress.daysToGoLive <= 45).length;
  const liveRecent = all.filter((r) => r.project.GoLiveDate && diffDays(asOf, parseDate(r.project.GoLiveDate)) <= 90).length;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Active projects" value={String(open.length)} active={status === "open"} onClick={() => setStatus("open")} />
        <StatTile label="At Risk" value={String(atRisk)} active={status === "At Risk"} onClick={() => setStatus("At Risk")} />
        <StatTile label="Going live in 45 days" value={String(soon)} />
        <StatTile label="Live in the last 90 days" value={String(liveRecent)} active={status === "Live"} onClick={() => setStatus("Live")} />
      </dl>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.project.Id}
        caption="Onboarding projects"
        search={{ placeholder: "Search projects", text: (r) => `${r.account} ${r.contract} ${r.owner}` }}
        filterKey={`${status}|${owner}`}
        defaultSort={{ key: "golive", dir: "asc" }}
        onRowClick={(r) => router.push(`/customers/onboarding/${r.project.Id}`)}
        minWidth={940}
        empty="No onboarding projects match"
        filters={
          <>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectCls}>
              <option value="open">Not live yet</option>
              <option value="">All statuses</option>
              {ONBOARDING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)} className={selectCls}>
              <option value="all">All owners</option>
              <option value="mine">My projects</option>
            </select>
          </>
        }
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={!withoutProject.length}>
            <Plus />
            New project
          </Button>
        }
      />
      <RecordDrawer
        open={creating}
        onOpenChange={setCreating}
        title="New onboarding project"
        fields={[{ name: "ContractId", label: "Signed contract", type: "select", required: true, options: withoutProject, wide: true }]}
        initial={{ ContractId: withoutProject[0]?.value ?? "" }}
        submitLabel="Create project"
        onSubmit={(v) => {
          const c = data.contracts.find((x) => x.Id === v.ContractId);
          if (!c) return "Choose a contract";
          const muts = onboardingForContractMutations({ data, asOf, userId }, c);
          if (!muts.length) return "This contract already has a project";
          run(muts, "Onboarding project created");
          setCreating(false);
          const id = muts[0].op === "create" ? muts[0].record.Id : "";
          if (id) router.push(`/customers/onboarding/${id}`);
        }}
      />
    </div>
  );
}
