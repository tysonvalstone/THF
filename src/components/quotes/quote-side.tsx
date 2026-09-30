"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { userName } from "@/lib/data/selectors";
import type { Quote } from "@/types/salesforce";
import { fmtDate, fmtShortDate } from "@/lib/dates";
import { productMap } from "@/lib/quotes/catalog";
import { computeTotals, fmtCurrency, fmtPctValue, paymentSchedule } from "@/lib/quotes/pricing";
import { POLICY_RULES, approvalFor } from "@/lib/quotes/approvals";
import { boardCheck, quoteLines, repriceChanges } from "@/lib/quotes/lifecycle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NumCell } from "./line-items";

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-md border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Row({ label, value, strong, muted }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1 text-sm", strong && "font-semibold", muted && "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="text-right tabular">{value}</dd>
    </div>
  );
}

export function useQuoteTotals(q: Quote) {
  const { data } = useStore();
  return useMemo(() => computeTotals(q, quoteLines(data, q.Id), productMap(data.products)), [data, q]);
}

export function TotalsCard({ quote: q, editable }: { quote: Quote; editable: boolean }) {
  const { data } = useStore();
  const { run } = useCrud();
  const t = useQuoteTotals(q);
  const ccy = data.pricebooks.find((b) => b.Id === q.Pricebook2Id)?.CurrencyIsoCode ?? "USD";
  const money = (n: number) => fmtCurrency(n, ccy);
  const [all, setAll] = useState(false);
  const schedule = paymentSchedule(t, { start: q.Start_Date__c, termMonths: q.Contract_Term_Months__c, frequency: q.Billing_Frequency__c, taxRate: q.Tax_Rate__c });
  const shown = all ? schedule : schedule.slice(0, 4);
  const setHeader = (changes: Partial<Quote>) => run([{ op: "update", object: "Quote", id: q.Id, changes: repriceChanges(q, quoteLines(data, q.Id), data, changes) }]);

  return (
    <Card title="Totals">
      <dl>
        <Row label="Recurring, list" value={money(t.recurringList)} muted />
        {t.recurringList !== t.recurringNet && <Row label="Line discounts" value={`−${money(t.recurringList - t.recurringNet)}`} muted />}
        <Row
          label={
            <span className="flex items-center gap-2">
              Header discount
              {editable ? (
                <NumCell key={q.Discount__c} value={q.Discount__c ?? 0} max={100} step={0.5} suffix="%" label="Header discount" onCommit={(n) => setHeader({ Discount__c: n })} className="w-16" />
              ) : (
                <span className="text-muted-foreground">{fmtPctValue(q.Discount__c ?? 0)}</span>
              )}
            </span>
          }
          value={t.headerDiscount ? `−${money(t.headerDiscount)}` : "—"}
          muted={!t.headerDiscount}
        />
        <Row label="Annual recurring (ARR)" value={money(t.arr)} strong />
        <Row label="One-time" value={money(t.oneTime)} />
        <Row
          label={
            <span className="flex items-center gap-2">
              Tax
              {editable ? (
                <NumCell key={q.Tax_Rate__c} value={q.Tax_Rate__c ?? 0} max={30} step={0.25} suffix="%" label="Tax rate" onCommit={(n) => setHeader({ Tax_Rate__c: n })} className="w-16" />
              ) : (
                <span className="text-muted-foreground">{fmtPctValue(q.Tax_Rate__c ?? 0)}</span>
              )}
            </span>
          }
          value={t.tax ? money(t.tax) : "—"}
        />
        <div className="my-1.5 border-t" />
        <Row label="First-year total" value={money(t.firstYear)} strong />
        <Row label={`TCV · ${q.Contract_Term_Months__c} months`} value={money(t.tcv)} strong />
        {t.discountTotal > 0 && <Row label="Below list, first year" value={`${money(t.discountTotal)} · ${fmtPctValue(Math.round((t.discountTotal / Math.max(1, t.listTotal)) * 1000) / 10)}`} muted />}
      </dl>

      <div className="mt-3 border-t pt-3">
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Payment schedule · {q.Billing_Frequency__c.toLowerCase()} · {q.Payment_Terms__c}
        </p>
        <table className="w-full text-xs">
          <caption className="sr-only">Payment schedule</caption>
          <tbody className="divide-y">
            {shown.map((i) => (
              <tr key={i.n}>
                <td className="py-1 text-muted-foreground tabular">{i.n}</td>
                <td className="py-1 tabular">{fmtDate(i.date)}</td>
                <td className="py-1 text-right tabular">{money(i.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-medium">
              <td colSpan={2} className="py-1">
                {schedule.length} invoice{schedule.length === 1 ? "" : "s"}
              </td>
              <td className="py-1 text-right tabular">{money(schedule.reduce((s, i) => s + i.amount, 0))}</td>
            </tr>
          </tfoot>
        </table>
        {schedule.length > 4 && (
          <Button variant="link" size="xs" className="px-0" onClick={() => setAll((x) => !x)}>
            {all ? "Show fewer" : `Show all ${schedule.length}`}
          </Button>
        )}
      </div>
    </Card>
  );
}

const LEVEL_CLS = {
  auto: "border-primary/30 bg-accent-soft text-primary",
  manager: "border-amber-300 bg-amber-50 text-amber-800",
  admin: "border-red-200 bg-red-50 text-status-critical",
} as const;

export function ApprovalCard({ quote: q }: { quote: Quote }) {
  const { data } = useStore();
  const t = useQuoteTotals(q);
  const req = approvalFor(t, data.pricebooks.find((b) => b.Id === q.Pricebook2Id)?.CurrencyIsoCode ?? "USD");
  const approvedBy = q.Approved_By__c ? userName(q.Approved_By__c) : null;
  let state: React.ReactNode = null;
  if (q.Status === "In Review") state = `Submitted · waiting for ${req.approver.toLowerCase()}`;
  else if (q.Status === "Rejected") state = `Rejected${approvedBy ? ` by ${approvedBy}` : ""}${q.Approved_Date__c ? ` on ${fmtShortDate(q.Approved_Date__c)}` : ""}`;
  else if (q.Approved_Date__c && ["Approved", "Sent", "Accepted", "Declined", "Expired"].includes(q.Status))
    state = approvedBy ? `Approved by ${approvedBy} on ${fmtShortDate(q.Approved_Date__c)}` : `Auto-approved on ${fmtShortDate(q.Approved_Date__c)}`;
  else if (q.Status === "Draft") state = req.level === "auto" ? "Approves on submit" : "Not submitted";

  return (
    <Card title="Approval">
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex h-5 items-center rounded-sm border px-1.5 text-[11px] font-medium", LEVEL_CLS[req.level])}>{req.level === "auto" ? "Within rep limit" : `Needs ${req.approver.toLowerCase()}`}</span>
          <span className="text-xs text-muted-foreground tabular">Max discount {fmtPctValue(req.discount)}</span>
        </div>
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {req.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          {req.reasonRequired && <li>Approver enters a reason</li>}
        </ul>
        {state && <p className="text-sm">{state}</p>}
        {q.Approval_Reason__c && <p className="rounded-md bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700">{q.Approval_Reason__c}</p>}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Discount policy</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-muted-foreground">
            {POLICY_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      </div>
    </Card>
  );
}

export function BoardCard({ quote: q, onPacket, busy }: { quote: Quote; onPacket: () => void; busy: boolean }) {
  const { data, asOf } = useStore();
  const b = boardCheck(data, q, asOf);
  if (!b.needsBoard) return null;
  return (
    <Card title="Board approval">
      <div className="space-y-2 text-sm">
        <Row label="Next board meeting" value={b.meeting ? fmtDate(b.meeting) : "Not scheduled"} />
        <Row label="Quote valid until" value={fmtDate(q.ExpirationDate)} />
        {b.expiresBefore && <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">Expires before the board meets. Extend it in Edit header.</p>}
        <Button variant="outline" size="sm" className="w-full" onClick={onPacket} disabled={busy}>
          {busy ? "Building…" : "Board packet (PDF)"}
        </Button>
      </div>
    </Card>
  );
}

export function ActivityCard({ quote: q }: { quote: Quote }) {
  const { data } = useStore();
  const tasks = data.tasks.filter((t) => t.WhatId === q.OpportunityId && t.Subject.includes(q.QuoteNumber));
  const items = [
    { date: q.CreatedDate, label: `Created by ${userName(q.OwnerId)}` },
    q.Approved_Date__c && q.Status !== "Rejected" ? { date: q.Approved_Date__c, label: q.Approved_By__c ? `Approved by ${userName(q.Approved_By__c)}` : "Auto-approved" } : null,
    q.Status === "Rejected" && q.Approved_Date__c ? { date: q.Approved_Date__c, label: `Rejected${q.Approved_By__c ? ` by ${userName(q.Approved_By__c)}` : ""}` } : null,
    q.Sent_Date__c ? { date: q.Sent_Date__c, label: "Sent" } : null,
    q.Accepted_Date__c ? { date: q.Accepted_Date__c, label: q.Status === "Accepted" ? "Accepted" : "Accepted (earlier version)" } : null,
    ...tasks.filter((t) => !t.Subject.startsWith("Sent quote")).map((t) => ({ date: t.CreatedDate, label: t.Subject })),
  ]
    .filter((x): x is { date: string; label: string } => !!x)
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Card title="Activity">
      <ol className="space-y-1.5 text-sm">
        {items.map((i) => (
          <li key={`${i.date}${i.label}`} className="flex justify-between gap-3">
            <span>{i.label}</span>
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular">{fmtShortDate(i.date)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
