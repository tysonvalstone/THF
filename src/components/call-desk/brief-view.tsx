"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Copy, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { aiCallBrief, useAiStatus } from "@/lib/ai/client";
import { applyAiBrief, briefDigest, briefText, buildBrief, TIMELINE_KINDS, type CallBrief, type TimelineEntry, type TimelineKind } from "@/lib/call-desk";
import { fmtDate, fmtRelative, fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";
import { opportunityHref } from "@/lib/links";
import type { Call } from "@/types/salesforce";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Block, Field, SentimentTag, Tag, selectCls } from "./parts";

/** "Oct 14", or "Feb 28, 2028" outside the current year */
const dateLabel = (iso: string) => (iso.slice(0, 4) === new Date().toISOString().slice(0, 4) ? fmtShortDate(iso) : fmtDate(iso));

/* ------------------------------------------------------------------ hook */

const aiCache = new Map<string, Promise<CallBrief | null>>();

/** The rules brief at once; with an AI key, the model's summary, questions and talking points replace the rules' when ready */
export function useCallBrief(call: Call | undefined): { brief: CallBrief | null; aiLoading: boolean } {
  const { data, asOf, asOfISO, demoMode, changeLog } = useStore();
  const { available } = useAiStatus();
  const rules = useMemo(() => (call ? buildBrief(call, data, { asOf }) : null), [call, data, asOf]);
  const [ai, setAi] = useState<{ key: string; brief: CallBrief | null } | null>(null);
  const key = call && rules ? `${call.Id}:${rules.lastTime?.callId ?? ""}:${rules.lastTime?.pending ? 1 : 0}:${call.Start}` : "";

  useEffect(() => {
    if (!available || !call || !rules || !key) return;
    let live = true;
    let p = aiCache.get(key);
    if (!p) {
      p = aiCallBrief(briefDigest(rules, call), { asOf: asOfISO, page: "/call-desk", pageTitle: "Call Desk", demo: demoMode, mutations: changeLog().slice(-500) }).then((r) => (r.ok ? applyAiBrief(rules, r.brief) : null));
      aiCache.set(key, p);
    }
    p.then((b) => live && setAi({ key, brief: b }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one request per call/key
  }, [available, key]);

  const aiBrief = ai?.key === key ? ai.brief : null;
  // AI parts on top of the latest rules data (snapshot, timeline stay live)
  const brief = rules && aiBrief ? { ...rules, source: "ai" as const, aiSummary: aiBrief.aiSummary, questions: aiBrief.questions, talking: { ...rules.talking, points: aiBrief.talking.points, objections: aiBrief.talking.objections } } : rules;
  return { brief, aiLoading: !!available && !!key && ai?.key !== key };
}

/* ---------------------------------------------------------------- blocks */

function Snapshot({ brief }: { brief: CallBrief }) {
  const s = brief.snapshot;
  const { lightningBaseUrl } = useStore();
  const seasonTone = s.season.status === "hard" ? "warn" : s.season.status === "light" ? "warn" : "accent";
  return (
    <Block title="Snapshot" aside={<Tag tone={seasonTone}>{s.season.label}</Tag>}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-4">
        <Field label="Account">
          <Link href={`/accounts/${s.accountId}`} className="font-medium text-primary hover:underline">
            {s.accountName}
          </Link>
        </Field>
        <Field label="Segment">{s.segment}</Field>
        <Field label="Locations">{s.locations}</Field>
        <Field label="Commodity">{s.commodity}</Field>
        <Field label="Region">
          <span title={s.place}>{s.region}</span>
        </Field>
        <Field label="Health">
          {s.health ? (
            <span className={cn(s.health.band === "At Risk" ? "text-status-critical" : s.health.band === "Watch" ? "text-amber-800" : "")}>
              {s.health.score} · {s.health.band}
              {s.health.trend !== "flat" && <span className="text-xs text-muted-foreground"> ({s.health.delta > 0 ? "+" : ""}{s.health.delta})</span>}
            </span>
          ) : (
            <span className="text-muted-foreground">{s.isCustomer ? "No data" : "Prospect"}</span>
          )}
        </Field>
        <Field label="Open pipeline">
          {fmtMoney(s.pipeline.amount)} <span className="text-xs text-muted-foreground">({s.pipeline.count})</span>
        </Field>
        <Field label="Overdue invoices">{s.overdue.count ? <span className="text-status-critical">{s.overdue.count} · {fmtMoney(s.overdue.amount)}</span> : "None"}</Field>
      </div>
      {(s.opportunity || s.quote || s.contract) && (
        <ul className="mt-3 space-y-1 border-t pt-2.5 text-sm">
          {s.opportunity && (
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="w-16 text-xs text-muted-foreground">Deal</span>
              <Link href={opportunityHref(s.opportunity.id, lightningBaseUrl)} className="min-w-0 truncate hover:text-primary hover:underline">
                {s.opportunity.name}
              </Link>
              <Tag>{s.opportunity.stage}</Tag>
              <span className="text-xs text-muted-foreground tabular">
                {fmtMoney(s.opportunity.amount)} · close {dateLabel(s.opportunity.closeDate)}
              </span>
            </li>
          )}
          {s.quote && (
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="w-16 text-xs text-muted-foreground">Quote</span>
              <Link href={`/quotes/${s.quote.id}`} className="hover:text-primary hover:underline">
                {s.quote.number}
              </Link>
              <Tag tone="muted">{s.quote.status}</Tag>
              <span className="text-xs text-muted-foreground tabular">{fmtMoney(s.quote.total)}</span>
            </li>
          )}
          {s.contract && (
            <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="w-16 text-xs text-muted-foreground">Contract</span>
              <span>{s.contract.number}</span>
              <Tag tone="muted">{s.contract.status}</Tag>
              <span className="text-xs text-muted-foreground tabular">
                ends {dateLabel(s.contract.endDate)} · ARR {fmtMoney(s.contract.arr)}
              </span>
            </li>
          )}
        </ul>
      )}
    </Block>
  );
}

function Attendees({ brief }: { brief: CallBrief }) {
  const { asOf } = useStore();
  return (
    <Block title="Who's on the call">
      <ul className="space-y-2">
        {brief.attendees.map((a) => (
          <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className="min-w-0">
              <span className="font-medium">{a.name}</span>
              <span className="text-muted-foreground"> · {a.title}</span>
              {a.note && <p className="text-xs text-muted-foreground">{a.note}</p>}
            </div>
            <div className="flex items-center gap-1.5">
              <Tag tone={a.role === "Economic Buyer" ? "accent" : "neutral"}>{a.role}</Tag>
              <span className="text-xs text-muted-foreground tabular">{a.lastSpoke ? `${a.lastSpoke.kind} ${fmtRelative(a.lastSpoke.date.slice(0, 10), asOf)}` : "Never spoke"}</span>
            </div>
          </li>
        ))}
        {!brief.attendees.length && <li className="text-muted-foreground">No contacts on the invite</li>}
      </ul>
      {brief.gaps.length > 0 && (
        <ul className="mt-2.5 space-y-1 border-t pt-2">
          {brief.gaps.map((g) => (
            <li key={g} className="flex items-start gap-1.5 text-amber-800">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {g}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function LastTime({ brief }: { brief: CallBrief }) {
  const l = brief.lastTime;
  return (
    <Block
      title="Last time"
      aside={
        l && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <SentimentTag sentiment={l.sentiment as never} />
            {dateLabel(l.date.slice(0, 10))} · {l.callType}
          </span>
        )
      }
    >
      {!l ? (
        <p className="text-muted-foreground">First call with this account</p>
      ) : l.pending ? (
        <p className="text-muted-foreground">Notes pending for the {dateLabel(l.date.slice(0, 10))} call</p>
      ) : (
        <>
          <div className="space-y-0.5">
            {l.summary.map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
          {l.commitments.length > 0 && (
            <ul className="mt-2.5 space-y-1 border-t pt-2">
              {l.commitments.map((c, i) => (
                <li key={i} className={cn("flex items-start gap-2", c.overdue && "text-amber-800")}>
                  <span className={cn("mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm border", c.done && "border-primary bg-primary text-primary-foreground")} aria-label={c.done ? "Done" : "Open"}>
                    {c.done && <Check className="size-2.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs font-medium text-muted-foreground">{c.owner === "us" ? "Ours" : "Theirs"}: </span>
                    <span className={cn(c.done && "text-muted-foreground line-through")}>{c.text}</span>
                  </span>
                  {c.due && <span className="text-xs tabular">{c.overdue ? `Overdue · ${dateLabel(c.due)}` : dateLabel(c.due)}</span>}
                </li>
              ))}
            </ul>
          )}
          {l.questionsAsked.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Answered: {l.questionsAsked.join(" · ")}</p>}
        </>
      )}
    </Block>
  );
}

const KIND_TONE: Partial<Record<TimelineKind, "accent" | "neutral" | "muted">> = { Call: "accent", Meeting: "accent" };

function Timeline({ brief }: { brief: CallBrief }) {
  const [kind, setKind] = useState<"" | TimelineKind>("");
  const rows = kind ? brief.timeline.filter((t) => t.kind === kind) : brief.timeline;
  const columns: Column<TimelineEntry>[] = [
    { key: "date", header: "Date", sortValue: (r) => r.date, cell: (r) => <span className="whitespace-nowrap tabular text-muted-foreground">{dateLabel(r.date.slice(0, 10))}</span> },
    { key: "kind", header: "Type", sortValue: (r) => r.kind, cell: (r) => <Tag tone={r.tone === "warn" ? "warn" : (KIND_TONE[r.kind] ?? "neutral")}>{r.kind}</Tag> },
    {
      key: "title",
      header: "Activity",
      cell: (r) => (
        <div className="max-w-[440px] min-w-[180px]">
          {r.href ? (
            <Link href={r.href} className="block truncate hover:text-primary hover:underline">
              {r.title}
            </Link>
          ) : (
            <p className="truncate">{r.title}</p>
          )}
          {r.detail && <p className={cn("truncate text-xs text-muted-foreground", r.tone === "warn" && "text-amber-800")}>{r.detail}</p>}
        </div>
      ),
    },
  ];
  const kinds = TIMELINE_KINDS.filter((k) => brief.timeline.some((t) => t.kind === k));
  return (
    <Block title="Interaction timeline" aside={<span className="text-xs text-muted-foreground">{brief.timeline.length} items</span>}>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "date", dir: "desc" }}
        pageSize={10}
        pageSizes={[]}
        urlState={false}
        dense
        filterKey={kind}
        filters={
          <select className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as TimelineKind | "")} aria-label="Activity type">
            <option value="">All activity</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        }
        empty="No activity yet"
      />
    </Block>
  );
}

/** Tailored questions with check-offs (saved to Call.QuestionsAsked) */
export function Questions({ brief, asked, onToggle, aiLoading }: { brief: CallBrief; asked: string[]; onToggle: (text: string) => void; aiLoading?: boolean }) {
  return (
    <Block
      title="Questions to ask"
      aside={
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {aiLoading && <Loader2 className="size-3 animate-spin" aria-label="AI is writing" />}
          {asked.length}/{brief.questions.length} asked
        </span>
      }
    >
      <ol className="space-y-1.5">
        {brief.questions.map((q) => {
          const on = asked.includes(q.text);
          return (
            <li key={q.id}>
              <label className="flex cursor-pointer items-start gap-2">
                <input type="checkbox" checked={on} onChange={() => onToggle(q.text)} className="mt-0.5 size-4 shrink-0 accent-[#1f5f4a]" />
                <span className={cn("min-w-0 flex-1", on && "text-muted-foreground line-through")}>{q.text}</span>
                {q.why !== "General" && q.why !== "AI" && (
                  <Tag tone="muted" className="hidden sm:inline-flex">
                    {q.why}
                  </Tag>
                )}
              </label>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}

function TalkingPoints({ brief }: { brief: CallBrief }) {
  const t = brief.talking;
  return (
    <Block title="Talking points">
      {t.points.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4">
          {t.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {t.products.length > 0 && (
        <div className="mt-2.5">
          <p className="text-xs font-semibold text-muted-foreground">Products that fit</p>
          <ul className="mt-1 space-y-1">
            {t.products.map((p) => (
              <li key={p.name}>
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground"> · {p.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {t.reference && (
        <div className="mt-2.5">
          <p className="text-xs font-semibold text-muted-foreground">Reference customer</p>
          <p className="mt-0.5">
            <Link href={`/accounts/${t.reference.accountId}`} className="font-medium hover:text-primary hover:underline">
              {t.reference.name}
            </Link>
            <span className="text-muted-foreground"> · {t.reference.detail}</span>
          </p>
        </div>
      )}
      {t.objections.length > 0 && (
        <div className="mt-2.5">
          <p className="text-xs font-semibold text-muted-foreground">Likely objections</p>
          <ul className="mt-1 space-y-1">
            {t.objections.map((o) => (
              <li key={o.objection}>
                <span>&ldquo;{o.objection}&rdquo;</span>
                <span className="text-muted-foreground"> {o.response}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Block>
  );
}

function Risks({ brief }: { brief: CallBrief }) {
  return (
    <Block title="Risks" aside={brief.risks.length ? <Tag tone="warn">{brief.risks.length}</Tag> : undefined}>
      {brief.risks.length ? (
        <ul className="space-y-1">
          {brief.risks.map((r) => (
            <li key={r.text} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700" aria-hidden />
              <span>{r.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">None flagged</p>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ view */

export function BriefActions({ brief, call }: { brief: CallBrief; call: Call }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          navigator.clipboard.writeText(briefText(brief, call)).then(
            () => toast.success("Brief copied"),
            () => toast.error("Couldn't copy"),
          );
        }}
      >
        <Copy data-icon="inline-start" />
        Copy brief
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { downloadBriefPdf } = await import("@/lib/call-desk/pdf");
            await downloadBriefPdf(brief, call);
          } catch {
            toast.error("Couldn't create the PDF");
          } finally {
            setBusy(false);
          }
        }}
      >
        <FileDown data-icon="inline-start" />
        PDF
      </Button>
    </>
  );
}

/** The whole pre-call brief, blocks in reading order */
export function BriefView({ call, brief, aiLoading }: { call: Call; brief: CallBrief; aiLoading: boolean }) {
  const { update } = useCrud();
  const asked = call.QuestionsAsked ?? [];
  const toggle = (text: string) => update("Call", call.Id, { QuestionsAsked: asked.includes(text) ? asked.filter((q) => q !== text) : [...asked, text] });
  return (
    <div className="space-y-3" data-testid="call-brief">
      {brief.aiSummary.length > 0 && (
        <div className="rounded-md border border-primary/30 bg-accent-soft px-3.5 py-2.5 text-sm">
          <div className="mb-1 flex items-center gap-1.5">
            <Tag tone="accent">AI</Tag>
            <span className="text-xs text-muted-foreground">At a glance</span>
          </div>
          {brief.aiSummary.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
      )}
      <Snapshot brief={brief} />
      <div className="grid gap-3 xl:grid-cols-2">
        <Attendees brief={brief} />
        <LastTime brief={brief} />
      </div>
      <Timeline brief={brief} />
      <Questions brief={brief} asked={asked} onToggle={toggle} aiLoading={aiLoading} />
      <div className="grid gap-3 xl:grid-cols-2">
        <TalkingPoints brief={brief} />
        <Risks brief={brief} />
      </div>
    </div>
  );
}
