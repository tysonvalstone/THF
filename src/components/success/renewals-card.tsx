"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { renewalsAtRisk } from "@/lib/success/health";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { HealthBadge, useCustomerScope } from "./shared";

/** Compact Home card: renewals at risk in the next 180 days, soonest first */
export function RenewalsAtRiskCard({ limit = 5, className }: { limit?: number; className?: string }) {
  const { ready, data, asOf } = useStore();
  const scope = useCustomerScope();
  const rows = useMemo(() => renewalsAtRisk(data, asOf).filter((r) => scope.visible(r.contract.OwnerId)), [data, asOf, scope]);
  const total = rows.reduce((s, r) => s + r.arr, 0);

  return (
    <section className={cn("min-w-0 rounded-md border bg-card", className)} aria-label="Renewals at risk">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">Renewals at risk</h2>
        <Link href="/customers/renewals" className="text-xs text-primary hover:underline">
          All renewals
        </Link>
      </div>
      <div className="p-4">
        {!ready ? (
          <Skeleton className="h-32" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">None in the next 180 days</p>
        ) : (
          <>
            <p className="mb-3 text-sm">
              <span className="font-semibold tabular">{fmtMoney(total)}</span>
              <span className="text-muted-foreground">
                {" "}
                ARR across {rows.length} {rows.length === 1 ? "renewal" : "renewals"}
              </span>
            </p>
            <ul className="divide-y">
              {rows.slice(0, limit).map((r) => (
                <li key={r.contract.Id} className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <Link href={`/customers?account=${r.account.Id}`} className="min-w-0 flex-1 hover:underline">
                    <span className="block truncate">{r.account.Name}</span>
                    <span className="text-xs text-muted-foreground tabular">
                      Ends {fmtShortDate(r.contract.EndDate)} · {r.daysToEnd}d · {fmtMoney(r.arr)}
                    </span>
                  </Link>
                  <HealthBadge band={r.health.band} score={r.health.score} />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
