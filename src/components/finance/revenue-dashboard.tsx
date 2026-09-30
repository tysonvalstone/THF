"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { FileDown, Info } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useAuth } from "@/lib/auth";
import { financeSummary, fx, upcomingRenewals, type PeriodKind } from "@/lib/finance/metrics";
import { renewalsAtRisk } from "@/lib/success/health";
import { agingBuckets } from "@/lib/billing";
import { fmtDate, fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { userName } from "@/lib/data/selectors";
import { opportunityHref } from "@/lib/links";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ArrWaterfall } from "./arr-waterfall";
import { FinanceGate } from "./shared";

const PERIODS: [PeriodKind, string][] = [
  ["month", "Month"],
  ["quarter", "Quarter"],
  ["ytd", "Year to date"],
];

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

function Kpi({ label, value, sub, tip, tone }: { label: string; value: string; sub?: string; tip: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-md border bg-card px-4 py-3">
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`About ${label}`} className="text-muted-foreground/70 hover:text-foreground">
              <Info className="size-3" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64">{tip}</TooltipContent>
        </Tooltip>
      </p>
      <p className="mt-1 text-2xl font-semibold tabular">{value}</p>
      <p className={cn("mt-0.5 h-4 text-xs tabular", tone === "good" ? "text-status-good" : tone === "bad" ? "text-status-critical" : "text-muted-foreground")}>{sub ?? ""}</p>
    </div>
  );
}

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-md border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Bookings, billings and revenue side by side, one accent, direct labels */
function FlowBars({ rows }: { rows: { label: string; value: number; sub: string; tip: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div>
      <p className="h-5 text-xs text-muted-foreground">{hover !== null ? rows[hover].tip : " "}</p>
      <div className="mt-1 grid grid-cols-3 items-end gap-4" onMouseLeave={() => setHover(null)} role="img" aria-label={rows.map((r) => `${r.label} ${fmtMoney(r.value)}`).join(", ")}>
        {rows.map((r, i) => (
          <div key={r.label} className="flex flex-col items-center gap-1" onMouseEnter={() => setHover(i)}>
            <span className="text-sm font-semibold tabular">{fmtMoney(r.value)}</span>
            <div className="flex h-32 w-full items-end justify-center border-b">
              <div className={cn("w-10 rounded-t-[3px] bg-primary transition-[height] duration-500", hover !== null && hover !== i && "opacity-50")} style={{ height: `${Math.max(1, (r.value / max) * 100)}%` }} />
            </div>
            <span className="text-xs font-medium">{r.label}</span>
            <span className="text-[11px] text-muted-foreground tabular">{r.sub}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RevenueDashboard() {
  return (
    <FinanceGate>
      <Dashboard />
    </FinanceGate>
  );
}

function Dashboard() {
  const { data, asOf, ready, lightningBaseUrl } = useStore();
  const { session } = useAuth();
  const [kind, setKind] = useState<PeriodKind>("month");
  const [busy, setBusy] = useState(false);
  const s = useMemo(() => financeSummary(data, asOf, kind), [data, asOf, kind]);
  const renewals = useMemo(() => {
    const upcoming = upcomingRenewals(data, asOf);
    let risk: { id: string; accountId: string; name: string; endDate: string; days: number; arr: number; reason: string }[];
    try {
      risk = renewalsAtRisk(data, asOf).map((r) => ({
        id: r.contract.Id,
        accountId: r.account.Id,
        name: r.account.Name,
        endDate: r.contract.EndDate,
        days: r.daysToEnd,
        arr: r.arr * fx(r.contract.CurrencyIsoCode),
        reason: `${r.health.band} ${r.health.score}`,
      }));
    } catch {
      risk = upcoming
        .filter((r) => r.risks.length)
        .map((r) => ({ id: r.contract.Id, accountId: r.accountId, name: data.accounts.find((a) => a.Id === r.accountId)?.Name ?? r.accountId, endDate: r.endDate, days: r.daysLeft, arr: r.arr, reason: r.risks.join(", ") }));
    }
    return { upcomingArr: upcoming.reduce((a, r) => a + r.arr, 0), upcomingCount: upcoming.length, risk };
  }, [data, asOf]);
  const overdue = useMemo(() => agingBuckets(data, asOf, fx).filter((b) => b.key !== "current"), [data, asOf]);

  if (!ready) return <Skeleton className="h-[640px]" />;

  const board = async () => {
    setBusy(true);
    try {
      const { generateBoardReport } = await import("@/lib/finance/board-report");
      const r = await generateBoardReport(data, asOf, { preparedBy: session?.name });
      toast.success(`${r.filename} downloaded`);
    } catch (e) {
      toast.error(`Couldn't build the Board Report: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const arrChange = s.arrYearAgo ? (s.arr - s.arrYearAgo) / s.arrYearAgo : null;
  const riskArr = renewals.risk.reduce((a, r) => a + r.arr, 0);
  const overdueTotal = overdue.reduce((a, b) => a + b.amount, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Revenue</h1>
          <p className="text-sm text-muted-foreground">
            {s.period.label} · through {fmtDate(asOf)} · USD
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5 text-sm" role="tablist" aria-label="Period">
            {PERIODS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={kind === k}
                onClick={() => setKind(k)}
                className={cn("rounded-[4px] px-2.5 py-1", kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={board} disabled={busy} title="Monthly PDF for the current month">
            <FileDown />
            {busy ? "Building…" : "Board Report"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="ARR"
          value={fmtMoney(s.arr)}
          sub={arrChange === null ? undefined : `${arrChange >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(arrChange * 100))}% vs. a year ago`}
          tone={arrChange === null ? undefined : arrChange >= 0 ? "good" : "bad"}
          tip="Annual recurring revenue of contracts in force today, with yearly price increases applied."
        />
        <Kpi label="MRR" value={fmtMoney(s.mrr)} tip="Monthly recurring revenue: ARR ÷ 12." />
        <Kpi label="NRR" value={pct(s.nrr)} sub="Trailing 12 months" tip="Net revenue retention: today's ARR from customers who had ARR a year ago ÷ their ARR then." />
        <Kpi label="GRR" value={pct(s.grr)} sub="Trailing 12 months" tip="Gross revenue retention: like NRR, but expansion is not counted." />
        <Kpi label="ACV" value={s.acv === null ? "–" : fmtMoney(s.acv)} sub="Signed, last 12 months" tip="Average annual contract value: (TCV − one-time fees) ÷ years, contracts signed in the last 12 months." />
        <Kpi
          label="Payback"
          value={s.payback.months === null ? "–" : `${s.payback.months.toFixed(1)} mo`}
          sub={`${s.payback.reps} reps · ${fmtMoney(s.payback.smCost)} S&M`}
          tip="Months of gross margin on new and expansion ARR to recover sales & marketing cost (proxy: reps × fully loaded cost). See Help for assumptions."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="ARR bridge" className="lg:col-span-3" action={<span className="text-xs text-muted-foreground tabular">{fmtMoney(s.bridge.opening)} → {fmtMoney(s.bridge.closing)}</span>}>
          <ArrWaterfall bridge={s.bridge} periodLabel={s.period.label} />
        </Card>
        <Card title="Bookings, billings and revenue" className="lg:col-span-2">
          <FlowBars
            rows={[
              { label: "Bookings", value: s.bookings.tcv, sub: `${s.bookings.count} signed`, tip: `TCV of contracts signed · first-year value ${fmtMoney(s.bookings.firstYear)}` },
              { label: "Billings", value: s.billings.amount, sub: `${s.billings.count} invoices`, tip: "Invoices issued (not Draft or Void)" },
              { label: "Revenue", value: s.revenue, sub: "Recognised", tip: "Subscription earned per day; one-time fees at go-live" },
            ]}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground" title="Billed but not yet earned, today">
                Deferred revenue
              </dt>
              <dd className="font-semibold tabular">{fmtMoney(s.deferred)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground" title="Payments received in the period">
                Cash collected
              </dt>
              <dd className="font-semibold tabular">
                {fmtMoney(s.cash.amount)} <span className="text-xs font-normal text-muted-foreground">· {s.cash.count} payments</span>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top wins" action={<span className="text-xs text-muted-foreground">{s.period.label}</span>}>
          {s.topWins.length ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Top wins</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1.5 font-medium">Opportunity</th>
                  <th className="hidden pb-1.5 font-medium xl:table-cell">Owner</th>
                  <th className="pb-1.5 font-medium">Closed</th>
                  <th className="pb-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {s.topWins.map((o) => (
                  <tr key={o.Id} title={`${o.Name} · ${userName(o.OwnerId)}`}>
                    <td className="max-w-0 truncate py-1.5 pr-2">
                      <Link href={opportunityHref(o.Id, lightningBaseUrl)} className="hover:underline">
                        {o.Name}
                      </Link>
                    </td>
                    <td className="hidden py-1.5 pr-2 whitespace-nowrap text-muted-foreground xl:table-cell">{userName(o.OwnerId)}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground tabular">{fmtShortDate(o.CloseDate)}</td>
                    <td className="py-1.5 text-right tabular">{fmtMoney(o.Amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No wins in this period</p>
          )}
        </Card>
        <Card
          title="Renewals and at-risk ARR"
          action={
            <span className="text-xs text-muted-foreground tabular">
              {renewals.upcomingCount} renewing in 120 days · {fmtMoney(renewals.upcomingArr)}
            </span>
          }
        >
          <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">At-risk ARR</p>
              <p className={cn("font-semibold tabular", riskArr > 0 && "text-status-critical")}>{fmtMoney(riskArr)}</p>
            </div>
            <Link href="/finance/invoices?aging=overdue" className="rounded-md hover:bg-muted/60">
              <p className="text-xs text-muted-foreground">Overdue receivables</p>
              <p className="font-semibold tabular">
                {fmtMoney(overdueTotal)} <span className="text-xs font-normal text-muted-foreground">· {overdue.reduce((a, b) => a + b.count, 0)} invoices</span>
              </p>
            </Link>
          </div>
          {renewals.risk.length ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Renewals at risk</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-1.5 font-medium">Account</th>
                  <th className="pb-1.5 font-medium">Ends</th>
                  <th className="pb-1.5 text-right font-medium">ARR</th>
                  <th className="hidden pb-1.5 pl-3 font-medium sm:table-cell">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {renewals.risk.slice(0, 6).map((r) => (
                  <tr key={r.id} title={`${r.name} · ${r.reason}`}>
                    <td className="max-w-0 truncate py-1.5 pr-2">
                      <Link href={`/accounts/${r.accountId}`} className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap text-muted-foreground tabular">
                      {fmtShortDate(r.endDate)}
                    </td>
                    <td className="py-1.5 text-right tabular">{fmtMoney(r.arr)}</td>
                    <td className="hidden py-1.5 pl-3 text-xs whitespace-nowrap text-muted-foreground sm:table-cell">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No renewals at risk</p>
          )}
        </Card>
      </div>
    </div>
  );
}
