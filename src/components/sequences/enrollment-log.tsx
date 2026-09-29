"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { Enrollment } from "@/lib/ai/types";
import type { DataSnapshot } from "@/lib/data/types";
import { fmtShortDate } from "@/lib/dates";
import { recordHref } from "@/lib/links";
import { STEP_TYPE_LABEL, enrollmentsCollection } from "./sequence-store";
import { ConfirmDialog } from "./parts";
import { Button } from "@/components/ui/button";

export function EnrollmentLog({ enrollments, data, asOfISO }: { enrollments: Enrollment[]; data: DataSnapshot; asOfISO: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Enrollment | null>(null);
  const rows = useMemo(() => {
    const acc = new Map(data.accounts.map((a) => [a.Id, a]));
    const con = new Map(data.contacts.map((c) => [c.Id, c]));
    return [...enrollments]
      .sort((a, b) => b.enrolledAt.localeCompare(a.enrolledAt))
      .map((e) => {
        const next = e.steps.find((s) => s.date >= asOfISO);
        return { e, account: acc.get(e.accountId), contact: e.contactId ? con.get(e.contactId) : undefined, next };
      });
  }, [enrollments, data, asOfISO]);

  if (!rows.length) return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No enrollments yet</p>;

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <div className="hidden grid-cols-[1rem_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_5rem] gap-3 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground md:grid">
        <span />
        <span>Recipient</span>
        <span>Sequence</span>
        <span>Next step</span>
        <span className="text-right">Steps</span>
      </div>
      <ul className="divide-y">
        {rows.map(({ e, account, contact, next }) => {
          const expanded = open === e.id;
          return (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : e.id)}
                aria-expanded={expanded}
                className="grid w-full grid-cols-[1rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-4 py-2.5 text-left text-sm hover:bg-muted/30 md:grid-cols-[1rem_minmax(0,1.5fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_5rem] md:items-center"
              >
                {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
                <span className="min-w-0">
                  <span className="block truncate font-medium">{contact?.Name ?? account?.Name ?? e.accountId}</span>
                  <span className="block truncate text-xs text-muted-foreground">{contact ? account?.Name : "Account only"}</span>
                </span>
                <span className="col-start-2 truncate text-muted-foreground md:col-start-auto md:text-foreground">{e.sequenceName}</span>
                <span className="col-start-2 text-xs md:col-start-auto md:text-sm">
                  {next ? (
                    <>
                      {STEP_TYPE_LABEL[next.type]} · <span className="tabular">{fmtShortDate(next.date)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">Complete</span>
                  )}
                </span>
                <span className="col-start-2 text-xs text-muted-foreground tabular md:col-start-auto md:text-right md:text-sm">{e.steps.length} steps</span>
              </button>
              {expanded && (
                <div className="space-y-2 border-t bg-muted/20 px-4 py-3">
                  <ol className="space-y-1.5">
                    {e.steps.map((s, i) => {
                      const past = s.date < asOfISO;
                      return (
                        <li key={`${s.stepId}-${i}`} className="grid grid-cols-[4.5rem_6.5rem_minmax(0,1fr)_auto] items-baseline gap-2 text-sm">
                          <span className="text-muted-foreground tabular">{fmtShortDate(s.date)}</span>
                          <span className="text-muted-foreground">{STEP_TYPE_LABEL[s.type]}</span>
                          <span className="min-w-0 truncate">
                            {s.subject ?? s.body.split("\n")[0]}
                            {s.originalDate && <span className="text-xs text-muted-foreground"> · moved from {fmtShortDate(s.originalDate)}</span>}
                          </span>
                          <span className="text-xs text-muted-foreground">{past ? "Simulated" : "Scheduled"}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
                    <span>
                      Enrolled {fmtShortDate(e.startDate)}
                      {account && (
                        <>
                          {" · "}
                          <Link href={recordHref(account.Id)} className="text-primary hover:underline">
                            Open account
                          </Link>
                        </>
                      )}
                    </span>
                    <Button variant="ghost" size="xs" onClick={() => setRemoving(e)}>
                      Unenroll
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Unenroll recipient?"
        description={removing ? `Remaining steps of "${removing.sequenceName}" won't be scheduled.` : undefined}
        confirmLabel="Unenroll"
        destructive
        onConfirm={() => removing && enrollmentsCollection.remove(removing.id)}
      />
    </div>
  );
}
