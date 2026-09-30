"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FieldValue = string | number | boolean | null | undefined;

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "currency" | "percent" | "date" | "select" | "textarea" | "checkbox";
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Full width in the two-column grid */
  wide?: boolean;
  help?: string;
  disabled?: boolean;
  /** Return an error message, or null when valid */
  validate?: (value: FieldValue, values: Record<string, FieldValue>) => string | null;
}

export interface RecordDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  fields: FieldDef[];
  initial: Record<string, FieldValue>;
  submitLabel?: string;
  /** Return an error message to keep the drawer open */
  onSubmit: (values: Record<string, FieldValue>) => void | string;
  /** Shown in the footer when editing */
  onDelete?: () => void;
  /** Extra content under the form (e.g. related lists) */
  children?: React.ReactNode;
}

const EMAIL = /^\S+@\S+\.\S+$/;

function check(f: FieldDef, v: FieldValue, all: Record<string, FieldValue>): string | null {
  const empty = v === undefined || v === null || v === "";
  if (f.required && empty && f.type !== "checkbox") return "Required";
  if (!empty && f.type === "email" && !EMAIL.test(String(v))) return "Enter a valid email";
  if (!empty && (f.type === "number" || f.type === "currency" || f.type === "percent")) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "Enter a number";
    if (f.min !== undefined && n < f.min) return `At least ${f.min}`;
    if (f.max !== undefined && n > f.max) return `At most ${f.max}`;
  }
  return f.validate?.(v, all) ?? null;
}

function Form({ fields, initial, submitLabel, onSubmit, onDelete, onCancel }: Omit<RecordDrawerProps, "open" | "onOpenChange" | "title"> & { onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, FieldValue>>(initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errors = Object.fromEntries(fields.map((f) => [f.name, check(f, values[f.name], values)]));
  const set = (name: string, v: FieldValue) => setValues((s) => ({ ...s, [name]: v }));

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        if (fields.some((f) => errors[f.name])) return;
        const out: Record<string, FieldValue> = {};
        for (const f of fields) {
          const v = values[f.name];
          out[f.name] = f.type === "number" || f.type === "currency" || f.type === "percent" ? (v === "" || v == null ? null : Number(v)) : typeof v === "string" ? v.trim() : v;
        }
        const err = onSubmit({ ...values, ...out });
        if (typeof err === "string") setFormError(err);
      }}
    >
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-5 sm:grid-cols-2">
        {fields.map((f) => {
          const err = (touched[f.name] || submitted) && errors[f.name];
          const id = `rd-${f.name}`;
          const common = {
            id,
            disabled: f.disabled,
            "aria-invalid": !!err || undefined,
            "aria-describedby": err ? `${id}-err` : f.help ? `${id}-help` : undefined,
            onBlur: () => setTouched((t) => ({ ...t, [f.name]: true })),
          };
          const v = values[f.name];
          return (
            <div key={f.name} className={cn("grid content-start gap-1.5", (f.wide || f.type === "textarea") && "sm:col-span-2")}>
              {f.type === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} className="size-4 accent-[#1f5f4a]" {...common} />
                  {f.label}
                </label>
              ) : (
                <Label htmlFor={id}>
                  {f.label}
                  {f.required && <span className="text-status-critical"> *</span>}
                </Label>
              )}
              {f.type === "select" ? (
                <select value={String(v ?? "")} onChange={(e) => set(f.name, e.target.value)} className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm aria-invalid:border-status-critical" {...common}>
                  {!f.required && <option value="">None</option>}
                  {f.required && !v && <option value="">Select…</option>}
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  value={String(v ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                  placeholder={f.placeholder}
                  rows={4}
                  className="w-full rounded-md border border-input bg-card px-2.5 py-2 text-sm outline-none focus:border-primary/50 aria-invalid:border-status-critical"
                  {...common}
                />
              ) : f.type !== "checkbox" ? (
                <div className="relative">
                  {f.type === "currency" && <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">$</span>}
                  <Input
                    type={f.type === "currency" || f.type === "percent" ? "number" : (f.type ?? "text")}
                    value={v === null || v === undefined ? "" : String(v)}
                    onChange={(e) => set(f.name, e.target.value)}
                    placeholder={f.placeholder}
                    min={f.min}
                    max={f.max}
                    step={f.step ?? (f.type === "currency" ? 100 : undefined)}
                    className={cn(f.type === "currency" && "pl-6", f.type === "percent" && "pr-7", err && "border-status-critical")}
                    {...common}
                  />
                  {f.type === "percent" && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
                </div>
              ) : null}
              {err ? (
                <p id={`${id}-err`} className="text-xs text-status-critical">
                  {err}
                </p>
              ) : (
                f.help && (
                  <p id={`${id}-help`} className="text-xs text-muted-foreground">
                    {f.help}
                  </p>
                )
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 border-t px-5 py-3">
        {onDelete && (
          <Button type="button" variant="ghost" className="text-status-critical hover:text-status-critical" onClick={onDelete}>
            Delete
          </Button>
        )}
        {formError && <p className="text-sm text-status-critical">{formError}</p>}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">{submitLabel ?? "Save"}</Button>
        </div>
      </div>
    </form>
  );
}

/** Side drawer with a validated form, used for every create and edit */
export function RecordDrawer({ open, onOpenChange, title, description, children, ...form }: RecordDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-[560px]">
        <div className="border-b px-5 py-4 pr-12">
          <SheetTitle className="text-base font-semibold">{title}</SheetTitle>
          <SheetDescription className={description ? "mt-0.5 text-sm text-muted-foreground" : "sr-only"}>{description ?? title}</SheetDescription>
        </div>
        {/* Remount per open so the form starts from `initial` */}
        {open && <Form {...form} onCancel={() => onOpenChange(false)} />}
        {children && <div className="border-t px-5 py-4">{children}</div>}
      </SheetContent>
    </Sheet>
  );
}
