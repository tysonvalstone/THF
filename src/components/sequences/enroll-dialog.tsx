"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Enrollment, Sequence } from "@/lib/ai/types";
import type { DataSnapshot } from "@/lib/data/types";
import type { Account } from "@/types/salesforce";
import { SEGMENTS, COMMODITIES } from "@/types/salesforce";
import { REGIONS, REGION_BY_ID } from "@/data/reference/regions";
import { planFor, usesContactFields } from "@/lib/sequences/engine";
import { fmtShortDate } from "@/lib/dates";
import { canEmail, recipientName, type Recipient } from "./sequence-store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ALL = "__all";
const MAX_ROWS = 300;

export interface EnrollRow {
  r: Recipient;
  variant: string;
  status: "ready" | "missing" | "enrolled";
  label: string;
  missingCount: number;
}

type Filters = { segment: string; state: string; region: string; commodity: string; type: string; q: string };

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" className="h-8 w-full text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{`All ${label.toLowerCase()}`}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EnrollDialog({
  open,
  onOpenChange,
  sequence,
  sequences,
  onSequence,
  data,
  asOf,
  senderName,
  enrollments,
  handoff,
  onClearHandoff,
  onEnroll,
  blockedReason,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  sequence: Sequence;
  sequences: Sequence[];
  onSequence: (id: string) => void;
  data: DataSnapshot;
  asOf: Date;
  senderName: string;
  enrollments: Enrollment[];
  handoff: { accountIds: string[]; from: string } | null;
  onClearHandoff: () => void;
  onEnroll: (ready: Recipient[], skipped: EnrollRow[]) => void;
  blockedReason?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        {open && (
          <EnrollBody
            key={`${sequence.id}-${handoff?.from ?? ""}`}
            sequence={sequence}
            sequences={sequences}
            onSequence={onSequence}
            data={data}
            asOf={asOf}
            senderName={senderName}
            enrollments={enrollments}
            handoff={handoff}
            onClearHandoff={onClearHandoff}
            onEnroll={onEnroll}
            blockedReason={blockedReason}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EnrollBody({
  sequence,
  sequences,
  onSequence,
  data,
  asOf,
  senderName,
  enrollments,
  handoff,
  onClearHandoff,
  onEnroll,
  blockedReason,
}: Omit<Parameters<typeof EnrollDialog>[0], "open" | "onOpenChange">) {
  const [filters, setFilters] = useState<Filters>({
    segment: handoff ? ALL : sequence.segment && SEGMENTS.includes(sequence.segment as never) ? sequence.segment : ALL,
    state: ALL,
    region: ALL,
    commodity: ALL,
    type: ALL,
    q: "",
  });
  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const accountLevelOk = !usesContactFields(sequence);
  const handoffIds = useMemo(() => new Set(handoff?.accountIds ?? []), [handoff]);

  const states = useMemo(() => [...new Set(data.accounts.map((a) => a.BillingState))].sort(), [data.accounts]);

  const { rows, total } = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const match = (a: Account) =>
      (!handoffIds.size || handoffIds.has(a.Id)) &&
      (filters.segment === ALL || a.Segment__c === filters.segment) &&
      (filters.state === ALL || a.BillingState === filters.state) &&
      (filters.region === ALL || a.Region__c === filters.region) &&
      (filters.commodity === ALL || a.Primary_Commodities__c.includes(filters.commodity as never)) &&
      (filters.type === ALL || (filters.type === "customer" ? a.Type === "Customer - Direct" : a.Type === "Prospect"));
    const accounts = data.accounts.filter(match);
    const contactsBy = new Map<string, typeof data.contacts>();
    for (const c of data.contacts) {
      if (!canEmail(c)) continue;
      const list = contactsBy.get(c.AccountId);
      if (list) list.push(c);
      else contactsBy.set(c.AccountId, [c]);
    }
    const recips: Recipient[] = [];
    for (const a of accounts) {
      const cs = contactsBy.get(a.Id) ?? [];
      if (cs.length) cs.forEach((c) => recips.push({ key: c.Id, account: a, contact: c }));
      else recips.push({ key: a.Id, account: a });
    }
    const filtered = q ? recips.filter((r) => recipientName(r).toLowerCase().includes(q) || r.account.Name.toLowerCase().includes(q)) : recips;
    const enrolled = new Set(enrollments.filter((e) => e.sequenceId === sequence.id).map((e) => e.contactId ?? e.accountId));
    const firstEmail = [...sequence.steps].sort((a, b) => a.day - b.day).find((s) => s.type === "email");
    const out: EnrollRow[] = filtered.slice(0, MAX_ROWS).map((r) => {
      const plan = planFor(sequence, { account: r.account, contact: r.contact, sender: { name: senderName }, asOf, data, startDate: asOf });
      const first = plan.schedule[0];
      const emailStep = plan.schedule.find((s) => s.step.id === firstEmail?.id);
      const variant = emailStep ? (emailStep.rendered.variant?.name ?? "Default") : "—";
      const missing = !r.contact && !accountLevelOk ? Math.max(plan.missing.length, 1) : plan.missing.length;
      if (enrolled.has(r.contact?.Id ?? r.account.Id)) return { r, variant, status: "enrolled", label: "Already enrolled", missingCount: 0 };
      if (missing) return { r, variant, status: "missing", label: `${missing} missing field${missing === 1 ? "" : "s"}`, missingCount: missing };
      return { r, variant, status: "ready", label: first?.originalDate ? `Starts ${fmtShortDate(first.date)} (blackout)` : "Ready", missingCount: 0 };
    });
    return { rows: out, total: filtered.length };
  }, [data, filters, handoffIds, enrollments, sequence, senderName, asOf, accountLevelOk]);

  const [selected, setSelected] = useState<Set<string>>(() => (handoff ? new Set(rows.filter((x) => x.status === "ready").map((x) => x.r.key)) : new Set()));
  const chosen = rows.filter((x) => selected.has(x.r.key));
  const ready = chosen.filter((x) => x.status === "ready");
  const skipped = chosen.filter((x) => x.status !== "ready");
  const allOn = rows.length > 0 && rows.every((x) => selected.has(x.r.key));

  return (
    <>
      <DialogHeader>
        <DialogTitle>Enroll recipients</DialogTitle>
        <DialogDescription className="sr-only">Pick contacts to enroll in the sequence</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={sequence.id} onValueChange={onSequence}>
          <SelectTrigger size="sm" className="h-8 w-full sm:w-72" aria-label="Sequence">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sequences.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {handoff && (
          <span className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-1 text-xs">
            From: {handoff.from} · {handoff.accountIds.length} account{handoff.accountIds.length === 1 ? "" : "s"}
            <button type="button" aria-label="Clear" onClick={onClearHandoff} className="text-muted-foreground hover:text-foreground">
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <FilterSelect label="Segments" value={filters.segment} onChange={set("segment")} options={SEGMENTS.map((s) => ({ value: s, label: s }))} />
        <FilterSelect label="Regions" value={filters.region} onChange={set("region")} options={REGIONS.map((r) => ({ value: r.id, label: r.name }))} />
        <FilterSelect label="States" value={filters.state} onChange={set("state")} options={states.map((s) => ({ value: s, label: s }))} />
        <FilterSelect label="Commodities" value={filters.commodity} onChange={set("commodity")} options={COMMODITIES.map((c) => ({ value: c, label: c }))} />
        <FilterSelect
          label="Types"
          value={filters.type}
          onChange={set("type")}
          options={[
            { value: "customer", label: "Customers" },
            { value: "prospect", label: "Prospects" },
          ]}
        />
        <Input value={filters.q} onChange={(e) => set("q")(e.target.value)} placeholder="Search" className="h-8 text-xs" aria-label="Search recipients" />
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {total > rows.length ? `Showing ${rows.length} of ${total}` : `${total} recipient${total === 1 ? "" : "s"}`} · contacts with email, not opted out
        </span>
        <span className="flex gap-1">
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set(rows.map((x) => x.r.key)))}>
            Select all
          </Button>
          <Button variant="ghost" size="xs" onClick={() => setSelected(new Set())}>
            None
          </Button>
        </span>
      </div>

      <div className="overflow-hidden rounded-md border">
        <div className="hidden grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <Checkbox
            checked={allOn}
            onCheckedChange={(v) => setSelected(v ? new Set(rows.map((x) => x.r.key)) : new Set())}
            aria-label="Select all"
          />
          <span>Recipient</span>
          <span>Account</span>
          <span>Variant</span>
          <span>Status</span>
        </div>
        <ul className="max-h-[46vh] divide-y overflow-y-auto">
          {rows.map((x) => (
            <li key={x.r.key}>
              <label className="grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 px-3 py-2 text-sm hover:bg-muted/30 md:grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                <Checkbox
                  checked={selected.has(x.r.key)}
                  onCheckedChange={(v) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (v) n.add(x.r.key);
                      else n.delete(x.r.key);
                      return n;
                    })
                  }
                  aria-label={`Select ${recipientName(x.r)}`}
                />
                <span className="min-w-0">
                  <span className="block truncate">{x.r.contact ? x.r.contact.Name : "Account only"}</span>
                  <span className="block truncate text-xs text-muted-foreground">{x.r.contact?.Title ?? "No contact"}</span>
                </span>
                <span className="col-start-2 min-w-0 md:col-start-auto">
                  <span className="block truncate">{x.r.account.Name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {x.r.account.BillingState} · {REGION_BY_ID[x.r.account.Region__c]?.shortName} · {x.r.account.Type === "Prospect" ? "Prospect" : "Customer"}
                  </span>
                </span>
                <span className="col-start-2 truncate text-xs text-muted-foreground md:col-start-auto md:text-sm md:text-foreground">{x.variant}</span>
                <span className="col-start-2 md:col-start-auto">
                  <span
                    className={cn(
                      "inline-block rounded-md px-1.5 py-0.5 text-xs",
                      x.status === "missing" ? "bg-amber-100 text-amber-900" : x.status === "enrolled" ? "text-muted-foreground" : "bg-muted text-foreground",
                    )}
                  >
                    {x.label}
                  </span>
                </span>
              </label>
            </li>
          ))}
          {!rows.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">No matching recipients</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          {chosen.length} selected
          {skipped.length ? ` · ${skipped.length} will be skipped` : ""}
          {blockedReason ? ` · ${blockedReason}` : ""}
        </span>
        <Button size="sm" disabled={!ready.length || !!blockedReason} onClick={() => onEnroll(ready.map((x) => x.r), skipped)}>
          Enroll {ready.length}
        </Button>
      </div>
    </>
  );
}
