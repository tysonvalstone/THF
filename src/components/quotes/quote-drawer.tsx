"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import type { Mutation } from "@/lib/data/types";
import type { BillingFrequency, Quote } from "@/types/salesforce";
import { addDays, fmtDate, fmtShortDate, toISODate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { nextBoardMeeting } from "@/lib/seasonality";
import { defaultPricebookFor } from "@/lib/quotes/catalog";
import {
  BILLING_OPTIONS,
  DEFAULT_VALID_DAYS,
  PAYMENT_TERMS,
  TERM_OPTIONS,
  buildQuoteFromOpportunity,
  defaultContactFor,
  goLiveWarning,
  suggestGoLiveFor,
} from "@/lib/quotes/build";
import { changePricebookMutations, isEditable, quoteLines, repriceChanges } from "@/lib/quotes/lifecycle";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fieldSelectCls, useQuoteContext } from "./shared";

export interface QuoteDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this quote's header; create a new quote when omitted */
  quote?: Quote;
  /** New quote: preselect (and lock) this opportunity */
  opportunityId?: string;
  /** New quote: open the builder after creating (default true) */
  navigate?: boolean;
}

/** New quote, or edit a quote's header, in a side drawer */
export function QuoteDrawer(props: QuoteDrawerProps) {
  const { open, onOpenChange, quote } = props;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[600px]">
        <div className="border-b px-5 py-4 pr-12">
          <SheetTitle className="text-base font-semibold">{quote ? `Edit ${quote.QuoteNumber}` : "New quote"}</SheetTitle>
          <SheetDescription className="sr-only">{quote ? "Edit quote header" : "Create a quote"}</SheetDescription>
        </div>
        {open && <QuoteForm {...props} />}
      </SheetContent>
    </Sheet>
  );
}

interface Values {
  opportunityId: string;
  name: string;
  nameTouched: boolean;
  pricebookId: string;
  contactId: string;
  term: number;
  billing: BillingFrequency;
  paymentTerms: Quote["Payment_Terms__c"];
  start: string;
  expiration: string;
  discount: string;
  tax: string;
  description: string;
  lines: "opportunity" | "fit" | "none";
}

function Field({ label, htmlFor, children, error, hint, wide }: { label: string; htmlFor: string; children: React.ReactNode; error?: string | null; hint?: React.ReactNode; wide?: boolean }) {
  return (
    <div className={cn("grid content-start gap-1.5", wide && "sm:col-span-2")}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-status-critical">{error}</p> : hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function QuoteForm({ onOpenChange, quote, opportunityId, navigate = true }: QuoteDrawerProps) {
  const { data, asOf } = useStore();
  const ctx = useQuoteContext();
  const { run } = useCrud();
  const router = useRouter();
  const editing = !!quote;
  const locked = editing && !isEditable(quote, asOf);

  const initial = (): Values => {
    if (quote)
      return {
        opportunityId: quote.OpportunityId,
        name: quote.Name,
        nameTouched: true,
        pricebookId: quote.Pricebook2Id,
        contactId: quote.ContactId ?? "",
        term: quote.Contract_Term_Months__c,
        billing: quote.Billing_Frequency__c,
        paymentTerms: quote.Payment_Terms__c,
        start: quote.Start_Date__c,
        expiration: quote.ExpirationDate,
        discount: String(quote.Discount__c ?? 0),
        tax: String(quote.Tax_Rate__c ?? 0),
        description: quote.Description ?? "",
        lines: "none",
      };
    return withOpportunity(
      {
        opportunityId: "",
        name: "",
        nameTouched: false,
        pricebookId: "",
        contactId: "",
        term: 36,
        billing: "Annual",
        paymentTerms: "Net 30",
        start: "",
        expiration: toISODate(addDays(asOf, DEFAULT_VALID_DAYS)),
        discount: "0",
        tax: "0",
        description: "",
        lines: "opportunity",
      },
      opportunityId ?? "",
    );
  };

  /** Defaults that follow the chosen opportunity */
  function withOpportunity(v: Values, oppId: string): Values {
    const opp = data.opportunities.find((o) => o.Id === oppId);
    if (!opp) return { ...v, opportunityId: "" };
    const a = data.accounts.find((x) => x.Id === opp.AccountId);
    const coop = a?.Segment__c === "Multi-Location Co-op";
    const hasLines = data.lineItems.some((l) => l.OpportunityId === opp.Id);
    return {
      ...v,
      opportunityId: opp.Id,
      pricebookId: defaultPricebookFor(a, data.pricebooks)?.Id ?? "",
      contactId: defaultContactFor(data, opp)?.Id ?? "",
      term: v.term,
      paymentTerms: coop ? "Net 45" : "Net 30",
      start: toISODate(suggestGoLiveFor(a, opp, asOf)),
      name: v.nameTouched ? v.name : `${a?.Name ?? opp.Name} · ${v.term}-month proposal`,
      lines: hasLines ? "opportunity" : "fit",
    };
  }

  const [v, setV] = useState<Values>(initial);
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((s) => ({ ...s, [k]: val }));

  const opp = data.opportunities.find((o) => o.Id === v.opportunityId);
  const account = opp ? data.accounts.find((a) => a.Id === opp.AccountId) : undefined;
  const contacts = account ? data.contacts.filter((c) => c.AccountId === account.Id) : [];
  const oppLineCount = opp ? data.lineItems.filter((l) => l.OpportunityId === opp.Id).length : 0;
  const book = data.pricebooks.find((b) => b.Id === v.pricebookId);
  const suggestedBook = defaultPricebookFor(account, data.pricebooks);
  const suggested = toISODate(suggestGoLiveFor(account, opp, asOf));
  const liveWarn = goLiveWarning(account, v.start);
  const needsBoard = account?.Segment__c === "Multi-Location Co-op" || opp?.StageName === "Board Approval";
  const meeting = needsBoard ? nextBoardMeeting(account?.Board_Meeting_Months__c, asOf) : null;

  const num = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const errors = {
    opportunityId: !v.opportunityId ? "Required" : null,
    name: !v.name.trim() ? "Required" : null,
    pricebookId: !v.pricebookId ? "Required" : null,
    start: !v.start ? "Required" : null,
    expiration: !v.expiration ? "Required" : v.expiration < toISODate(asOf) && !editing ? "Must be today or later" : null,
    discount: !(num(v.discount) >= 0 && num(v.discount) <= 100) ? "0 to 100" : null,
    tax: !(num(v.tax) >= 0 && num(v.tax) <= 30) ? "0 to 30" : null,
  };
  const show = (k: keyof typeof errors) => (submitted ? errors[k] : null);

  const submit = () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    const header = {
      Name: v.name.trim(),
      ContactId: v.contactId || undefined,
      Contract_Term_Months__c: v.term,
      Billing_Frequency__c: v.billing,
      Payment_Terms__c: v.paymentTerms,
      Start_Date__c: v.start,
      ExpirationDate: v.expiration,
      Discount__c: num(v.discount),
      Tax_Rate__c: num(v.tax),
      Description: v.description.trim(),
    };
    if (!quote) {
      const built = buildQuoteFromOpportunity(ctx, v.opportunityId, {
        name: header.Name,
        pricebookId: v.pricebookId,
        contactId: header.ContactId,
        termMonths: v.term,
        billingFrequency: v.billing,
        paymentTerms: v.paymentTerms,
        startDate: v.start,
        expirationDate: v.expiration,
        headerDiscount: header.Discount__c,
        taxRate: header.Tax_Rate__c,
        description: header.Description || undefined,
        lines: v.lines,
      });
      run(built.mutations, `Quote ${built.quote.QuoteNumber} created`);
      onOpenChange(false);
      if (navigate) router.push(`/quotes/${built.quote.Id}`);
      return;
    }
    const pricing = header.Contract_Term_Months__c !== quote.Contract_Term_Months__c || header.Discount__c !== quote.Discount__c || header.Tax_Rate__c !== quote.Tax_Rate__c;
    const changes: Partial<Quote> = { ...header, ContactId: v.contactId || "" };
    let mutations: Mutation[];
    if (v.pricebookId !== quote.Pricebook2Id) mutations = changePricebookMutations(ctx, quote.Id, v.pricebookId, changes);
    else if (pricing) mutations = [{ op: "update", object: "Quote", id: quote.Id, changes: repriceChanges(quote, quoteLines(data, quote.Id), data, changes) }];
    else mutations = [{ op: "update", object: "Quote", id: quote.Id, changes }];
    run(mutations, `Quote ${quote.QuoteNumber} updated`);
    onOpenChange(false);
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-5 sm:grid-cols-2">
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="q-opp">Opportunity</Label>
          {editing || opportunityId ? (
            <p id="q-opp" className="text-sm">
              {opp?.Name ?? "—"}
              {account && <span className="text-muted-foreground"> · {account.Name} · {opp?.StageName}</span>}
            </p>
          ) : (
            <OpportunityPicker value={v.opportunityId} onChange={(id) => setV((s) => withOpportunity(s, id))} error={show("opportunityId")} />
          )}
        </div>

        <Field label="Quote name" htmlFor="q-name" error={show("name")} wide>
          <Input id="q-name" value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value, nameTouched: true }))} />
        </Field>

        <Field
          label="Price book"
          htmlFor="q-book"
          error={show("pricebookId")}
          hint={suggestedBook && account && suggestedBook.Id !== v.pricebookId ? `Default for this account: ${suggestedBook.Name}` : editing && v.pricebookId !== quote?.Pricebook2Id ? "Lines are re-priced from this book" : null}
        >
          <select id="q-book" value={v.pricebookId} disabled={locked} onChange={(e) => set("pricebookId", e.target.value)} className={fieldSelectCls}>
            {!v.pricebookId && <option value="">Select…</option>}
            {data.pricebooks
              .filter((b) => b.IsActive || b.Id === v.pricebookId)
              .map((b) => (
                <option key={b.Id} value={b.Id}>
                  {b.Name.includes(b.CurrencyIsoCode) ? b.Name : `${b.Name} (${b.CurrencyIsoCode})`}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Contact" htmlFor="q-contact">
          <select id="q-contact" value={v.contactId} onChange={(e) => set("contactId", e.target.value)} className={fieldSelectCls} disabled={!account}>
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.Id} value={c.Id}>
                {c.Name} · {c.Buying_Role__c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Term" htmlFor="q-term">
          <select
            id="q-term"
            value={v.term}
            disabled={locked}
            onChange={(e) => {
              const term = Number(e.target.value);
              setV((s) => ({ ...s, term, name: !s.nameTouched && account ? `${account.Name} · ${term}-month proposal` : s.name }));
            }}
            className={fieldSelectCls}
          >
            {TERM_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t} months
              </option>
            ))}
          </select>
        </Field>

        <Field label="Billing" htmlFor="q-billing">
          <select id="q-billing" value={v.billing} onChange={(e) => set("billing", e.target.value as BillingFrequency)} className={fieldSelectCls}>
            {BILLING_OPTIONS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </Field>

        <Field label="Payment terms" htmlFor="q-pay">
          <select id="q-pay" value={v.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value as Quote["Payment_Terms__c"])} className={fieldSelectCls}>
            {PAYMENT_TERMS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>

        <Field
          label="Go-live"
          htmlFor="q-start"
          error={show("start")}
          hint={
            liveWarn ? (
              <span className="text-amber-800">
                {liveWarn}{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => set("start", suggested)}>
                  Use {fmtShortDate(suggested)}
                </button>
              </span>
            ) : account && v.start !== suggested ? (
              <button type="button" className="text-primary hover:underline" onClick={() => set("start", suggested)}>
                Suggested: {fmtDate(suggested)}
              </button>
            ) : account ? (
              "After harvest"
            ) : null
          }
        >
          <Input id="q-start" type="date" value={v.start} onChange={(e) => set("start", e.target.value)} />
        </Field>

        <Field
          label="Valid until"
          htmlFor="q-exp"
          error={show("expiration")}
          hint={
            meeting && v.expiration && v.expiration < toISODate(meeting) ? (
              <span className="text-amber-800">
                Expires before the board meeting ({fmtShortDate(meeting)}).{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => set("expiration", toISODate(addDays(meeting, 14)))}>
                  Extend to {fmtShortDate(addDays(meeting, 14))}
                </button>
              </span>
            ) : meeting ? (
              `Board meets ${fmtShortDate(meeting)}`
            ) : null
          }
        >
          <Input id="q-exp" type="date" value={v.expiration} onChange={(e) => set("expiration", e.target.value)} />
        </Field>

        <Field label="Header discount (recurring)" htmlFor="q-disc" error={show("discount")}>
          <div className="relative">
            <Input id="q-disc" type="number" min={0} max={100} step={0.5} value={v.discount} disabled={locked} onChange={(e) => set("discount", e.target.value)} className="pr-7" />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
        </Field>

        <Field label="Tax rate" htmlFor="q-tax" error={show("tax")}>
          <div className="relative">
            <Input id="q-tax" type="number" min={0} max={30} step={0.25} value={v.tax} disabled={locked} onChange={(e) => set("tax", e.target.value)} className="pr-7" />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </div>
        </Field>

        {!editing && opp && (
          <fieldset className="grid gap-2 sm:col-span-2">
            <legend className="mb-1 text-sm font-medium">Line items</legend>
            {(
              [
                ["opportunity", `From the opportunity (${oppLineCount} product${oppLineCount === 1 ? "" : "s"})`, oppLineCount === 0],
                ["fit", `From product fit (${account?.Facility_Type__c ?? "facility"})`, false],
                ["none", "Start empty", false],
              ] as const
            ).map(([val, label, disabled]) => (
              <label key={val} className={cn("flex items-center gap-2 text-sm", disabled && "opacity-50")}>
                <input type="radio" name="q-lines" value={val} checked={v.lines === val} disabled={disabled} onChange={() => set("lines", val)} className="accent-[#1f5f4a]" />
                {label}
              </label>
            ))}
          </fieldset>
        )}

        <Field label="Notes" htmlFor="q-desc" wide>
          <textarea id="q-desc" rows={3} value={v.description} onChange={(e) => set("description", e.target.value)} className="w-full rounded-md border border-input bg-card px-2.5 py-2 text-sm outline-none focus:border-primary/50" />
        </Field>

        {book && !editing && account && (
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {account.Name} · {account.Number_of_Locations__c} location{account.Number_of_Locations__c === 1 ? "" : "s"} · {account.Scales__c ?? 0} scale{account.Scales__c === 1 ? "" : "s"} · {book.CurrencyIsoCode}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 border-t px-5 py-3">
        {submitted && Object.values(errors).some(Boolean) && <p className="text-sm text-status-critical">Check the highlighted fields</p>}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit">{editing ? "Save" : "Create quote"}</Button>
        </div>
      </div>
    </form>
  );
}

/** Searchable list of open opportunities (name, account, stage, amount) */
function OpportunityPicker({ value, onChange, error }: { value: string; onChange: (id: string) => void; error: string | null }) {
  const { data } = useStore();
  const [q, setQ] = useState("");
  const accounts = useMemo(() => new Map(data.accounts.map((a) => [a.Id, a])), [data.accounts]);
  const open = useMemo(
    () =>
      data.opportunities
        .filter((o) => !o.IsClosed)
        .sort((a, b) => b.Probability - a.Probability || b.Amount - a.Amount),
    [data.opportunities],
  );
  const chosen = open.find((o) => o.Id === value) ?? data.opportunities.find((o) => o.Id === value);
  if (chosen) {
    const a = accounts.get(chosen.AccountId);
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border bg-slate-50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-medium">{chosen.Name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {a?.Name} · {chosen.StageName} · {fmtMoney(chosen.Amount)}
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Change opportunity" onClick={() => onChange("")}>
          <X />
        </Button>
      </div>
    );
  }
  const needle = q.trim().toLowerCase();
  const hits = (needle ? open.filter((o) => `${o.Name} ${accounts.get(o.AccountId)?.Name ?? ""}`.toLowerCase().includes(needle)) : open).slice(0, 8);
  return (
    <div className="grid gap-1.5">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input id="q-opp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search open opportunities" className={cn("pl-8", error && "border-status-critical")} autoFocus />
      </div>
      <ul className="max-h-64 divide-y overflow-y-auto rounded-md border" role="listbox" aria-label="Open opportunities">
        {hits.map((o) => {
          const a = accounts.get(o.AccountId);
          return (
            <li key={o.Id}>
              <button type="button" role="option" aria-selected={false} onClick={() => onChange(o.Id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span className="min-w-0">
                  <span className="block truncate">{o.Name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a?.Name} · {a?.BillingState}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block">{o.StageName}</span>
                  <span className="block text-muted-foreground tabular">{fmtMoney(o.Amount)}</span>
                </span>
              </button>
            </li>
          );
        })}
        {!hits.length && <li className="px-3 py-4 text-center text-sm text-muted-foreground">No open opportunities match</li>}
      </ul>
      {error && <p className="text-xs text-status-critical">{error}</p>}
    </div>
  );
}

