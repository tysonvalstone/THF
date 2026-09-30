"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { USERS, USER_BY_ID } from "@/data/reference/users";
import { fmtDay, fmtTime, searchCalls } from "@/lib/call-desk";
import { CALL_TYPES, type Call, type CallNotes, type CallType } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CallDetail } from "./call-detail";
import { CallTypeTag, SentimentTag, Tag, selectCls } from "./parts";
import { useCallScope, type CallScope } from "./use-call-desk";

interface Row {
  call: Call;
  account: string;
  rep: string;
  snippets: string[];
}

/** Call Desk → Past calls: completed calls, filterable, with full-text search across transcripts and notes */
export function HistoryView() {
  const { ready, data, asOfISO } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { canSeeTeam, ownsCalls, filter, userId } = useCallScope();
  const [scopeChoice, setScope] = useState<CallScope | null>(null);
  const scope: CallScope = scopeChoice ?? (canSeeTeam && !ownsCalls ? "team" : "mine");
  const [rep, setRep] = useState("");
  const [account, setAccount] = useState("");
  const [type, setType] = useState<"" | CallType>("");
  const [sentiment, setSentiment] = useState<"" | CallNotes["sentiment"] | "pending">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const open = params.get("call");

  const base = useMemo(() => {
    const today = asOfISO;
    const acct = account.trim().toLowerCase();
    const names = new Map(data.accounts.map((a) => [a.Id, a.Name]));
    return data.calls.filter(
      (c) =>
        (c.Status === "Completed" || (c.Status === "Canceled" && c.Start.slice(0, 10) <= today)) &&
        filter(scope)(c) &&
        (!rep || c.OwnerId === rep) &&
        (!type || c.CallType === type) &&
        (!sentiment || (sentiment === "pending" ? c.NotesStatus !== "Saved" : c.Notes?.sentiment === sentiment)) &&
        (!from || c.Start.slice(0, 10) >= from) &&
        (!to || c.Start.slice(0, 10) <= to) &&
        (!acct || (names.get(c.AccountId) ?? "").toLowerCase().includes(acct)),
    );
  }, [data.calls, data.accounts, filter, scope, rep, type, sentiment, from, to, account, asOfISO]);

  const rows: Row[] = useMemo(() => {
    const q = query.trim();
    if (q.length >= 2) {
      return searchCalls({ ...data, calls: base }, { query: q }).map((h) => ({ call: h.call, account: h.account, rep: USER_BY_ID[h.call.OwnerId]?.Name ?? "", snippets: h.snippets }));
    }
    const names = new Map(data.accounts.map((a) => [a.Id, a.Name]));
    return base.map((c) => ({ call: c, account: names.get(c.AccountId) ?? "", rep: USER_BY_ID[c.OwnerId]?.Name ?? "", snippets: [] }));
  }, [base, query, data]);

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("call", id);
    else next.delete("call");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  const openCall = open ? data.calls.find((c) => c.Id === open) : undefined;

  if (!ready) return <Skeleton className="h-[480px]" />;

  const team = scope === "team";
  const columns: Column<Row>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (r) => r.call.Start,
      cell: (r) => (
        <span className="whitespace-nowrap tabular">
          {fmtDay(r.call.Start.slice(0, 10))}
          <span className="block text-xs text-muted-foreground">{fmtTime(r.call.Start.slice(11, 16))}</span>
        </span>
      ),
    },
    {
      key: "account",
      header: "Account",
      sortValue: (r) => r.account,
      cell: (r) => (
        <div className="max-w-[420px] min-w-[180px]">
          <Link href={`/accounts/${r.call.AccountId}`} className="block truncate font-medium hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.account}
          </Link>
          <LocalChangeTag id={r.call.Id} />
          {r.snippets.length > 0 ? (
            <p className="truncate text-xs text-muted-foreground" title={r.snippets.join("\n")}>
              {r.snippets[0]}
            </p>
          ) : (
            r.call.Notes && <p className="truncate text-xs text-muted-foreground">{r.call.Notes.summary.split("\n")[1] ?? r.call.Notes.summary}</p>
          )}
        </div>
      ),
    },
    { key: "type", header: "Type", sortValue: (r) => r.call.CallType, cell: (r) => <CallTypeTag type={r.call.CallType} /> },
    ...(team ? [{ key: "rep", header: "Rep", sortValue: (r: Row) => r.rep, hideBelow: "md" as const, cell: (r: Row) => <span className="whitespace-nowrap">{r.rep}</span> }] : []),
    {
      key: "sentiment",
      header: "Sentiment",
      sortValue: (r) => r.call.Notes?.sentiment ?? "",
      cell: (r) => (r.call.Status === "Canceled" ? <Tag tone="muted">Canceled</Tag> : r.call.Notes ? <SentimentTag sentiment={r.call.Notes.sentiment} /> : <Tag tone="warn">Notes pending</Tag>),
    },
    {
      key: "next",
      header: "Next steps",
      hideBelow: "lg",
      cell: (r) => <span className="text-xs text-muted-foreground">{r.call.Notes?.nextSteps.length ?? 0}</span>,
      sortValue: (r) => r.call.Notes?.nextSteps.length ?? 0,
    },
  ];

  const input = "h-8 rounded-md border border-input bg-card px-2 text-sm";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search transcripts and notes" aria-label="Search transcripts and notes" className={`${input} w-full pl-8`} />
        </div>
        <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="Account" aria-label="Account" className={`${input} w-40`} />
        {canSeeTeam && (
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Whose calls">
            {(["mine", "team"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => (setScope(s), setRep(""))}
                className={`rounded-sm px-2.5 py-0.5 text-sm ${scope === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {s === "mine" ? "My calls" : "Team"}
              </button>
            ))}
          </div>
        )}
        {team && (
          <select className={selectCls} value={rep} onChange={(e) => setRep(e.target.value)} aria-label="Rep">
            <option value="">All reps</option>
            {USERS.slice(4).map((u) => (
              <option key={u.Id} value={u.Id}>
                {u.Name}
              </option>
            ))}
          </select>
        )}
        <select className={selectCls} value={type} onChange={(e) => setType(e.target.value as CallType | "")} aria-label="Call type">
          <option value="">All types</option>
          {CALL_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className={selectCls} value={sentiment} onChange={(e) => setSentiment(e.target.value as typeof sentiment)} aria-label="Sentiment">
          <option value="">Any sentiment</option>
          <option>Positive</option>
          <option>Neutral</option>
          <option>Concerned</option>
          <option value="pending">Notes pending</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} aria-label="From date" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} aria-label="To date" />
        </label>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.call.Id}
        defaultSort={{ key: "date", dir: "desc" }}
        filterKey={`${scope}|${rep}|${type}|${sentiment}|${from}|${to}|${account}|${query}|${userId}`}
        onRowClick={(r) => setOpen(r.call.Id)}
        rowClassName={(r) => (r.call.Id === open ? "bg-accent-soft" : undefined)}
        empty={query ? `No calls mention "${query}"` : "No past calls"}
        minWidth={640}
        caption="Past calls"
      />
      <Sheet open={!!openCall} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[640px]">
          <div className="border-b px-5 py-4 pr-12">
            <SheetTitle className="text-base font-semibold">{openCall?.Subject ?? "Call"}</SheetTitle>
            <SheetDescription className="sr-only">Call notes, transcript and actions</SheetDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{openCall && <CallDetail call={openCall} />}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
