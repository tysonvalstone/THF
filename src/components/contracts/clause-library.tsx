"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/roles";
import { fmtDate } from "@/lib/dates";
import { stamp } from "@/lib/quotes/build";
import type { Clause, ClauseCategory } from "@/types/salesforce";
import { CLAUSE_CATEGORIES } from "@/lib/contracts";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { RecordDrawer } from "@/components/shared/record-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Flag, selectCls } from "./shared";

interface Row {
  clause: Clause;
  used: number;
}

/** Settings → Legal: the standard clause library (Legal and admins edit; everyone else reads) */
export function ClauseLibrary() {
  const { ready, data, asOf } = useStore();
  const { role } = useAuth();
  const { create, update, remove } = useCrud();
  const editor = can(role, "edit:clauses");
  const [category, setCategory] = useState<"" | ClauseCategory>("");
  const [status, setStatus] = useState<"" | "active" | "archived">("active");
  const [editing, setEditing] = useState<Clause | "new" | null>(null);
  const [viewing, setViewing] = useState<Clause | null>(null);
  const [deleting, setDeleting] = useState<Clause | null>(null);

  const all = useMemo(() => {
    const usage = new Map<string, Set<string>>();
    for (const r of data.contractClauses) if (r.ClauseId) usage.set(r.ClauseId, (usage.get(r.ClauseId) ?? new Set()).add(r.ContractId));
    return data.clauses.map((clause) => ({ clause, used: usage.get(clause.Id)?.size ?? 0 }));
  }, [data.clauses, data.contractClauses]);
  const rows = useMemo(
    () => all.filter((r) => (!category || r.clause.Category === category) && (!status || (status === "active" ? r.clause.IsActive : !r.clause.IsActive))),
    [all, category, status],
  );

  const columns: Column<Row>[] = [
    {
      key: "name",
      header: "Clause",
      sortValue: (r) => r.clause.Name,
      cell: (r) => (
        <div className="max-w-[340px] min-w-[180px]">
          <p className="truncate font-medium">
            {r.clause.Name}
            <LocalChangeTag id={r.clause.Id} />
          </p>
          <p className="truncate text-xs text-muted-foreground">{r.clause.Body}</p>
        </div>
      ),
    },
    { key: "category", header: "Category", sortValue: (r) => r.clause.Category, cell: (r) => <span className="whitespace-nowrap">{r.clause.Category}</span> },
    { key: "default", header: "Default", sortValue: (r) => (r.clause.IsDefault ? 1 : 0), cell: (r) => (r.clause.IsDefault ? "Yes" : "No") },
    { key: "status", header: "Status", sortValue: (r) => (r.clause.IsActive ? 1 : 0), cell: (r) => (r.clause.IsActive ? <Flag tone="neutral">Active</Flag> : <Flag tone="warning">Archived</Flag>) },
    { key: "version", header: "Version", align: "right", sortValue: (r) => r.clause.Version, cell: (r) => `v${r.clause.Version}` },
    { key: "used", header: "Contracts", align: "right", sortValue: (r) => r.used, hideBelow: "md", cell: (r) => r.used.toLocaleString() },
    { key: "updated", header: "Updated", sortValue: (r) => r.clause.LastModifiedDate, hideBelow: "md", cell: (r) => <span className="tabular whitespace-nowrap text-muted-foreground">{fmtDate(r.clause.LastModifiedDate)}</span> },
  ];
  if (editor) {
    columns.push({
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (r) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="ghost" onClick={() => update("Clause", r.clause.Id, { IsActive: !r.clause.IsActive, LastModifiedDate: stamp(asOf) }, r.clause.Name)}>
            {r.clause.IsActive ? "Archive" : "Restore"}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-status-critical hover:text-status-critical"
            disabled={r.used > 0}
            title={r.used > 0 ? `Used by ${r.used} contract${r.used === 1 ? "" : "s"}; archive it instead` : undefined}
            onClick={() => setDeleting(r.clause)}
          >
            Delete
          </Button>
        </span>
      ),
    });
  }

  if (!ready) return <Skeleton className="h-[420px]" />;
  const current = editing && editing !== "new" ? editing : null;

  return (
    <div className="space-y-3">
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.clause.Id}
        caption="Clause library"
        param="clauses"
        search={{ placeholder: "Search clauses", text: (r) => `${r.clause.Name} ${r.clause.Category} ${r.clause.Body}` }}
        filterKey={`${category}|${status}`}
        defaultSort={{ key: "category", dir: "asc" }}
        onRowClick={(r) => (editor ? setEditing(r.clause) : setViewing(r.clause))}
        minWidth={760}
        empty="No clauses match"
        filters={
          <>
            <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className={selectCls}>
              <option value="">All categories</option>
              {CLAUSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectCls}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="">All</option>
            </select>
          </>
        }
        actions={
          editor && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus />
              New clause
            </Button>
          )
        }
      />

      <RecordDrawer
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={current ? `Edit ${current.Name}` : "New clause"}
        description={current ? `Version ${current.Version}` : undefined}
        initial={{ Name: current?.Name ?? "", Category: current?.Category ?? "General", IsDefault: current?.IsDefault ?? false, IsActive: current?.IsActive ?? true, Body: current?.Body ?? "" }}
        fields={[
          { name: "Name", label: "Name", required: true },
          { name: "Category", label: "Category", type: "select", required: true, options: CLAUSE_CATEGORIES.map((c) => ({ value: c, label: c })) },
          { name: "Body", label: "Text", type: "textarea", required: true, wide: true },
          { name: "IsDefault", label: "Include on new contracts", type: "checkbox" },
          { name: "IsActive", label: "Active", type: "checkbox" },
        ]}
        onDelete={current && clauseUsed(all, current.Id) === 0 ? () => (setDeleting(current), setEditing(null)) : undefined}
        onSubmit={(v) => {
          const fields = { Name: String(v.Name), Category: v.Category as ClauseCategory, Body: String(v.Body), IsDefault: !!v.IsDefault, IsActive: !!v.IsActive, LastModifiedDate: stamp(asOf) };
          if (current) {
            const textChanged = fields.Body !== current.Body || fields.Name !== current.Name;
            update("Clause", current.Id, { ...fields, Version: textChanged ? current.Version + 1 : current.Version }, fields.Name);
          } else {
            create("Clause", { ...fields, Version: 1 }, fields.Name);
          }
          setEditing(null);
        }}
      />

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.Name}</DialogTitle>
            <DialogDescription>
              {viewing?.Category} · v{viewing?.Version}
              {viewing && !viewing.IsActive ? " · Archived" : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm whitespace-pre-line">{viewing?.Body}</p>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting ? `Delete ${deleting.Name}?` : "Delete clause?"}
        onConfirm={() => deleting && remove("Clause", deleting.Id, deleting.Name)}
      />
    </div>
  );
}

function clauseUsed(rows: Row[], id: string): number {
  return rows.find((r) => r.clause.Id === id)?.used ?? 0;
}
