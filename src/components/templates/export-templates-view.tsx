"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { ChatContext, ExportSpec } from "@/lib/ai/types";
import { aiExportSpec, useAiStatus } from "@/lib/ai/client";
import { takeHandoff, type ExportHandoff } from "@/lib/ai/handoff";
import { localCollection, newId, useStoredCollection } from "@/lib/storage";
import { useStore } from "@/lib/data/store";
import { prioritize } from "@/lib/prioritization";
import { applySpec, blankSpec, buildRows, localSpecFromPrompt, sanitizeSpec, withAccountIds } from "@/lib/exports/engine";
import { SOURCE_LABELS } from "@/lib/exports/fields";
import { PREBUILT_EXPORTS } from "@/data/seed/export-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExportForm } from "./export-form";
import { ExportPreview } from "./export-preview";
import { cn } from "@/lib/utils";

const collection = localCollection<ExportSpec>("harvest-signal:export-templates:v1");
let pendingHandoff: { value: ExportHandoff; at: number } | null = null;

/** Comparable form of a spec (ignores bookkeeping fields) */
function signature(s: ExportSpec | undefined): string {
  if (!s) return "";
  const { updatedAt: _u, prebuilt: _p, ...rest } = s;
  void _u;
  void _p;
  return JSON.stringify({
    ...rest,
    description: rest.description || undefined,
    columns: rest.columns.map((c) => ({ field: c.field, label: c.label || undefined })),
  });
}

export function ExportTemplatesView() {
  const { ready, data, asOf, asOfISO, ranked, lightningBaseUrl } = useStore();
  const { items, save, remove, duplicate, loaded } = useStoredCollection(collection, PREBUILT_EXPORTS, "exp");
  const ai = useAiStatus();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExportSpec | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const saved = items.find((t) => t.id === selectedId);
  const isNew = !!draft && !saved;
  const dirty = !!draft && (isNew || signature(draft) !== signature(saved));

  const select = useCallback((t: ExportSpec) => {
    setSelectedId(t.id);
    setDraft(structuredClone(t));
  }, []);

  // Select the first template once storage has loaded
  useEffect(() => {
    if (!loaded || selectedId || !items.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial selection after browser storage loads
    select(items[0]);
  }, [loaded, items, selectedId, select]);

  const context = useMemo<ChatContext>(() => ({ asOf: asOfISO, page: "/templates/exports", pageTitle: "Export templates" }), [asOfISO]);

  const generate = useCallback(
    async (text: string, accountIds?: string[]) => {
      const p = text.trim();
      if (!p) return;
      setGenerating(true);
      let spec: Omit<ExportSpec, "id"> | null = null;
      if (ai.available !== false) {
        try {
          const res = await aiExportSpec(p, context);
          if (res.ok) spec = sanitizeSpec(res.spec);
          else if (ai.available) toast.error("AI couldn't build that template", { description: res.reason });
        } catch {
          if (ai.available) toast.error("AI couldn't build that template");
        }
      }
      spec ??= localSpecFromPrompt(p);
      if (accountIds?.length) spec = withAccountIds(spec, accountIds);
      const next: ExportSpec = { ...spec, id: newId("exp"), prebuilt: false };
      setSelectedId(next.id);
      setDraft(next);
      setGenerating(false);
    },
    [ai.available, context],
  );

  // Hand-off from the AI chat ("Export this"). Kept briefly at module level so
  // a remount during sign-in or data load still picks it up.
  const handoffDone = useRef(false);
  useEffect(() => {
    if (handoffDone.current || !loaded || ai.available === null) return;
    handoffDone.current = true;
    const taken = takeHandoff("export");
    if (taken) pendingHandoff = { value: taken, at: Date.now() };
    const h = pendingHandoff && Date.now() - pendingHandoff.at < 10_000 ? pendingHandoff.value : null;
    if (!h?.prompt) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot hand-off from another page
    setPrompt(h.prompt);
    void generate(h.prompt, h.accountIds);
  }, [loaded, ai.available, generate]);

  const prio = useMemo(() => (ready ? prioritize(data, asOf) : null), [ready, data, asOf]);
  const source = draft?.source;
  const rows = useMemo(
    () => (prio && source ? buildRows(source, { data, asOf, prio, ranked, lightningBaseUrl }) : []),
    [prio, source, data, asOf, ranked, lightningBaseUrl],
  );
  const result = useMemo(() => (draft ? applySpec(draft, rows) : null), [draft, rows]);

  const update = (patch: Partial<ExportSpec>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  const onSave = () => {
    if (!draft) return;
    const name = draft.name.trim() || "Untitled export";
    save({ ...draft, name });
    setDraft({ ...draft, name });
    toast.success(saved?.prebuilt ? `Saved your version of ${name}` : `Saved ${name}`);
  };

  const onDuplicate = () => {
    if (!draft) return;
    const copy = duplicate({ ...draft, prebuilt: false });
    select(copy);
    toast.success(`Created ${copy.name}`);
  };

  const onDelete = () => {
    if (!draft) return;
    setConfirmDelete(false);
    const name = draft.name;
    if (!isNew) remove(draft.id);
    const rest = items.filter((t) => t.id !== draft.id);
    if (rest[0]) select(rest[0]);
    else {
      setSelectedId(null);
      setDraft(null);
    }
    toast.success(isNew ? "Draft discarded" : `Deleted ${name}`);
  };

  const onExport = async () => {
    if (!draft || !result) return;
    setExporting(true);
    try {
      const { exportSpec } = await import("@/lib/exports/export-file");
      const file = await exportSpec(draft, result, { asOf: asOfISO });
      toast.success(`Exported ${file}`);
    } catch (e) {
      console.error(e);
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  const onNew = () => {
    const next: ExportSpec = { ...blankSpec(), id: newId("exp"), prebuilt: false };
    setSelectedId(next.id);
    setDraft(next);
  };

  const prebuilt = items.filter((t) => t.prebuilt);
  const mine = items.filter((t) => !t.prebuilt);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Export templates</h1>
        <Button onClick={onNew}>
          <Plus /> New template
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Templates" className="h-fit min-w-0 overflow-hidden rounded-md border bg-card lg:sticky lg:top-4">
          <ul className="divide-y">
            {isNew && draft && (
              <TemplateItem name={draft.name || "Untitled export"} meta={`${SOURCE_LABELS[draft.source]} · Unsaved`} active onClick={() => undefined} />
            )}
            {prebuilt.map((t) => (
              <TemplateItem key={t.id} name={t.name} meta={`${SOURCE_LABELS[t.source]} · Prebuilt`} active={t.id === selectedId} onClick={() => select(t)} />
            ))}
            {mine.map((t) => (
              <TemplateItem key={t.id} name={t.name} meta={`${SOURCE_LABELS[t.source]} · ${t.format.toUpperCase()}`} active={t.id === selectedId} onClick={() => select(t)} />
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-4">
          <form
            className="rounded-md border bg-card p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void generate(prompt);
            }}
          >
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Board summary of Illinois pipeline by segment with win rates"
                aria-label="Describe the export"
                className="min-w-0 flex-1"
              />
              <Button type="submit" disabled={generating || !prompt.trim()} className="sm:w-28">
                {generating && <Loader2 className="animate-spin" />}
                {ai.available === false ? "Build" : "Generate"}
              </Button>
            </div>
            {ai.available === false && <p className="mt-1.5 text-xs text-muted-foreground">AI offline — manual mode</p>}
          </form>

          {!draft ? (
            <Skeleton className="h-96" />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="min-w-0 truncate text-base font-semibold">{draft.name || "Untitled export"}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {dirty && <span className="text-xs text-muted-foreground">Unsaved</span>}
                  <Button variant="outline" size="sm" onClick={onSave} disabled={!dirty}>
                    Save template
                  </Button>
                  <Button variant="outline" size="sm" onClick={onDuplicate}>
                    <Copy /> Duplicate
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete
                  </Button>
                  <Button size="sm" onClick={onExport} disabled={exporting || !result || !ready}>
                    {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                    Export {draft.format.toUpperCase()}
                  </Button>
                </div>
              </div>

              <ExportForm spec={draft} rows={rows} onChange={update} />

              {result && ready ? <ExportPreview spec={draft} result={result} /> : <Skeleton className="h-80" />}
            </>
          )}
        </div>
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? "Discard draft?" : `Delete ${draft?.name}?`}</DialogTitle>
            {saved?.prebuilt && <DialogDescription>The prebuilt template will be hidden from the list.</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              {isNew ? "Discard" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplateItem({ name, meta, active, onClick }: { name: string; meta: string; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={active ? "true" : undefined}
        className={cn("block w-full px-3 py-2.5 text-left transition-colors", active ? "bg-accent-soft" : "hover:bg-muted/40")}
      >
        <span className={cn("block truncate text-sm", active && "font-medium text-primary")}>{name}</span>
        <span className="block truncate text-xs text-muted-foreground">{meta}</span>
      </button>
    </li>
  );
}
