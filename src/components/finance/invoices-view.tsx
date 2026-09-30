"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { ColumnDef } from "@/lib/columns";
import type { Invoice, InvoiceStatus, Payment } from "@/types/salesforce";
import { INVOICE_STATUSES } from "@/types/salesforce";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useAuth, useUserId } from "@/lib/auth";
import { can } from "@/lib/roles";
import {
  AGING_KEYS,
  AGING_LABEL,
  agingKey,
  balanceOf,
  daysOverdue,
  DUNNING_SEQUENCE,
  effectiveStatus,
  isOpen,
  recordPaymentMutations,
  renderReminder,
  reminderStep,
  round2,
  sendInvoiceMutations,
  sendReminderMutations,
  voidInvoiceMutations,
  type AgingKey,
  type ReminderTemplate,
} from "@/lib/billing";
import { fx } from "@/lib/finance/metrics";
import { sequencesCollection } from "@/components/sequences/sequence-store";
import { PREBUILT_SEQUENCES } from "@/data/seed/sequences";
import { fmtDate, fmtShortDate, toISODate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { DataTable, type Column } from "@/components/shared/data-table";
import { RecordDrawer, type FieldDef } from "@/components/shared/record-drawer";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ExportCsvButton } from "@/components/shared/column-picker";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FinanceGate, InvoiceStatusPill, selectCls, Tag, useNetSuite } from "./shared";

interface Row {
  inv: Invoice;
  account: string;
  accountId: string;
  contract: string;
  status: InvoiceStatus;
  days: number;
  balance: number;
  external: boolean;
}

type StatusFilter = "" | "open" | InvoiceStatus;
type AgingFilter = "" | "overdue" | AgingKey;

const money = (n: number, ccy: string) => n.toLocaleString("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 2 });
const METHODS: Payment["Method"][] = ["ACH", "Check", "Wire", "Card"];

const CSV: ColumnDef<Row>[] = [
  { key: "number", label: "Invoice", value: (r) => r.inv.InvoiceNumber, required: true },
  { key: "account", label: "Account", value: (r) => r.account },
  { key: "contract", label: "Contract", value: (r) => r.contract },
  { key: "periodStart", label: "Period start", type: "date", value: (r) => r.inv.PeriodStart },
  { key: "periodEnd", label: "Period end", type: "date", value: (r) => r.inv.PeriodEnd },
  { key: "issue", label: "Issue date", type: "date", value: (r) => r.inv.IssueDate },
  { key: "due", label: "Due date", type: "date", value: (r) => r.inv.DueDate },
  { key: "recurring", label: "Recurring", type: "currency", value: (r) => r.inv.Recurring, defaultOn: false },
  { key: "oneTime", label: "One-time", type: "currency", value: (r) => r.inv.OneTime, defaultOn: false },
  { key: "total", label: "Total", type: "currency", value: (r) => r.inv.Total },
  { key: "paid", label: "Paid", type: "currency", value: (r) => r.inv.AmountPaid },
  { key: "balance", label: "Balance", type: "currency", value: (r) => r.balance },
  { key: "currency", label: "Currency", value: (r) => r.inv.CurrencyIsoCode },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "daysOverdue", label: "Days overdue", type: "number", value: (r) => r.days },
  { key: "harvest", label: "Harvest terms", value: (r) => (r.inv.HarvestTerms ? "Yes" : "No") },
  { key: "reminders", label: "Reminders sent", type: "number", value: (r) => r.inv.RemindersSent, defaultOn: false },
  { key: "source", label: "Source", value: (r) => (r.external ? "NetSuite" : "HarvestSignal"), defaultOn: false },
  { key: "id", label: "Invoice Id", value: (r) => r.inv.Id, defaultOn: false },
];

/** Email steps of a "Payment reminders" / dunning sequence, if one exists (else the built-in steps) */
function dunningTemplates(): ReminderTemplate[] {
  const match = (name: string) => /payment reminder|dunning|collection/i.test(name);
  let saved: { name: string; steps: { type: string; subject?: string; body: string }[] }[] = [];
  try {
    saved = sequencesCollection.list();
  } catch {
    saved = [];
  }
  const seq = [...saved, ...PREBUILT_SEQUENCES].find((s) => match(s.name));
  const steps = seq?.steps.filter((s) => s.type === "email" && s.subject).map((s) => ({ subject: s.subject!, body: s.body }));
  return steps?.length ? steps : DUNNING_SEQUENCE.steps;
}

export function InvoicesView() {
  return (
    <FinanceGate>
      <Invoices />
    </FinanceGate>
  );
}

function Invoices() {
  const { data, asOf, ready } = useStore();
  const { role, session } = useAuth();
  const userId = useUserId();
  const { run, update, remove } = useCrud();
  const ns = useNetSuite();
  const params = useSearchParams();
  const editable = can(role, "edit:invoices");

  const [status, setStatus] = useState<StatusFilter>("");
  const [aging, setAging] = useState<AgingFilter>((params.get("aging") as AgingFilter) || "");
  const [harvest, setHarvest] = useState<"" | "yes" | "no">("");
  const [account, setAccount] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Invoice | null>(null);
  const [editFor, setEditFor] = useState<Invoice | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "void" | "delete" | "send"; inv: Invoice } | null>(null);
  const [remindFor, setRemindFor] = useState<Invoice | null>(null);

  const ctx = useMemo(() => ({ data, asOf, userId, senderName: session?.name }), [data, asOf, userId, session?.name]);

  const all = useMemo<Row[]>(() => {
    const accounts = new Map(data.accounts.map((a) => [a.Id, a.Name]));
    const byName = new Map(data.accounts.map((a) => [a.Name.toLowerCase(), a.Id]));
    const contracts = new Map(data.contracts.map((c) => [c.Id, c.ContractNumber]));
    const today = toISODate(asOf);
    const local: Row[] = data.invoices
      .filter((inv) => inv.IssueDate <= today || inv.Status === "Draft")
      .map((inv) => ({
        inv,
        account: accounts.get(inv.AccountId) ?? inv.AccountId,
        accountId: inv.AccountId,
        contract: contracts.get(inv.ContractId) ?? "",
        status: effectiveStatus(inv, asOf),
        days: daysOverdue(inv, asOf),
        balance: inv.Status === "Void" ? 0 : balanceOf(inv),
        external: false,
      }));
    const external: Row[] = ns.invoices.map((inv) => {
      const id = byName.get(inv.CustomerName.toLowerCase()) ?? inv.AccountId;
      const x = { ...inv, AccountId: id };
      return { inv: x, account: accounts.get(id) ?? inv.CustomerName, accountId: id, contract: "", status: effectiveStatus(x, asOf), days: daysOverdue(x, asOf), balance: x.Status === "Void" ? 0 : balanceOf(x), external: true };
    });
    return [...local, ...external];
  }, [data, asOf, ns.invoices]);

  const rows = useMemo(
    () =>
      all.filter((r) => {
        if (status === "open" ? !isOpen(r.inv) : status && r.status !== status) return false;
        if (aging === "overdue" && !(isOpen(r.inv) && r.days > 0)) return false;
        if (aging && aging !== "overdue" && !(isOpen(r.inv) && agingKey(r.days) === aging)) return false;
        if (harvest === "yes" && !r.inv.HarvestTerms) return false;
        if (harvest === "no" && r.inv.HarvestTerms) return false;
        if (account && r.accountId !== account) return false;
        return true;
      }),
    [all, status, aging, harvest, account],
  );

  const buckets = useMemo(() => {
    const b = AGING_KEYS.map((key) => ({ key, label: AGING_LABEL[key], amount: 0, count: 0 }));
    for (const r of all) {
      if (!isOpen(r.inv)) continue;
      const x = b.find((y) => y.key === agingKey(r.days))!;
      x.amount += r.balance * fx(r.inv.CurrencyIsoCode);
      x.count++;
    }
    return b;
  }, [all]);
  const openTotal = buckets.reduce((a, b) => a + b.amount, 0);

  const accountOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of all) m.set(r.accountId, r.account);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);

  const templates = useMemo(() => (remindFor ? dunningTemplates() : DUNNING_SEQUENCE.steps), [remindFor]);

  if (!ready) return <Skeleton className="h-[640px]" />;

  const openRow = openId ? all.find((r) => r.inv.Id === openId) : undefined;

  const actions = (r: Row) => {
    const inv = r.inv;
    if (r.external || !editable) return [];
    const out: { label: string; onClick: () => void; destructive?: boolean }[] = [];
    if (inv.Status === "Draft") {
      out.push({ label: "Send", onClick: () => setConfirm({ kind: "send", inv }) });
      out.push({ label: "Edit draft", onClick: () => setEditFor(inv) });
    }
    if (isOpen(inv)) {
      out.push({ label: "Record payment", onClick: () => setPayFor(inv) });
      out.push({ label: inv.RemindersSent ? `Send reminder (${inv.RemindersSent} sent)` : "Send reminder", onClick: () => setRemindFor(inv) });
    }
    if (inv.Status !== "Void" && inv.Status !== "Paid" && inv.AmountPaid === 0 && inv.Status !== "Draft") out.push({ label: "Void", onClick: () => setConfirm({ kind: "void", inv }), destructive: true });
    if (inv.Status === "Draft") out.push({ label: "Delete draft", onClick: () => setConfirm({ kind: "delete", inv }), destructive: true });
    return out;
  };

  const columns: Column<Row>[] = [
    {
      key: "number",
      header: "Invoice",
      sortValue: (r) => r.inv.InvoiceNumber,
      cell: (r) => (
        <span className="flex items-center gap-1.5 font-medium whitespace-nowrap">
          {r.inv.InvoiceNumber}
          {r.external && (
            <span className="rounded-sm border px-1 text-[10px] font-normal text-muted-foreground" title="Read from NetSuite">
              NS
            </span>
          )}
        </span>
      ),
    },
    {
      key: "account",
      header: "Account",
      sortValue: (r) => r.account,
      cell: (r) => <span className="block max-w-[220px] truncate">{r.account}</span>,
    },
    { key: "contract", header: "Contract", sortValue: (r) => r.contract, cell: (r) => <span className="text-muted-foreground">{r.contract || "–"}</span>, hideBelow: "lg" },
    {
      key: "period",
      header: "Period",
      sortValue: (r) => r.inv.PeriodStart,
      cell: (r) => (
        <span className="whitespace-nowrap text-muted-foreground tabular">
          {r.inv.PeriodStart.slice(0, 4) === r.inv.PeriodEnd.slice(0, 4) ? fmtShortDate(r.inv.PeriodStart) : fmtDate(r.inv.PeriodStart)} – {fmtDate(r.inv.PeriodEnd)}
        </span>
      ),
      hideBelow: "lg",
    },
    { key: "issue", header: "Issued", sortValue: (r) => r.inv.IssueDate, cell: (r) => <span className="whitespace-nowrap tabular">{fmtDate(r.inv.IssueDate)}</span>, hideBelow: "md" },
    { key: "due", header: "Due", sortValue: (r) => r.inv.DueDate, cell: (r) => <span className="whitespace-nowrap tabular">{fmtDate(r.inv.DueDate)}</span> },
    { key: "total", header: "Total", align: "right", sortValue: (r) => r.inv.Total * fx(r.inv.CurrencyIsoCode), cell: (r) => money(r.inv.Total, r.inv.CurrencyIsoCode) },
    { key: "paid", header: "Paid", align: "right", sortValue: (r) => r.inv.AmountPaid, cell: (r) => <span className="text-muted-foreground">{money(r.inv.AmountPaid, r.inv.CurrencyIsoCode)}</span>, hideBelow: "md" },
    {
      key: "status",
      header: "Status",
      sortValue: (r) => INVOICE_STATUSES.indexOf(r.status),
      cell: (r) => (
        <span className="flex items-center gap-1">
          <InvoiceStatusPill status={r.status} />
          {r.inv.HarvestTerms && <Tag title="Harvest payment terms: due Dec 15 after harvest">Harvest</Tag>}
        </span>
      ),
    },
    {
      key: "days",
      header: "Days overdue",
      align: "right",
      sortValue: (r) => r.days,
      cell: (r) => (r.days > 0 ? <span className={cn(r.days > 60 && "font-medium text-status-critical")}>{r.days}</span> : <span className="text-muted-foreground">–</span>),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      cell: (r) => {
        const acts = actions(r);
        if (!acts.length) return null;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7" aria-label={`Actions for ${r.inv.InvoiceNumber}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {acts.map((a, i) => (
                  <span key={a.label}>
                    {a.destructive && i > 0 && !acts[i - 1].destructive && <DropdownMenuSeparator />}
                    <DropdownMenuItem onSelect={a.onClick} className={cn(a.destructive && "text-status-critical focus:text-status-critical")}>
                      {a.label}
                    </DropdownMenuItem>
                  </span>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const doConfirm = () => {
    if (!confirm) return;
    const { kind, inv } = confirm;
    if (kind === "delete") remove("Invoice", inv.Id, `Draft ${inv.InvoiceNumber}`);
    if (kind === "void") run(voidInvoiceMutations(inv), `${inv.InvoiceNumber} voided`, { undoable: true });
    if (kind === "send") run(sendInvoiceMutations(ctx, inv), `${inv.InvoiceNumber} sent · email logged`, { undoable: true });
    if (kind !== "send") setOpenId(null);
  };

  const payFields: FieldDef[] = [
    { name: "amount", label: "Amount", type: "currency", required: true, min: 0.01, step: 0.01, validate: (v) => (payFor && Number(v) > balanceOf(payFor) + 0.005 ? `At most ${money(balanceOf(payFor), payFor.CurrencyIsoCode)}` : null) },
    { name: "date", label: "Payment date", type: "date", required: true },
    { name: "method", label: "Method", type: "select", required: true, options: METHODS.map((m) => ({ value: m, label: m })) },
    { name: "reference", label: "Reference", placeholder: "Check number or remittance id" },
  ];

  const editFields: FieldDef[] = [
    { name: "IssueDate", label: "Issue date", type: "date", required: true },
    { name: "DueDate", label: "Due date", type: "date", required: true, validate: (v, all) => (String(v) < String(all.IssueDate) ? "On or after the issue date" : null) },
    { name: "PeriodStart", label: "Period start", type: "date", required: true },
    { name: "PeriodEnd", label: "Period end", type: "date", required: true, validate: (v, all) => (String(v) < String(all.PeriodStart) ? "On or after the period start" : null) },
    { name: "Recurring", label: "Recurring", type: "currency", required: true, min: 0, step: 0.01 },
    { name: "OneTime", label: "One-time", type: "currency", min: 0, step: 0.01 },
    { name: "Tax", label: "Tax", type: "currency", min: 0, step: 0.01 },
    { name: "HarvestTerms", label: "Harvest payment terms", type: "checkbox" },
  ];

  const reminder = remindFor ? renderReminder(ctx, remindFor, reminderStep(remindFor, templates)) : null;
  const filterKey = `${status}|${aging}|${harvest}|${account}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold">Invoices</h1>
          {ns.mode === "live" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-5 items-center gap-1 rounded-sm border border-primary/40 bg-accent-soft px-1.5 text-[11px] font-medium text-primary">
                  <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                  Live NetSuite
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {ns.invoices.length} invoices read from NetSuite (read-only){ns.loadedAt ? ` · ${new Date(ns.loadedAt).toLocaleTimeString()}` : ""}
              </TooltipContent>
            </Tooltip>
          )}
          {ns.error && (
            <span className="inline-flex h-5 items-center rounded-sm border border-red-200 px-1.5 text-[11px] text-status-critical" title={ns.error}>
              NetSuite unavailable
            </span>
          )}
        </div>
      </div>

      <section className="rounded-md border bg-card" aria-labelledby="aging-title">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h2 id="aging-title" className="text-sm font-semibold">
            Aging
          </h2>
          <span className="text-xs text-muted-foreground tabular">
            Open {fmtMoney(openTotal)} · {buckets.reduce((a, b) => a + b.count, 0)} invoices · USD
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-5">
          {buckets.map((b) => {
            const on = aging === b.key;
            return (
              <button
                key={b.key}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setAging(on ? "" : b.key);
                  if (!on) setStatus("");
                }}
                className={cn("rounded-md border px-3 py-2 text-left hover:border-primary/40", on && "border-primary bg-accent-soft")}
                title={b.key === "current" ? "Open, not yet due" : `${b.label} days past due`}
              >
                <span className="block text-xs text-muted-foreground">{b.key === "current" ? b.label : `${b.label} days`}</span>
                <span className={cn("block text-lg font-semibold tabular", b.key === "90+" && b.amount > 0 && "text-status-critical")}>{fmtMoney(b.amount)}</span>
                <span className="block text-[11px] text-muted-foreground tabular">
                  {b.count} invoice{b.count === 1 ? "" : "s"} · {openTotal ? Math.round((b.amount / openTotal) * 100) : 0}%
                </span>
                <span className="mt-1.5 block h-1 rounded-full bg-muted" aria-hidden>
                  <span className={cn("block h-1 rounded-full", b.key === "current" ? "bg-slate-400" : "bg-primary")} style={{ width: `${openTotal ? (b.amount / openTotal) * 100 : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.inv.Id}
        caption="Invoices"
        search={{ placeholder: "Search invoices", text: (r) => `${r.inv.InvoiceNumber} ${r.account} ${r.contract}` }}
        filterKey={filterKey}
        defaultSort={{ key: "issue", dir: "desc" }}
        onRowClick={(r) => setOpenId(r.inv.Id)}
        minWidth={980}
        empty="No invoices match"
        filters={
          <>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectCls}>
              <option value="">All statuses</option>
              <option value="open">Open (unpaid)</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select aria-label="Aging" value={aging} onChange={(e) => setAging(e.target.value as AgingFilter)} className={selectCls}>
              <option value="">Any aging</option>
              <option value="overdue">Overdue</option>
              {AGING_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k === "current" ? AGING_LABEL[k] : `${AGING_LABEL[k]} days`}
                </option>
              ))}
            </select>
            <select aria-label="Payment terms" value={harvest} onChange={(e) => setHarvest(e.target.value as typeof harvest)} className={selectCls}>
              <option value="">All terms</option>
              <option value="yes">Harvest terms</option>
              <option value="no">Standard terms</option>
            </select>
            <select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)} className={cn(selectCls, "max-w-[200px]")}>
              <option value="">All accounts</option>
              {accountOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </>
        }
        actions={<ExportCsvButton exportId="invoices" columns={CSV} rows={all} filteredRows={rows} filename="invoices.csv" size="sm" title="Export invoices" />}
      />

      <InvoiceSheet
        row={openRow}
        payments={openRow ? (openRow.external ? ns.payments : data.payments).filter((p) => p.InvoiceId === openRow.inv.Id) : []}
        actions={openRow ? actions(openRow) : []}
        onOpenChange={(o) => !o && setOpenId(null)}
      />

      <RecordDrawer
        open={!!payFor}
        onOpenChange={(o) => !o && setPayFor(null)}
        title={payFor ? `Record payment · ${payFor.InvoiceNumber}` : "Record payment"}
        description={payFor ? `Balance ${money(balanceOf(payFor), payFor.CurrencyIsoCode)}` : undefined}
        fields={payFields}
        initial={{ amount: payFor ? balanceOf(payFor) : 0, date: toISODate(asOf), method: "ACH", reference: "" }}
        submitLabel="Record payment"
        onSubmit={(v) => {
          if (!payFor) return;
          const m = recordPaymentMutations(ctx, payFor, { amount: Number(v.amount), date: String(v.date), method: v.method as Payment["Method"], reference: String(v.reference ?? "") });
          if (!m.length) return "Payment can't be recorded on this invoice";
          const full = round2(payFor.AmountPaid + Number(v.amount)) >= payFor.Total - 0.005;
          run(m, full ? `${payFor.InvoiceNumber} paid in full` : `Payment recorded on ${payFor.InvoiceNumber}`, { undoable: true });
          setPayFor(null);
        }}
      />

      <RecordDrawer
        open={!!editFor}
        onOpenChange={(o) => !o && setEditFor(null)}
        title={editFor ? `Edit draft · ${editFor.InvoiceNumber}` : "Edit draft"}
        fields={editFields}
        initial={editFor ? { IssueDate: editFor.IssueDate, DueDate: editFor.DueDate, PeriodStart: editFor.PeriodStart, PeriodEnd: editFor.PeriodEnd, Recurring: editFor.Recurring, OneTime: editFor.OneTime, Tax: editFor.Tax, HarvestTerms: editFor.HarvestTerms } : {}}
        onSubmit={(v) => {
          if (!editFor) return;
          const Recurring = round2(Number(v.Recurring) || 0);
          const OneTime = round2(Number(v.OneTime) || 0);
          const Tax = round2(Number(v.Tax) || 0);
          update(
            "Invoice",
            editFor.Id,
            {
              IssueDate: String(v.IssueDate),
              DueDate: String(v.DueDate),
              PeriodStart: String(v.PeriodStart),
              PeriodEnd: String(v.PeriodEnd),
              Recurring,
              OneTime,
              Tax,
              Total: round2(Recurring + OneTime + Tax),
              HarvestTerms: !!v.HarvestTerms,
            },
            editFor.InvoiceNumber,
          );
          setEditFor(null);
        }}
        onDelete={() => {
          const inv = editFor;
          setEditFor(null);
          if (inv) setConfirm({ kind: "delete", inv });
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? (confirm.kind === "delete" ? `Delete draft ${confirm.inv.InvoiceNumber}?` : confirm.kind === "void" ? `Void ${confirm.inv.InvoiceNumber}?` : `Send ${confirm.inv.InvoiceNumber}?`) : ""}
        description={
          confirm?.kind === "send"
            ? `Issued today and emailed to the billing contact. ${confirm.inv.HarvestTerms ? "Due Dec 15 (harvest terms)." : ""}`
            : confirm?.kind === "void"
              ? "The invoice stays on record with a zero balance. You can undo this for a few seconds afterwards."
              : undefined
        }
        confirmLabel={confirm?.kind === "delete" ? "Delete" : confirm?.kind === "void" ? "Void" : "Send"}
        destructive={confirm?.kind !== "send"}
        onConfirm={doConfirm}
      />

      <Dialog open={!!remindFor} onOpenChange={(o) => !o && setRemindFor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{remindFor ? `Reminder ${Math.min(remindFor.RemindersSent + 1, templates.length)} of ${templates.length} · ${remindFor.InvoiceNumber}` : "Reminder"}</DialogTitle>
            <DialogDescription>To {reminder?.to ? `${reminder.to.Name} <${reminder.to.Email}>` : "the billing contact (no email on file)"}</DialogDescription>
          </DialogHeader>
          {reminder && (
            <div className="space-y-2 rounded-md border bg-slate-50 p-3 text-sm">
              <p className="font-medium">{reminder.subject}</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{reminder.body}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemindFor(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (remindFor) run(sendReminderMutations(ctx, remindFor, reminderStep(remindFor, templates)), `Reminder sent for ${remindFor.InvoiceNumber} · email logged`, { undoable: true });
                setRemindFor(null);
              }}
            >
              Send reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceSheet({
  row,
  payments,
  actions,
  onOpenChange,
}: {
  row: Row | undefined;
  payments: Payment[];
  actions: { label: string; onClick: () => void; destructive?: boolean }[];
  onOpenChange: (open: boolean) => void;
}) {
  const inv = row?.inv;
  const ccy = inv?.CurrencyIsoCode ?? "USD";
  const facts: [string, React.ReactNode][] = inv
    ? [
        ["Account", row.external ? row.account : <Link href={`/accounts/${row.accountId}`} className="hover:underline">{row.account}</Link>],
        ["Contract", row.contract || "–"],
        ["Service period", `${fmtDate(inv.PeriodStart)} – ${fmtDate(inv.PeriodEnd)}`],
        ["Issued", fmtDate(inv.IssueDate)],
        ["Due", `${fmtDate(inv.DueDate)}${inv.HarvestTerms ? " · harvest terms" : ""}`],
        ["Recurring", money(inv.Recurring, ccy)],
        ["One-time", money(inv.OneTime, ccy)],
        ["Tax", money(inv.Tax, ccy)],
        ["Total", <span key="t" className="font-semibold">{money(inv.Total, ccy)}</span>],
        ["Paid", money(inv.AmountPaid, ccy)],
        ["Balance", money(row.balance, ccy)],
        ["Reminders", inv.RemindersSent ? `${inv.RemindersSent} · last ${fmtDate(inv.LastReminderDate ?? inv.DueDate)}` : "None"],
      ]
    : [];
  return (
    <Sheet open={!!row} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        <div className="border-b px-5 py-4 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base font-semibold">
            {inv?.InvoiceNumber}
            {row && <InvoiceStatusPill status={row.status} />}
            {inv?.HarvestTerms && <Tag>Harvest</Tag>}
          </SheetTitle>
          <SheetDescription className="mt-0.5 text-sm text-muted-foreground">
            {row?.external ? "Read-only · NetSuite" : row?.days ? `${row.days} days overdue` : row?.account}
          </SheetDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="tabular">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Payments</h3>
            {payments.length ? (
              <ul className="divide-y rounded-md border text-sm">
                {payments.map((p) => (
                  <li key={p.Id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {fmtDate(p.PaymentDate)} · {p.Method}
                      {p.Reference && <span className="text-muted-foreground"> · {p.Reference}</span>}
                    </span>
                    <span className="tabular">{money(p.Amount, ccy)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No payments</p>
            )}
          </div>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
            {actions.map((a) => (
              <Button key={a.label} size="sm" variant={a.destructive ? "ghost" : "outline"} className={cn(a.destructive && "text-status-critical hover:text-status-critical")} onClick={a.onClick}>
                {a.label}
              </Button>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
