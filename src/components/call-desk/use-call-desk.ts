"use client";

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/data/store";
import { useAuth, useUserId } from "@/lib/auth";
import { can } from "@/lib/roles";
import { simulatedNow, type CallContext } from "@/lib/call-desk";
import type { Call } from "@/types/salesforce";

/** Store data, the app date and the acting user, for the lib/call-desk helpers */
export function useCallContext(): CallContext {
  const { data, asOf } = useStore();
  const userId = useUserId();
  return useMemo(() => ({ data, asOf, userId }), [data, asOf, userId]);
}

/** Simulated now ("YYYY-MM-DDTHH:MM"): the time-travel date at the real time of day, ticking every 20 s */
export function useSimClock(): string {
  const { asOfISO } = useStore();
  const [wall, setWall] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clock starts after mount so server and client renders match
    setWall(new Date());
    const t = setInterval(() => setWall(new Date()), 20_000);
    return () => clearInterval(t);
  }, []);
  return simulatedNow(asOfISO, wall ?? new Date(`${asOfISO}T08:00:00`));
}

export type CallScope = "mine" | "team";

/** Who sees which calls: reps their own; managers (and other team roles) can switch to the whole team */
export function useCallScope(): { canSeeTeam: boolean; userId: string; ownsCalls: boolean; filter: (scope: CallScope) => (c: Call) => boolean } {
  const { role } = useAuth();
  const userId = useUserId();
  const { data } = useStore();
  const canSeeTeam = can(role, "see:team");
  const ownsCalls = useMemo(() => data.calls.some((c) => c.OwnerId === userId), [data.calls, userId]);
  return {
    canSeeTeam,
    userId,
    ownsCalls,
    filter: (scope) => (c) => (canSeeTeam && scope === "team") || c.OwnerId === userId,
  };
}
