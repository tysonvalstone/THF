"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useUserId } from "@/lib/auth";
import { userName } from "@/lib/data/selectors";
import { fmtShortDate, fmtRelative } from "@/lib/dates";
import { QUOTE_STATUSES, type Quote, type QuoteStatus } from "@/types/salesforce";
import type { ColumnDef } from "@/lib/columns";
import { productMap } from "@/lib/quotes/catalog";
import { computeTotals, fmtCurrency, type QuoteTotals } from "@/lib/quotes/pricing";
import { daysToExpiry, effectiveStatus, quoteUpdated } from "@/lib/quotes/lifecycle";
import { DataTable, type Column } from "@/components/shared/data-table";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { QuoteDrawer } from "./quote-drawer";
import { QuoteStatusPill, selectCls } from "./shared";

export interface QuoteRow {
  quote: Quote;
  status: QuoteStatus;
  account: string;
  opportunity: string;
  stage: string;
  owner: string;
  currency: "USD" | "CAD";
  totals: QuoteTotals;
  daysLeft: number;
  updated: string;
}

/** Rows for quote tables (list page and opportunity page) */
export function useQuoteRows(filter?: (q: Quote) => boolean): QuoteRow[] {
  const { data, asOf } = useStore();
  return useMemo(() => {
    const accounts = new Map(data.accounts.map((a) => [a.Id, a]));
    const opps = new Map(data.opportunities.map((o) => [o.Id, o]));
    const books = new Map(data.pricebooks.map((b) => [b.Id, b]));
    const products = productMap(data.products);
    const lines = new Map<string, typeof data.quoteLineItems>();
    for (const l of data.quoteLineItems) lines.set(l.QuoteId, [...(lines.get(l.QuoteId) ?? []), l]);
    return data.quotes
      .filter((q) => !filter || filter(q))
      .map((q) => {
        const o = opps.get(q.OpportunityId);
        return {
          quote: q,
          status: effectiveStatus(q, asOf),
          account: accounts.get(q.AccountId)?.Name ?? "",
          opportunity: o?.Name ?? "",
          stage: o?.StageName ?? "",
          owner: userName(q.OwnerId),
          currency: books.get(q.Pricebook2Id)?.CurrencyIsoCode ?? "USD",
          totals: computeTotals(q, lines.get(q.Id) ?? [], products),
          daysLeft: daysToExpiry(q, asOf),
          updated: quoteUpdated(q),
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter is a render-time predicate
  }, [data, asOf]);
}

const OPEN: QuoteStatus[] = ["Draft", "In Review", "Approved", "Sent"];

export function ExpiryCell({ row }: { row: QuoteRow }) {
  const { asOf } = useStore();
  const open = OPEN.includes(row.quote.Status);
  const soon = open && row.daysLeft >= 0 && row.daysLeft <= 7;
  const past = row.status === "Expired";
  return (
    <span className={cn("tabular whitespace-nowrap", soon && "font-medium text-amber-800", past && "text-status-critical")} title={open ? fmtRelative(row.quote.ExpirationDate, asOf) : undefined}>
      {fmtShortDate(row.quote.ExpirationDate)}
      {soon && <span className="ml-1 text-xs">({row.daysLeft === 0 ? "today" : `${row.daysLeft}d`})</span>}
    </span>
  );
}

export function quoteColumns(opts: { compact?: boolean } = {}): Column<QuoteRow>[] {
  const cols: Column<QuoteRow>[] = [
    {
      key: "number",
      header: "Quote",
      sortValue: (r) => r.quote.QuoteNumber,
      cell: (r) => (
        <Link href={`/quotes/${r.quote.Id}`} className="font-medium whitespace-nowrap text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {r.quote.QuoteNumber}
        </Link>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortValue: (r) => r.quote.Name,
      cell: (r) => (
        <div className="max-w-[320px] min-w-[180px]">
          <p className="truncate">
            {r.quote.Name}
            <LocalChangeTag id={r.quote.Id} />
          </p>
          {!opts.compact && <p className="truncate text-xs text-muted-foreground">{r.account}</p>}
        </div>
      ),
    },
  ];
  if (!opts.compact) cols.push({ key: "stage", header: "Stage", sortValue: (r) => r.stage, hideBelow: "lg", cell: (r) => <span className="whitespace-nowrap">{r.stage}</span> });
  cols.push(
    { key: "status", header: "Status", sortValue: (r) => QUOTE_STATUSES.indexOf(r.status), cell: (r) => <QuoteStatusPill status={r.status} /> },
    { key: "first", header: "First year", align: "right", sortValue: (r) => r.totals.firstYear, cell: (r) => fmtCurrency(r.totals.firstYear, r.currency, { cents: false }) },
    { key: "tcv", header: "TCV", align: "right", sortValue: (r) => r.totals.tcv, hideBelow: "md", cell: (r) => fmtCurrency(r.totals.tcv, r.currency, { cents: false }) },
    { key: "expires", header: "Expires", sortValue: (r) => r.quote.ExpirationDate, cell: (r) => <ExpiryCell row={r} /> },
  );
  if (!opts.compact) cols.push({ key: "owner", header: "Owner", sortValue: (r) => r.owner, hideBelow: "lg", cell: (r) => <span className="whitespace-nowrap">{r.owner}</span> });
  cols.push({ key: "updated", header: "Updated", sortValue: (r) => r.updated, hideBelow: "md", cell: (r) => <span className="tabular whitespace-nowrap text-muted-foreground">{fmtShortDate(r.updated)}</span> });
  return cols;
}

const CSV: ColumnDef<QuoteRow>[] = [
  { key: "number", label: "Quote Number", value: (r) => r.quote.QuoteNumber, required: true },
  { key: "name", label: "Name", value: (r) => r.quote.Name },
  { key: "account", label: "Account", value: (r) => r.account },
  { key: "opportunity", label: "Opportunity", value: (r) => r.opportunity },
  { key: "stage", label: "Stage", value: (r) => r.stage },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "currency", label: "Currency", value: (r) => r.currency },
  { key: "arr", label: "ARR", type: "currency", value: (r) => r.totals.arr },
  { key: "oneTime", label: "One-time", type: "currency", value: (r) => r.totals.oneTime },
  { key: "firstYear", label: "First-year total", type: "currency", value: (r) => r.totals.firstYear },
  { key: "tcv", label: "TCV", type: "currency", value: (r) => r.totals.tcv },
  { key: "discount", label: "Max discount %", type: "number", value: (r) => r.totals.maxEffectiveDiscount },
  { key: "term", label: "Term (months)", type: "number", value: (r) => r.quote.Contract_Term_Months__c },
  { key: "start", label: "Go-live", type: "date", value: (r) => r.quote.Start_Date__c },
  { key: "expires", label: "Expiration", type: "date", value: (r) => r.quote.ExpirationDate },
  { key: "owner", label: "Owner", value: (r) => r.owner },
  { key: "created", label: "Created", type: "date", value: (r) => r.quote.CreatedDate.slice(0, 10), defaultOn: false },
  { key: "updated", label: "Updated", type: "date", value: (r) => r.updated.slice(0, 10), defaultOn: false },
  { key: "id", label: "Quote Id", value: (r) => r.quote.Id, defaultOn: false },
];

type Expiring = "" | "7" | "30" | "expired";

export function QuotesList() {
  const { ready } = useStore();
  const userId = useUserId();
  const router = useRouter();
  const all = useQuoteRows();
  const [status, setStatus] = useState<"" | "open" | QuoteStatus>("open");
  const [owner, setOwner] = useState<"all" | "mine">("all");
  const [expiring, setExpiring] = useState<Expiring>("");
  const [creating, setCreating] = useState(false);

  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (status === "open" ? !OPEN.includes(r.status) : status && r.status !== status) return false;
        if (owner === "mine" && r.quote.OwnerId !== userId) return false;
        if (expiring === "expired") return r.status === "Expired";
        if (expiring) return OPEN.includes(r.status) && r.daysLeft >= 0 && r.daysLeft <= Number(expiring);
        return true;
      }),
    [all, status, owner, expiring, userId],
  );
  const columns = useMemo(() => quoteColumns(), []);

  if (!ready) return <Skeleton className="h-[480px]" />;
  const openRows = all.filter((r) => OPEN.includes(r.status));
  const expiringSoon = openRows.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 7).length;
  const inReview = all.filter((r) => r.status === "In Review").length;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Open quotes", String(openRows.length), () => (setStatus("open"), setExpiring(""))],
            ["Open first-year value", fmtCurrency(openRows.filter((r) => r.currency === "USD").reduce((s, r) => s + r.totals.firstYear, 0), "USD", { cents: false }), () => (setStatus("open"), setExpiring(""))],
            ["Awaiting approval", String(inReview), () => (setStatus("In Review"), setExpiring(""))],
            ["Expiring in 7 days", String(expiringSoon), () => (setStatus("open"), setExpiring("7"))],
          ] as const
        ).map(([label, value, onClick]) => (
          <button key={label} type="button" onClick={onClick} className="rounded-md border bg-card px-4 py-3 text-left hover:border-primary/40">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular">{value}</dd>
          </button>
        ))}
      </dl>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.quote.Id}
        caption="Quotes"
        search={{ placeholder: "Search quotes", text: (r) => `${r.quote.QuoteNumber} ${r.quote.Name} ${r.account} ${r.opportunity}` }}
        filterKey={`${status}|${owner}|${expiring}`}
        defaultSort={{ key: "updated", dir: "desc" }}
        onRowClick={(r) => router.push(`/quotes/${r.quote.Id}`)}
        minWidth={900}
        empty="No quotes match"
        filters={
          <>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectCls}>
              <option value="open">Open</option>
              <option value="">All statuses</option>
              {QUOTE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)} className={selectCls}>
              <option value="all">All owners</option>
              <option value="mine">My quotes</option>
            </select>
            <select aria-label="Expiration" value={expiring} onChange={(e) => setExpiring(e.target.value as Expiring)} className={selectCls}>
              <option value="">Any expiration</option>
              <option value="7">Expiring in 7 days</option>
              <option value="30">Expiring in 30 days</option>
              <option value="expired">Expired</option>
            </select>
          </>
        }
        actions={
          <>
            <ExportCsvButton exportId="quotes" columns={CSV} rows={all} filteredRows={rows} filename="quotes.csv" size="sm" title="Export quotes" />
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              New quote
            </Button>
          </>
        }
      />
      <QuoteDrawer open={creating} onOpenChange={setCreating} />
    </div>
  );
}
