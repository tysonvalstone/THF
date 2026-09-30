"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useAuth } from "@/lib/auth";
import { canDecide } from "@/lib/roles";
import { quoteApproval } from "@/lib/quotes/lifecycle";
import { canApprove } from "@/lib/quotes/approvals";
import { USER_BY_ID } from "@/data/reference/users";
import type { DataSnapshot } from "@/lib/data/types";
import type { AppRole } from "@/lib/supabase/config";
import { fmtShortDate } from "@/lib/dates";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface InboxItem {
  id: string;
  type: "Discount" | "Non-standard clause" | "Payment terms";
  title: string;
  detail: string;
  href: string;
  requestedBy: string;
  requestedDate: string;
}

/** Everything waiting on the current role: quote discounts, clauses, payment terms */
export function approvalsFor(data: DataSnapshot, role: AppRole): InboxItem[] {
  const items: InboxItem[] = [];
  for (const q of data.quotes) {
    if (q.Status !== "In Review") continue;
    const req = quoteApproval(data, q);
    if (req.level === "auto" || !canApprove(req.level, role)) continue;
    items.push({
      id: q.Id,
      type: "Discount",
      title: `${q.QuoteNumber} · ${q.Name}`,
      detail: req.reasons.join("; "),
      href: `/quotes/${q.Id}`,
      requestedBy: USER_BY_ID[q.OwnerId]?.Name ?? "",
      requestedDate: q.CreatedDate,
    });
  }
  for (const a of data.approvals) {
    if (a.Status !== "Pending" || a.Type === "Discount" || !canDecide(role, a.ApproverRole)) continue;
    const contractId = a.Object === "ContractClause" ? data.contractClauses.find((c) => c.Id === a.RecordId)?.ContractId : a.Object === "Contract" ? a.RecordId : undefined;
    items.push({
      id: a.Id,
      type: a.Type,
      title: a.RecordName,
      detail: a.Detail,
      href: contractId ? `/contracts/${contractId}` : a.Object === "Quote" ? `/quotes/${a.RecordId}` : "/approvals",
      requestedBy: USER_BY_ID[a.RequestedById]?.Name ?? "",
      requestedDate: a.RequestedDate,
    });
  }
  return items.sort((x, y) => y.requestedDate.localeCompare(x.requestedDate));
}

export function useApprovals(): InboxItem[] {
  const { data, ready } = useStore();
  const { role } = useAuth();
  return useMemo(() => (ready ? approvalsFor(data, role) : []), [ready, data, role]);
}

/** Header inbox with a count badge */
export function ApprovalsInbox() {
  const items = useApprovals();
  const n = items.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={n ? `Approvals, ${n} waiting` : "Approvals"}
          className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Inbox className="size-[18px]" aria-hidden />
          {n > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular">
              {n > 99 ? "99+" : n}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Approvals</p>
          <Link href="/approvals" className="text-xs text-primary hover:underline">
            View all
          </Link>
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto">
          {items.slice(0, 8).map((i) => (
            <li key={`${i.type}-${i.id}`}>
              <Link href={i.href} className="block px-3 py-2 hover:bg-muted/60">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{i.title}</span>
                  <span className={cn("shrink-0 rounded-sm border px-1 text-[10px] text-muted-foreground")}>{i.type}</span>
                </span>
                <span className="line-clamp-1 text-xs text-muted-foreground">{i.detail}</span>
                <span className="text-[11px] text-muted-foreground">
                  {i.requestedBy} · {fmtShortDate(i.requestedDate)}
                </span>
              </Link>
            </li>
          ))}
          {!n && <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing waiting on you</li>}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
