"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { ChatContext, Sequence } from "@/lib/ai/types";
import { useAiStatus } from "@/lib/ai/client";
import { takeHandoff, type EnrollHandoff } from "@/lib/ai/handoff";
import { useStoredCollection } from "@/lib/storage";
import { useStore } from "@/lib/data/store";
import { useSender, useUserId } from "@/lib/auth";
import { PREBUILT_SEQUENCES } from "@/data/seed/sequences";
import { enrollmentFor } from "@/lib/sequences/engine";
import { MONTHS, blankSequence, enrollmentTasks, fingerprint, normalizeSequence, nowStamp, recipientName, sequencesCollection, enrollmentsCollection, useEnrollments, type Recipient } from "./sequence-store";
import { SequenceEditor } from "./sequence-editor";
import { SequencePreview, defaultRecipient } from "./sequence-preview";
import { EnrollDialog, type EnrollRow } from "./enroll-dialog";
import { EnrollmentLog } from "./enrollment-log";
import { DraftDialog } from "./draft-dialog";
import { ConfirmDialog } from "./parts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/shared/data-table";

const VISIT_SEQUENCE = "seq-visiting-next-week";

export function SequencesView() {
  return (
    <Suspense fallback={<Skeleton className="h-[32rem]" />}>
      <SequencesInner />
    </Suspense>
  );
}

function SequencesInner() {
  const { ready, data, asOf, asOfISO, commit } = useStore();
  const sender = useSender();
  const userId = useUserId();
  const ai = useAiStatus();
  const { items, save, remove, duplicate } = useStoredCollection(sequencesCollection, PREBUILT_SEQUENCES, "seq");
  const { items: enrollments } = useEnrollments();

  const [tab, setTab] = useState("sequences");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Sequence | null>(null);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [enrollSeqId, setEnrollSeqId] = useState<string | null>(null);
  const [handoff, setHandoff] = useState<EnrollHandoff | null>(null);
  const [picked, setPicked] = useState<{ seqId: string; r: Recipient } | null>(null);

  const activeId = selectedId && (draft?.id === selectedId || items.some((x) => x.id === selectedId)) ? selectedId : (items[0]?.id ?? null);
  const saved = items.find((x) => x.id === activeId);
  const working = draft && draft.id === activeId ? draft : (saved ?? null);
  const dirty = !!working && (!saved || fingerprint(working) !== fingerprint(saved));
  const isNew = !!working && !saved;

  const aiContext: ChatContext = useMemo(() => ({ asOf: asOfISO, page: "/outreach/sequences", pageTitle: "Sequences" }), [asOfISO]);

  // One-shot hand-off from chat, map or trip planner: open Enroll with those accounts
  const took = useRef(false);
  useEffect(() => {
    if (took.current) return;
    took.current = true;
    const h = takeHandoff("enroll");
    if (!h?.accountIds?.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage hand-off is only readable after mount
    setHandoff(h);
    if (h.from.startsWith("Trip:") && PREBUILT_SEQUENCES.some((s) => s.id === VISIT_SEQUENCE)) {
      setSelectedId(VISIT_SEQUENCE);
      setEnrollSeqId(VISIT_SEQUENCE);
    }
    setEnrollOpen(true);
  }, []);

  const enrollCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of enrollments) m.set(e.sequenceId, (m.get(e.sequenceId) ?? 0) + 1);
    return m;
  }, [enrollments]);

  const select = (id: string) => {
    if (id === activeId) return;
    if (dirty) setPendingSelect(id);
    else {
      setSelectedId(id);
      setDraft(null);
    }
  };

  const change = (next: Sequence | ((prev: Sequence) => Sequence)) => {
    setDraft((prev) => {
      const base = prev && prev.id === activeId ? prev : working;
      if (!base) return prev;
      return typeof next === "function" ? next(base) : next;
    });
  };

  const onSave = () => {
    if (!working) return;
    const clean = { ...working, name: working.name.trim() || "Untitled sequence", steps: [...working.steps].sort((a, b) => a.day - b.day) };
    save(clean);
    setDraft(null);
    setSelectedId(clean.id);
    toast.success("Sequence saved");
  };

  const onDuplicate = () => {
    if (!working) return;
    const copy = duplicate(working);
    setSelectedId(copy.id);
    setDraft(null);
    toast.success(`Duplicated as "${copy.name}"`);
  };

  const onDelete = () => {
    if (!working) return;
    if (!isNew) remove(working.id);
    setDraft(null);
    setSelectedId(null);
    toast.success(working.prebuilt ? "Prebuilt sequence hidden" : "Sequence deleted");
  };

  const startNew = (s: Sequence) => {
    const go = () => {
      setDraft(s);
      setSelectedId(s.id);
    };
    if (dirty) {
      setPendingSelect(null);
      toast.info("Save or discard changes first");
      return;
    }
    go();
  };

  const enroll = (sequence: Sequence, recipients: Recipient[], skipped: EnrollRow[] = []) => {
    const list = recipients.map((r) => enrollmentFor(sequence, r.account, r.contact, { sender, asOf, data, enrolledBy: userId }));
    list.forEach((e) => enrollmentsCollection.save(e));
    commit(list.flatMap((e) => enrollmentTasks(e, sequence, userId, nowStamp(asOf))));
    const steps = list.reduce((n, e) => n + e.steps.length, 0);
    toast.success(`Enrolled ${list.length} recipient${list.length === 1 ? "" : "s"} · ${steps} steps scheduled`, {
      description: skipped.length
        ? `Skipped ${skipped.length}: ${skipped
            .slice(0, 5)
            .map((x) => `${recipientName(x.r)} (${x.label.toLowerCase()})`)
            .join(", ")}${skipped.length > 5 ? ", …" : ""}`
        : "Steps logged as Salesforce tasks. Nothing is sent.",
      duration: 6000,
    });
  };

  if (!ready) return <Skeleton className="h-[32rem]" />;

  const listRows: Sequence[] = isNew && working ? [working, ...items] : items;
  const listColumns: Column<Sequence>[] = [
    {
      key: "name",
      header: "Sequence",
      cell: (x) => {
        const unsaved = isNew && x.id === working?.id;
        const shown = x.id === activeId && working ? working : x;
        const count = enrollCounts.get(x.id) ?? 0;
        return (
          <div className="min-w-0 max-w-[13rem]" aria-current={x.id === activeId ? "true" : undefined}>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{shown.name || "Untitled sequence"}</span>
              {x.prebuilt && <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-[11px] text-muted-foreground">Prebuilt</span>}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {unsaved
                ? `Unsaved · ${shown.steps.length} steps`
                : `${shown.steps.length} steps${shown.segment ? ` · ${shown.segment}` : ""}${shown.month ? ` · ${MONTHS[shown.month - 1].slice(0, 3)}` : ""} · ${count} enrolled`}
            </span>
          </div>
        );
      },
    },
  ];

  const enrollSeq = items.find((x) => x.id === (enrollSeqId ?? activeId)) ?? (saved ? saved : items[0]);
  const recipient = picked && picked.seqId === activeId ? picked.r : working ? defaultRecipient(data, working.segment) : null;

  return (
    <Tabs value={tab} onValueChange={setTab} className="gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="sequences">Sequences</TabsTrigger>
          <TabsTrigger value="scheduled">
            Scheduled <span className="text-muted-foreground tabular">{enrollments.length}</span>
          </TabsTrigger>
        </TabsList>
        <div className="flex flex-wrap items-center gap-2">
          {ai.available === false && <span className="text-xs text-muted-foreground">AI offline</span>}
          {ai.available && (
            <Button variant="outline" size="sm" onClick={() => setDraftOpen(true)}>
              <Sparkles /> Draft sequence
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => startNew(blankSequence())}>
            <Plus /> New sequence
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEnrollSeqId(saved?.id ?? null);
              setEnrollOpen(true);
            }}
          >
            Enroll
          </Button>
        </div>
      </div>

      <TabsContent value="sequences" className="mt-0">
        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <DataTable
            className="h-fit"
            rows={listRows}
            columns={listColumns}
            rowKey={(x) => x.id}
            param="sp"
            dense
            pageSizes={[]}
            onRowClick={(x) => (isNew && x.id === working?.id ? undefined : select(x.id))}
            rowClassName={(x) => (x.id === activeId ? "bg-accent-soft hover:bg-accent-soft" : undefined)}
            empty="No sequences"
            caption="Sequences"
          />

          {working ? (
            <div className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{working.name || "Untitled sequence"}</h2>
                {dirty && <span className="text-xs text-muted-foreground">Unsaved</span>}
                <Button size="sm" disabled={!dirty} onClick={onSave}>
                  Save
                </Button>
                <Button variant="outline" size="sm" disabled={isNew} onClick={onDuplicate}>
                  Duplicate
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                  Delete
                </Button>
              </div>
              <div className="grid gap-4 xl:grid-cols-2">
                <section className="min-w-0 rounded-md border bg-card p-4" aria-label="Editor">
                  <SequenceEditor draft={working} onChange={change} aiAvailable={ai.available} aiContext={aiContext} />
                </section>
                <section className="h-fit min-w-0 rounded-md border bg-card p-4 xl:sticky xl:top-4" aria-label="Preview">
                  <h3 className="mb-3 text-sm font-semibold">Preview</h3>
                  <SequencePreview
                    sequence={working}
                    data={data}
                    asOf={asOf}
                    senderName={sender.name}
                    recipient={recipient}
                    onRecipient={(r) => setPicked({ seqId: working.id, r })}
                    onEnrollOne={(r) => enroll(working, [r])}
                    enrollBlockedReason={dirty ? "Save changes to enroll" : undefined}
                  />
                </section>
              </div>
            </div>
          ) : (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No sequences</p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="scheduled" className="mt-0">
        <EnrollmentLog enrollments={enrollments} data={data} asOfISO={asOfISO} />
      </TabsContent>

      {enrollSeq && (
        <EnrollDialog
          open={enrollOpen}
          onOpenChange={(o) => {
            setEnrollOpen(o);
            if (!o) setHandoff(null);
          }}
          sequence={enrollSeq}
          sequences={items}
          onSequence={setEnrollSeqId}
          data={data}
          asOf={asOf}
          senderName={sender.name}
          enrollments={enrollments}
          handoff={handoff}
          onClearHandoff={() => setHandoff(null)}
          blockedReason={dirty && enrollSeq.id === activeId ? "Save changes to this sequence first" : undefined}
          onEnroll={(ready, skipped) => {
            enroll(enrollSeq, ready, skipped);
            setEnrollOpen(false);
            setHandoff(null);
            setTab("scheduled");
          }}
        />
      )}

      <DraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        context={aiContext}
        onDraft={(s) => {
          const seq = normalizeSequence(s);
          setDraft(seq);
          setSelectedId(seq.id);
          setTab("sequences");
        }}
      />

      <ConfirmDialog
        open={!!pendingSelect}
        onOpenChange={(o) => !o && setPendingSelect(null)}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setDraft(null);
          setSelectedId(pendingSelect);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={working?.prebuilt ? "Hide prebuilt sequence?" : "Delete sequence?"}
        description={working ? `"${working.name}" will be removed from the list. Existing enrollments stay scheduled.` : undefined}
        confirmLabel={working?.prebuilt ? "Hide" : "Delete"}
        destructive
        onConfirm={onDelete}
      />
    </Tabs>
  );
}
