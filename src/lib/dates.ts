/** All dates are handled as UTC calendar dates ("YYYY-MM-DD") to avoid timezone drift. */

export const DAY_MS = 86_400_000;

export function parseDate(iso: string): Date {
  return new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function diffDays(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

/** "Sep 29, 2026" */
export function fmtDate(d: Date | string): string {
  const x = typeof d === "string" ? parseDate(d) : d;
  return x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "Sep 29" */
export function fmtShortDate(d: Date | string): string {
  const x = typeof d === "string" ? parseDate(d) : d;
  return x.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "September 2026" */
export function fmtMonthYear(d: Date | string): string {
  const x = typeof d === "string" ? parseDate(d) : d;
  return x.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "about 3 weeks", "5 days", "2 months" */
export function fmtSpan(days: number): string {
  const d = Math.abs(Math.round(days));
  if (d <= 1) return d === 0 ? "today" : "1 day";
  if (d < 12) return `${d} days`;
  if (d < 60) {
    const w = Math.round(d / 7);
    return `about ${w} week${w > 1 ? "s" : ""}`;
  }
  const m = Math.round(d / 30);
  return `about ${m} months`;
}

/** "3 days ago", "in 2 weeks" relative to asOf */
export function fmtRelative(date: Date | string, asOf: Date): string {
  const x = typeof date === "string" ? parseDate(date) : date;
  const days = diffDays(x, asOf);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${fmtSpan(days)}` : `${fmtSpan(days)} ago`;
}

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Day of year (0-based) for a UTC date */
export function dayOfYear(d: Date): number {
  return diffDays(d, new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
}
