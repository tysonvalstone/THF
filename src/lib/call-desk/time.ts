/**
 * Call Desk clock. Calls store local wall-clock times ("2026-10-14T09:30").
 * The simulated "now" is the time-travel date at the real time of day, so the
 * next-call countdown works on any as-of date.
 */
import type { Call } from "@/types/salesforce";

export const callDate = (c: Pick<Call, "Start">) => c.Start.slice(0, 10);
export const callTime = (c: Pick<Call, "Start">) => c.Start.slice(11, 16) || "09:00";

/** Minutes after midnight for "HH:MM" */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** "9:30 AM" */
export function fmtTime(hhmm: string): string {
  const mins = minutesOf(hhmm);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Tue, Oct 14" */
export function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** Simulated now: the as-of date plus the wall-clock time, as "YYYY-MM-DDTHH:MM" */
export function simulatedNow(asOfISO: string, wall: Date = new Date()): string {
  return `${asOfISO}T${String(wall.getHours()).padStart(2, "0")}:${String(wall.getMinutes()).padStart(2, "0")}`;
}

/** Minutes from `now` to the call start (negative when it has started) */
export function minutesUntil(call: Pick<Call, "Start">, now: string): number {
  const d = (Date.parse(`${callDate(call)}T00:00:00Z`) - Date.parse(`${now.slice(0, 10)}T00:00:00Z`)) / 60000;
  return d + minutesOf(callTime(call)) - minutesOf(now.slice(11, 16));
}

/** "in 12 min", "in 2 h 5 min", "now", "started 4 min ago" */
export function fmtCountdown(mins: number): string {
  const m = Math.round(mins);
  if (m === 0) return "now";
  if (m < 0) return `started ${-m} min ago`;
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h >= 24) return `in ${Math.round(h / 24)} d`;
  return r ? `in ${h} h ${r} min` : `in ${h} h`;
}

export function isPast(call: Pick<Call, "Start" | "DurationMin">, now: string): boolean {
  return minutesUntil(call, now) + call.DurationMin <= 0;
}

/** The first scheduled call that hasn't ended yet */
export function nextCall<T extends Pick<Call, "Start" | "DurationMin" | "Status">>(calls: T[], now: string): T | undefined {
  return [...calls]
    .filter((c) => c.Status === "Scheduled" && minutesUntil(c, now) + c.DurationMin > 0)
    .sort((a, b) => a.Start.localeCompare(b.Start))[0];
}
