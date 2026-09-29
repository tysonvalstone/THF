"use client";

/** Browser helpers for /api/ai. The API key stays on the server. */
import { useEffect, useState } from "react";
import type {
  ChatContext,
  ChatEvent,
  ChatRequest,
  DraftSequenceResponse,
  ExportSpecResponse,
  RewriteStepResponse,
  StepType,
  TripParseResponse,
} from "./types";

const ENDPOINT = "/api/ai";

/** Streams a chat answer, calling `onEvent` for each NDJSON event */
export async function streamChat(req: Omit<ChatRequest, "kind">, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "chat", ...req }),
      signal,
    });
  } catch {
    if (!signal?.aborted) onEvent({ type: "error", message: "Could not reach the assistant." });
    return;
  }
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `The assistant returned an error (${res.status}).` });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    const t = line.trim();
    if (!t) return;
    try {
      onEvent(JSON.parse(t) as ChatEvent);
    } catch {
      // ignore a malformed line
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        flush(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    buffer += decoder.decode();
    flush(buffer);
  } catch {
    if (!signal?.aborted) onEvent({ type: "error", message: "The connection to the assistant was interrupted." });
  }
}

async function postJson<T extends { ok: boolean }>(body: unknown): Promise<T | { ok: false; reason: string }> {
  try {
    const r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => null)) as T | null;
    if (!j || typeof j.ok !== "boolean") return { ok: false, reason: `http-${r.status}` };
    return j;
  } catch {
    return { ok: false, reason: "network" };
  }
}

export async function aiExportSpec(prompt: string, context: ChatContext): Promise<ExportSpecResponse> {
  return postJson<ExportSpecResponse>({ kind: "export-spec", prompt, context });
}

export async function aiDraftSequence(input: { goal: string; segment: string; season: string }, context: ChatContext): Promise<DraftSequenceResponse> {
  return postJson<DraftSequenceResponse>({ kind: "draft-sequence", ...input, context });
}

export async function aiRewriteStep(step: { type: StepType; subject?: string; body: string }, instruction: string, context: ChatContext): Promise<RewriteStepResponse> {
  return postJson<RewriteStepResponse>({ kind: "rewrite-step", step, instruction, context });
}

export async function aiParseTrip(prompt: string, context: ChatContext): Promise<TripParseResponse> {
  return postJson<TripParseResponse>({ kind: "trip-parse", prompt, context });
}

/** Whether the server has an AI key, and which model (fetched once per page load) */
let status: Promise<{ available: boolean; model: string | null }> | null = null;
export function useAiStatus(): { available: boolean | null; model: string | null } {
  const [value, setValue] = useState<{ available: boolean | null; model: string | null }>({ available: null, model: null });
  useEffect(() => {
    status ??= fetch(ENDPOINT)
      .then((r) => r.json())
      .then((j: { aiAvailable?: boolean; model?: string | null }) => ({ available: !!j.aiAvailable, model: j.model ?? null }))
      .catch(() => ({ available: false, model: null }));
    let live = true;
    status.then((v) => live && setValue(v));
    return () => {
      live = false;
    };
  }, []);
  return value;
}
