"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/data/store";
import { useAuth } from "@/lib/auth";
import { APP_ROLE_LABEL } from "@/lib/supabase/config";
import { USER_BY_ID } from "@/data/reference/users";
import { fmtShortDate } from "@/lib/dates";
import { DataTable, type Column } from "@/components/shared/data-table";
import { useApprovals, type InboxItem } from "./approvals-inbox";

interface HistoryRow {
  id: string;
  type: string;
  title: string;
  status: string;
  decidedBy: string;
  date: string;
  note: string;
}

export function ApprovalsView() {
  const router = useRouter();
  const { data } = useStore();
  const { role } = useAuth();
  const pending = useApprovals();
  const [type, setType] = useState("all");
  const rows = type === "all" ? pending : pending.filter((p) => p.type === type);

  const history = useMemo<HistoryRow[]>(
    () =>
      data.approvals
        .filter((a) => a.Status !== "Pending")
        .map((a) => ({
          id: a.Id,
          type: a.Type,
          title: a.RecordName,
          status: a.Status,
          decidedBy: a.DecidedById ? (USER_BY_ID[a.DecidedById]?.Name ?? a.DecidedById) : "",
          date: a.DecidedDate ?? a.RequestedDate,
          note: a.DecisionNote ?? "",
        })),
    [data.approvals],
  );

  const cols: Column<InboxItem>[] = [
    {
      key: "title",
      header: "Record",
      sortValue: (r) => r.title,
      cell: (r) => (
        <Link href={r.href} className="font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {r.title}
        </Link>
      ),
    },
    { key: "type", header: "Type", sortValue: (r) => r.type, cell: (r) => r.type },
    { key: "detail", header: "Why", cell: (r) => <span className="text-muted-foreground">{r.detail}</span>, hideBelow: "md" },
    { key: "by", header: "Requested by", sortValue: (r) => r.requestedBy, cell: (r) => r.requestedBy, hideBelow: "sm" },
    { key: "date", header: "Requested", sortValue: (r) => r.requestedDate, cell: (r) => fmtShortDate(r.requestedDate) },
  ];
  const histCols: Column<HistoryRow>[] = [
    { key: "title", header: "Record", sortValue: (r) => r.title, cell: (r) => <span className="font-medium">{r.title}</span> },
    { key: "type", header: "Type", sortValue: (r) => r.type, cell: (r) => r.type },
    { key: "status", header: "Decision", sortValue: (r) => r.status, cell: (r) => r.status },
    { key: "by", header: "By", sortValue: (r) => r.decidedBy, cell: (r) => r.decidedBy, hideBelow: "sm" },
    { key: "date", header: "Date", sortValue: (r) => r.date, cell: (r) => fmtShortDate(r.date) },
    { key: "note", header: "Note", cell: (r) => <span className="text-muted-foreground">{r.note}</span>, hideBelow: "md" },
  ];

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Waiting on {APP_ROLE_LABEL[role]}</p>
      </header>
      <DataTable
        rows={rows}
        columns={cols}
        rowKey={(r) => `${r.type}-${r.id}`}
        onRowClick={(r) => router.push(r.href)}
        search={{ placeholder: "Search approvals", text: (r) => `${r.title} ${r.detail} ${r.requestedBy}` }}
        filterKey={type}
        filters={
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type" className="h-8 rounded-md border border-input bg-card px-2 text-sm">
            <option value="all">All types</option>
            <option>Discount</option>
            <option>Non-standard clause</option>
            <option>Payment terms</option>
          </select>
        }
        defaultSort={{ key: "date", dir: "desc" }}
        empty="Nothing waiting on you"
        minWidth={640}
      />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Decided</h2>
        <DataTable rows={history} columns={histCols} rowKey={(r) => r.id} param="hp" defaultSort={{ key: "date", dir: "desc" }} empty="No decisions yet" minWidth={640} />
      </section>
    </div>
  );
}
