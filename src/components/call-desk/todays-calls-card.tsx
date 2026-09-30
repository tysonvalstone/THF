"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useStore } from "@/lib/data/store";
import { USER_BY_ID } from "@/data/reference/users";
import { callContacts, fmtCountdown, fmtDay, fmtTime, minutesUntil } from "@/lib/call-desk";
import { cn } from "@/lib/utils";
import { CallTypeTag, Tag } from "./parts";
import { useCallScope, useSimClock } from "./use-call-desk";

/** Home card: the next 3 calls (the user's, or the team's for managers without calls) with a Prep link */
export function TodaysCallsCard({ className }: { className?: string }) {
  const { ready, data } = useStore();
  const now = useSimClock();
  const { canSeeTeam, ownsCalls, filter } = useCallScope();
  const team = canSeeTeam && !ownsCalls;
  const upcoming = useMemo(
    () =>
      data.calls
        .filter(filter(team ? "team" : "mine"))
        .filter((c) => c.Status === "Scheduled" && minutesUntil(c, now) + c.DurationMin > 0)
        .sort((a, b) => a.Start.localeCompare(b.Start))
        .slice(0, 3),
    [data.calls, filter, team, now],
  );
  const today = now.slice(0, 10);
  return (
    <section className={cn("min-w-0 rounded-md border bg-card", className)} aria-label="Today's calls">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{team ? "Team calls" : "Today's calls"}</h2>
        <Link href="/call-desk" className="text-xs text-primary hover:underline">
          Call Desk
        </Link>
      </div>
      <ol className="divide-y">
        {!ready && <li className="px-4 py-6 text-sm text-muted-foreground">Loading…</li>}
        {ready &&
          upcoming.map((c, i) => {
            const account = data.accounts.find((a) => a.Id === c.AccountId);
            const mins = minutesUntil(c, now);
            const day = c.Start.slice(0, 10);
            return (
              <li key={c.Id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-16 shrink-0 text-xs tabular">
                  <p className="font-semibold">{fmtTime(c.Start.slice(11, 16))}</p>
                  <p className="text-muted-foreground">{day === today ? (i === 0 ? fmtCountdown(mins) : "today") : fmtDay(day)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{account?.Name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {callContacts(c, data)
                      .map((x) => x.Name)
                      .join(", ")}
                    {team && ` · ${USER_BY_ID[c.OwnerId]?.Name ?? ""}`}
                  </p>
                </div>
                <div className="hidden shrink-0 sm:block">{i === 0 && day === today ? <Tag tone="solid">Next</Tag> : <CallTypeTag type={c.CallType} />}</div>
                <Link href={`/call-desk?date=${day}&call=${c.Id}`} className="shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium hover:border-primary/50 hover:text-primary">
                  Prep
                </Link>
              </li>
            );
          })}
        {ready && !upcoming.length && <li className="px-4 py-6 text-sm text-muted-foreground">No upcoming calls</li>}
      </ol>
    </section>
  );
}
