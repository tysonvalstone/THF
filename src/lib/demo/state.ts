"use client";

/**
 * Demo Mode browser state (localStorage `harvest-signal:demo:v1`): the demo
 * run, walkthrough position, the ids each step created (so re-running a step
 * never duplicates records) and the demo event log for the activity feed.
 */
import { useSyncExternalStore } from "react";

export const DEMO_STATE_KEY = "harvest-signal:demo:v1";

export interface DemoLink {
  label: string;
  href: string;
}

export interface DemoEvent {
  id: string;
  /** Wall-clock time */
  at: string;
  /** App (time-travel) date */
  asOf: string;
  kind: "step" | "simulation" | "control";
  text: string;
  links: DemoLink[];
}

export interface DemoRecords {
  newBuildId?: string;
  leadId?: string;
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  campaignId?: string;
  enrollmentIds?: string[];
  callId?: string;
  callSaved?: boolean;
  callStage?: string;
  quoteId?: string;
  quoteNumber?: string;
  contractId?: string;
  clauseRowId?: string;
  clauseApproved?: boolean;
  invoiceId?: string;
  signer?: string;
  harvestContractId?: string;
  renewalId?: string;
  renewalDate?: string;
  expansionId?: string;
  expansionAccount?: string;
  boardReport?: string;
  /** ARR before the contract was signed (Finance step compares) */
  arrBefore?: number;
  /** Date the 30-day walkthrough fast-forward landed on */
  fastForwardTo?: string;
}

export interface DemoState {
  runId: string;
  startedAt: string;
  walkthrough: { active: boolean; step: number; view: number; finished: boolean };
  records: DemoRecords;
  events: DemoEvent[];
}

const listeners = new Set<() => void>();
let cache: DemoState | null | undefined;

function fresh(): DemoState {
  return {
    runId: Math.random().toString(36).slice(2, 10),
    startedAt: new Date().toISOString(),
    walkthrough: { active: false, step: 0, view: 0, finished: false },
    records: {},
    events: [],
  };
}

function read(): DemoState | null {
  if (cache !== undefined) return cache;
  try {
    const raw = window.localStorage.getItem(DEMO_STATE_KEY);
    cache = raw ? (JSON.parse(raw) as DemoState) : null;
  } catch {
    cache = null;
  }
  return cache;
}

function write(s: DemoState | null) {
  cache = s;
  try {
    if (s) window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(DEMO_STATE_KEY);
  } catch {
    // storage blocked: state lives for this page only
  }
  listeners.forEach((fn) => fn());
}

export const demoState = {
  get: (): DemoState | null => (typeof window === "undefined" ? null : read()),
  /** The current run, created on first use */
  ensure(): DemoState {
    const s = read();
    if (s) return s;
    const next = fresh();
    write(next);
    return next;
  },
  update(fn: (s: DemoState) => DemoState): DemoState {
    const next = fn(demoState.ensure());
    write(next);
    return next;
  },
  patchRecords(patch: Partial<DemoRecords>): DemoState {
    return demoState.update((s) => ({ ...s, records: { ...s.records, ...patch } }));
  },
  log(e: Omit<DemoEvent, "id" | "at">): void {
    demoState.update((s) => ({ ...s, events: [{ ...e, id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString() }, ...s.events].slice(0, 500) }));
  },
  clear(): void {
    write(null);
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== DEMO_STATE_KEY) return;
      cache = undefined;
      fn();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(fn);
      window.removeEventListener("storage", onStorage);
    };
  },
};

/** The demo state, re-rendering on change (null before the first demo action) */
export function useDemoState(): DemoState | null {
  return useSyncExternalStore(demoState.subscribe, demoState.get, () => null);
}

/* ------------------------------------------------------------ events */

/** Demo Mode UI events: the live call reports when its transcript finished; the walkthrough closes it */
export type DemoSignal = { type: "call-streamed"; callId: string } | { type: "call-close"; callId: string };
const SIGNAL = "harvest-signal:demo-signal";

export function emitDemo(signal: DemoSignal): void {
  window.dispatchEvent(new CustomEvent<DemoSignal>(SIGNAL, { detail: signal }));
}

export function onDemo(fn: (s: DemoSignal) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<DemoSignal>).detail);
  window.addEventListener(SIGNAL, h);
  return () => window.removeEventListener(SIGNAL, h);
}
