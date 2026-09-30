"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, FileDown, MoreHorizontal, Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useAuth, useUserId } from "@/lib/auth";
import type { Mutation } from "@/lib/data/types";
import { userName } from "@/lib/data/selectors";
import { USER_BY_ID } from "@/data/reference/users";
import { opportunityHref, recordHref } from "@/lib/links";
import { can } from "@/lib/roles";
import { fmtDate, toISODate } from "@/lib/dates";
import { fmtCurrency, fmtPctValue } from "@/lib/quotes/pricing";
import type { Contract, ContractClause } from "@/types/salesforce";
import {
  EDITABLE_CONTRACT,
  LIVE_CONTRACT,
  PRICE_INCREASE_CAP,
  activateMutations,
  addClauseMutations,
  addableClauses,
  clausesFor,
  contractAlerts,
  contractApprovalEffects,
  contractInfo,
  customerSignerFor,
  decideClauseMutations,
  decideLegalReviewMutations,
  decidePaymentTermsMutations,
  deleteContractCascade,
  editClauseMutations,
  harvestTermsMutations,
  orderFormLines,
  pendingApproval,
  recallSignatureMutations,
  removeClauseMutations,
  revertClauseMutations,
  sendForSignatureMutations,
  signatureBlockers,
  submitLegalReviewMutations,
  terminateMutations,
  updateTermsMutations,
} from "@/lib/contracts";
import { signAndHandoffMutations } from "@/lib/contracts/handoff";
import { DocTitle } from "@/components/shared/doc-title";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { RecordDrawer } from "@/components/shared/record-drawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { BILLING_CHOICES, ContractFlags, ContractStatusPill, Flag, Notice, PAYMENT_TERM_CHOICES, StatusPath, TERM_CHOICES, useContractContext } from "./shared";
import { SignaturePad } from "./signature-pad";

export function ContractDetail({ id }: { id: string }) {
  const { ready, data } = useStore();
  if (!ready) return <Skeleton className="h-[640px]" />;
  const c = data.contracts.find((x) => x.Id === id);
  if (!c) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center">
        <p className="font-medium">Contract not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/contracts">Back to contracts</Link>
        </Button>
      </div>
    );
  }
  return <ContractBody key={c.Id} contract={c} />;
}

type DialogKind = null | "terms" | "sign" | "terminate" | "delete" | "addClause";

function Card({ title, action, children, className }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function ContractBody({ contract: c }: { contract: Contract }) {
  const { data, asOf, lightningBaseUrl } = useStore();
  const ctx = useContractContext();
  const { run, remove } = useCrud();
  const { role } = useAuth();
  const userId = useUserId();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [editing, setEditing] = useState<ContractClause | null>(null);
  const [removing, setRemoving] = useState<ContractClause | null>(null);
  const [busy, setBusy] = useState(false);

  // Decisions made in the header Approvals inbox take effect here
  const effects = useMemo(() => contractApprovalEffects(data, c.Id), [data, c.Id]);
  useEffect(() => {
    if (effects.length) run(effects, "Approval decision applied");
  }, [effects, run]);

  const account = data.accounts.find((a) => a.Id === c.AccountId);
  const opp = c.OpportunityId ? data.opportunities.find((o) => o.Id === c.OpportunityId) : undefined;
  const quote = c.QuoteId ? data.quotes.find((q) => q.Id === c.QuoteId) : undefined;
  const rows = clausesFor(data, c.Id);
  const lines = orderFormLines(data, c);
  const info = contractInfo(c, asOf);
  const alerts = contractAlerts({ contracts: [c], accounts: data.accounts }, asOf);
  const blockers = signatureBlockers(data, c);
  const legalReq = pendingApproval(data, c.Id, "Non-standard clause");
  const payReq = pendingApproval(data, c.Id, "Payment terms");
  const pendingRows = rows.filter((r) => r.ApprovalStatus === "Pending");
  const signer = customerSignerFor(data, c);
  const money = (n: number) => fmtCurrency(n, c.CurrencyIsoCode, { cents: false });
  const today = toISODate(asOf);

  const editable = EDITABLE_CONTRACT.includes(c.Status) && role !== "finance" && (role !== "rep" || c.OwnerId === userId);
  const legal = can(role, "approve:clauses");
  const finance = can(role, "approve:payment-terms");
  const live = LIVE_CONTRACT.includes(c.Status);

  const act = (fn: () => Mutation[], message: string, undoable = false) => {
    try {
      run(fn(), message, { undoable });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the contract");
      return false;
    }
  };

  const pdf = async () => {
    setBusy(true);
    try {
      const m = await import("@/lib/contracts/pdf");
      await m.downloadContractPdf(data, c.Id);
    } catch (e) {
      console.error(e);
      toast.error("Could not build the PDF");
    } finally {
      setBusy(false);
    }
  };

  // Primary actions by status and role
  const primary: React.ReactNode[] = [];
  if (c.Status === "Legal Review" && legal && (legalReq || pendingRows.length)) {
    primary.push(
      <Button key="reject" size="sm" variant="outline" onClick={() => act(() => decideLegalReviewMutations(ctx, c.Id, "Rejected"), `${c.ContractNumber} returned to Draft`)}>
        Reject
      </Button>,
      <Button key="approve" size="sm" onClick={() => act(() => decideLegalReviewMutations(ctx, c.Id, "Approved"), `${c.ContractNumber} approved by Legal`)}>
        Approve
      </Button>,
    );
  } else if (EDITABLE_CONTRACT.includes(c.Status) && role !== "finance") {
    if (c.Status === "Draft" && !legalReq) {
      primary.push(
        <Button key="legal" size="sm" variant="outline" disabled={!editable} onClick={() => act(() => submitLegalReviewMutations(ctx, c.Id), `${c.ContractNumber} sent to Legal`)}>
          Submit to Legal Review
        </Button>,
      );
    }
    primary.push(
      <Button key="send" size="sm" disabled={!editable || blockers.length > 0} title={blockers.join("; ") || undefined} onClick={() => act(() => sendForSignatureMutations(ctx, c.Id), `${c.ContractNumber} sent for signature`)}>
        Send for signature
      </Button>,
    );
  }
  if (c.Status === "Sent for Signature") primary.push(<Button key="sign" size="sm" onClick={() => setDialog("sign")}>Sign</Button>);
  if (c.Status === "Signed" && c.StartDate <= today) primary.push(<Button key="activate" size="sm" onClick={() => act(() => activateMutations(ctx, c.Id), `${c.ContractNumber} active`)}>Activate</Button>);

  const signedCopy = !!c.SignedDate && (live || c.Status === "Expired" || c.Status === "Terminated");

  return (
    <div className="space-y-4">
      <DocTitle title={`${c.ContractNumber} · ${account?.Name ?? c.Name}`} />
      <Link href="/contracts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-3.5" aria-hidden />
        Contracts
      </Link>

      <section className="space-y-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Contract {c.ContractNumber}
              <ContractStatusPill status={c.Status} />
              <ContractFlags info={info} autoRenew={c.AutoRenew} />
              <LocalChangeTag id={c.Id} />
            </p>
            <h1 className="mt-1 text-xl font-semibold">{c.Name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {account && (
                <Link href={recordHref(account.Id)} className="text-primary hover:underline">
                  {account.Name}
                </Link>
              )}
              {quote && (
                <>
                  {" · "}
                  <Link href={`/quotes/${quote.Id}`} className="text-primary hover:underline">
                    Quote {quote.QuoteNumber}
                  </Link>
                </>
              )}
              {opp && (
                <>
                  {" · "}
                  <Link href={opportunityHref(opp.Id, lightningBaseUrl)} className="text-primary hover:underline">
                    {opp.Name}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {primary}
            <Button size="sm" variant="outline" onClick={pdf} disabled={busy}>
              <FileDown />
              {busy ? "Building…" : signedCopy ? "Signed PDF" : "Preview PDF"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!editable} onSelect={() => setDialog("terms")}>
                  Edit key terms
                </DropdownMenuItem>
                {c.Status === "Sent for Signature" && role !== "finance" && (
                  <DropdownMenuItem onSelect={() => act(() => recallSignatureMutations(ctx, c.Id), `${c.ContractNumber} recalled to Draft`)}>Recall to Draft</DropdownMenuItem>
                )}
                {live && role !== "rep" && <DropdownMenuItem onSelect={() => setDialog("terminate")}>Terminate</DropdownMenuItem>}
                {c.Status === "Draft" && editable && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-status-critical focus:text-status-critical" onSelect={() => setDialog("delete")}>
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <StatusPath status={c.Status} />

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-8">
          {(
            [
              ["ARR", money(c.ARR)],
              ["One-time", money(c.OneTimeFees)],
              ["TCV", money(c.TCV)],
              ["Start", fmtDate(c.StartDate)],
              ["End", fmtDate(c.EndDate)],
              ["Term", `${c.TermMonths} months`],
              ["Notice by", fmtDate(info.noticeDeadline)],
              ["Owner", userName(c.OwnerId)],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="truncate tabular" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>

        {(alerts.length > 0 || legalReq || payReq || (editable && blockers.length > 0) || c.Status === "Terminated") && (
          <div className="space-y-2">
            {alerts.map((a) => (
              <Notice key={a.kind} tone={a.severity === "critical" ? "critical" : "warning"}>
                {a.message} ({fmtDate(a.date)})
              </Notice>
            ))}
            {legalReq && <Notice tone="info">Awaiting Legal: {legalReq.Detail}</Notice>}
            {payReq && (
              <Notice tone="info">
                Awaiting Finance: {payReq.Detail}
                {finance && (
                  <span className="ml-2 inline-flex gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => act(() => decidePaymentTermsMutations(ctx, c.Id, "Rejected"), "Harvest terms rejected")}>
                      Reject
                    </Button>
                    <Button size="xs" onClick={() => act(() => decidePaymentTermsMutations(ctx, c.Id, "Approved"), "Harvest terms approved")}>
                      Approve
                    </Button>
                  </span>
                )}
              </Notice>
            )}
            {editable && blockers.length > 0 && !legalReq && <Notice tone="warning">Before sending for signature: {blockers.join("; ")}</Notice>}
            {c.Status === "Terminated" && <Notice tone="critical">Terminated effective {c.TerminatedDate ? fmtDate(c.TerminatedDate) : "—"}</Notice>}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Order Form">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2 font-medium">Product</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">List</th>
                    <th className="pb-2 text-right font-medium">Disc.</th>
                    <th className="pb-2 text-right font-medium">Net unit</th>
                    <th className="pb-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td className="py-2">
                        {l.name}
                        <span className="ml-1.5 text-xs text-muted-foreground">{l.recurring ? "annual" : "one-time"}</span>
                      </td>
                      <td className="py-2 text-right tabular">{l.quantity}</td>
                      <td className="py-2 text-right tabular">{money(l.listPrice)}</td>
                      <td className="py-2 text-right tabular">{l.discount ? fmtPctValue(l.discount) : "—"}</td>
                      <td className="py-2 text-right tabular">{money(l.unitPrice)}</td>
                      <td className="py-2 text-right tabular">{money(l.total)}</td>
                    </tr>
                  ))}
                  {!lines.length && (
                    <tr>
                      <td colSpan={6} className="py-4 text-center text-muted-foreground">
                        No lines
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot className="border-t text-sm">
                  <tr>
                    <td colSpan={5} className="pt-2 text-right text-muted-foreground">
                      Annual recurring (ARR)
                    </td>
                    <td className="pt-2 text-right font-medium tabular">{money(c.ARR)}</td>
                  </tr>
                  {c.OneTimeFees > 0 && (
                    <tr>
                      <td colSpan={5} className="text-right text-muted-foreground">
                        One-time fees
                      </td>
                      <td className="text-right tabular">{money(c.OneTimeFees)}</td>
                    </tr>
                  )}
                  <tr>
                    <td colSpan={5} className="text-right text-muted-foreground">
                      Total contract value ({c.TermMonths} months)
                    </td>
                    <td className="text-right font-semibold tabular">{money(c.TCV)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card
            title={`Clauses (${rows.length})`}
            action={
              editable && (
                <Button size="xs" variant="outline" onClick={() => setDialog("addClause")} disabled={!addableClauses(data, c.Id).length}>
                  <Plus />
                  Add clause
                </Button>
              )
            }
          >
            <ol className="divide-y">
              {rows.map((r, i) => (
                <li key={r.Id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">
                      {i + 1}. {r.Name}
                    </p>
                    <span className="text-xs text-muted-foreground">{r.Category}</span>
                    {!r.Standard && <Flag tone="neutral">Non-standard</Flag>}
                    {r.ApprovalStatus === "Pending" && <Flag tone="warning">Awaiting Legal</Flag>}
                    {r.ApprovalStatus === "Approved" && !r.Standard && <Flag tone="neutral">Approved{r.ApprovedById && USER_BY_ID[r.ApprovedById] ? ` by ${USER_BY_ID[r.ApprovedById].Name}` : ""}</Flag>}
                    {r.ApprovalStatus === "Rejected" && <Flag tone="critical">Rejected</Flag>}
                    <span className="ml-auto flex gap-1">
                      {r.ApprovalStatus === "Pending" && legal && (
                        <>
                          <Button size="xs" variant="outline" onClick={() => act(() => decideClauseMutations(ctx, r.Id, "Rejected"), `${r.Name} rejected`)}>
                            Reject
                          </Button>
                          <Button size="xs" onClick={() => act(() => decideClauseMutations(ctx, r.Id, "Approved"), `${r.Name} approved`)}>
                            Approve
                          </Button>
                        </>
                      )}
                      {editable && (
                        <>
                          <Button size="xs" variant="ghost" onClick={() => setEditing(r)}>
                            Edit
                          </Button>
                          {!r.Standard && r.ClauseId && (
                            <Button size="xs" variant="ghost" onClick={() => act(() => revertClauseMutations(ctx, r.Id), `${r.Name} reverted to standard`)}>
                              Revert
                            </Button>
                          )}
                          <Button size="xs" variant="ghost" className="text-status-critical hover:text-status-critical" onClick={() => setRemoving(r)}>
                            Remove
                          </Button>
                        </>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-line text-slate-600">{r.Body}</p>
                </li>
              ))}
              {!rows.length && <li className="py-2 text-sm text-muted-foreground">No clauses</li>}
            </ol>
          </Card>
        </div>

        <div className="space-y-4">
          <Card
            title="Key terms"
            action={
              editable && (
                <Button size="xs" variant="outline" onClick={() => setDialog("terms")}>
                  Edit
                </Button>
              )
            }
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {(
                [
                  ["Start date", fmtDate(c.StartDate)],
                  ["End date", fmtDate(c.EndDate)],
                  ["Auto-renew", c.AutoRenew ? "Yes, 12-month terms" : "No"],
                  ["Notice period", `${c.NoticeDays} days`],
                  ["Price increase", `${fmtPctValue(c.PriceIncreasePct)} a year`],
                  ["Billing", c.BillingFrequency],
                  ["Payment terms", c.PaymentTerms],
                  ["Harvest terms", c.HarvestTerms ? "Yes, due Dec 15" : payReq ? "Awaiting Finance" : "No"],
                  ["DPA", c.DPA ? "Yes" : "No"],
                  ["Currency", c.CurrencyIsoCode],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-right tabular">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Signature">
            {c.SignedDate ? (
              <div className="space-y-2 text-sm">
                {c.SignatureImage ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL from the signature pad
                  <img src={c.SignatureImage} alt={`Signature of ${c.SignedByName ?? "the signer"}`} className="h-16 w-auto max-w-full rounded-sm border bg-white" />
                ) : (
                  <p className="font-serif text-lg italic">/s/ {c.SignedByName}</p>
                )}
                <p>
                  {c.SignedByName}
                  {c.SignedByTitle && <span className="text-muted-foreground">, {c.SignedByTitle}</span>}
                </p>
                <p className="text-xs text-muted-foreground">Signed electronically {new Date(c.SignedDate).toUTCString().replace(" GMT", " UTC")}</p>
              </div>
            ) : c.Status === "Sent for Signature" ? (
              <div className="space-y-1 text-sm">
                <p>Out for signature{signer ? ` with ${signer.Name}` : ""}</p>
                <p className="text-xs text-muted-foreground">
                  Sent {c.SentForSignatureDate ? fmtDate(c.SentForSignatureDate) : "—"}
                  {info.unsignedDays !== null && ` · ${info.unsignedDays} days ago`}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Not signed</p>
            )}
          </Card>
        </div>
      </div>

      {/* Key terms */}
      <RecordDrawer
        open={dialog === "terms"}
        onOpenChange={(o) => setDialog(o ? "terms" : null)}
        title="Edit key terms"
        description={c.ContractNumber}
        initial={{
          StartDate: c.StartDate,
          TermMonths: String(c.TermMonths),
          AutoRenew: c.AutoRenew,
          NoticeDays: c.NoticeDays,
          PriceIncreasePct: c.PriceIncreasePct,
          BillingFrequency: c.BillingFrequency,
          PaymentTerms: c.PaymentTerms,
          HarvestTerms: c.HarvestTerms || !!payReq,
          DPA: c.DPA,
          ARR: c.ARR,
          OneTimeFees: c.OneTimeFees,
        }}
        fields={[
          { name: "StartDate", label: "Start date", type: "date", required: true },
          { name: "TermMonths", label: "Term", type: "select", required: true, options: TERM_CHOICES.map((n) => ({ value: String(n), label: `${n} months` })) },
          { name: "NoticeDays", label: "Notice period (days)", type: "number", required: true, min: 0, max: 365 },
          { name: "PriceIncreasePct", label: "Yearly price increase", type: "percent", required: true, min: 0, max: PRICE_INCREASE_CAP, step: 0.5 },
          { name: "BillingFrequency", label: "Billing", type: "select", required: true, options: BILLING_CHOICES.map((v) => ({ value: v, label: v })) },
          { name: "PaymentTerms", label: "Payment terms", type: "select", required: true, options: PAYMENT_TERM_CHOICES.map((v) => ({ value: v, label: v })) },
          ...(c.QuoteId
            ? []
            : [
                { name: "ARR", label: "ARR", type: "currency" as const, required: true, min: 0 },
                { name: "OneTimeFees", label: "One-time fees", type: "currency" as const, min: 0 },
              ]),
          { name: "AutoRenew", label: "Auto-renew", type: "checkbox" },
          { name: "DPA", label: "Data protection addendum", type: "checkbox" },
          { name: "HarvestTerms", label: "Harvest payment terms", type: "checkbox", wide: true, help: finance ? undefined : "Needs Finance approval" },
        ]}
        onSubmit={(v) => {
          try {
            const muts = updateTermsMutations(ctx, c.Id, {
              StartDate: String(v.StartDate),
              TermMonths: Number(v.TermMonths),
              NoticeDays: Number(v.NoticeDays),
              PriceIncreasePct: Number(v.PriceIncreasePct),
              BillingFrequency: v.BillingFrequency as Contract["BillingFrequency"],
              PaymentTerms: v.PaymentTerms as Contract["PaymentTerms"],
              AutoRenew: !!v.AutoRenew,
              DPA: !!v.DPA,
              ...(c.QuoteId ? {} : { ARR: Number(v.ARR) || 0, OneTimeFees: Number(v.OneTimeFees) || 0 }),
            });
            let pending = false;
            const wantHarvest = !!v.HarvestTerms;
            if (wantHarvest !== (c.HarvestTerms || !!payReq)) {
              const h = harvestTermsMutations(ctx, c.Id, wantHarvest);
              muts.push(...h.mutations);
              pending = h.pending;
            }
            run(muts, pending ? "Key terms updated; harvest terms sent to Finance" : `${c.ContractNumber} updated`);
            setDialog(null);
          } catch (e) {
            return e instanceof Error ? e.message : "Could not save";
          }
        }}
      />

      {/* Clause edit */}
      <RecordDrawer
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing ? `Edit clause: ${editing.Name}` : "Edit clause"}
        description={legal ? c.ContractNumber : "Changes from the library text need Legal approval"}
        initial={{ Name: editing?.Name ?? "", Body: editing?.Body ?? "" }}
        fields={[
          { name: "Name", label: "Heading", required: true, wide: true },
          { name: "Body", label: "Text", type: "textarea", required: true, wide: true },
        ]}
        onSubmit={(v) => {
          if (!editing) return;
          try {
            const muts = editClauseMutations(ctx, editing.Id, String(v.Body), String(v.Name));
            const toLegal = muts.some((m) => m.object === "ApprovalRequest");
            run(muts, toLegal ? `${editing.Name} sent to Legal` : `${editing.Name} updated`);
            setEditing(null);
          } catch (e) {
            return e instanceof Error ? e.message : "Could not save";
          }
        }}
      />

      {/* Add clause */}
      <RecordDrawer
        open={dialog === "addClause"}
        onOpenChange={(o) => setDialog(o ? "addClause" : null)}
        title="Add clause"
        description={c.ContractNumber}
        submitLabel="Add"
        initial={{ clauseId: addableClauses(data, c.Id)[0]?.Id ?? "" }}
        fields={[{ name: "clauseId", label: "Library clause", type: "select", required: true, wide: true, options: addableClauses(data, c.Id).map((x) => ({ value: x.Id, label: `${x.Name} (${x.Category})` })) }]}
        onSubmit={(v) => {
          try {
            const lib = data.clauses.find((x) => x.Id === v.clauseId);
            run(addClauseMutations(ctx, c.Id, String(v.clauseId)), `${lib?.Name ?? "Clause"} added`);
            setDialog(null);
          } catch (e) {
            return e instanceof Error ? e.message : "Could not add";
          }
        }}
      />

      {/* Terminate */}
      <RecordDrawer
        open={dialog === "terminate"}
        onOpenChange={(o) => setDialog(o ? "terminate" : null)}
        title={`Terminate ${c.ContractNumber}`}
        submitLabel="Terminate"
        initial={{ date: today, reason: "" }}
        fields={[
          { name: "date", label: "Effective date", type: "date", required: true },
          { name: "reason", label: "Reason", type: "textarea", required: true },
        ]}
        onSubmit={(v) => {
          try {
            run(terminateMutations(ctx, c.Id, { date: String(v.date), reason: String(v.reason) }), `${c.ContractNumber} terminated`, { undoable: true });
            setDialog(null);
          } catch (e) {
            return e instanceof Error ? e.message : "Could not terminate";
          }
        }}
      />

      <SignDialog
        open={dialog === "sign"}
        onOpenChange={(o) => setDialog(o ? "sign" : null)}
        contract={c}
        defaultName={signer?.Name ?? ""}
        defaultTitle={signer?.Title ?? ""}
        onSign={(sig) => {
          try {
            run(signAndHandoffMutations(ctx, c.Id, sig), `${c.ContractNumber} signed`);
            setDialog(null);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Could not sign");
          }
        }}
      />

      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => setDialog(o ? "delete" : null)}
        title={`Delete ${c.ContractNumber}?`}
        onConfirm={() => {
          remove("Contract", c.Id, c.ContractNumber, deleteContractCascade(data, c.Id));
          router.push("/contracts");
        }}
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing ? `Remove ${removing.Name}?` : "Remove clause?"}
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) act(() => removeClauseMutations(ctx, removing.Id), `${removing.Name} removed`, true);
          setRemoving(null);
        }}
      />
    </div>
  );
}

function SignDialog({
  open,
  onOpenChange,
  contract: c,
  defaultName,
  defaultTitle,
  onSign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract: Contract;
  defaultName: string;
  defaultTitle: string;
  onSign: (sig: { name: string; title: string; image: string }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Sign {c.ContractNumber}</DialogTitle>
          <DialogDescription>{c.Name}</DialogDescription>
        </DialogHeader>
        {open && <SignForm defaultName={defaultName} defaultTitle={defaultTitle} onCancel={() => onOpenChange(false)} onSign={onSign} />}
      </DialogContent>
    </Dialog>
  );
}

function SignForm({ defaultName, defaultTitle, onCancel, onSign }: { defaultName: string; defaultTitle: string; onCancel: () => void; onSign: (sig: { name: string; title: string; image: string }) => void }) {
  const { asOf } = useStore();
  const [image, setImage] = useState<string | null>(null);
  const [name, setName] = useState(defaultName);
  const [title, setTitle] = useState(defaultTitle);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (image && name.trim()) onSign({ name, title, image });
      }}
    >
      <SignaturePad onChange={setImage} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="sig-name">Full name</Label>
          <Input id="sig-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sig-title">Title</Label>
          <Input id="sig-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Signing date {fmtDate(asOf)}</p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!image || !name.trim()}>
          Sign contract
        </Button>
      </DialogFooter>
    </form>
  );
}
