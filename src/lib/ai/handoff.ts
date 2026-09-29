"use client";

/**
 * One-shot hand-offs between screens (chat -> Template Builder, chat or map ->
 * Email Sequences). Stored in sessionStorage so the next page can pick them up.
 */
export interface ExportHandoff {
  /** The user's question, used as the plain-words template request */
  prompt: string;
  /** The assistant's answer (markdown) */
  answer?: string;
  accountIds?: string[];
}

export interface EnrollHandoff {
  accountIds: string[];
  /** Where the recipients came from, e.g. "AI chat", "Map: Iowa" */
  from: string;
}

type Handoffs = { export: ExportHandoff; enroll: EnrollHandoff };
const key = (k: keyof Handoffs) => `harvest-signal:handoff:${k}`;

export function setHandoff<K extends keyof Handoffs>(k: K, value: Handoffs[K]) {
  try {
    window.sessionStorage.setItem(key(k), JSON.stringify(value));
  } catch {
    // storage blocked
  }
}

/** Read and clear */
export function takeHandoff<K extends keyof Handoffs>(k: K): Handoffs[K] | null {
  try {
    const raw = window.sessionStorage.getItem(key(k));
    if (!raw) return null;
    window.sessionStorage.removeItem(key(k));
    return JSON.parse(raw) as Handoffs[K];
  } catch {
    return null;
  }
}
