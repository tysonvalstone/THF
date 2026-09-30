"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Sequence } from "@/lib/ai/types";
import type { DataSnapshot } from "@/lib/data/types";
import type { Account, Contact } from "@/types/salesforce";
import { planFor, SEASON_PHASE_LABEL, seasonPhaseFor } from "@/lib/sequences/engine";
import { fmtShortDate } from "@/lib/dates";
import { FIELD_LABEL, STEP_TYPE_LABEL, canEmail, type Recipient } from "./sequence-store";
import { RenderedText } from "./parts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScheduleCallButton } from "@/components/call-desk/schedule-call";

/** Default preview recipient: first emailable contact at an account in the sequence's segment */
export function defaultRecipient(data: DataSnapshot, segment?: string): Recipient | null {
  const byId = new Map(data.accounts.map((a) => [a.Id, a]));
  const pick = (ok: (a: Account) => boolean) => {
    const c = data.contacts.find((x) => canEmail(x) && byId.has(x.AccountId) && ok(byId.get(x.AccountId)!));
    return c ? { key: c.Id, account: byId.get(c.AccountId)!, contact: c } : null;
  };
  return (segment ? pick((a) => a.Segment__c === segment && !a.ParentId) : null) ?? pick(() => true);
}

function RecipientPicker({ data, value, onChange }: { data: DataSnapshot; value: Recipient | null; onChange: (r: Recipient) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const byId = new Map(data.accounts.map((a) => [a.Id, a]));
    const out: Recipient[] = [];
    for (const c of data.contacts) {
      if (out.length >= 8) break;
      const a = byId.get(c.AccountId);
      if (a && (c.Name.toLowerCase().includes(s) || a.Name.toLowerCase().includes(s))) out.push({ key: c.Id, account: a, contact: c });
    }
    for (const a of data.accounts) {
      if (out.length >= 10) break;
      if (a.Name.toLowerCase().includes(s) && !out.some((r) => r.account.Id === a.Id && !r.contact)) out.push({ key: a.Id, account: a });
    }
    return out;
  }, [q, data]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={value ? `${value.contact?.Name ?? "Account only"} · ${value.account.Name}` : "Search contacts or accounts"}
        className="h-8 pl-8 text-sm"
        aria-label="Preview recipient"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-popover py-1 text-sm shadow-md">
          {matches.map((r) => (
            <li key={r.key}>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(r);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="block truncate">{r.contact ? r.contact.Name : `${r.account.Name} (account only)`}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.contact ? `${r.contact.Title} · ${r.account.Name}` : r.account.Segment__c} · {r.account.BillingState}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SequencePreview({
  sequence,
  data,
  asOf,
  senderName,
  recipient,
  onRecipient,
  onEnrollOne,
  enrollBlockedReason,
}: {
  sequence: Sequence;
  data: DataSnapshot;
  asOf: Date;
  senderName: string;
  recipient: Recipient | null;
  onRecipient: (r: Recipient) => void;
  onEnrollOne: (r: Recipient) => void;
  /** Why enrolling is blocked regardless of recipient (e.g. unsaved changes) */
  enrollBlockedReason?: string;
}) {
  const plan = useMemo(
    () => (recipient ? planFor(sequence, { account: recipient.account, contact: recipient.contact, sender: { name: senderName }, asOf, data, startDate: asOf }) : null),
    [sequence, recipient, senderName, asOf, data],
  );
  const unknown = useMemo(() => [...new Set((plan?.schedule ?? []).flatMap((s) => [...(s.rendered.subject?.unknown ?? []), ...s.rendered.body.unknown]))], [plan]);
  const contact: Contact | undefined = recipient?.contact;
  const missingReason = plan && plan.missing.length ? `${plan.missing.length} missing field${plan.missing.length === 1 ? "" : "s"}` : undefined;
  const blocked =
    missingReason ??
    enrollBlockedReason ??
    (!recipient ? "Pick a recipient" : contact && !contact.Email ? "No email address" : contact?.HasOptedOutOfEmail ? "Opted out of email" : undefined);

  return (
    <div className="space-y-3">
      <RecipientPicker data={data} value={recipient} onChange={onRecipient} />
      {recipient && (
        <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{contact ? `${contact.Name} · ${contact.Title}` : "Account only"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {recipient.account.Name} · {recipient.account.BillingState} · {recipient.account.Segment__c} · {SEASON_PHASE_LABEL[seasonPhaseFor(recipient.account, asOf)]}
            </p>
          </div>
          {plan && plan.missing.length > 0 && (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
              {plan.missing.length} missing field{plan.missing.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
      {plan && plan.missing.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          No value for {plan.missing.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}. Edit the text or pick a recipient with this data.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
          Unknown field{unknown.length === 1 ? "" : "s"}: {unknown.map((u) => `{{${u}}}`).join(", ")}
        </p>
      )}
      <ol className="space-y-2.5">
        {plan?.schedule.map(({ step, date, originalDate, reason, rendered }) => (
          <li key={step.id} className="rounded-md border bg-card">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b px-3 py-2 text-xs">
              <span className="font-medium">
                Day {step.day} · {STEP_TYPE_LABEL[step.type]}
              </span>
              <span className="text-muted-foreground tabular">{fmtShortDate(date)}</span>
              {originalDate && (
                <span className="text-muted-foreground">
                  Moved from {fmtShortDate(originalDate)} · {reason}
                </span>
              )}
              <span className="ml-auto text-muted-foreground">{rendered.variant ? `Variant: ${rendered.variant.name}` : "Default"}</span>
              {step.type === "call" && recipient && (
                <ScheduleCallButton
                  size="xs"
                  variant="ghost"
                  prefill={{ accountId: recipient.account.Id, contactIds: recipient.contact ? [recipient.contact.Id] : undefined, callType: "Follow-up", date, time: "10:00" }}
                />
              )}
            </div>
            <div className="space-y-2 px-3 py-2.5 text-sm">
              {rendered.subject && (
                <p className="font-medium">
                  <RenderedText segments={rendered.subject.segments} />
                </p>
              )}
              <p className="text-foreground/90">
                <RenderedText segments={rendered.body.segments} />
              </p>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {blocked && <span className={missingReason ? "text-xs text-amber-900" : "text-xs text-muted-foreground"}>{blocked}</span>}
        <Button size="sm" disabled={!!blocked} onClick={() => recipient && onEnrollOne(recipient)}>
          Enroll {recipient ? (contact?.FirstName ?? "account") : ""}
        </Button>
      </div>
    </div>
  );
}
