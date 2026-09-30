"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FastForward, Loader2, Mic, PhoneOff, X } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { aiCallNotes, useAiStatus } from "@/lib/ai/client";
import {
  callContacts,
  callMeta,
  fmtClock,
  fmtTime,
  notesFromAi,
  notesFromTranscript,
  repName,
  simulatedTranscript,
  suggestedUpdates,
  transcriptText,
  type CallBrief,
  type SuggestedUpdate,
  type TranscriptLine,
} from "@/lib/call-desk";
import type { Call, CallNotes } from "@/types/salesforce";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { emitDemo } from "@/lib/demo/state";
import { Questions } from "./brief-view";
import { NotesReview } from "./notes-review";
import { CallTypeTag, Tag } from "./parts";

type Phase = "ready" | "live" | "processing" | "review";
type Mode = "simulated" | "mic";

/* Minimal Web Speech API typing (not in lib.dom) */
interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Simulated lines stream at this pace */
const LINE_MS = 1100;

/** Focused call view: brief (collapsed), questions, live transcript, my notes, timer; then AI Notes review */
export function LiveCall({ call, brief, onClose, autoStart = false }: { call: Call; brief: CallBrief; onClose: (saved: boolean) => void; autoStart?: boolean }) {
  const { data, asOfISO, demoMode, changeLog } = useStore();
  const { available } = useAiStatus();
  const [phase, setPhase] = useState<Phase>("ready");
  const [mode, setMode] = useState<Mode>("simulated");
  const [consent, setConsent] = useState(false);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [interim, setInterim] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [repNotes, setRepNotes] = useState("");
  const [asked, setAsked] = useState<string[]>(call.QuestionsAsked ?? []);
  const [result, setResult] = useState<{ notes: CallNotes; updates: SuggestedUpdate[]; transcript: TranscriptLine[] } | null>(null);
  const script = useMemo(() => simulatedTranscript({ ...call, Transcript: undefined }, data), [call, data]);
  const contacts = useMemo(() => callContacts(call, data), [call, data]);
  const account = data.accounts.find((a) => a.Id === call.AccountId);
  const startedAt = useRef(0);
  const recog = useRef<SpeechRecognitionLike | null>(null);
  const listEnd = useRef<HTMLLIElement | null>(null);
  const micAvailable = !!speechCtor() && !demoMode;
  const autoStarted = useRef(false);

  // Timer
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  // Simulated transcript, line by line
  useEffect(() => {
    if (phase !== "live" || mode !== "simulated") return;
    const t = setInterval(() => setLines((l) => (l.length < script.length ? [...l, script[l.length]] : l)), LINE_MS);
    return () => clearInterval(t);
  }, [phase, mode, script]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length, interim]);

  // Demo Mode walkthrough: the simulated call starts by itself and reports when the transcript is done
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    startedAt.current = Date.now();
    setPhase("live");
  }, [autoStart]);
  const streamed = phase === "live" && mode === "simulated" && script.length > 0 && lines.length >= script.length;
  useEffect(() => {
    if (streamed && autoStart) emitDemo({ type: "call-streamed", callId: call.Id });
  }, [streamed, autoStart, call.Id]);

  // Stop the microphone when leaving
  useEffect(() => () => recog.current?.stop(), []);

  const startMic = useCallback(() => {
    const Ctor = speechCtor();
    if (!Ctor) return false;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (res.isFinal) setLines((l) => [...l, { speaker: "Call audio", text: text.charAt(0).toUpperCase() + text.slice(1), atSec: Math.round((Date.now() - startedAt.current) / 1000) }]);
        else live += `${text} `;
      }
      setInterim(live.trim());
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Microphone blocked. Switched to the simulated transcript.");
        setMode("simulated");
      }
    };
    r.onend = () => {
      // Chrome ends continuous recognition after silence; keep going while live
      if (recog.current === r) {
        try {
          r.start();
        } catch {
          // already started
        }
      }
    };
    recog.current = r;
    try {
      r.start();
      return true;
    } catch {
      return false;
    }
  }, []);

  const start = () => {
    startedAt.current = Date.now();
    setElapsed(0);
    setLines([]);
    if (mode === "mic" && !startMic()) {
      toast.error("Couldn't start the microphone. Using the simulated transcript.");
      setMode("simulated");
    }
    setPhase("live");
  };

  const end = async () => {
    const r = recog.current;
    recog.current = null;
    r?.stop();
    setInterim("");
    const transcript = lines.length ? lines : mode === "simulated" ? script.slice(0, 1) : [];
    setPhase("processing");
    const withCall: Call = { ...call, Transcript: transcript };
    let out: { notes: CallNotes; updates: SuggestedUpdate[] } | null = null;
    if (available && transcript.length) {
      const res = await aiCallNotes(
        { meta: callMeta(withCall, data), transcript: transcriptText(transcript), repNotes },
        { asOf: asOfISO, page: "/call-desk", pageTitle: "Call Desk", demo: demoMode, mutations: changeLog().slice(-200) },
      );
      if (res.ok) out = notesFromAi(res.notes, withCall, data);
    }
    if (!out) {
      const notes = notesFromTranscript(withCall, transcript, repNotes, data);
      out = { notes, updates: suggestedUpdates(withCall, notes, data) };
    }
    setResult({ ...out, transcript });
    setPhase("review");
  };

  const rep = repName(call.OwnerId);
  const recording = phase === "live";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={`Call with ${account?.Name ?? ""}`} data-testid="live-call">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{account?.Name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {fmtTime(call.Start.slice(11, 16))} · {contacts.map((c) => c.Name).join(", ") || "No contacts"}
          </p>
        </div>
        <CallTypeTag type={call.CallType} />
        {recording && (
          <span className="flex items-center gap-1.5 rounded-sm border border-red-200 bg-red-50 px-1.5 py-0.5 text-xs font-medium text-status-critical" role="status">
            <span className="size-2 animate-pulse rounded-full bg-status-critical" aria-hidden />
            {mode === "mic" ? "Recording" : "Transcribing (simulated)"}
          </span>
        )}
        <span className="ml-auto font-mono text-sm tabular" aria-label="Call timer">
          {fmtClock(phase === "ready" ? 0 : elapsed)}
        </span>
        {phase === "live" && (
          <>
            {mode === "simulated" && lines.length < script.length && (
              <Button size="sm" variant="outline" onClick={() => setLines(script)}>
                <FastForward data-icon="inline-start" />
                Skip ahead
              </Button>
            )}
            <Button size="sm" variant="destructive" onClick={end}>
              <PhoneOff data-icon="inline-start" />
              End call
            </Button>
          </>
        )}
        {(phase === "ready" || phase === "review") && (
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={() => onClose(false)}>
            <X />
          </Button>
        )}
      </header>

      {phase === "ready" && (
        <div className="flex flex-1 items-start justify-center overflow-y-auto p-4">
          <div className="w-full max-w-md space-y-4 rounded-md border bg-card p-5">
            <h2 className="text-base font-semibold">Start call</h2>
            <fieldset className="space-y-2">
              <legend className="sr-only">Transcription</legend>
              <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-checked:border-primary/50 has-checked:bg-accent-soft">
                <input type="radio" name="mode" className="mt-0.5 accent-[#1f5f4a]" checked={mode === "simulated"} onChange={() => setMode("simulated")} />
                <span className="font-medium">Simulated transcript</span>
              </label>
              <label className={cn("flex items-start gap-2 rounded-md border p-2.5 text-sm has-checked:border-primary/50 has-checked:bg-accent-soft", micAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-60")}>
                <input type="radio" name="mode" className="mt-0.5 accent-[#1f5f4a]" disabled={!micAvailable} checked={mode === "mic"} onChange={() => setMode("mic")} />
                <span>
                  <span className="flex items-center gap-1 font-medium">
                    <Mic className="size-3.5" aria-hidden />
                    Microphone
                  </span>
                  <span className="block text-xs text-muted-foreground">{micAvailable ? "Speech-to-text in this browser" : demoMode ? "Not available in Demo Mode" : "Not supported in this browser"}</span>
                </span>
              </label>
            </fieldset>
            {mode === "mic" && (
              <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                <input type="checkbox" className="mt-0.5 size-4 accent-[#1f5f4a]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                I&apos;ve told everyone on the call that it&apos;s being recorded and transcribed.
              </label>
            )}
            <Button className="w-full" disabled={mode === "mic" && !consent} onClick={start}>
              Start
            </Button>
          </div>
        </div>
      )}

      {phase === "live" && (
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)_minmax(260px,320px)] lg:overflow-hidden">
          <aside className="min-h-0 space-y-3 lg:overflow-y-auto">
            <Questions brief={brief} asked={asked} onToggle={(t) => setAsked((a) => (a.includes(t) ? a.filter((x) => x !== t) : [...a, t]))} />
            <details className="rounded-md border bg-card text-sm">
              <summary className="cursor-pointer px-3.5 py-2 text-[13px] font-semibold">Brief</summary>
              <div className="space-y-2 border-t px-3.5 py-2.5">
                <p>{brief.snapshot.season.label}</p>
                {brief.lastTime && !brief.lastTime.pending && brief.lastTime.summary.map((s, i) => <p key={i} className="text-muted-foreground">{s}</p>)}
                {brief.talking.objections.map((o) => (
                  <p key={o.objection}>
                    &ldquo;{o.objection}&rdquo; <span className="text-muted-foreground">{o.response}</span>
                  </p>
                ))}
                {brief.risks.map((r) => (
                  <p key={r.text} className="text-amber-800">
                    {r.text}
                  </p>
                ))}
              </div>
            </details>
          </aside>
          <section className="flex min-h-[320px] flex-col rounded-md border bg-card lg:min-h-0" aria-label="Live transcript">
            <div className="flex items-center justify-between border-b px-3.5 py-2">
              <h3 className="text-[13px] font-semibold">Live transcript</h3>
              <Tag tone="muted">{mode === "mic" ? "Microphone" : "Simulated"}</Tag>
            </div>
            <ol className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3.5 py-3 text-sm" aria-live="polite" data-testid="transcript">
              {lines.map((l, i) => (
                <li key={i} className="grid grid-cols-[44px_minmax(0,1fr)] gap-2">
                  <span className="text-xs text-muted-foreground tabular">{fmtClock(l.atSec)}</span>
                  <span>
                    <span className={cn("font-medium", l.speaker === rep && "text-primary")}>{l.speaker}</span>
                    <span className="block">{l.text}</span>
                  </span>
                </li>
              ))}
              {interim && <li className="pl-[52px] text-muted-foreground italic">{interim}</li>}
              {!lines.length && !interim && <li className="text-muted-foreground">Listening…</li>}
              <li ref={listEnd} aria-hidden />
            </ol>
          </section>
          <section className="flex min-h-[220px] flex-col rounded-md border bg-card lg:min-h-0" aria-label="My notes">
            <div className="border-b px-3.5 py-2">
              <h3 className="text-[13px] font-semibold">My notes</h3>
            </div>
            <textarea
              className="min-h-0 flex-1 resize-none bg-transparent px-3.5 py-2.5 text-sm outline-none"
              value={repNotes}
              onChange={(e) => setRepNotes(e.target.value)}
              placeholder="Rough notes. Lines starting with Send, Call, Email or Follow up become action items."
              aria-label="My notes"
            />
          </section>
        </div>
      )}

      {phase === "processing" && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Writing AI Notes…
        </div>
      )}

      {phase === "review" && result && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl p-3 sm:p-4">
            <NotesReview
              call={call}
              transcript={result.transcript}
              repNotes={repNotes}
              asked={asked}
              initial={result.notes}
              updates={result.updates}
              onSaved={() => onClose(true)}
              onDiscard={() => onClose(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
