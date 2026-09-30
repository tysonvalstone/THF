"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneCall, Search } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { USERS, USER_BY_ID } from "@/data/reference/users";
import { CALL_TYPES, type Call, type CallType } from "@/types/salesforce";
import { toast } from "sonner";
import { scheduleCallMutations, fmtDay, fmtTime, type ScheduleCallInput } from "@/lib/call-desk";
import { RecordDrawer, type FieldDef, type FieldValue } from "@/components/shared/record-drawer";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCallContext, useCallScope } from "./use-call-desk";

export interface ScheduleCallPrefill {
  accountId?: string;
  opportunityId?: string;
  contactIds?: string[];
  callType?: CallType;
  /** YYYY-MM-DD */
  date?: string;
  /** HH:MM */
  time?: string;
}

const EVENT = "hs:schedule-call";
let hosts = 0;

/**
 * Opens the Schedule call drawer from anywhere. Uses a mounted
 * <ScheduleCallHost /> when there is one (Call Desk), else goes to Call Desk
 * with the prefill in the URL.
 */
export function openScheduleCall(prefill: ScheduleCallPrefill = {}) {
  if (typeof window === "undefined") return;
  if (hosts > 0) {
    window.dispatchEvent(new CustomEvent<ScheduleCallPrefill>(EVENT, { detail: prefill }));
    return;
  }
  const p = new URLSearchParams({ schedule: "1" });
  if (prefill.accountId) p.set("account", prefill.accountId);
  if (prefill.opportunityId) p.set("opp", prefill.opportunityId);
  if (prefill.contactIds?.length) p.set("contacts", prefill.contactIds.join(","));
  if (prefill.callType) p.set("type", prefill.callType);
  if (prefill.date) p.set("date", prefill.date);
  if (prefill.time) p.set("time", prefill.time);
  // Plain function (no router here): a full navigation to Call Desk is fine
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/call-desk?${p.toString()}`);
}

/** Listens for openScheduleCall() while mounted */
export function ScheduleCallHost({ onScheduled }: { onScheduled?: (callId: string, date: string) => void }) {
  const [prefill, setPrefill] = useState<ScheduleCallPrefill | null>(null);
  useEffect(() => {
    hosts++;
    const on = (e: Event) => setPrefill((e as CustomEvent<ScheduleCallPrefill>).detail ?? {});
    window.addEventListener(EVENT, on);
    return () => {
      hosts--;
      window.removeEventListener(EVENT, on);
    };
  }, []);
  return <ScheduleCallFlow prefill={prefill} onClose={() => setPrefill(null)} onScheduled={onScheduled} />;
}

/** Account search (the first step when scheduling without an account) */
function AccountPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (accountId: string) => void }) {
  const { data } = useStore();
  const { userId, canSeeTeam } = useCallScope();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const mineFirst = [...data.accounts]
      .filter((a) => !a.ParentId && (canSeeTeam || a.OwnerId === userId || !data.accounts.some((x) => x.OwnerId === userId)))
      .sort((a, b) => Number(b.OwnerId === userId) - Number(a.OwnerId === userId) || a.Name.localeCompare(b.Name));
    return (s ? mineFirst.filter((a) => a.Name.toLowerCase().includes(s) || a.BillingCity.toLowerCase().includes(s)) : mineFirst).slice(0, 40);
  }, [q, data.accounts, userId, canSeeTeam]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Schedule call</DialogTitle>
          <DialogDescription>Pick the account.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts" aria-label="Search accounts" className="pl-8" />
        </div>
        <ul className="max-h-80 overflow-y-auto rounded-md border" role="listbox" aria-label="Accounts">
          {list.map((a) => (
            <li key={a.Id}>
              <button type="button" role="option" aria-selected={false} className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted" onClick={() => onPick(a.Id)}>
                <span className="block truncate font-medium">{a.Name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {a.Segment__c} · {a.BillingCity}, {a.BillingState} · {USER_BY_ID[a.OwnerId]?.Name ?? ""}
                </span>
              </button>
            </li>
          ))}
          {!list.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No accounts match</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

/** A sensible call type for the deal's stage */
function defaultType(stage: string | undefined, customer: boolean): CallType {
  if (!stage) return customer ? "Check-in" : "Discovery";
  if (stage === "Prospecting" || stage === "Qualification") return "Discovery";
  if (stage === "Needs Analysis") return "Demo";
  if (stage === "Proposal") return "Follow-up";
  return "Negotiation";
}

const TIMES = Array.from({ length: (18 - 7) * 4 + 1 }, (_, i) => {
  const m = 7 * 60 + i * 15;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
});

/** Create or edit a call in the RecordDrawer; delete with ConfirmDialog + Undo */
export function ScheduleCallDrawer({
  open,
  onOpenChange,
  accountId,
  prefill,
  call,
  onScheduled,
  linkToDesk,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accountId: string;
  prefill?: ScheduleCallPrefill;
  call?: Call;
  onScheduled?: (callId: string, date: string) => void;
  /** Outside Call Desk: the toast links to the new call */
  linkToDesk?: boolean;
}) {
  const router = useRouter();
  const { data, asOfISO } = useStore();
  const ctx = useCallContext();
  const { run, remove } = useCrud();
  const { canSeeTeam } = useCallScope();
  const [confirm, setConfirm] = useState(false);
  const account = data.accounts.find((a) => a.Id === accountId);
  const contacts = useMemo(() => data.contacts.filter((c) => c.AccountId === accountId), [data.contacts, accountId]);
  const opps = useMemo(() => data.opportunities.filter((o) => o.AccountId === accountId && (!o.IsClosed || o.Id === call?.OpportunityId)), [data.opportunities, accountId, call]);

  const fields: FieldDef[] = [
    { name: "callType", label: "Call type", type: "select", required: true, options: CALL_TYPES.map((t) => ({ value: t, label: t })) },
    { name: "opportunityId", label: "Opportunity", type: "select", options: opps.map((o) => ({ value: o.Id, label: `${o.Name} (${o.StageName})` })) },
    { name: "date", label: "Date", type: "date", required: true },
    { name: "time", label: "Time", type: "select", required: true, options: TIMES.map((t) => ({ value: t, label: fmtTime(t) })) },
    { name: "durationMin", label: "Length", type: "select", required: true, options: [15, 30, 45, 60].map((m) => ({ value: String(m), label: `${m} min` })) },
    ...(canSeeTeam ? [{ name: "ownerId", label: "Rep", type: "select" as const, required: true, options: USERS.slice(4).map((u) => ({ value: u.Id, label: u.Name })) }] : []),
    { name: "subject", label: "Subject", type: "text", wide: true, placeholder: account ? `Discovery: ${account.Name}` : "" },
    ...contacts.map(
      (c, i): FieldDef => ({
        name: `c_${c.Id}`,
        label: `${c.Name} · ${c.Title} (${c.Buying_Role__c})`,
        type: "checkbox",
        wide: true,
        ...(i === 0
          ? {
              validate: (_v: FieldValue, all: Record<string, FieldValue>) => (Object.keys(all).some((k) => k.startsWith("c_") && all[k]) ? null : "Pick at least one contact"),
            }
          : {}),
      }),
    ),
  ];

  const selected = new Set(call?.ContactIds ?? prefill?.contactIds ?? (contacts[0] ? [contacts[0].Id] : []));
  const defaultOpp = call?.OpportunityId ?? prefill?.opportunityId ?? opps.filter((o) => !o.IsClosed).sort((a, b) => b.Probability - a.Probability)[0]?.Id ?? "";
  const initial: Record<string, FieldValue> = {
    callType: call?.CallType ?? prefill?.callType ?? defaultType(opps.find((o) => o.Id === defaultOpp)?.StageName, account?.Type === "Customer - Direct"),
    opportunityId: defaultOpp,
    date: call?.Start.slice(0, 10) ?? prefill?.date ?? asOfISO,
    time: call?.Start.slice(11, 16) ?? prefill?.time ?? "10:00",
    durationMin: String(call?.DurationMin ?? 30),
    ownerId: call?.OwnerId ?? account?.OwnerId ?? USERS[4].Id,
    subject: call?.Subject ?? "",
    ...Object.fromEntries(contacts.map((c) => [`c_${c.Id}`, selected.has(c.Id)])),
  };

  return (
    <>
      <RecordDrawer
        open={open}
        onOpenChange={onOpenChange}
        title={call ? "Edit call" : "Schedule call"}
        description={account ? `${account.Name} · ${account.BillingCity}, ${account.BillingState}` : undefined}
        fields={fields}
        initial={initial}
        submitLabel={call ? "Save" : "Schedule"}
        onDelete={call ? () => setConfirm(true) : undefined}
        onSubmit={(v) => {
          const input: ScheduleCallInput = {
            ...(call ? { id: call.Id } : {}),
            accountId,
            opportunityId: String(v.opportunityId ?? "") || undefined,
            contactIds: contacts.filter((c) => v[`c_${c.Id}`]).map((c) => c.Id),
            callType: v.callType as CallType,
            date: String(v.date),
            time: String(v.time),
            durationMin: Number(v.durationMin) || 30,
            subject: String(v.subject ?? "") || undefined,
            ...(canSeeTeam && v.ownerId ? { ownerId: String(v.ownerId) } : {}),
          };
          if (!input.subject && call) input.subject = `${input.callType}: ${account?.Name ?? ""}`;
          const r = scheduleCallMutations(ctx, input);
          const message = call ? "Call updated" : `Call scheduled for ${fmtDay(input.date)}, ${fmtTime(input.time)}`;
          if (linkToDesk) {
            run(r.mutations);
            toast.success(message, { action: { label: "Open Call Desk", onClick: () => router.push(`/call-desk?date=${input.date}&call=${r.callId}`) } });
          } else run(r.mutations, message);
          onOpenChange(false);
          onScheduled?.(r.callId, input.date);
        }}
      />
      {call && (
        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title="Delete this call?"
          description={`${call.Subject}. You can undo this for a few seconds afterwards.`}
          onConfirm={() => {
            onOpenChange(false);
            remove("Call", call.Id, "Call");
          }}
        />
      )}
    </>
  );
}

/** Picks an account first when the prefill has none, then opens the drawer */
export function ScheduleCallFlow({
  prefill,
  onClose,
  onScheduled,
  linkToDesk,
}: {
  prefill: ScheduleCallPrefill | null;
  onClose: () => void;
  onScheduled?: (callId: string, date: string) => void;
  linkToDesk?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const accountId = prefill?.accountId ?? picked;
  const close = () => {
    setPicked(null);
    onClose();
  };
  return (
    <>
      <AccountPicker open={!!prefill && !accountId} onOpenChange={(o) => !o && close()} onPick={setPicked} />
      {accountId && <ScheduleCallDrawer open={!!prefill} onOpenChange={(o) => !o && close()} accountId={accountId} prefill={prefill ?? undefined} onScheduled={onScheduled} linkToDesk={linkToDesk} />}
    </>
  );
}

/** Small "Schedule call" button with its own drawer (account, opportunity and map pages, trip planner, sequences) */
export function ScheduleCallButton({
  prefill,
  label = "Schedule call",
  size = "sm",
  variant = "outline",
  className,
  iconOnly,
}: {
  prefill: ScheduleCallPrefill;
  label?: string;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "default";
  className?: string;
  /** Compact icon button (the label becomes the tooltip) */
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState<ScheduleCallPrefill | null>(null);
  return (
    // Stop clicks (also from the portalled drawer) reaching clickable parent rows
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      {iconOnly ? (
        <Button size="icon-xs" variant="ghost" className={className} aria-label={label} title={label} onClick={() => setOpen(prefill)}>
          <PhoneCall />
        </Button>
      ) : (
        <Button size={size} variant={variant} className={className} onClick={() => setOpen(prefill)}>
          <PhoneCall data-icon="inline-start" />
          {label}
        </Button>
      )}
      <ScheduleCallFlow prefill={open} onClose={() => setOpen(null)} linkToDesk />
    </span>
  );
}
