"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { SEASON_PHASES, VARIANT_FIELDS, type ChatContext, type Sequence, type SequenceStep, type StepType, type StepVariant, type VariantField, type VariantRule } from "@/lib/ai/types";
import { aiRewriteStep } from "@/lib/ai/client";
import { newId } from "@/lib/storage";
import { REGIONS } from "@/data/reference/regions";
import { COMMODITIES, SEGMENTS } from "@/types/salesforce";
import { MONTHS, STEP_TYPE_LABEL, blankStep } from "./sequence-store";
import { MergeTextField } from "./parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const FIELD_NAME: Record<VariantField, string> = {
  season_phase: "Season phase",
  commodity: "Commodity",
  region: "Region",
  state: "State",
  segment: "Segment",
};

const STATES = [...new Set(REGIONS.flatMap((r) => r.states))].sort();

const SUGGESTIONS: Record<VariantField, string[]> = {
  season_phase: SEASON_PHASES,
  commodity: ["corn", "soybeans", "wheat", ...COMMODITIES.filter((c) => !["Corn", "Soybeans"].includes(c)).map((c) => c.toLowerCase())],
  region: REGIONS.map((r) => r.name),
  state: STATES,
  segment: SEGMENTS,
};

const REWRITES = ["Shorter", "More formal", "Friendlier", "Clearer call to action"];
const ANY = "__any";

export function SequenceEditor({
  draft,
  onChange,
  aiAvailable,
  aiContext,
}: {
  draft: Sequence;
  onChange: (next: Sequence | ((prev: Sequence) => Sequence)) => void;
  aiAvailable: boolean | null;
  aiContext: ChatContext;
}) {
  const setStep = (id: string, patch: Partial<SequenceStep> | ((s: SequenceStep) => SequenceStep)) =>
    onChange((prev) => ({ ...prev, steps: prev.steps.map((s) => (s.id === id ? (typeof patch === "function" ? patch(s) : { ...s, ...patch }) : s)) }));
  const sortSteps = () => onChange((prev) => ({ ...prev, steps: [...prev.steps].sort((a, b) => a.day - b.day) }));
  const move = (i: number, dir: -1 | 1) =>
    onChange((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      const a = steps[i];
      const b = steps[j];
      // Swap positions and days so the order still follows the day numbers
      steps[i] = { ...b, day: a.day };
      steps[j] = { ...a, day: b.day };
      return { ...prev, steps };
    });
  const addStep = () =>
    onChange((prev) => {
      const last = prev.steps[prev.steps.length - 1];
      return { ...prev, steps: [...prev.steps, blankStep(last ? last.day + 3 : 1)] };
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="seq-name" className="text-xs">
            Name
          </Label>
          <Input id="seq-name" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
        </div>
        <div className="grid gap-1 sm:col-span-2">
          <Label htmlFor="seq-desc" className="text-xs">
            Description
          </Label>
          <Textarea id="seq-desc" rows={2} value={draft.description ?? ""} onChange={(e) => onChange({ ...draft, description: e.target.value })} className="min-h-0 text-sm" />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Segment</Label>
          <Select value={draft.segment || ANY} onValueChange={(v) => onChange({ ...draft, segment: v === ANY ? undefined : v })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any segment</SelectItem>
              {SEGMENTS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Start month</Label>
          <Select value={draft.month ? String(draft.month) : ANY} onValueChange={(v) => onChange({ ...draft, month: v === ANY ? undefined : Number(v) })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Any month</SelectItem>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Steps</h3>
          <span className="text-xs text-muted-foreground">{draft.steps.length} steps</span>
        </div>
        {draft.steps.map((step, i) => (
          <StepCard
            key={step.id}
            index={i}
            count={draft.steps.length}
            step={step}
            setStep={(p) => setStep(step.id, p)}
            onDayCommit={sortSteps}
            onMove={(dir) => move(i, dir)}
            onRemove={() => onChange((prev) => ({ ...prev, steps: prev.steps.filter((s) => s.id !== step.id) }))}
            aiAvailable={aiAvailable}
            aiContext={aiContext}
          />
        ))}
        <Button variant="outline" size="sm" onClick={addStep}>
          <Plus /> Add step
        </Button>
      </div>
    </div>
  );
}

function StepCard({
  index,
  count,
  step,
  setStep,
  onDayCommit,
  onMove,
  onRemove,
  aiAvailable,
  aiContext,
}: {
  index: number;
  count: number;
  step: SequenceStep;
  setStep: (p: Partial<SequenceStep> | ((s: SequenceStep) => SequenceStep)) => void;
  onDayCommit: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  aiAvailable: boolean | null;
  aiContext: ChatContext;
}) {
  const [busy, setBusy] = useState(false);
  const [showVariants, setShowVariants] = useState(step.variants.length > 0);

  const rewrite = async (instruction: string) => {
    const before = { subject: step.subject, body: step.body };
    setBusy(true);
    try {
      const out = await aiRewriteStep({ type: step.type, subject: step.subject, body: step.body }, instruction, aiContext);
      if (!out.ok) {
        toast.error("Rewrite failed", { description: out.reason });
        return;
      }
      setStep((s) => ({ ...s, body: out.body, ...(s.type === "email" && out.subject !== undefined ? { subject: out.subject } : {}) }));
      toast.success(`Step ${index + 1} rewritten: ${instruction.toLowerCase()}`, {
        action: { label: "Undo", onClick: () => setStep((s) => ({ ...s, ...before })) },
      });
    } finally {
      setBusy(false);
    }
  };

  const setVariant = (id: string, patch: Partial<StepVariant>) => setStep((s) => ({ ...s, variants: s.variants.map((v) => (v.id === id ? { ...v, ...patch } : v)) }));

  return (
    <div className="rounded-md border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground tabular">Step {index + 1}</span>
        <Select
          value={step.type}
          onValueChange={(v) => setStep((s) => ({ ...s, type: v as StepType, subject: v === "email" ? (s.subject ?? "") : undefined }))}
        >
          <SelectTrigger size="sm" className="h-7 w-34" aria-label="Step type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STEP_TYPE_LABEL) as StepType[]).map((t) => (
              <SelectItem key={t} value={t}>
                {STEP_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Day
          <Input
            type="number"
            min={1}
            max={365}
            value={step.day}
            onChange={(e) => setStep({ day: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
            onBlur={onDayCommit}
            className="h-7 w-16 px-2 text-sm tabular"
          />
        </label>
        <div className="ml-auto flex items-center gap-0.5">
          {aiAvailable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="xs" disabled={busy || !step.body.trim()}>
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Rewrite <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {REWRITES.map((r) => (
                  <DropdownMenuItem key={r} onSelect={() => void rewrite(r)}>
                    {r}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="icon-xs" aria-label="Move step up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Move step down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </Button>
          <Button variant="ghost" size="icon-xs" aria-label="Remove step" disabled={count <= 1} onClick={onRemove}>
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-3">
        {step.type === "email" && <MergeTextField id={`${step.id}-subject`} label="Subject" value={step.subject ?? ""} onChange={(v) => setStep({ subject: v })} />}
        <MergeTextField
          id={`${step.id}-body`}
          label={step.type === "email" ? "Body" : "Task notes"}
          value={step.body}
          onChange={(v) => setStep({ body: v })}
          multiline
          rows={step.type === "email" ? 8 : 4}
        />
        <div>
          <button
            type="button"
            onClick={() => setShowVariants((x) => !x)}
            className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            aria-expanded={showVariants}
          >
            {showVariants ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            Variants ({step.variants.length})
          </button>
          {showVariants && (
            <div className="mt-2 space-y-3">
              {step.variants.map((v) => (
                <VariantCard
                  key={v.id}
                  stepType={step.type}
                  variant={v}
                  onChange={(p) => setVariant(v.id, p)}
                  onRemove={() => setStep((s) => ({ ...s, variants: s.variants.filter((x) => x.id !== v.id) }))}
                />
              ))}
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  setStep((s) => ({
                    ...s,
                    variants: [
                      ...s.variants,
                      {
                        id: newId("va"),
                        name: `Variant ${s.variants.length + 1}`,
                        rules: [{ field: "season_phase", op: "eq", value: "harvest" }],
                        ...(s.type === "email" ? { subject: s.subject ?? "" } : {}),
                        body: s.body,
                      },
                    ],
                  }))
                }
              >
                <Plus /> Add variant
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VariantCard({
  stepType,
  variant,
  onChange,
  onRemove,
}: {
  stepType: StepType;
  variant: StepVariant;
  onChange: (p: Partial<StepVariant>) => void;
  onRemove: () => void;
}) {
  const setRule = (i: number, patch: Partial<VariantRule>) => onChange({ rules: variant.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const listId = useMemo(() => `vals-${variant.id}`, [variant.id]);
  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="flex items-center gap-2">
        <Input value={variant.name} onChange={(e) => onChange({ name: e.target.value })} className="h-7 text-sm font-medium" aria-label="Variant name" />
        <Button variant="ghost" size="icon-xs" aria-label="Remove variant" onClick={onRemove}>
          <Trash2 />
        </Button>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Use when all of these match</p>
        {variant.rules.map((r, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)_auto] items-center gap-1.5">
            <Select value={r.field} onValueChange={(v) => setRule(i, { field: v as VariantField, value: "" })}>
              <SelectTrigger size="sm" className="h-7 w-full" aria-label="Field">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VARIANT_FIELDS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FIELD_NAME[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={r.op} onValueChange={(v) => setRule(i, { op: v as VariantRule["op"] })}>
              <SelectTrigger size="sm" className="h-7 w-full" aria-label="Operator">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="eq">is</SelectItem>
                <SelectItem value="neq">is not</SelectItem>
              </SelectContent>
            </Select>
            <Input list={`${listId}-${i}`} value={r.value} onChange={(e) => setRule(i, { value: e.target.value })} className="h-7 text-sm" aria-label="Value" />
            <datalist id={`${listId}-${i}`}>
              {SUGGESTIONS[r.field].map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <Button variant="ghost" size="icon-xs" aria-label="Remove rule" onClick={() => onChange({ rules: variant.rules.filter((_, j) => j !== i) })}>
              <X />
            </Button>
          </div>
        ))}
        <Button variant="ghost" size="xs" className={cn("text-muted-foreground")} onClick={() => onChange({ rules: [...variant.rules, { field: "commodity", op: "eq", value: "" }] })}>
          <Plus /> Add rule
        </Button>
      </div>
      {stepType === "email" && <MergeTextField id={`${variant.id}-subject`} label="Subject" value={variant.subject ?? ""} onChange={(v) => onChange({ subject: v })} />}
      <MergeTextField id={`${variant.id}-body`} label={stepType === "email" ? "Body" : "Task notes"} value={variant.body} onChange={(v) => onChange({ body: v })} multiline rows={6} />
    </div>
  );
}
