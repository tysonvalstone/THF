"use client";

import { useMemo, useState } from "react";
import type { AuditEntry } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const ACTIONS: AuditEntry["Action"][] = ["Create", "Update", "Delete", "Approve", "Reject", "Sign", "Send"];

/** Who changed what and when, with old and new values */
export function AuditLog() {
  const { data } = useStore();
  const [action, setAction] = useState("all");
  const [object, setObject] = useState("all");
  const [user, setUser] = useState("all");
  const [open, setOpen] = useState<AuditEntry | null>(null);

  const objects = useMemo(() => [...new Set(data.auditLog.map((a) => a.Object))].sort(), [data.auditLog]);
  const users = useMemo(() => [...new Set(data.auditLog.map((a) => a.UserName))].sort(), [data.auditLog]);
  const rows = useMemo(
    () => data.auditLog.filter((a) => (action === "all" || a.Action === action) && (object === "all" || a.Object === object) && (user === "all" || a.UserName === user)),
    [data.auditLog, action, object, user],
  );

  const cols: Column<AuditEntry>[] = [
    { key: "at", header: "When", sortValue: (r) => r.At, cell: (r) => <span className="whitespace-nowrap tabular">{fmtWhen(r.At)}</span> },
    {
      key: "user",
      header: "User",
      sortValue: (r) => r.UserName,
      cell: (r) => (
        <span>
          {r.UserName}
          <span className="block text-xs text-muted-foreground">{r.Role}</span>
        </span>
      ),
    },
    { key: "action", header: "Action", sortValue: (r) => r.Action, cell: (r) => r.Action },
    { key: "object", header: "Object", sortValue: (r) => r.Object, cell: (r) => r.Object, hideBelow: "sm" },
    { key: "record", header: "Record", sortValue: (r) => r.RecordName, cell: (r) => <span className="font-medium">{r.RecordName}</span> },
    {
      key: "changes",
      header: "Changes",
      cell: (r) =>
        r.Changes.length ? (
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {r.Changes.slice(0, 3)
              .map((c) => `${c.field}: ${show(c.old)} → ${show(c.new)}`)
              .join(" · ")}
            {r.Changes.length > 3 ? ` · +${r.Changes.length - 3}` : ""}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
      hideBelow: "md",
    },
  ];

  const select = (label: string, value: string, set: (v: string) => void, options: string[]) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={label} className="h-8 rounded-md border border-input bg-card px-2 text-sm">
      <option value="all">All {label.toLowerCase()}s</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">Audit log</h2>
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => r.Id}
        onRowClick={setOpen}
        search={{ placeholder: "Search audit log", text: (r) => `${r.RecordName} ${r.UserName} ${r.Object} ${r.Changes.map((c) => `${c.field} ${show(c.old)} ${show(c.new)}`).join(" ")}` }}
        filters={
          <>
            {select("Action", action, setAction, ACTIONS)}
            {select("Object", object, setObject, objects)}
            {select("User", user, setUser, users)}
          </>
        }
        filterKey={`${action}|${object}|${user}`}
        defaultSort={{ key: "at", dir: "desc" }}
        param="ap"
        empty="No changes recorded yet"
        minWidth={720}
      />
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[520px]">
          <div className="border-b px-5 py-4 pr-12">
            <SheetTitle className="text-base font-semibold">
              {open?.Action} · {open?.Object}
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              {open?.RecordName} · {open && fmtWhen(open.At)} · {open?.UserName} ({open?.Role})
            </SheetDescription>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            {open?.Changes.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Field</th>
                    <th className="py-1.5 pr-3 font-medium">Old</th>
                    <th className="py-1.5 font-medium">New</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {open.Changes.map((c) => (
                    <tr key={c.field}>
                      <td className="py-1.5 pr-3 font-medium">{c.field}</td>
                      <td className="py-1.5 pr-3 break-all text-muted-foreground">{show(c.old)}</td>
                      <td className="py-1.5 break-all">{show(c.new)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">{open?.Action === "Create" ? "Record created." : open?.Action === "Delete" ? "Record deleted." : "No field changes."}</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
