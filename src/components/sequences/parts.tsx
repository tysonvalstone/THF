"use client";

import { useRef } from "react";
import { ChevronDown } from "lucide-react";
import { MERGE_FIELDS, type MergeField } from "@/lib/ai/types";
import type { RenderSegment } from "@/lib/sequences/engine";
import { FIELD_LABEL } from "./sequence-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Rendered template text: filled merge fields tinted, missing ones amber */
export function RenderedText({ segments, className }: { segments: RenderSegment[]; className?: string }) {
  return (
    <span className={cn("whitespace-pre-wrap break-words", className)}>
      {segments.map((s, i) =>
        s.field ? (
          <span
            key={i}
            title={s.missing ? `Missing: ${FIELD_LABEL[s.field]}` : FIELD_LABEL[s.field]}
            className={cn("rounded-sm px-0.5", s.missing ? "bg-amber-100 font-mono text-[0.85em] text-amber-900" : "bg-accent-soft")}
          >
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/** Dropdown of merge fields */
export function InsertFieldMenu({ onPick, disabled }: { onPick: (f: MergeField) => void; disabled?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" disabled={disabled} className="text-muted-foreground">
          Insert field <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
        {MERGE_FIELDS.map((f) => (
          <DropdownMenuItem key={f} onSelect={() => onPick(f)} className="flex justify-between gap-4">
            <span>{FIELD_LABEL[f]}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{`{{${f}}}`}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Subject or body input with an "Insert field" menu that inserts at the cursor */
export function MergeTextField({
  id,
  label,
  value,
  onChange,
  multiline,
  rows = 8,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const insert = (f: MergeField) => {
    const el = ref.current;
    const token = `{{${f}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    onChange(value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      ref.current.setSelectionRange(start + token.length, start + token.length);
    });
  };
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <InsertFieldMenu onPick={insert} />
      </div>
      {multiline ? (
        <Textarea id={id} ref={ref} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="text-sm" />
      ) : (
        <Input id={id} ref={ref} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
