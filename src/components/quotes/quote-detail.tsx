"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, FileDown, MoreHorizontal } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useAuth } from "@/lib/auth";
import type { Mutation } from "@/lib/data/types";
import { userName } from "@/lib/data/selectors";
import { opportunityHref, recordHref } from "@/lib/links";
import type { Quote } from "@/types/salesforce";
import { fmtDate, fmtShortDate } from "@/lib/dates";
import { approvalFor, canApprove } from "@/lib/quotes/approvals";
import { baseQuoteNumber, goLiveWarning } from "@/lib/quotes/build";
import { fmtCurrency } from "@/lib/quotes/pricing";
import { contractForQuote, contractFromQuoteMutations } from "@/lib/contracts";
import {
  LOSS_REASONS,
  acceptQuoteMutations,
  approveQuoteMutations,
  boardCheck,
  closeLostMutations,
  closeWonMutations,
  declineQuoteMutations,
  deleteQuoteCascade,
  effectiveStatus,
  isEditable,
  markSentMutations,
  quoteLines,
  recallQuoteMutations,
  rejectQuoteMutations,
  reviseQuoteMutations,
  submitForApprovalMutations,
} from "@/lib/quotes/lifecycle";
import { DocTitle } from "@/components/shared/doc-title";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LineItems } from "./line-items";
import { ActivityCard, ApprovalCard, BoardCard, TotalsCard, useQuoteTotals } from "./quote-side";
import { QuoteDrawer } from "./quote-drawer";
import { Notice, QuoteStatusPill, fieldSelectCls, useQuoteContext } from "./shared";

type DialogKind = null | "submit" | "approve" | "reject" | "accept" | "won" | "decline" | "delete" | "sent";

/** Text entry dialog (approval note, rejection reason, justification) */
function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  required,
  confirmLabel,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  label: string;
  required?: boolean;
  confirmLabel: string;
  onConfirm: (text: string) => void;
  children?: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [tried, setTried] = useState(false);
  const missing = required && !text.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setText("");
          setTried(false);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : "sr-only"}>{description ?? title}</DialogDescription>
        </DialogHeader>
        {children}
        <div className="grid gap-1.5">
          <Label htmlFor="reason-text">
            {label}
            {required && <span className="text-status-critical"> *</span>}
          </Label>
          <textarea
            id="reason-text"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={(tried && missing) || undefined}
            className="w-full rounded-md border border-input bg-card px-2.5 py-2 text-sm outline-none focus:border-primary/50 aria-invalid:border-status-critical"
            autoFocus
          />
          {tried && missing && <p className="text-xs text-status-critical">Required</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setTried(true);
              if (missing) return;
              onConfirm(text.trim());
              setText("");
              setTried(false);
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeclineDialog({ open, onOpenChange, oppOpen, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; oppOpen: boolean; onConfirm: (close: boolean, reason: string) => void }) {
  const [reason, setReason] = useState<string>(LOSS_REASONS[0]);
  const [close, setClose] = useState(oppOpen);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark quote declined</DialogTitle>
          <DialogDescription className="sr-only">Decline the quote and optionally close the opportunity as lost</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {oppOpen && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} className="size-4 accent-[#1f5f4a]" />
              Close the opportunity as lost
            </label>
          )}
          {close && oppOpen && (
            <div className="grid gap-1.5">
              <Label htmlFor="loss-reason">Loss reason</Label>
              <select id="loss-reason" value={reason} onChange={(e) => setReason(e.target.value)} className={fieldSelectCls}>
                {LOSS_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm(close && oppOpen, reason);
            }}
          >
            Mark declined
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuoteDetail({ id }: { id: string }) {
  const { ready, data, asOf, lightningBaseUrl } = useStore();
  if (!ready) return <Skeleton className="h-[640px]" />;
  const q = data.quotes.find((x) => x.Id === id);
  if (!q) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center">
        <p className="font-medium">Quote not found</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/quotes">Back to quotes</Link>
        </Button>
      </div>
    );
  }
  return <QuoteDetailBody key={q.Id} quote={q} asOf={asOf} lightningBaseUrl={lightningBaseUrl} />;
}

function QuoteDetailBody({ quote: q, asOf, lightningBaseUrl }: { quote: Quote; asOf: Date; lightningBaseUrl?: string }) {
  const { data } = useStore();
  const ctx = useQuoteContext();
  const { run, remove } = useCrud();
  const { role } = useAuth();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<null | "quote" | "packet">(null);
  const totals = useQuoteTotals(q);

  const status = effectiveStatus(q, asOf);
  const editable = isEditable(q, asOf);
  const account = data.accounts.find((a) => a.Id === q.AccountId);
  const opp = data.opportunities.find((o) => o.Id === q.OpportunityId);
  const contact = data.contacts.find((c) => c.Id === q.ContactId);
  const book = data.pricebooks.find((b) => b.Id === q.Pricebook2Id);
  const ccy = book?.CurrencyIsoCode ?? "USD";
  const lines = quoteLines(data, q.Id);
  const req = approvalFor(totals, ccy);
  const mayApprove = canApprove(req.level, role);
  const board = boardCheck(data, q, asOf);
  const oppOpen = !!opp && !opp.IsClosed;
  const liveWarn = ["Draft", "In Review", "Approved", "Rejected", "Sent"].includes(status) ? goLiveWarning(account, q.Start_Date__c) : null;
  const versions = data.quotes.filter((x) => x.Id !== q.Id && baseQuoteNumber(x.QuoteNumber) === baseQuoteNumber(q.QuoteNumber)).sort((a, b) => a.QuoteNumber.localeCompare(b.QuoteNumber));

  const act = (fn: () => Mutation[], message: string) => {
    try {
      run(fn(), message);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the quote");
      return false;
    }
  };

  const submit = (note?: string) => {
    const r = submitForApprovalMutations(ctx, q.Id, note);
    run(r.mutations, r.status === "Approved" ? `${q.QuoteNumber} auto-approved` : `${q.QuoteNumber} submitted to ${r.requirement.approver.toLowerCase()}`);
  };

  const pdf = async (kind: "quote" | "packet") => {
    setBusy(kind);
    try {
      const m = await import("@/lib/quotes/pdf");
      if (kind === "quote") await m.downloadQuotePdf(data, q.Id, asOf);
      else await m.downloadBoardPacketPdf(data, q.Id, asOf);
    } catch (e) {
      console.error(e);
      toast.error("Could not build the PDF");
    } finally {
      setBusy(null);
    }
  };

  const revise = () => {
    const r = reviseQuoteMutations(ctx, q.Id);
    run(r.mutations, `Revision ${r.quoteNumber} created`);
    router.push(`/quotes/${r.id}`);
  };

  // Primary actions by status
  const primary: React.ReactNode[] = [];
  if (status === "Draft" || status === "Rejected") {
    primary.push(
      <Button key="submit" size="sm" disabled={!lines.length} onClick={() => (req.level === "auto" ? submit() : setDialog("submit"))}>
        {req.level === "auto" ? "Submit for approval" : `Submit to ${req.approver.toLowerCase()}`}
      </Button>,
    );
  }
  if (status === "In Review") {
    if (mayApprove) {
      primary.push(
        <Button key="reject" size="sm" variant="outline" onClick={() => setDialog("reject")}>
          Reject
        </Button>,
        <Button key="approve" size="sm" onClick={() => setDialog("approve")}>
          Approve
        </Button>,
      );
    } else {
      primary.push(
        <Button key="recall" size="sm" variant="outline" onClick={() => act(() => recallQuoteMutations(ctx, q.Id), `${q.QuoteNumber} recalled to Draft`)}>
          Recall
        </Button>,
      );
    }
  }
  if (status === "Approved") primary.push(<Button key="sent" size="sm" onClick={() => setDialog("sent")}>Mark sent</Button>);
  if (status === "Sent") {
    primary.push(
      <Button key="decline" size="sm" variant="outline" onClick={() => setDialog("decline")}>
        Mark declined
      </Button>,
      <Button key="accept" size="sm" onClick={() => setDialog("accept")}>
        Mark accepted
      </Button>,
    );
  }
  if (status === "Accepted" && oppOpen) primary.push(<Button key="won" size="sm" onClick={() => setDialog("won")}>Close opportunity won</Button>);
  if (status === "Accepted") {
    const existing = contractForQuote(data, q.Id);
    primary.push(
      existing ? (
        <Button key="contract" size="sm" variant="outline" asChild>
          <Link href={`/contracts/${existing.Id}`}>Contract {existing.ContractNumber}</Link>
        </Button>
      ) : (
        <Button
          key="contract"
          size="sm"
          onClick={() => {
            const r = contractFromQuoteMutations(ctx, q.Id);
            run(r.mutations, "Contract created");
            router.push(`/contracts/${r.contractId}`);
          }}
        >
          Create contract
        </Button>
      ),
    );
  }
  if (status === "Declined" && oppOpen) primary.push(<Button key="lost" size="sm" variant="outline" onClick={() => setDialog("decline")}>Close opportunity lost</Button>);
  if (status === "Expired") primary.push(<Button key="revise" size="sm" onClick={revise}>Revise</Button>);

  return (
    <div className="space-y-4">
      <DocTitle title={`${q.QuoteNumber} · ${q.Name}`} />
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-3.5" aria-hidden />
        Quotes
      </Link>

      <section className="space-y-4 rounded-md border bg-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              Quote {q.QuoteNumber}
              <QuoteStatusPill status={status} />
              <LocalChangeTag id={q.Id} />
            </p>
            <h1 className="mt-1 text-xl font-semibold">{q.Name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {account && (
                <Link href={recordHref(account.Id)} className="text-primary hover:underline">
                  {account.Name}
                </Link>
              )}
              {opp && (
                <>
                  {" · "}
                  <Link href={opportunityHref(opp.Id, lightningBaseUrl)} className="text-primary hover:underline">
                    {opp.Name}
                  </Link>{" "}
                  · {opp.StageName}
                </>
              )}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {primary}
            <Button size="sm" variant="outline" onClick={() => pdf("quote")} disabled={busy !== null}>
              <FileDown />
              {busy === "quote" ? "Building…" : "PDF"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {status !== "Accepted" && status !== "Declined" && <DropdownMenuItem onSelect={() => setEditing(true)}>Edit header</DropdownMenuItem>}
                <DropdownMenuItem onSelect={revise}>Revise (new version)</DropdownMenuItem>
                {status === "In Review" && mayApprove && <DropdownMenuItem onSelect={() => act(() => recallQuoteMutations(ctx, q.Id), `${q.QuoteNumber} recalled to Draft`)}>Recall to Draft</DropdownMenuItem>}
                {board.needsBoard && <DropdownMenuItem onSelect={() => pdf("packet")}>Board packet (PDF)</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-status-critical focus:text-status-critical" onSelect={() => setDialog("delete")}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4 lg:grid-cols-8">
          {(
            [
              ["First year", fmtCurrency(totals.firstYear, ccy, { cents: false })],
              ["TCV", fmtCurrency(totals.tcv, ccy, { cents: false })],
              ["Valid until", fmtDate(q.ExpirationDate)],
              ["Go-live", fmtDate(q.Start_Date__c)],
              ["Term", `${q.Contract_Term_Months__c} mo · ${q.Billing_Frequency__c}`],
              ["Price book", book ? `${book.Name}` : "—"],
              ["Contact", contact ? contact.Name : "—"],
              ["Owner", userName(q.OwnerId)],
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

        {(status === "Expired" || liveWarn || board.expiresBefore || (opp?.IsClosed && !["Accepted", "Declined"].includes(status)) || versions.length > 0) && (
          <div className="space-y-1.5">
            {status === "Expired" && <Notice tone="critical">Expired {fmtShortDate(q.ExpirationDate)}. Revise, or extend the date in Edit header.</Notice>}
            {liveWarn && <Notice>{liveWarn}</Notice>}
            {board.expiresBefore && board.meeting && <Notice>Valid until {fmtShortDate(q.ExpirationDate)}, before the board meeting on {fmtShortDate(board.meeting)}.</Notice>}
            {opp?.IsClosed && !["Accepted", "Declined"].includes(status) && <Notice tone="info">Opportunity is {opp.StageName}.</Notice>}
            {versions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Other versions:{" "}
                {versions.map((x, i) => (
                  <span key={x.Id}>
                    {i > 0 && ", "}
                    <Link href={`/quotes/${x.Id}`} className="text-primary hover:underline">
                      {x.QuoteNumber}
                    </Link>{" "}
                    ({effectiveStatus(x, asOf)})
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <LineItems quote={q} editable={editable} />
          {q.Description && <p className="rounded-md border bg-card px-4 py-3 text-sm text-muted-foreground">{q.Description}</p>}
        </div>
        <div className="space-y-4">
          <TotalsCard quote={q} editable={editable} />
          <ApprovalCard quote={q} />
          <BoardCard quote={q} onPacket={() => pdf("packet")} busy={busy === "packet"} />
          <ActivityCard quote={q} />
        </div>
      </div>

      <QuoteDrawer open={editing} onOpenChange={setEditing} quote={q} />

      <ReasonDialog
        open={dialog === "submit"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Submit to ${req.approver.toLowerCase()}`}
        description={req.reasons.join(". ")}
        label="Justification"
        required={req.reasonRequired}
        confirmLabel="Submit"
        onConfirm={(text) => submit(text)}
      />
      <ReasonDialog
        open={dialog === "approve"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Approve ${q.QuoteNumber}`}
        description={req.reasons.join(". ")}
        label={req.reasonRequired ? "Reason" : "Note"}
        required={req.reasonRequired}
        confirmLabel="Approve"
        onConfirm={(text) => act(() => approveQuoteMutations({ ...ctx, role }, q.Id, text), `${q.QuoteNumber} approved`)}
      />
      <ReasonDialog
        open={dialog === "reject"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Reject ${q.QuoteNumber}`}
        label="Reason"
        required
        confirmLabel="Reject"
        onConfirm={(text) => act(() => rejectQuoteMutations(ctx, q.Id, text), `${q.QuoteNumber} rejected`)}
      />
      <ConfirmDialog
        open={dialog === "sent"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Mark ${q.QuoteNumber} sent`}
        description={`Logs a completed email${contact ? ` to ${contact.Name}` : ""} on ${account?.Name ?? "the account"}.`}
        confirmLabel="Mark sent"
        destructive={false}
        onConfirm={() => act(() => markSentMutations(ctx, q.Id), `${q.QuoteNumber} marked sent`)}
      />
      <ConfirmDialog
        open={dialog === "accept"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Mark ${q.QuoteNumber} accepted`}
        description={
          opp
            ? `The opportunity amount becomes ${fmtCurrency(totals.firstYearBeforeTax, ccy, { cents: false })} (first year) and its products are replaced by this quote's ${lines.length} line${lines.length === 1 ? "" : "s"}.`
            : "No opportunity is linked."
        }
        confirmLabel="Mark accepted"
        destructive={false}
        onConfirm={() => {
          if (act(() => acceptQuoteMutations(ctx, q.Id), `${q.QuoteNumber} accepted`) && oppOpen) setTimeout(() => setDialog("won"), 150);
        }}
      />
      <ConfirmDialog
        open={dialog === "won"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Mark opportunity Closed Won"
        description={opp ? `${opp.Name}: Closed Won on ${fmtShortDate(asOf)}, probability 100%, forecast Closed.` : undefined}
        confirmLabel="Close won"
        destructive={false}
        onConfirm={() => opp && act(() => closeWonMutations(ctx, opp.Id), `${opp.Name} closed won`)}
      />
      <DeclineDialog
        key={`${dialog}-${oppOpen}`}
        open={dialog === "decline"}
        onOpenChange={(o) => !o && setDialog(null)}
        oppOpen={oppOpen}
        onConfirm={(close, reason) => {
          const muts: Mutation[] = status === "Declined" ? [] : declineQuoteMutations(ctx, q.Id);
          if (close && opp) muts.push(...closeLostMutations(ctx, opp.Id, reason));
          act(() => muts, close ? `${q.QuoteNumber} declined; opportunity closed lost` : `${q.QuoteNumber} declined`);
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${q.QuoteNumber}?`}
        description={`Deletes the quote and its ${lines.length} line${lines.length === 1 ? "" : "s"}. You can undo this for a few seconds afterwards.`}
        onConfirm={() => {
          remove("Quote", q.Id, `Quote ${q.QuoteNumber}`, deleteQuoteCascade(data, q.Id));
          router.push("/quotes");
        }}
      />
    </div>
  );
}
