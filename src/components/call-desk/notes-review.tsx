"use client";

import { useMemo, useState } from "react";
import { Copy, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { sendEmail } from "@/lib/actions/outreach";
import { callContacts, fmtClock, repName, saveCallMutations, type SuggestedUpdate, type TranscriptLine } from "@/lib/call-desk";
import type { Call, CallNotes } from "@/types/salesforce";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Block, Tag } from "./parts";
import { useCallContext } from "./use-call-desk";

const inputCls = "w-full rounded-md border border-input bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/50";
const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

const QUAL: { key: keyof CallNotes["qualification"]; label: string }[] = [
  { key: "budget", label: "Budget" },
  { key: "decisionMaker", label: "Decision maker / economic buyer" },
  { key: "timeline", label: "Timeline" },
  { key: "competitors", label: "Competitors" },
  { key: "locations", label: "Locations" },
];

/** Review AI Notes after a call: edit, confirm CRM updates one by one, send the follow-up, save to the account */
export function NotesReview({
  call,
  transcript,
  repNotes,
  asked,
  initial,
  updates,
  onSaved,
  onDiscard,
}: {
  call: Call;
  transcript: TranscriptLine[];
  repNotes: string;
  asked: string[];
  initial: CallNotes;
  updates: SuggestedUpdate[];
  onSaved: () => void;
  onDiscard: () => void;
}) {
  const { data } = useStore();
  const ctx = useCallContext();
  const { run } = useCrud();
  const [notes, setNotes] = useState<CallNotes>(initial);
  const [confirmed, setConfirmed] = useState<Set<SuggestedUpdate["key"]>>(new Set());
  const [emailSent, setEmailSent] = useState(false);
  const [discard, setDiscard] = useState(false);
  const contacts = useMemo(() => callContacts(call, data), [call, data]);
  const rep = repName(call.OwnerId);
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const set = <K extends keyof CallNotes>(k: K, v: CallNotes[K]) => setNotes((n) => ({ ...n, [k]: v }));
  const email = notes.followUpEmail ?? { subject: "", body: "" };
  const to = contacts.find((c) => c.Email && !c.HasOptedOutOfEmail);

  const toggle = (u: SuggestedUpdate) =>
    setConfirmed((s) => {
      const next = new Set(s);
      if (next.has(u.key)) {
        next.delete(u.key);
        // The stage change depends on the economic buyer
        if (u.key === "economicBuyer") next.delete("stage");
      } else next.add(u.key);
      return next;
    });

  const save = () => {
    const chosen = updates.filter((u) => confirmed.has(u.key) && !u.blocked && (!u.requires || confirmed.has(u.requires)));
    const withCall: Call = { ...call, Transcript: transcript, RepNotes: repNotes, QuestionsAsked: asked };
    const clean: CallNotes = { ...notes, nextSteps: notes.nextSteps.filter((s) => s.text.trim()) };
    const muts = saveCallMutations(ctx, withCall, clean, chosen);
    const parts = [`AI Notes saved to ${account?.Name ?? "the account"}`];
    if (clean.nextSteps.length) parts.push(`${clean.nextSteps.length} task${clean.nextSteps.length === 1 ? "" : "s"}`);
    if (chosen.length) parts.push(`${chosen.length} update${chosen.length === 1 ? "" : "s"}`);
    run(muts, parts.join(" · "));
    onSaved();
  };

  return (
    <div className="space-y-3" data-testid="notes-review">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">AI Notes</h2>
        <Tag tone="muted">{notes.source === "ai" ? "AI" : "Rules"}</Tag>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Sentiment</span>
          <select className="h-8 rounded-md border border-input bg-card px-2 text-sm" value={notes.sentiment} onChange={(e) => set("sentiment", e.target.value as CallNotes["sentiment"])} aria-label="Sentiment">
            <option>Positive</option>
            <option>Neutral</option>
            <option>Concerned</option>
          </select>
        </label>
      </div>

      <Block title="Summary">
        <textarea className={inputCls} rows={4} value={notes.summary} onChange={(e) => set("summary", e.target.value)} aria-label="Summary" />
      </Block>

      <div className="grid gap-3 lg:grid-cols-2">
        <Block title="Key points">
          <textarea className={inputCls} rows={5} value={notes.keyPoints.join("\n")} onChange={(e) => set("keyPoints", lines(e.target.value))} aria-label="Key points, one per line" />
        </Block>
        <Block title="Pain points">
          <textarea className={inputCls} rows={5} value={notes.painPoints.join("\n")} onChange={(e) => set("painPoints", lines(e.target.value))} aria-label="Pain points, one per line" />
        </Block>
      </div>

      {notes.objections.length > 0 && (
        <Block title="Objections raised">
          <ul className="space-y-2">
            {notes.objections.map((o, i) => (
              <li key={i} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p>{o.objection}</p>
                  <p className="text-muted-foreground">Handled: {o.response}</p>
                </div>
                <Button size="icon-xs" variant="ghost" aria-label="Remove objection" onClick={() => set("objections", notes.objections.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <Block title="Qualification">
        <div className="grid gap-2 sm:grid-cols-2">
          {QUAL.map((q) => (
            <label key={q.key} className="grid gap-1 text-xs text-muted-foreground">
              {q.label}
              <Input value={notes.qualification[q.key] ?? ""} onChange={(e) => set("qualification", { ...notes.qualification, [q.key]: e.target.value || undefined })} className="h-8 text-sm text-foreground" />
            </label>
          ))}
        </div>
      </Block>

      <Block
        title="Next steps"
        aside={
          <Button size="xs" variant="ghost" onClick={() => set("nextSteps", [...notes.nextSteps, { text: "", owner: rep }])}>
            <Plus data-icon="inline-start" />
            Add
          </Button>
        }
      >
        <ul className="space-y-2">
          {notes.nextSteps.map((s, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_170px_140px_auto]">
              <Input
                value={s.text}
                onChange={(e) => set("nextSteps", notes.nextSteps.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                className="col-span-1 h-8 text-sm"
                aria-label="Action item"
              />
              <select
                className="h-8 rounded-md border border-input bg-card px-2 text-sm max-sm:col-start-1"
                value={s.owner}
                onChange={(e) => set("nextSteps", notes.nextSteps.map((x, j) => (j === i ? { ...x, owner: e.target.value } : x)))}
                aria-label="Owner"
              >
                {[rep, ...contacts.map((c) => c.Name), ...(contacts.some((c) => c.Name === s.owner) || s.owner === rep ? [] : [s.owner])].map((o) => (
                  <option key={o} value={o}>
                    {o === rep ? `${o} (us)` : o}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={s.due ?? ""}
                onChange={(e) => set("nextSteps", notes.nextSteps.map((x, j) => (j === i ? { ...x, due: e.target.value || undefined } : x)))}
                className="h-8 text-sm max-sm:col-start-1"
                aria-label="Due date"
              />
              <Button size="icon-sm" variant="ghost" aria-label="Remove step" className="max-sm:col-start-2 max-sm:row-start-1" onClick={() => set("nextSteps", notes.nextSteps.filter((_, j) => j !== i))}>
                <X />
              </Button>
            </li>
          ))}
          {!notes.nextSteps.length && <li className="text-muted-foreground">No action items</li>}
        </ul>
      </Block>

      <Block title="Suggested CRM updates" aside={<span className="text-xs text-muted-foreground">{confirmed.size} confirmed</span>}>
        {updates.length ? (
          <ul className="space-y-1.5" data-testid="suggested-updates">
            {updates.map((u) => {
              const needs = u.requires && !confirmed.has(u.requires);
              const disabled = !!u.blocked || !!needs;
              return (
                <li key={u.key}>
                  <label className={cn("flex items-start gap-2", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
                    <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[#1f5f4a]" checked={confirmed.has(u.key) && !disabled} disabled={disabled} onChange={() => toggle(u)} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{u.label}</span>
                      <span className="text-muted-foreground"> {u.from} → </span>
                      <span>{u.to}</span>
                      {u.blocked && <span className="block text-xs text-amber-800">{u.blocked}</span>}
                      {!u.blocked && needs && <span className="block text-xs text-muted-foreground">Confirm the economic buyer first</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No field changes suggested</p>
        )}
      </Block>

      <Block
        title="Follow-up email"
        aside={
          <div className="flex items-center gap-1.5">
            {emailSent && <Tag tone="accent">Sent</Tag>}
            <Button
              size="xs"
              variant="ghost"
              onClick={() => navigator.clipboard.writeText(`${email.subject}\n\n${email.body}`).then(() => toast.success("Email copied"), () => toast.error("Couldn't copy"))}
            >
              <Copy data-icon="inline-start" />
              Copy
            </Button>
            <Button
              size="xs"
              variant="outline"
              disabled={!to || emailSent || !email.body.trim()}
              title={to ? `To ${to.Name} <${to.Email}>` : "No contact with an email address"}
              onClick={() => {
                if (!to) return;
                const r = sendEmail(ctx, { targetId: call.AccountId, whoId: to.Id, toEmail: to.Email, subject: email.subject, body: email.body });
                run(r.mutations, `Email to ${to.Name} logged`);
                setEmailSent(true);
              }}
            >
              <Send data-icon="inline-start" />
              Send via Outreach
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <Input value={email.subject} onChange={(e) => set("followUpEmail", { ...email, subject: e.target.value })} aria-label="Email subject" className="h-8 text-sm" />
          <textarea className={inputCls} rows={9} value={email.body} onChange={(e) => set("followUpEmail", { ...email, body: e.target.value })} aria-label="Email body" />
        </div>
      </Block>

      <details className="rounded-md border bg-card">
        <summary className="cursor-pointer px-3.5 py-2 text-[13px] font-semibold">Transcript ({transcript.length} lines)</summary>
        <ol className="max-h-72 space-y-1.5 overflow-y-auto border-t px-3.5 py-2.5 text-sm">
          {transcript.map((l, i) => (
            <li key={i}>
              <span className="mr-2 text-xs text-muted-foreground tabular">{fmtClock(l.atSec)}</span>
              <span className="font-medium">{l.speaker}:</span> {l.text}
            </li>
          ))}
        </ol>
      </details>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background py-3">
        <Button variant="ghost" onClick={() => setDiscard(true)}>
          Discard
        </Button>
        <Button onClick={save}>Save to account</Button>
      </div>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Discard these notes?"
        description="The transcript and notes from this call won't be saved."
        confirmLabel="Discard"
        onConfirm={onDiscard}
      />
    </div>
  );
}
