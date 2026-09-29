"use client";

import { useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { ChevronDown, ChevronUp, GripVertical, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DATE_FORMATS, activeColumns, buildCsv, normalizeSetup, previewTable, type ColumnDef, type ColumnSetup, type DateFormat } from "@/lib/columns";
import { useColumnPresets } from "@/lib/column-presets";
import { downloadText } from "@/lib/csv";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface ColumnPickerProps<T> {
  /** Stable id for presets and the remembered last-used setup */
  exportId: string;
  title?: string;
  columns: ColumnDef<T>[];
  /** Every row that can be exported */
  rows: T[];
  /** The current filtered view; enables the All / Current view option */
  filteredRows?: T[];
  filename: string;
  /** Starting setup; overrides the last-used setup */
  initialSetup?: ColumnSetup;
  /** Custom writer; by default the CSV is built and downloaded */
  onExport?: (setup: ColumnSetup, rows: T[]) => void | Promise<void>;
}

export interface ColumnPickerDialogProps<T> extends ColumnPickerProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

export function ColumnPickerDialog<T>({ open, onOpenChange, ...props }: ColumnPickerDialogProps<T>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{props.title ?? "Export CSV"}</DialogTitle>
        </DialogHeader>
        <PickerBody {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PickerBody<T>(props: ColumnPickerProps<T> & { onDone: () => void }) {
  const store = useColumnPresets(props.exportId);
  if (!store.loaded) return <div className="h-72" />;
  return <PickerEditor {...props} store={store} />;
}

function PickerEditor<T>({
  exportId,
  columns,
  rows,
  filteredRows,
  filename,
  initialSetup,
  onExport,
  onDone,
  store,
}: ColumnPickerProps<T> & { onDone: () => void; store: ReturnType<typeof useColumnPresets> }) {
  const [setup, setSetupRaw] = useState<ColumnSetup>(() => normalizeSetup(columns, initialSetup ?? store.lastUsed));
  const [presetId, setPresetId] = useState<string>("");
  const [presetName, setPresetName] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const setSetup = (next: ColumnSetup) => setSetupRaw(normalizeSetup(columns, next));
  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const hasScope = !!filteredRows;
  const scoped = hasScope && setup.scope === "filtered" ? filteredRows : rows;
  const active = activeColumns(columns, setup);
  const preview = useMemo(() => previewTable(scoped, columns, setup, 5), [scoped, columns, setup]);
  const hasDates = columns.some((c) => c.type === "date");
  const optional = setup.columns.filter((c) => !byKey.get(c.key)?.required);

  const patchColumn = (key: string, patch: { on?: boolean; label?: string }) =>
    setSetup({ ...setup, columns: setup.columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  const setAll = (on: boolean) => setSetup({ ...setup, columns: setup.columns.map((c) => ({ ...c, on: byKey.get(c.key)?.required ? true : on })) });
  const moveTo = (key: string, index: number) => {
    const from = setup.columns.findIndex((c) => c.key === key);
    if (from < 0 || index < 0 || index >= setup.columns.length || from === index) return;
    const next = [...setup.columns];
    const [item] = next.splice(from, 1);
    next.splice(index, 0, item);
    setSetup({ ...setup, columns: next });
  };

  const applyPreset = (id: string) => {
    const p = store.presets.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setPresetName(p.name);
    setSetup(p.setup);
  };
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const p = store.savePreset(name, setup);
    setPresetId(p.id);
    toast.success(`Saved preset ${p.name}`);
  };
  const deletePreset = () => {
    const p = store.presets.find((x) => x.id === presetId);
    if (!p) return;
    store.deletePreset(p.id);
    setPresetId("");
    setPresetName("");
    toast.success(`Deleted preset ${p.name}`);
  };

  const download = async () => {
    if (!active.length) return;
    setBusy(true);
    try {
      store.rememberLast(setup);
      if (onExport) await onExport(setup, scoped);
      else downloadText(filename, buildCsv(scoped, columns, setup));
      toast.success(`Exported ${plural(scoped.length, "row")}`);
      onDone();
    } catch (e) {
      console.error(e);
      toast.error("Export failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_220px]">
        <section aria-label="Columns" className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {active.length} of {setup.columns.length} columns
            </p>
            <div className="flex gap-1">
              <Button variant="ghost" size="xs" onClick={() => setAll(true)} disabled={optional.every((c) => c.on)}>
                Select all
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setAll(false)} disabled={optional.every((c) => !c.on)}>
                Clear all
              </Button>
            </div>
          </div>
          <ul className="max-h-72 divide-y overflow-y-auto rounded-md border" onDragLeave={(e) => e.currentTarget === e.target && setOverKey(null)}>
            {setup.columns.map((c, i) => {
              const def = byKey.get(c.key)!;
              const locked = !!def.required;
              return (
                <li
                  key={c.key}
                  ref={(el) => {
                    if (el) rowRefs.current.set(c.key, el);
                    else rowRefs.current.delete(c.key);
                  }}
                  data-column={c.key}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (overKey !== c.key) setOverKey(c.key);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey) moveTo(dragKey, i);
                    setDragKey(null);
                    setOverKey(null);
                  }}
                  className={cn(
                    "flex items-center gap-1.5 bg-card py-1 pr-1 pl-0.5",
                    dragKey === c.key && "opacity-50",
                    overKey === c.key && dragKey !== c.key && "bg-accent-soft",
                  )}
                >
                  <span
                    draggable
                    onDragStart={(e) => {
                      setDragKey(c.key);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.key);
                      const row = rowRefs.current.get(c.key);
                      if (row) e.dataTransfer.setDragImage(row, 12, row.offsetHeight / 2);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                    aria-hidden
                  >
                    <GripVertical className="size-3.5" />
                  </span>
                  <Checkbox
                    checked={c.on}
                    disabled={locked}
                    onCheckedChange={(v) => patchColumn(c.key, { on: v === true })}
                    aria-label={`Include ${def.label}`}
                  />
                  <span className={cn("min-w-0 flex-1 truncate text-sm", !c.on && "text-muted-foreground")} title={def.label}>
                    {def.label}
                  </span>
                  {locked ? (
                    <span className="flex h-7 w-32 shrink-0 items-center gap-1 px-2 text-xs text-muted-foreground" title="Required import field">
                      <Lock className="size-3" /> Required
                    </span>
                  ) : (
                    <Input
                      value={c.label ?? ""}
                      onChange={(e) => patchColumn(c.key, { label: e.target.value })}
                      placeholder={def.label}
                      aria-label={`Header for ${def.label}`}
                      disabled={!c.on}
                      className="h-7 w-32 shrink-0 rounded-md px-2 text-xs md:text-xs"
                    />
                  )}
                  <Button variant="ghost" size="icon-xs" onClick={() => moveTo(c.key, i - 1)} disabled={i === 0} aria-label={`Move ${def.label} up`}>
                    <ChevronUp />
                  </Button>
                  <Button variant="ghost" size="icon-xs" onClick={() => moveTo(c.key, i + 1)} disabled={i === setup.columns.length - 1} aria-label={`Move ${def.label} down`}>
                    <ChevronDown />
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label="Options" className="space-y-3">
          {hasScope && (
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Rows</span>
              <Select value={setup.scope} onValueChange={(v) => setSetup({ ...setup, scope: v as ColumnSetup["scope"] })}>
                <SelectTrigger size="sm" className="w-full" aria-label="Rows">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="filtered">Current view ({filteredRows.length.toLocaleString()})</SelectItem>
                  <SelectItem value="all">All rows ({rows.length.toLocaleString()})</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
          {hasDates && (
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Date format</span>
              <Select value={setup.dateFormat} onValueChange={(v) => setSetup({ ...setup, dateFormat: v as DateFormat })}>
                <SelectTrigger size="sm" className="w-full" aria-label="Date format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Preset</span>
            <div className="flex gap-1">
              <Select value={presetId} onValueChange={applyPreset} disabled={!store.presets.length}>
                <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Apply preset">
                  <SelectValue placeholder={store.presets.length ? "Choose preset" : "No presets"} />
                </SelectTrigger>
                <SelectContent>
                  {store.presets.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon-sm" onClick={deletePreset} disabled={!presetId} aria-label="Delete preset">
                <Trash2 />
              </Button>
            </div>
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                savePreset();
              }}
            >
              <Input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Board summary" aria-label="Preset name" className="h-7 min-w-0 flex-1 rounded-md px-2 text-xs md:text-xs" />
              <Button type="submit" variant="outline" size="sm" disabled={!presetName.trim()}>
                Save
              </Button>
            </form>
          </div>
        </section>
      </div>

      <section aria-label="Preview" className="min-w-0">
        <p className="mb-1.5 text-xs text-muted-foreground">Preview</p>
        <div className="max-h-44 overflow-auto rounded-md border">
          {preview.headers.length ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                <tr>
                  {preview.headers.map((h, i) => (
                    <th key={i} className="px-2 py-1.5 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className="max-w-48 truncate px-2 py-1 whitespace-nowrap" title={v}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-3 text-xs text-muted-foreground">No columns selected</p>
          )}
        </div>
      </section>

      <DialogFooter className="items-center sm:justify-between">
        <span className="text-xs text-muted-foreground tabular">{plural(scoped.length, "row")}</span>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button onClick={download} disabled={busy || !active.length} data-export-id={exportId}>
            Download CSV
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

export interface ExportCsvButtonProps<T> extends ColumnPickerProps<T> {
  label?: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  className?: string;
}

/** "Export CSV" button that opens the column picker */
export function ExportCsvButton<T>({ label = "Export CSV", variant = "outline", size, disabled, className, ...props }: ExportCsvButtonProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ColumnPickerDialog {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}
