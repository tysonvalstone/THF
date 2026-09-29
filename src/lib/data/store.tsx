"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createLocalRepository } from "./local-repository";
import type { DataSnapshot, Mutation, SalesRepository } from "./types";
import type { AppData, DataMode } from "./server";
import { parseDate, toISODate } from "@/lib/dates";
import { rankProspects, type ScoredTarget } from "@/lib/scoring";
import { allRegionStatuses, type RegionStatus } from "@/lib/season";

const AS_OF_KEY = "harvest-signal:as-of:v1";

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
};

interface StoreValue {
  /** false until the server data and browser state have loaded */
  ready: boolean;
  error: string | null;
  mode: DataMode;
  /** Live Salesforce is read-only: outreach actions are disabled */
  readOnly: boolean;
  loadedAt: string | null;
  lightningBaseUrl?: string;
  warnings: string[];
  refreshing: boolean;
  refresh: () => Promise<void>;
  data: DataSnapshot;
  /** The "current" date the app reasons about (time travel changes it) */
  asOf: Date;
  asOfISO: string;
  todayISO: string;
  isTimeTraveling: boolean;
  setAsOf: (iso: string) => void;
  commit: (mutations: Mutation[]) => void;
  resetData: () => void;
  pendingChanges: number;
  ranked: ScoredTarget[];
  regions: RegionStatus[];
}

const StoreContext = createContext<StoreValue | null>(null);

async function fetchData(): Promise<AppData> {
  const res = await fetch("/api/data", { cache: "no-store" });
  if (!res.ok) throw new Error(`Data request failed (${res.status})`);
  return (await res.json()) as AppData;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const repo = useRef<SalesRepository | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<Omit<AppData, "snapshot"> | null>(null);
  const [data, setData] = useState<DataSnapshot>(EMPTY);
  const [pendingChanges, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [todayISO, setTodayISO] = useState("2026-09-29");
  const [asOfISO, setAsOfISO] = useState("2026-09-29");

  const apply = useCallback((d: AppData) => {
    const r = createLocalRepository(d.snapshot);
    repo.current = r;
    const { snapshot, ...rest } = d;
    void snapshot;
    setMeta(rest);
    setData(d.mode === "live" ? d.snapshot : r.load());
    setPending(d.mode === "live" ? 0 : r.pendingChanges());
  }, []);

  useEffect(() => {
    const today = toISODate(new Date());
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(AS_OF_KEY);
    } catch {
      saved = null;
    }
    // Browser-only state loads after mount so server and client renders match.
    /* eslint-disable react-hooks/set-state-in-effect */
    setTodayISO(today);
    setAsOfISO(saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : today);
    /* eslint-enable react-hooks/set-state-in-effect */
    let live = true;
    fetchData()
      .then((d) => {
        if (!live) return;
        apply(d);
        setReady(true);
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load data"));
    return () => {
      live = false;
    };
  }, [apply]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch("/api/data/refresh", { method: "POST" });
      apply(await fetchData());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [apply]);

  const setAsOf = useCallback((iso: string) => {
    setAsOfISO(iso);
    try {
      window.localStorage.setItem(AS_OF_KEY, iso);
    } catch {
      // ignore
    }
  }, []);

  const readOnly = meta?.mode === "live";

  const commit = useCallback(
    (mutations: Mutation[]) => {
      // Live Salesforce is read-only by design: nothing is ever written back.
      if (readOnly || !repo.current || !mutations.length) return;
      setData(repo.current.commit(mutations));
      setPending(repo.current.pendingChanges());
    },
    [readOnly],
  );

  const resetData = useCallback(() => {
    if (!repo.current) return;
    setData(repo.current.reset());
    setPending(0);
  }, []);

  const asOf = useMemo(() => parseDate(asOfISO), [asOfISO]);
  const ranked = useMemo(() => (ready ? rankProspects(data, asOf) : []), [ready, data, asOf]);
  const regions = useMemo(() => allRegionStatuses(asOf), [asOf]);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
      error,
      mode: meta?.mode ?? "mock",
      readOnly,
      loadedAt: meta?.loadedAt ?? null,
      lightningBaseUrl: meta?.lightningBaseUrl,
      warnings: meta?.warnings ?? [],
      refreshing,
      refresh,
      data,
      asOf,
      asOfISO,
      todayISO,
      isTimeTraveling: asOfISO !== todayISO,
      setAsOf,
      commit,
      resetData,
      pendingChanges,
      ranked,
      regions,
    }),
    [ready, error, meta, readOnly, refreshing, refresh, data, asOf, asOfISO, todayISO, setAsOf, commit, resetData, pendingChanges, ranked, regions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
