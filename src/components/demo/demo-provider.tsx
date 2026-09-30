"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { useCrud } from "@/lib/data/crud";
import { useAuth, useSender, useUserId } from "@/lib/auth";
import type { AppRole } from "@/lib/supabase/config";
import type { Mutation } from "@/lib/data/types";
import { addDays, parseDate, toISODate } from "@/lib/dates";
import { demoState, onDemo, useDemoState, type DemoLink, type DemoState } from "@/lib/demo/state";
import { simSummary, simulateWindow, type SimCounts } from "@/lib/demo/simulate";
import { DEMO_DATES } from "@/lib/demo/scenario";
import { generateBoardReport } from "@/lib/finance/board-report";
import { enrollmentsCollection } from "@/components/sequences/sequence-store";
import { DEMO_STEPS, type DemoTarget, type DemoView, type StepApi } from "./steps";

interface DemoContextValue {
  /** Demo Mode is on (guests always) */
  on: boolean;
  state: DemoState | null;
  busy: boolean;
  error: string | null;
  autoplay: boolean;
  setAutoplay: (on: boolean) => void;
  start: () => void;
  next: () => void;
  back: () => void;
  exit: () => void;
  fastForward: (days: number) => Promise<void>;
  reset: () => void;
  activityOpen: boolean;
  setActivityOpen: (open: boolean) => void;
  /** Caption for the current view */
  caption: string;
}

const DemoContext = createContext<DemoContextValue | null>(null);

export function useDemo(): DemoContextValue {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error("useDemo must be used inside <DemoProvider>");
  return ctx;
}

/** Auto-play: time on each view */
const VIEW_MS = 7000;
/** Auto-play: longest wait for the live call's transcript */
const CALL_MS = 45_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pathOf = (href: string) => href.split("?")[0];

/* ---------------------------------------------------------- highlight */

function findTarget(t: DemoTarget): HTMLElement | null {
  if ("selector" in t) return document.querySelector<HTMLElement>(t.selector);
  if ("heading" in t) {
    const h = [...document.querySelectorAll<HTMLElement>("main h1, main h2, main h3")].find((x) => x.textContent?.trim().startsWith(t.heading));
    return (h?.closest<HTMLElement>("section, [data-slot=card]") ?? h) || null;
  }
  return [...document.querySelectorAll<HTMLElement>("main tr")].find((x) => x.textContent?.includes(t.row)) ?? null;
}

let highlighted: HTMLElement | null = null;
async function highlight(t: DemoTarget | undefined) {
  highlighted?.removeAttribute("data-demo-highlight");
  highlighted = null;
  if (!t) return;
  let el: HTMLElement | null = null;
  for (let i = 0; i < 40 && !el; i++) {
    el = findTarget(t);
    if (!el) await sleep(100);
  }
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.setAttribute("data-demo-highlight", "");
  highlighted = el;
  const mine = el;
  setTimeout(() => {
    if (highlighted === mine) {
      mine.removeAttribute("data-demo-highlight");
      highlighted = null;
    }
  }, 5000);
}

/* ---------------------------------------------------------- signature */

/** A handwritten-looking signature, drawn on a canvas (simulated e-signature) */
function signatureImage(name: string): string {
  const c = document.createElement("canvas");
  c.width = 420;
  c.height = 110;
  const g = c.getContext("2d");
  if (!g) return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#1e293b";
  g.font = "italic 40px 'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive";
  g.textBaseline = "middle";
  g.fillText(name, 16, 58);
  g.strokeStyle = "#1e293b";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(16, 88);
  g.bezierCurveTo(140, 80, 260, 96, 400, 84);
  g.stroke();
  return c.toDataURL("image/png");
}

/* ----------------------------------------------------------- provider */

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const crud = useCrud();
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const userId = useUserId();
  const sender = useSender();
  const state = useDemoState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoplay, setAutoplayState] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  // Step code is async: it reads the latest store, CRUD and auth through this ref
  const latest = useRef({ store, crud, auth, router, pathname, userId, sender });
  const waiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    latest.current = { store, crud, auth, router, pathname, userId, sender };
    const w = waiters.current;
    waiters.current = [];
    w.forEach((f) => f());
  });
  /** Resolves after the next render (or 600 ms) */
  const settle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        let done = false;
        const f = () => {
          if (done) return;
          done = true;
          resolve();
        };
        waiters.current.push(f);
        setTimeout(f, 600);
      }),
    [],
  );
  const busyRef = useRef(false);

  const api = useMemo<StepApi>(() => {
    const L = () => latest.current;
    const waitFor: StepApi["waitFor"] = async (check, ms = 3000) => {
      const end = Date.now() + ms;
      for (;;) {
        const v = check();
        if (v) return v;
        if (Date.now() > end) return undefined;
        await sleep(100);
      }
    };
    const run = async (mutations: Mutation[], message?: string) => {
      if (!mutations.length) return;
      L().crud.run(mutations, message);
      await settle();
    };
    const setDate = async (iso: string) => {
      if (L().store.asOfISO === iso) return;
      L().store.setAsOf(iso);
      await settle();
      // Lifecycle automation commits on the new date; let it land
      await settle();
    };
    const log = (text: string, links: DemoLink[] = [], kind: "step" | "simulation" | "control" = "step") =>
      demoState.log({ kind, text, links, asOf: L().store.asOfISO });
    const fastForwardTo = async (iso: string): Promise<SimCounts | null> => {
      const s = L().store;
      const from = s.asOfISO;
      if (iso <= from) {
        await setDate(iso);
        return null;
      }
      const st = demoState.ensure();
      const sim = simulateWindow(s.allData, from, iso, {
        seed: st.runId,
        userId: L().userId,
        skipOpportunityIds: st.records.opportunityId ? [st.records.opportunityId] : [],
      });
      const msg = simSummary(sim.counts);
      if (sim.mutations.length) await run(sim.mutations, msg);
      else toast.success(msg);
      const camp = st.records.campaignId;
      log(msg, [...(camp ? [{ label: "Campaign", href: `/campaigns/${camp}` }] : []), ...sim.wonIds.slice(0, 3).map((id, i) => ({ label: `Win ${i + 1}`, href: `/opportunities/${id}` }))], "simulation");
      await setDate(iso);
      return sim.counts;
    };
    return {
      ctx: (role?: AppRole) => ({ data: L().store.allData, asOf: L().store.asOf, userId: L().userId, role: role ?? L().auth.role }),
      run,
      setDate,
      async setRole(role) {
        if (L().auth.role === role || !L().auth.canSwitchRole) return;
        L().auth.setRole(role);
        await settle();
      },
      async go(href) {
        L().router.push(href, { scroll: true });
        await waitFor(() => L().pathname === pathOf(href), 8000);
      },
      records: () => demoState.ensure().records,
      patch: (p) => void demoState.patchRecords(p),
      log: (text, links) => log(text, links),
      fastForwardTo,
      waitFor,
      rankedIds: () => L().store.ranked.map((s) => s.target.id),
      sender: () => L().sender,
      saveEnrollments: (list) => list.forEach((e) => enrollmentsCollection.save(e)),
      signature: signatureImage,
      async boardReport() {
        const s = L().store;
        const r = await generateBoardReport(s.allData, s.asOf, { download: true, preparedBy: L().auth.session?.name });
        toast.success(`Board Report downloaded · ${r.pages} pages`);
        return r.filename;
      },
      asOfISO: () => L().store.asOfISO,
    };
  }, [settle]);

  const viewAt = (step: number, view: number): DemoView | undefined => DEMO_STEPS[step]?.views[view];

  /** Enter a view: run its actions, go to its page, highlight */
  const show = useCallback(
    async (step: number, view: number) => {
      const v = viewAt(step, view);
      if (!v || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError(null);
      demoState.update((s) => ({ ...s, walkthrough: { active: true, step, view, finished: false } }));
      try {
        if (v.navFirst) await api.go(v.href(api.records()));
        if (v.run) await v.run(api);
        const href = v.href(api.records());
        if (`${latest.current.pathname}${window.location.search}` !== href) await api.go(href);
        void highlight(typeof v.highlight === "function" ? v.highlight(api.records()) : v.highlight);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Step failed";
        setError(msg);
        toast.error(msg);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [api],
  );

  const position = state?.walkthrough;
  const next = useCallback(() => {
    const w = demoState.get()?.walkthrough;
    if (!w?.active || busyRef.current) return;
    const step = DEMO_STEPS[w.step];
    if (w.view + 1 < step.views.length) void show(w.step, w.view + 1);
    else if (w.step + 1 < DEMO_STEPS.length) void show(w.step + 1, 0);
    else {
      demoState.update((s) => ({ ...s, walkthrough: { ...s.walkthrough, finished: true } }));
      setAutoplayState(false);
    }
  }, [show]);

  const back = useCallback(() => {
    const w = demoState.get()?.walkthrough;
    if (!w?.active || busyRef.current) return;
    if (w.view > 0) void show(w.step, w.view - 1);
    else if (w.step > 0) void show(w.step - 1, DEMO_STEPS[w.step - 1].views.length - 1);
  }, [show]);

  const start = useCallback(() => {
    const s = demoState.ensure();
    const w = s.walkthrough;
    if (w.step === 0 && w.view === 0 && !s.events.length) demoState.log({ kind: "control", text: "Demo started", links: [], asOf: latest.current.store.asOfISO });
    // Resume where the walkthrough was left, or start over after the end
    if (w.finished || (w.step === 0 && w.view === 0)) void show(0, 0);
    else void show(w.step, w.view);
  }, [show]);

  const exit = useCallback(() => {
    setAutoplayState(false);
    highlight(undefined);
    demoState.update((s) => ({ ...s, walkthrough: { ...s.walkthrough, active: false } }));
    // The contract step views the app as Legal; don't leave the viewer there
    const { auth: a } = latest.current;
    if (a.canSwitchRole && a.role === "legal") a.setRole("manager");
  }, []);

  const fastForward = useCallback(
    async (days: number) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      try {
        const to = toISODate(addDays(parseDate(latest.current.store.asOfISO), days));
        await api.fastForwardTo(to);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [api],
  );

  const reset = useCallback(() => {
    const { store: s, auth: a, router: r } = latest.current;
    setAutoplayState(false);
    highlight(undefined);
    const st = demoState.get();
    st?.records.enrollmentIds?.forEach((id) => enrollmentsCollection.remove(id));
    demoState.clear();
    s.resetData();
    s.setAsOf(DEMO_DATES.seed);
    if (a.canSwitchRole && (a.isGuest ? a.role !== "manager" : a.role === "legal")) a.setRole("manager");
    setError(null);
    toast.success("Demo reset to the seed data");
    r.push("/");
  }, []);

  // The live call reports its transcript is done: move on (the next view saves the call)
  useEffect(
    () =>
      onDemo((sig) => {
        if (sig.type !== "call-streamed") return;
        const w = demoState.get()?.walkthrough;
        if (!w?.active || !viewAt(w.step, w.view)?.waitsForCall) return;
        setTimeout(() => {
          const now = demoState.get()?.walkthrough;
          if (now && now.step === w.step && now.view === w.view) next();
        }, 1200);
      }),
    [next],
  );

  // Auto-play: a few seconds per view; the live call view waits for its transcript
  useEffect(() => {
    if (!autoplay || busy || !position?.active || position.finished) return;
    const v = viewAt(position.step, position.view);
    const t = setTimeout(next, v?.waitsForCall && !demoState.get()?.records.callSaved ? CALL_MS : VIEW_MS);
    return () => clearTimeout(t);
  }, [autoplay, busy, position?.active, position?.finished, position?.step, position?.view, next]);

  const setAutoplay = useCallback(
    (on: boolean) => {
      setAutoplayState(on);
      if (on && !demoState.get()?.walkthrough.active) start();
    },
    [start],
  );

  const caption = position?.active ? (viewAt(position.step, position.view)?.caption(state?.records ?? {}, api) ?? "") : "";

  const value = useMemo<DemoContextValue>(
    () => ({
      on: store.demoMode,
      state,
      busy,
      error,
      autoplay,
      setAutoplay,
      start,
      next,
      back,
      exit,
      fastForward,
      reset,
      activityOpen,
      setActivityOpen,
      caption,
    }),
    [store.demoMode, state, busy, error, autoplay, setAutoplay, start, next, back, exit, fastForward, reset, activityOpen, caption],
  );

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
