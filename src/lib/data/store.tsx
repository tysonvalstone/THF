"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createLocalRepository } from "./local-repository";
import type { DataSnapshot, Mutation, SalesRepository } from "./types";
import { SEED } from "@/data/seed";
import { parseDate, toISODate } from "@/lib/dates";
import { rankProspects, type ScoredTarget } from "@/lib/scoring";
import { allRegionStatuses, type RegionStatus } from "@/lib/season";

const AS_OF_KEY = "harvest-signal:as-of:v1";

interface StoreValue {
  /** false until browser state (localStorage) has loaded */
  ready: boolean;
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const repo = useRef<SalesRepository | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<DataSnapshot>(SEED);
  const [pendingChanges, setPending] = useState(0);
  const [todayISO, setTodayISO] = useState("2026-09-29");
  const [asOfISO, setAsOfISO] = useState("2026-09-29");

  useEffect(() => {
    const r = createLocalRepository();
    repo.current = r;
    const today = toISODate(new Date());
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(AS_OF_KEY);
    } catch {
      saved = null;
    }
    // Loading browser-only state after mount keeps server and client renders identical.
    /* eslint-disable react-hooks/set-state-in-effect */
    setTodayISO(today);
    setAsOfISO(saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : today);
    setData(r.load());
    setPending(r.pendingChanges());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const setAsOf = useCallback((iso: string) => {
    setAsOfISO(iso);
    try {
      window.localStorage.setItem(AS_OF_KEY, iso);
    } catch {
      // ignore
    }
  }, []);

  const commit = useCallback((mutations: Mutation[]) => {
    if (!repo.current || !mutations.length) return;
    setData(repo.current.commit(mutations));
    setPending(repo.current.pendingChanges());
  }, []);

  const resetData = useCallback(() => {
    if (!repo.current) return;
    setData(repo.current.reset());
    setPending(0);
  }, []);

  const asOf = useMemo(() => parseDate(asOfISO), [asOfISO]);
  const ranked = useMemo(() => rankProspects(data, asOf), [data, asOf]);
  const regions = useMemo(() => allRegionStatuses(asOf), [asOf]);

  const value = useMemo<StoreValue>(
    () => ({
      ready,
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
    [ready, data, asOf, asOfISO, todayISO, setAsOf, commit, resetData, pendingChanges, ranked, regions],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}
