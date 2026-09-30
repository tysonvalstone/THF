"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Pencil, Trash2 } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { USER_BY_ID } from "@/data/reference/users";
import { callContacts, deleteNotesMutations, fmtClock, fmtDay, fmtTime, simulatedTranscript, toggleCommitmentMutations } from "@/lib/call-desk";
import { fmtShortDate } from "@/lib/dates";
import type { AuditEntry, Call, CallNotes } from "@/types/salesforce";
import { RecordDrawer } from "@/components/shared/record-drawer";
import { ConfirmDialog, LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Block, CallTypeTag, NotesView, Tag } from "./parts";

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "empty" : typeof v === "object" ? "updated" : String(v));

/** Record changes saved together with the call's notes (same audit timestamp) */
function actionsTaken(log: AuditEntry[], callId: string): AuditEntry[] {
  const saved = [...log].reverse().find((e) => e.Object === "Call" && e.RecordId === callId && e.Changes.some((c) => c.field === "NotesStatus" && c.new === "Saved"));
  if (!saved) return [];
  return log.filter((e) => e.At === saved.At && e.Id !== saved.Id);
}

function EditNotes({ call, open, onOpenChange }: { call: Call; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { update } = useCrud();
  const n = call.Notes!;
  return (
    <RecordDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="Edit AI Notes"
      description={call.Subject}
      initial={{ summary: n.summary, keyPoints: n.keyPoints.join("\n"), painPoints: n.painPoints.join("\n"), sentiment: n.sentiment, repNotes: call.RepNotes ?? "" }}
      fields={[
        { name: "summary", label: "Summary", type: "textarea", required: true },
        { name: "keyPoints", label: "Key points (one per line)", type: "textarea" },
        { name: "painPoints", label: "Pain points (one per line)", type: "textarea" },
        { name: "sentiment", label: "Sentiment", type: "select", required: true, options: ["Positive", "Neutral", "Concerned"].map((s) => ({ value: s, label: s })) },
        { name: "repNotes", label: "My notes", type: "textarea" },
      ]}
      onSubmit={(v) => {
        const lines = (s: unknown) =>
          String(s ?? "")
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);
        const notes: CallNotes = { ...n, summary: String(v.summary), keyPoints: lines(v.keyPoints), painPoints: lines(v.painPoints), sentiment: v.sentiment as CallNotes["sentiment"] };
        update("Call", call.Id, { Notes: notes, RepNotes: String(v.repNotes ?? "") }, "AI Notes");
        onOpenChange(false);
      }}
    />
  );
}

/** A call's notes, commitments, questions asked, actions taken and transcript */
export function CallDetail({ call, editable = false }: { call: Call; editable?: boolean }) {
  const { data } = useStore();
  const { run } = useCrud();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const transcript = useMemo(() => (call.Status === "Completed" && (call.Transcript?.length || call.ScriptId) ? simulatedTranscript(call, data) : []), [call, data]);
  const actions = useMemo(() => actionsTaken(data.auditLog, call.Id), [data.auditLog, call.Id]);
  const contacts = callContacts(call, data);
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const opp = call.OpportunityId ? data.opportunities.find((o) => o.Id === call.OpportunityId) : undefined;

  return (
    <div className="space-y-3 text-sm" data-testid="call-detail">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <CallTypeTag type={call.CallType} />
        <span>
          {fmtDay(call.Start.slice(0, 10))} · {fmtTime(call.Start.slice(11, 16))} · {call.DurationMin} min
        </span>
        <span>· {USER_BY_ID[call.OwnerId]?.Name}</span>
        <LocalChangeTag id={call.Id} />
      </div>
      <p>
        <Link href={`/accounts/${call.AccountId}`} className="font-medium hover:text-primary hover:underline">
          {account?.Name}
        </Link>
        {contacts.length > 0 && <span className="text-muted-foreground"> · {contacts.map((c) => `${c.Name} (${c.Buying_Role__c})`).join(", ")}</span>}
        {opp && <span className="block text-xs text-muted-foreground">{opp.Name} · {opp.StageName}</span>}
      </p>

      {call.Notes ? (
        <Block
          title="AI Notes"
          aside={
            editable && (
              <div className="flex gap-1">
                <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
                  <Pencil data-icon="inline-start" />
                  Edit
                </Button>
                <Button size="xs" variant="ghost" className="text-status-critical hover:text-status-critical" onClick={() => setConfirm(true)}>
                  <Trash2 data-icon="inline-start" />
                  Delete
                </Button>
              </div>
            )
          }
        >
          <NotesView notes={call.Notes} />
        </Block>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-muted-foreground">{call.Status === "Canceled" ? "Canceled" : "Notes pending"}</p>
      )}

      {!!call.Commitments?.length && (
        <Block title="Commitments">
          <ul className="space-y-1">
            {call.Commitments.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <button
                  type="button"
                  disabled={!editable}
                  aria-label={c.done ? "Mark open" : "Mark done"}
                  aria-pressed={c.done}
                  onClick={() => run(toggleCommitmentMutations(call, i))}
                  className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border", c.done && "border-primary bg-primary text-primary-foreground")}
                >
                  {c.done && <Check className="size-3" />}
                </button>
                <span className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-muted-foreground">{c.owner === "us" ? "Ours" : "Theirs"}: </span>
                  <span className={cn(c.done && "text-muted-foreground line-through")}>{c.text}</span>
                </span>
                {c.due && <span className="text-xs text-muted-foreground tabular">{fmtShortDate(c.due)}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {!!call.QuestionsAsked?.length && (
        <Block title="Questions asked">
          <ul className="list-disc space-y-0.5 pl-4">
            {call.QuestionsAsked.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Block>
      )}

      {actions.length > 0 && (
        <Block title="Actions taken">
          <ul className="space-y-1">
            {actions.map((a) => (
              <li key={a.Id}>
                <Tag tone="muted" className="mr-1.5">
                  {a.Action}
                </Tag>
                <span>
                  {a.Object === "Task" ? "Task" : a.Object}: {a.RecordName}
                </span>
                {a.Changes.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {a.Changes.filter((c) => c.field !== "LastModifiedDate").map((c) => `${c.field} ${show(c.old)} → ${show(c.new)}`).join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Block>
      )}

      {call.RepNotes && (
        <Block title="My notes">
          <p className="whitespace-pre-wrap">{call.RepNotes}</p>
        </Block>
      )}

      {transcript.length > 0 && (
        <details className="rounded-md border bg-card">
          <summary className="cursor-pointer px-3.5 py-2 text-[13px] font-semibold">Transcript ({transcript.length} lines)</summary>
          <ol className="space-y-1.5 border-t px-3.5 py-2.5" data-testid="call-transcript">
            {transcript.map((l, i) => (
              <li key={i}>
                <span className="mr-2 text-xs text-muted-foreground tabular">{fmtClock(l.atSec)}</span>
                <span className="font-medium">{l.speaker}:</span> {l.text}
              </li>
            ))}
          </ol>
        </details>
      )}

      {editable && call.Notes && (
        <>
          <EditNotes call={call} open={editing} onOpenChange={setEditing} />
          <ConfirmDialog
            open={confirm}
            onOpenChange={setConfirm}
            title="Delete these AI Notes?"
            description="The call stays on the calendar with notes pending. You can undo this for a few seconds afterwards."
            onConfirm={() => run(deleteNotesMutations(call), "AI Notes deleted", { undoable: true })}
          />
        </>
      )}
    </div>
  );
}
