"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createLocalRepository } from "./local-repository";
import type { DataSnapshot, Mutation, SalesRepository } from "./types";
import type { AppData, DataMode } from "./server";
import { parseDate, toISODate } from "@/lib/dates";
import { rankProspects, type ScoredTarget } from "@/lib/scoring";
import { allRegionStatuses, type RegionStatus } from "@/lib/season";
import { useHarvestWeight } from "@/lib/harvest/weight";
import { useAuth } from "@/lib/auth";
import { scopeToOwner } from "./scope";

const AS_OF_KEY = "harvest-signal:as-of:v1";
const DEMO_KEY = "harvest-signal:demo-mode:v1";
/** Separate change logs, so demo activity never mixes with real local changes */
const LOG_KEYS = { mock: "harvest-signal:mutations:v2", live: "harvest-signal:mutations:live:v1", demo: "harvest-signal:mutations:demo:v1" } as const;
/** How long a changed row stays highlighted */
const HIGHLIGHT_MS = 2000;

const EMPTY: DataSnapshot = {
  accounts: [],
  contacts: [],
  leads: [],
  opportunities: [],
  lineItems: [],
  campaigns: [],
  campaignMembers: [],
  tasks: [],
  events: [],
  productTypes: [],
  products: [],
  pricebooks: [],
  pricebookEntries: [],
  quotes: [],
  quoteLineItems: [],
  newBuilds: [],
  contracts: [],
  contractClauses: [],
  clauses: [],
  invoices: [],
  payments: [],
  onboardingProjects: [],
  onboardingTasks: [],
  healthSignals: [],
  supportTickets: [],
  quotas: [],
  commissionPlans: [],
  approvals: [],
  auditLog: [],
  calls: [],
};

interface StoreValue {
  /** false until the server data and browser state have loaded */
  ready: boolean;
  error: string | null;
  mode: DataMode;
  /**
   * Always false: every mode accepts local changes. Live Salesforce is never
   * written to; changes there stay in the app and are tagged as not synced.
   */
  readOnly: boolean;
  /** Live Salesforce data: local changes aren't written back */
  localOnly: boolean;
  /** Demo Mode: always mock data, with the guided walkthrough */
  demoMode: boolean;
  setDemoMode: (on: boolean) => void;
  loadedAt: string | null;
  lightningBaseUrl?: string;
  warnings: string[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  data: DataSnapshot;
  /** Unscoped data (every owner), for system automation */
  allData: DataSnapshot;
  /** The "current" date the app reasons about (time travel changes it) */
  asOf: Date;
  asOfISO: string;
  todayISO: string;
  isTimeTraveling: boolean;
  setAsOf: (iso: string) => void;
  /** Pass `silent` for system changes (no row highlight or KPI flash) */
  commit: (mutations: Mutation[], opts?: { silent?: boolean }) => void;
  /** Drops the last `count` changes (Undo) */
  undo: (count: number) => void;
  resetData: () => void;
  pendingChanges: number;
  /** Ids created or edited locally (for "Local change, not synced" tags in live mode) */
  localIds: Set<string>;
  /** Ids changed in the last 2 seconds (row highlight) */
  recentIds: Set<string>;
  /** The local change log, sent to the assistant so answers include local changes */
  changeLog: () => Mutation[];
  ranked: ScoredTarget[];
  regions: RegionStatus[];
}

const StoreContext = createContext<StoreValue | null>(null);

async function fetchData(forceMock: boolean): Promise<AppData> {
  const res = await fetch(forceMock ? "/api/data?mock=1" : "/api/data", { cache: "no-store" });
  if (!res.ok) throw new Error(`Data request failed (${res.status})`);
  return (await res.json()) as AppData;
}

const idsOf = (log: Mutation[]) => new Set(log.map((m) => (m.op === "create" ? m.record.Id : m.id)));

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const repo = useRef<SalesRepository | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Omit<AppData, "snapshot"> | null>(null);
  const [fullData, setData] = useState<DataSnapshot>(EMPTY);
  const [pendingChanges, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [todayISO, setTodayISO] = useState("2026-09-29");
  const [asOfISO, setAsOfISO] = useState("2026-09-29");
  const [demoPref, setDemo] = useState<boolean | null>(null);
  // Guests always get Demo Mode (mock data, their own change log)
  const { isGuest, role, session } = useAuth();
  // Sales reps see only their own book; everyone else sees the team
  const ownerId = session?.sfUserId ?? session?.id;
  const data = useMemo(() => (role === "rep" && ownerId ? scopeToOwner(fullData, ownerId) : fullData), [fullData, role, ownerId]);
  const demoMode = demoPref === null ? null : isGuest || demoPref;
  const [localIds, setLocalIds] = useState<Set<string>>(new Set());
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set());
  const recentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sync = useCallback((r: SalesRepository) => {
    setData(r.load());
    setPending(r.pendingChanges());
    setLocalIds(idsOf(r.log()));
  }, []);

  const apply = useCallback(
    (d: AppData, demo: boolean) => {
      const r = createLocalRepository(d.snapshot, LOG_KEYS[demo ? "demo" : d.mode]);
      repo.current = r;
      const { snapshot, ...rest } = d;
      void snapshot;
      setMeta(rest);
      sync(r);
    },
    [sync],
  );

  // Browser-only state loads after mount so server and client renders match.
  useEffect(() => {
    const today = toISODate(new Date());
    let saved: string | null = null;
    let demo = false;
    try {
      saved = window.localStorage.getItem(AS_OF_KEY);
      demo = window.localStorage.getItem(DEMO_KEY) === "1";
    } catch {
      saved = null;
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    setTodayISO(today);
    setAsOfISO(saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : today);
    setDemo(demo);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // (Re)load whenever Demo Mode is known or changes
  useEffect(() => {
    if (demoMode === null) return;
    let live = true;
    fetchData(demoMode)
      .then((d) => {
        if (!live) return;
        apply(d, demoMode);
        setReady(true);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load data"));
    return () => {
      live = false;
    };
  }, [apply, demoMode]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/data/refresh", { method: "POST" });
      apply(await fetchData(!!demoMode), !!demoMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [apply, demoMode]);

  const setAsOf = useCallback((iso: string) => {
    setAsOfISO(iso);
    try {
      window.localStorage.setItem(AS_OF_KEY, iso);
    } catch {
      // ignore
    }
  }, []);

  const setDemoMode = useCallback((on: boolean) => {
    setDemo(on);
    try {
      window.localStorage.setItem(DEMO_KEY, on ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const flash = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setRecentIds(new Set(ids));
    if (recentTimer.current) clearTimeout(recentTimer.current);
    recentTimer.current = setTimeout(() => setRecentIds(new Set()), HIGHLIGHT_MS);
  }, []);

  const commit = useCallback(
    (mutations: Mutation[], opts: { silent?: boolean } = {}) => {
      if (!repo.current || !mutations.length) return;
      repo.current.commit(mutations);
      sync(repo.current);
      if (!opts.silent)
        flash(mutations.filter((m) => m.op !== "delete").map((m) => (m.op === "create" ? m.record.Id : m.id)));
    },
    [sync, flash],
  );

  const undo = useCallback(
    (count: number) => {
      if (!repo.current || count <= 0) return;
      repo.current.undo(count);
      sync(repo.current);
    },
    [sync],
  );

  const resetData = useCallback(() => {
    if (!repo.current) return;
    repo.current.reset();
    sync(repo.current);
  }, [sync]);

  const changeLog = useCallback(() => repo.current?.log() ?? [], []);

  const asOf = useMemo(() => parseDate(asOfISO), [asOfISO]);
  const harvestWeight = useHarvestWeight();
  const ranked = useMemo(() => (ready ? rankProspects(data, asOf, { harvestWeight }) : []), [ready, data, asOf, harvestWeight]);
  const regions = useMemo(() => allRegionStatuses(asOf), [asOf]);
  const mode: DataMode = meta?.mode ?? "mock";

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      error,
      mode,
      readOnly: false,
      localOnly: mode === "live",
      demoMode: !!demoMode,
      setDemoMode,
      loadedAt: meta?.loadedAt ?? null,
      lightningBaseUrl: meta?.lightningBaseUrl,
      warnings: meta?.warnings ?? [],
      refreshing,
      refresh,
      data,
      allData: fullData,
      asOf,
      asOfISO,
      todayISO,
      isTimeTraveling: asOfISO !== todayISO,
      setAsOf,
      commit,
      undo,
      resetData,
      pendingChanges,
      localIds,
      recentIds,
      changeLog,
      ranked,
      regions,
    }),
    [ready, error, mode, demoMode, setDemoMode, meta, refreshing, refresh, data, fullData, asOf, asOfISO, todayISO, setAsOf, commit, undo, resetData, pendingChanges, localIds, recentIds, changeLog, ranked, regions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
