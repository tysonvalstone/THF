"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { fmtDate } from "@/lib/dates";
import type { DemoLink } from "@/lib/demo/state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DataTable, type Column } from "@/components/shared/data-table";
import { useDemo } from "./demo-provider";

interface Row {
  id: string;
  at: string;
  asOf?: string;
  kind: string;
  text: string;
  links: DemoLink[];
}

/** In-app page for an audited record */
function hrefFor(object: string, id: string): string | undefined {
  switch (object) {
    case "Account":
      return `/accounts/${id}`;
    case "Lead":
      return `/leads/${id}`;
    case "Opportunity":
      return `/opportunities/${id}`;
    case "Quote":
      return `/quotes/${id}`;
    case "Contract":
      return `/contracts/${id}`;
    case "Campaign":
      return `/campaigns/${id}`;
    case "Invoice":
    case "Payment":
      return "/finance/invoices";
    case "Call":
      return `/call-desk/history`;
    case "OnboardingProject":
      return "/customers/onboarding";
    default:
      return undefined;
  }
}

const KIND: Record<string, string> = { step: "Demo step", simulation: "Simulation", control: "Demo" };

/** Everything that happened in the demo: walkthrough steps, simulated activity and every audited change, newest first */
export function ActivitySheet() {
  const demo = useDemo();
  const { data, localIds } = useStore();
  const events = demo.state?.events;
  const rows = useMemo<Row[]>(() => {
    const fromDemo: Row[] = (events ?? []).map((e) => ({ id: e.id, at: e.at, asOf: e.asOf, kind: KIND[e.kind] ?? "Demo", text: e.text, links: e.links }));
    const fromAudit: Row[] = data.auditLog
      .filter((a) => localIds.has(a.Id))
      .map((a) => {
        const href = hrefFor(a.Object, a.RecordId);
        return {
          id: a.Id,
          at: a.At,
          kind: `${a.Action} ${a.Object}`,
          text: `${a.RecordName}${a.Changes.length ? ` · ${a.Changes.map((c) => c.field).slice(0, 3).join(", ")}` : ""} · ${a.UserName}`,
          links: href ? [{ label: "Open", href }] : [],
        };
      });
    return [...fromDemo, ...fromAudit].sort((x, y) => y.at.localeCompare(x.at));
  }, [events, data.auditLog, localIds]);

  const columns: Column<Row>[] = [
    {
      key: "at",
      header: "When",
      sortValue: (r) => r.at,
      cell: (r) => (
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular">
          {new Date(r.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
          {r.asOf && <span className="block">{fmtDate(r.asOf)}</span>}
        </span>
      ),
    },
    {
      key: "what",
      header: "What",
      cell: (r) => (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{r.kind}</p>
          <p className="text-sm">{r.text}</p>
          {!!r.links.length && (
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
              {r.links.map((l) => (
                <Link key={l.href + l.label} href={l.href} className="text-primary hover:underline" onClick={() => demo.setActivityOpen(false)}>
                  {l.label}
                </Link>
              ))}
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <Sheet open={demo.activityOpen} onOpenChange={demo.setActivityOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]" data-testid="demo-activity">
        <SheetHeader className="border-b">
          <SheetTitle className="text-base font-semibold">Demo activity</SheetTitle>
          <SheetDescription>{rows.length} events in this demo, newest first</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <DataTable
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            urlState={false}
            pageSize={10}
            pageSizes={[]}
            dense
            search={{ placeholder: "Search activity", text: (r) => `${r.kind} ${r.text}` }}
            empty="Nothing yet. Start the demo or fast-forward."
            caption="Demo activity"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
