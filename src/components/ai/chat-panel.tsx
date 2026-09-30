"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, MessageSquare, RotateCcw, Square, X } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { streamChat, useAiStatus } from "@/lib/ai/client";
import { setHandoff } from "@/lib/ai/handoff";
import { usePageCommodity } from "@/lib/ai/page-context";
import type { ChatMessage, SourceKind } from "@/lib/ai/types";
import { Button } from "@/components/ui/button";

const MESSAGES_KEY = "harvest-signal:chat:v1";
const OPEN_KEY = "harvest-signal:chat:open";

const SUGGESTIONS = [
  "Top 10 open deals by expected value",
  "Which Iowa co-ops come out of blackout next?",
  "Summarize the Eastern Corn Belt",
  "Which segment should we prioritize this month?",
];

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: string;
  streaming?: boolean;
  error?: string;
  sources?: SourceKind[];
  offline?: boolean;
  accountIds?: string[];
  exportable?: boolean;
}

/* ---------------------------------------------------------- open state */

let openState = false;
const openListeners = new Set<() => void>();
function setOpen(v: boolean) {
  openState = v;
  try {
    window.sessionStorage.setItem(OPEN_KEY, v ? "1" : "0");
  } catch {
    // storage blocked
  }
  openListeners.forEach((fn) => fn());
}

/** Whether the chat panel is open (the shell makes room for it on wide screens) */
export function useChatOpen(): boolean {
  return useSyncExternalStore(
    (fn) => {
      openListeners.add(fn);
      return () => {
        openListeners.delete(fn);
      };
    },
    () => openState,
    () => false,
  );
}

function loadTurns(): Turn[] {
  try {
    const raw = window.sessionStorage.getItem(MESSAGES_KEY);
    return raw ? (JSON.parse(raw) as Turn[]).map((t) => ({ ...t, streaming: false, status: undefined })) : [];
  } catch {
    return [];
  }
}
function saveTurns(turns: Turn[]) {
  try {
    window.sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(turns));
  } catch {
    // storage blocked
  }
}

const uid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------ markdown */

const MD: Components = {
  a: ({ href = "", children }) =>
    href.startsWith("/") ? (
      <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
        {children}
      </a>
    ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>,
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-panel text-left text-muted-foreground">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1.5 font-medium whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border-t px-2 py-1.5 align-top">{children}</td>,
};

/* ---------------------------------------------------------------- panel */

export function ChatPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const { asOfISO, demoMode, changeLog } = useStore();
  const commodity = usePageCommodity();
  const { available } = useAiStatus();
  const open = useChatOpen();
  // The panel is closed during hydration, so reading session storage here is safe
  const [turns, setTurns] = useState<Turn[]>(() => (typeof window === "undefined" ? [] : loadTurns()));
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = turns.some((t) => t.streaming);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(OPEN_KEY) === "1") setOpen(true);
    } catch {
      // storage blocked
    }
  }, []);

  useEffect(() => {
    if (!busy) saveTurns(turns);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const update = useCallback((id: string, fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.id === id ? fn(t) : t))), []);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const user: Turn = { id: uid(), role: "user", content: q };
      const reply: Turn = { id: uid(), role: "assistant", content: "", streaming: true };
      const history: ChatMessage[] = [...turns, user]
        .filter((t) => t.content && !t.error)
        .slice(-20)
        .map((t) => ({ role: t.role, content: t.content }));
      setTurns((ts) => [...ts, user, reply]);
      setInput("");
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await streamChat(
        {
          messages: history,
          context: { asOf: asOfISO, commodity, page: pathname, pageTitle: document.title.split(" · ")[0], demo: demoMode, mutations: changeLog() },
        },
        (e) => {
          if (e.type === "text") update(reply.id, (t) => ({ ...t, content: t.content + e.text, status: undefined }));
          else if (e.type === "status") update(reply.id, (t) => ({ ...t, status: e.text }));
          else if (e.type === "done")
            update(reply.id, (t) => ({
              ...t,
              streaming: false,
              status: undefined,
              sources: e.sources,
              offline: e.offline,
              accountIds: e.accountIds,
              exportable: e.exportable,
            }));
          else if (e.type === "error") update(reply.id, (t) => ({ ...t, streaming: false, status: undefined, error: e.message }));
        },
        ctrl.signal,
      );
      update(reply.id, (t) => (t.streaming ? { ...t, streaming: false, status: undefined, error: t.content ? undefined : "Stopped" } : t));
      abortRef.current = null;
    },
    [busy, turns, asOfISO, commodity, pathname, update, demoMode, changeLog],
  );

  const questionFor = (id: string) => {
    const i = turns.findIndex((t) => t.id === id);
    return turns
      .slice(0, i)
      .reverse()
      .find((t) => t.role === "user")?.content;
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          className="fixed right-5 bottom-5 z-50 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg outline-none hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <MessageSquare className="size-5" aria-hidden />
        </button>
      )}
      {open && (
        <aside
          className="fixed top-0 right-0 bottom-0 z-50 flex w-full flex-col border-l bg-card shadow-xl sm:w-[400px] lg:shadow-none"
          aria-label="Assistant"
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">Assistant</p>
              {available === false && <p className="text-xs text-muted-foreground">AI offline — limited answers</p>}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New conversation"
              disabled={busy || !turns.length}
              onClick={() => {
                setTurns([]);
                saveTurns([]);
              }}
            >
              <RotateCcw aria-hidden />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Close assistant" onClick={() => setOpen(false)}>
              <X aria-hidden />
            </Button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {!turns.length ? (
              <div className="grid gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-md border bg-background px-3 py-2 text-left text-sm text-foreground hover:border-primary/40 hover:bg-accent-soft"
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid gap-4">
                {turns.map((t) =>
                  t.role === "user" ? (
                    <div key={t.id} className="ml-8 justify-self-end rounded-md bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap text-foreground">
                      {t.content}
                    </div>
                  ) : (
                    <div key={t.id} className="min-w-0 text-sm leading-relaxed text-foreground">
                      {t.content && <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{t.content}</ReactMarkdown>}
                      {t.streaming && <p className="text-xs text-muted-foreground">{t.status ?? (t.content ? "" : "Thinking…")}</p>}
                      {t.error && <p className="text-xs text-status-critical">{t.error === "Stopped" ? "Stopped." : `Something went wrong: ${t.error}`}</p>}
                      {!t.streaming && !t.error && (
                        <>
                          {(t.sources?.length || (t.offline && available !== false)) && (
                            <p className="mt-2 text-xs text-muted-foreground">
                              {t.sources?.length ? `Sources: ${t.sources.join(" · ")}` : ""}
                              {t.offline && available !== false && `${t.sources?.length ? " · " : ""}AI offline — limited answers`}
                            </p>
                          )}
                          {(t.exportable || !!t.accountIds?.length) && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {t.exportable && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setHandoff("export", { prompt: questionFor(t.id) ?? t.content.slice(0, 200), answer: t.content, accountIds: t.accountIds });
                                    router.push("/outreach/exports");
                                  }}
                                >
                                  Export this
                                </Button>
                              )}
                              {!!t.accountIds?.length && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setHandoff("enroll", { accountIds: t.accountIds!, from: "AI chat" });
                                    router.push("/outreach/sequences?enroll=1");
                                  }}
                                >
                                  Start sequence
                                </Button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          <form
            className="shrink-0 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="flex items-end gap-2 rounded-md border bg-background p-1.5 focus-within:border-primary/50">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                placeholder="Ask about pipeline, accounts or seasons"
                className="max-h-32 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none placeholder:text-muted-foreground"
                aria-label="Message"
              />
              {busy ? (
                <Button type="button" size="icon-sm" variant="outline" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
                  <Square aria-hidden />
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" aria-label="Send" disabled={!input.trim()}>
                  <ArrowUp aria-hidden />
                </Button>
              )}
            </div>
          </form>
        </aside>
      )}
    </>
  );
}
