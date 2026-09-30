"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { contactName, userName } from "@/lib/data/selectors";
import { fmtShortDate, toISODate } from "@/lib/dates";
import { stampAt } from "@/lib/new-builds/convert";
import type { Task } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TaskDrawer } from "./forms";

/** Tasks on an account, opportunity or lead, with New / Edit / Complete / Delete */
export function TasksPanel({
  accountId,
  opportunityId,
  leadId,
  param = "tp",
  title,
}: {
  accountId?: string;
  opportunityId?: string;
  leadId?: string;
  param?: string;
  title?: string;
}) {
  const { data, asOf } = useStore();
  const { update, remove } = useCrud();
  const [show, setShow] = useState<"open" | "all">("open");
  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const asOfISO = toISODate(asOf);
  const account = accountId ?? (opportunityId ? data.opportunities.find((o) => o.Id === opportunityId)?.AccountId : undefined);

  const all = useMemo(
    () => data.tasks.filter((t) => (opportunityId ? t.WhatId === opportunityId : accountId ? t.AccountId === accountId : t.WhoId === leadId)),
    [data.tasks, accountId, opportunityId, leadId],
  );
  const rows = useMemo(() => {
    const list = show === "open" ? all.filter((t) => t.Status !== "Completed") : all;
    return [...list].sort((a, b) => Number(a.Status === "Completed") - Number(b.Status === "Completed") || (a.Status === "Completed" ? b.ActivityDate.localeCompare(a.ActivityDate) : a.ActivityDate.localeCompare(b.ActivityDate)));
  }, [all, show]);
  const openCount = all.filter((t) => t.Status !== "Completed").length;

  const complete = (t: Task) => update("Task", t.Id, { Status: "Completed", CompletedDateTime: stampAt(asOf) }, "Task");

  const columns: Column<Task>[] = [
    {
      key: "done",
      header: <span className="sr-only">Complete</span>,
      className: "w-9",
      cell: (t) =>
        t.Status === "Completed" ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-accent-soft text-primary" title="Completed">
            <Check className="size-3" aria-hidden />
          </span>
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              complete(t);
            }}
            aria-label={`Complete ${t.Subject}`}
            title="Mark complete"
            className="flex size-5 items-center justify-center rounded-full border border-slate-300 text-transparent hover:border-primary hover:text-primary"
          >
            <Check className="size-3" aria-hidden />
          </button>
        ),
    },
    {
      key: "subject",
      header: "Subject",
      sortValue: (t) => t.Subject,
      cell: (t) => (
        <div className="min-w-0 max-w-72">
          <p className={cn("truncate font-medium", t.Status === "Completed" && "font-normal text-muted-foreground")}>
            {t.Subject}
            <LocalChangeTag id={t.Id} />
          </p>
          <p className="truncate text-xs text-muted-foreground">{[t.Type, t.Status === "In Progress" ? "In progress" : null, contactName(data, t.WhoId), t.Priority === "High" ? "High priority" : null].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    {
      key: "due",
      header: "Due",
      sortValue: (t) => t.ActivityDate,
      cell: (t) => {
        const overdue = t.Status !== "Completed" && t.ActivityDate < asOfISO;
        return <span className={cn("whitespace-nowrap tabular", overdue && "font-medium text-[#a8431b]")}>{overdue ? `Overdue · ${fmtShortDate(t.ActivityDate)}` : fmtShortDate(t.ActivityDate)}</span>;
      },
    },
    { key: "owner", header: "Assigned", hideBelow: "lg", sortValue: (t) => userName(t.OwnerId), cell: (t) => <span className="whitespace-nowrap text-muted-foreground">{userName(t.OwnerId)}</span> },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (t) => (
        <span className="inline-flex gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Edit ${t.Subject}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(t);
            }}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete ${t.Subject}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(t);
            }}
          >
            <Trash2 />
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-2">
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(t) => t.Id}
        param={param}
        filterKey={show}
        dense
        onRowClick={setEditing}
        empty={show === "open" ? "No open tasks" : "No tasks"}
        filters={
          <div className="inline-flex rounded-md border bg-card p-0.5 text-xs" role="group" aria-label="Show tasks">
            {(["open", "all"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={show === v}
                onClick={() => setShow(v)}
                className={cn("rounded-[5px] px-2.5 py-1", show === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {v === "open" ? `Open (${openCount})` : `All (${all.length})`}
              </button>
            ))}
          </div>
        }
        actions={
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus /> New task
          </Button>
        }
      />
      <TaskDrawer
        open={creating || !!editing}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        record={editing ?? undefined}
        defaults={creating ? { AccountId: account, WhatId: opportunityId ?? accountId, ...(leadId ? { WhoId: leadId } : {}) } : undefined}
        onDelete={
          editing
            ? () => {
                setDeleting(editing);
                setEditing(null);
              }
            : undefined
        }
      />
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete task "${deleting?.Subject ?? ""}"?`} onConfirm={() => deleting && remove("Task", deleting.Id, "Task")} />
    </div>
  );
}
