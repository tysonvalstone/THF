"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Pencil, Phone, Plus } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { USER_BY_ID } from "@/data/reference/users";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import { callContacts, fmtCountdown, fmtDay, fmtTime, isPast, minutesUntil, nextCall } from "@/lib/call-desk";
import { CALL_TYPES, type Call, type CallType } from "@/types/salesforce";
import { LocalChangeTag } from "@/components/shared/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BriefActions, BriefView, useCallBrief } from "./brief-view";
import { CallDetail } from "./call-detail";
import { LiveCall } from "./live-call";
import { CallTypeTag, Tag } from "./parts";
import { ScheduleCallDrawer, ScheduleCallFlow, ScheduleCallHost, type ScheduleCallPrefill } from "./schedule-call";
import { useCallScope, useSimClock, type CallScope } from "./use-call-desk";
import { onDemo } from "@/lib/demo/state";

type CallState = "next" | "upcoming" | "saved" | "pending" | "canceled";

function stateOf(call: Call, now: string, asOfISO: string, next?: Call): CallState {
  if (call.Status === "Canceled") return "canceled";
  if (call.Status === "Completed") return call.NotesStatus === "Saved" && call.Notes ? "saved" : "pending";
  if (next?.Id === call.Id) return "next";
  const day = call.Start.slice(0, 10);
  if (day < asOfISO || (day === asOfISO && isPast(call, now))) return "pending";
  return "upcoming";
}

function StatusTag({ state }: { state: CallState }) {
  switch (state) {
    case "saved":
      return <Tag tone="accent">Notes saved</Tag>;
    case "pending":
      return <Tag tone="warn">Notes pending</Tag>;
    case "canceled":
      return <Tag tone="muted">Canceled</Tag>;
    default:
      return <Tag tone="neutral">Brief ready</Tag>;
  }
}

function AgendaItem({ call, state, countdown, selected, team, onSelect }: { call: Call; state: CallState; countdown?: string; selected: boolean; team: boolean; onSelect: () => void }) {
  const { data } = useStore();
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const opp = call.OpportunityId ? data.opportunities.find((o) => o.Id === call.OpportunityId) : undefined;
  const contacts = callContacts(call, data);
  const next = state === "next";
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="agenda-item"
        className={cn(
          "block w-full rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40",
          selected && "border-primary/60 bg-accent-soft",
          next && "border-primary ring-1 ring-primary",
          state === "canceled" && "opacity-60",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular">{fmtTime(call.Start.slice(11, 16))}</span>
          <span className="text-xs text-muted-foreground">{call.DurationMin} min</span>
          {next && (
            <Tag tone="solid" className="ml-auto">
              Next · {countdown}
            </Tag>
          )}
        </div>
        <p className={cn("mt-0.5 truncate text-sm font-medium", state === "canceled" && "line-through")}>
          {account?.Name ?? "Unknown account"}
          <LocalChangeTag id={call.Id} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{contacts.map((c) => c.Name).join(", ") || "No contacts"}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <CallTypeTag type={call.CallType} />
          <StatusTag state={state} />
          {team && <span className="text-xs text-muted-foreground">{USER_BY_ID[call.OwnerId]?.Name}</span>}
        </div>
        {opp && <p className="mt-1 truncate text-xs text-muted-foreground">{opp.Name}</p>}
      </button>
    </li>
  );
}

/** The selected call: header, actions, AI Notes (after the call) and the brief */
function CallPanel({ call, state, onEdit, onStart, team }: { call: Call; state: CallState; onEdit: () => void; onStart: () => void; team: boolean }) {
  const { brief, aiLoading } = useCallBrief(call);
  const { data } = useStore();
  const [tab, setTab] = useState<"notes" | "brief">(call.Notes ? "notes" : "brief");
  // Reset the tab for another call, or when notes were just saved
  const shownKey = `${call.Id}:${call.NotesStatus}`;
  const [shownFor, setShownFor] = useState(shownKey);
  if (shownFor !== shownKey) {
    setShownFor(shownKey);
    setTab(call.Notes ? "notes" : "brief");
  }
  const contacts = callContacts(call, data);
  const done = call.Status === "Completed" || call.Status === "Canceled";
  if (!brief) return <p className="text-sm text-muted-foreground">This call&apos;s account is not in the data.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border bg-card px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold" data-testid="call-subject">
            {call.Subject}
          </h2>
          <p className="text-xs text-muted-foreground">
            {fmtDay(call.Start.slice(0, 10))} · {fmtTime(call.Start.slice(11, 16))} · {call.DurationMin} min · {contacts.map((c) => c.Name).join(", ") || "No contacts"}
            {team && ` · ${USER_BY_ID[call.OwnerId]?.Name ?? ""}`}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <CallTypeTag type={call.CallType} />
            <StatusTag state={state} />
            <Tag tone="muted">{aiLoading ? "AI brief…" : brief.source === "ai" ? "AI brief" : "Rules brief"}</Tag>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {call.Status !== "Canceled" && (
            <Button size="sm" onClick={onStart}>
              <Phone data-icon="inline-start" />
              {done ? "Redo notes" : "Start call"}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil data-icon="inline-start" />
            Edit
          </Button>
          <BriefActions brief={brief} call={call} />
        </div>
      </div>
      {done && (
        <div className="flex gap-1 border-b" role="tablist">
          {(["notes", "brief"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn("-mb-px border-b-2 px-3 py-1.5 text-sm", tab === t ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t === "notes" ? "AI Notes" : "Brief"}
            </button>
          ))}
        </div>
      )}
      {done && tab === "notes" ? <CallDetail call={call} editable /> : <BriefView call={call} brief={brief} aiLoading={aiLoading} />}
    </div>
  );
}

/** Call Desk → Today: the day's agenda on the left, the selected call's brief on the right */
export function CallDeskView() {
  const { ready, data, asOfISO } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const now = useSimClock();
  const { canSeeTeam, ownsCalls, filter } = useCallScope();
  const [dateParam, setDateParam] = useState<string | null>(params.get("date"));
  const date = dateParam ?? asOfISO;
  const [scopeChoice, setScope] = useState<CallScope | null>(null);
  const scope: CallScope = scopeChoice ?? (canSeeTeam && !ownsCalls ? "team" : "mine");
  const [picked, setPicked] = useState<string | null>(params.get("call"));
  const [editing, setEditing] = useState<Call | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"" | CallType>("");
  const [schedule, setSchedule] = useState<ScheduleCallPrefill | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // ?schedule=1&account=…: opened from another page
  const handledSchedule = useRef(false);
  useEffect(() => {
    if (!ready || handledSchedule.current || params.get("schedule") !== "1") return;
    handledSchedule.current = true;
    setSchedule({
      accountId: params.get("account") ?? undefined,
      opportunityId: params.get("opp") ?? undefined,
      contactIds: params.get("contacts")?.split(",").filter(Boolean),
      callType: (params.get("type") as CallType) ?? undefined,
      date: params.get("date") ?? undefined,
      time: params.get("time") ?? undefined,
    });
    router.replace("/call-desk", { scroll: false });
  }, [ready, params, router]);

  // ?call=…&live=1 (Demo Mode walkthrough): open that call and start the simulated transcript
  const liveParam = params.get("live") === "1" ? params.get("call") : null;
  const [liveHandled, setLiveHandled] = useState<string | null>(null);
  if (ready && liveParam && liveParam !== liveHandled) {
    setLiveHandled(liveParam);
    setPicked(liveParam);
    setDateParam(null);
    setLive(liveParam);
    setAutoStart(true);
  }
  useEffect(
    () =>
      onDemo((s) => {
        if (s.type === "call-close") setLive((cur) => (cur === s.callId ? null : cur));
      }),
    [],
  );

  const visible = useMemo(() => data.calls.filter(filter(scope)), [data.calls, filter, scope]);
  const dayCalls = useMemo(
    () => visible.filter((c) => c.Start.startsWith(date) && (!typeFilter || c.CallType === typeFilter)).sort((a, b) => a.Start.localeCompare(b.Start) || a.OwnerId.localeCompare(b.OwnerId)),
    [visible, date, typeFilter],
  );
  const isToday = date === asOfISO;
  const next = isToday ? nextCall(dayCalls, now) : undefined;
  const selected = dayCalls.find((c) => c.Id === picked) ?? data.calls.find((c) => c.Id === picked && c.Start.startsWith(date)) ?? next ?? dayCalls.find((c) => c.Status === "Scheduled") ?? dayCalls[0];
  const liveCall = live ? data.calls.find((c) => c.Id === live) : undefined;
  const { brief: liveBrief } = useCallBrief(liveCall);

  const shift = (days: number) => {
    let d = addDays(parseDate(date), days);
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = addDays(d, days > 0 ? 1 : -1);
    setDateParam(toISODate(d));
    setPicked(null);
  };

  if (!ready) return <Skeleton className="h-[560px]" />;

  const counts = { total: dayCalls.length, saved: dayCalls.filter((c) => c.NotesStatus === "Saved" && c.Status === "Completed").length };
  const team = scope === "team";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label="Previous day" onClick={() => shift(-1)}>
            <ChevronLeft />
          </Button>
          <label className="relative">
            <span className="sr-only">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (!e.target.value) return;
                setDateParam(e.target.value);
                setPicked(null);
              }}
              className="h-7 rounded-md border border-input bg-card px-2 text-sm"
            />
          </label>
          <Button size="icon-sm" variant="outline" aria-label="Next day" onClick={() => shift(1)}>
            <ChevronRight />
          </Button>
        </div>
        <span className="text-sm font-medium" data-testid="agenda-date">
          {fmtDay(date)}
          {isToday && <span className="font-normal text-muted-foreground"> · today</span>}
        </span>
        {!isToday && (
          <Button size="sm" variant="ghost" onClick={() => (setDateParam(null), setPicked(null))}>
            Today
          </Button>
        )}
        {canSeeTeam && (
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Whose calls">
            {(["mine", "team"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={scope === s}
                onClick={() => (setScope(s), setPicked(null))}
                className={cn("rounded-sm px-2.5 py-0.5 text-sm", scope === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {s === "mine" ? "My calls" : "Team"}
              </button>
            ))}
          </div>
        )}
        <select className="h-7 rounded-md border border-input bg-card px-2 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as CallType | "")} aria-label="Call type">
          <option value="">All call types</option>
          {CALL_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <Button size="sm" className="ml-auto" onClick={() => setSchedule({ date: date >= asOfISO ? date : asOfISO })}>
          <Plus data-icon="inline-start" />
          Schedule call
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section aria-label="Agenda" className="min-w-0">
          <p className="mb-2 text-xs text-muted-foreground">
            {counts.total} call{counts.total === 1 ? "" : "s"}
            {counts.saved ? ` · ${counts.saved} with notes` : ""}
            {next && ` · next ${fmtCountdown(minutesUntil(next, now))}`}
          </p>
          <ol className="space-y-2 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1" data-testid="agenda">
            {dayCalls.map((c) => (
              <AgendaItem
                key={c.Id}
                call={c}
                state={stateOf(c, now, asOfISO, next)}
                countdown={next?.Id === c.Id ? fmtCountdown(minutesUntil(c, now)) : undefined}
                selected={selected?.Id === c.Id}
                team={team}
                onSelect={() => {
                  setPicked(c.Id);
                  if (window.matchMedia("(max-width: 1023px)").matches) setTimeout(() => panelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }}
              />
            ))}
            {!dayCalls.length && (
              <li className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                No calls on {fmtDay(date)}
                {scope === "mine" && canSeeTeam && !ownsCalls && <span className="block text-xs">Switch to Team to see the reps&apos; calls</span>}
              </li>
            )}
          </ol>
        </section>
        <div ref={panelRef} className="min-w-0 scroll-mt-4">
          {selected ? (
            <CallPanel call={selected} state={stateOf(selected, now, asOfISO, next)} team={team} onEdit={() => setEditing(selected)} onStart={() => (setAutoStart(false), setLive(selected.Id))} />
          ) : (
            <p className="rounded-md border border-dashed px-3 py-10 text-center text-sm text-muted-foreground">Pick a call to see its brief</p>
          )}
        </div>
      </div>

      {editing && <ScheduleCallDrawer open onOpenChange={(o) => !o && setEditing(null)} accountId={editing.AccountId} call={editing} />}
      <ScheduleCallFlow
        prefill={schedule}
        onClose={() => setSchedule(null)}
        onScheduled={(id, d) => {
          setDateParam(d === asOfISO ? null : d);
          setPicked(id);
        }}
      />
      <ScheduleCallHost
        onScheduled={(id, d) => {
          setDateParam(d === asOfISO ? null : d);
          setPicked(id);
        }}
      />
      {liveCall && liveBrief && (
        <LiveCall
          key={liveCall.Id}
          call={liveCall}
          brief={liveBrief}
          autoStart={autoStart}
          onClose={() => {
            setLive(null);
            setAutoStart(false);
          }}
        />
      )}
    </div>
  );
}
