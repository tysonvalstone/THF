"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { Enrollment } from "@/lib/ai/types";
import type { DataSnapshot, Mutation } from "@/lib/data/types";
import { useStore } from "@/lib/data/store";
import { fmtShortDate } from "@/lib/dates";
import { recordHref } from "@/lib/links";
import type { Account, Contact } from "@/types/salesforce";
import { STEP_TYPE_LABEL, enrollmentTaskIds, enrollmentsCollection } from "./sequence-store";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface Row {
  e: Enrollment;
  account?: Account;
  contact?: Contact;
  next?: Enrollment["steps"][number];
}

export function EnrollmentLog({ enrollments, data, asOfISO }: { enrollments: Enrollment[]; data: DataSnapshot; asOfISO: string }) {
  const { commit, undo, changeLog, localOnly } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Enrollment | null>(null);
  const rows = useMemo<Row[]>(() => {
    const acc = new Map(data.accounts.map((a) => [a.Id, a]));
    const con = new Map(data.contacts.map((c) => [c.Id, c]));
    return enrollments.map((e) => ({ e, account: acc.get(e.accountId), contact: e.contactId ? con.get(e.contactId) : undefined, next: e.steps.find((s) => s.date >= asOfISO) }));
  }, [enrollments, data, asOfISO]);

  /** Remove the recipient: the enrollment and its scheduled tasks, with Undo */
  const unenroll = (e: Enrollment) => {
    const ids = enrollmentTaskIds(e, data.tasks);
    const mutations: Mutation[] = ids.map((id) => ({ op: "delete", object: "Task", id }));
    enrollmentsCollection.remove(e.id);
    if (mutations.length) commit(mutations);
    const expected = changeLog().length;
    setOpenId(null);
    toast.success(`Recipient removed${ids.length ? ` · ${ids.length} scheduled task${ids.length === 1 ? "" : "s"} deleted` : ""}${localOnly ? " (local change, not synced)" : ""}`, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          if (mutations.length && changeLog().length !== expected) {
            toast.error("Can't undo: other changes were made since");
            return;
          }
          if (mutations.length) undo(mutations.length);
          enrollmentsCollection.save(e);
        },
      },
    });
  };

  const columns: Column<Row>[] = [
    {
      key: "recipient",
      header: "Recipient",
      sortValue: (r) => r.contact?.Name ?? r.account?.Name,
      cell: (r) => (
        <div className="min-w-0 max-w-64">
          <p className="truncate font-medium">{r.contact?.Name ?? r.account?.Name ?? r.e.accountId}</p>
          <p className="truncate text-xs text-muted-foreground">{r.contact ? r.account?.Name : "Account only"}</p>
        </div>
      ),
    },
    { key: "sequence", header: "Sequence", hideBelow: "sm", sortValue: (r) => r.e.sequenceName, cell: (r) => <span className="block max-w-56 truncate">{r.e.sequenceName}</span> },
    {
      key: "next",
      header: "Next step",
      sortValue: (r) => r.next?.date ?? "9999",
      cell: (r) =>
        r.next ? (
          <span className="whitespace-nowrap">
            {STEP_TYPE_LABEL[r.next.type]} · <span className="tabular">{fmtShortDate(r.next.date)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Complete</span>
        ),
    },
    { key: "steps", header: "Steps", align: "right", hideBelow: "md", sortValue: (r) => r.e.steps.length, cell: (r) => r.e.steps.length },
    { key: "enrolled", header: "Enrolled", hideBelow: "lg", sortValue: (r) => r.e.enrolledAt, cell: (r) => <span className="text-muted-foreground tabular">{fmtShortDate(r.e.startDate)}</span> },
    {
      key: "remove",
      header: <span className="sr-only">Remove</span>,
      align: "right",
      cell: (r) => (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${r.contact?.Name ?? r.account?.Name ?? "recipient"}`}
          onClick={(ev) => {
            ev.stopPropagation();
            setRemoving(r.e);
          }}
        >
          <X />
        </Button>
      ),
    },
  ];

  const open = openId ? rows.find((r) => r.e.id === openId) : undefined;

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.e.id}
        param="ep"
        search={{ placeholder: "Search recipients or sequences", text: (r) => `${r.contact?.Name ?? ""} ${r.account?.Name ?? ""} ${r.e.sequenceName}` }}
        defaultSort={{ key: "enrolled", dir: "desc" }}
        onRowClick={(r) => setOpenId(r.e.id)}
        empty="No enrollments yet"
        caption="Scheduled enrollments"
      />
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
          {open && (
            <>
              <div className="border-b px-5 py-4 pr-12">
                <p className="text-xs text-muted-foreground">Enrollment · {open.e.sequenceName}</p>
                <SheetTitle className="mt-0.5 text-base font-semibold">{open.contact?.Name ?? open.account?.Name ?? open.e.accountId}</SheetTitle>
                <SheetDescription className="text-sm text-muted-foreground">
                  {open.contact ? `${open.contact.Title} · ${open.account?.Name ?? ""}` : "Account only"} · enrolled {fmtShortDate(open.e.startDate)}
                </SheetDescription>
              </div>
              <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
                {open.e.steps.map((s, i) => (
                  <li key={`${s.stepId}-${i}`} className="grid grid-cols-[4.5rem_6.5rem_minmax(0,1fr)] items-baseline gap-2 text-sm">
                    <span className="text-muted-foreground tabular">{fmtShortDate(s.date)}</span>
                    <span className="text-muted-foreground">{STEP_TYPE_LABEL[s.type]}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{s.subject ?? s.body.split("\n")[0]}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.date < asOfISO ? "Simulated" : "Scheduled"}
                        {s.originalDate ? ` · moved from ${fmtShortDate(s.originalDate)}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="flex items-center gap-2 border-t px-5 py-3">
                <Button variant="ghost" className="text-status-critical hover:text-status-critical" onClick={() => setRemoving(open.e)}>
                  Remove recipient
                </Button>
                {open.account && (
                  <Button asChild variant="outline" className="ml-auto">
                    <Link href={recordHref(open.account.Id)}>Open account</Link>
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove recipient?"
        description={removing ? `The enrollment in "${removing.sequenceName}" and its scheduled tasks will be deleted. You can undo this for a few seconds afterwards.` : undefined}
        confirmLabel="Remove"
        onConfirm={() => removing && unenroll(removing)}
      />
    </>
  );
}
