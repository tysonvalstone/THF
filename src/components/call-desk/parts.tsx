"use client";

import type { CallNotes, CallType } from "@/types/salesforce";
import { fmtShortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Small tag (6px radius, 11px text) */
export function Tag({ children, tone = "neutral", className, title }: { children: React.ReactNode; tone?: "neutral" | "accent" | "solid" | "warn" | "critical" | "muted"; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 text-[11px] font-medium whitespace-nowrap",
        tone === "neutral" && "border-slate-300 text-slate-700",
        tone === "accent" && "border-primary/30 bg-accent-soft text-primary",
        tone === "solid" && "border-primary bg-primary text-primary-foreground",
        tone === "warn" && "border-amber-300 bg-amber-50 text-amber-800",
        tone === "critical" && "border-red-200 bg-red-50 text-status-critical",
        tone === "muted" && "border-slate-200 bg-slate-50 text-slate-500",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CallTypeTag({ type }: { type: CallType }) {
  return <Tag tone="neutral">{type}</Tag>;
}

export function SentimentTag({ sentiment }: { sentiment?: CallNotes["sentiment"] }) {
  if (!sentiment) return null;
  return <Tag tone={sentiment === "Positive" ? "accent" : sentiment === "Concerned" ? "warn" : "muted"}>{sentiment}</Tag>;
}

/** A compact brief block: heading, optional right-side content, body */
export function Block({ title, aside, children, className, id }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("min-w-0 rounded-md border bg-card", className)} aria-label={title}>
      <div className="flex items-center justify-between gap-2 border-b px-3.5 py-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {aside}
      </div>
      <div className="px-3.5 py-3 text-sm">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="truncate text-sm">{children}</div>
    </div>
  );
}

const QUAL_LABEL: Record<keyof CallNotes["qualification"], string> = {
  budget: "Budget",
  decisionMaker: "Decision maker",
  timeline: "Timeline",
  competitors: "Competitors",
  locations: "Locations",
};

/** Read-only AI Notes */
export function NotesView({ notes, compact }: { notes: CallNotes; compact?: boolean }) {
  const qual = (Object.keys(QUAL_LABEL) as (keyof CallNotes["qualification"])[]).filter((k) => notes.qualification[k]);
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <SentimentTag sentiment={notes.sentiment} />
        <Tag tone="muted">{notes.source === "ai" ? "AI" : "Rules"}</Tag>
      </div>
      <div className="space-y-0.5">
        {notes.summary.split("\n").map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
      {!compact && notes.keyPoints.length > 0 && <List title="Key points" items={notes.keyPoints} />}
      {notes.painPoints.length > 0 && <List title="Pain points" items={notes.painPoints} />}
      {notes.objections.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Objections</p>
          <ul className="mt-1 space-y-1.5">
            {notes.objections.map((o, i) => (
              <li key={i}>
                <p>{o.objection}</p>
                <p className="text-muted-foreground">Handled: {o.response}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {qual.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Qualification</p>
          <dl className="mt-1 grid gap-x-3 gap-y-1 sm:grid-cols-[120px_minmax(0,1fr)]">
            {qual.map((k) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{QUAL_LABEL[k]}</dt>
                <dd>{notes.qualification[k]}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {notes.nextSteps.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Next steps</p>
          <ul className="mt-1 space-y-1">
            {notes.nextSteps.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                <span>{s.text}</span>
                <span className="text-xs text-muted-foreground">
                  {s.owner}
                  {s.due ? ` · ${fmtShortDate(s.due)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export const selectCls = "h-8 rounded-md border border-input bg-card px-2 text-sm";
