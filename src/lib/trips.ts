/**
 * Trip planner: rank facilities to visit in a state or region on a travel date,
 * route them nearest-neighbour and split them into days.
 */
import type { DataSnapshot } from "@/lib/data/types";
import type { Prioritization } from "@/lib/prioritization";
import type { ScoredTarget } from "@/lib/scoring";
import type { TripRequest } from "@/lib/ai/types";
import { SEGMENTS, SEASONAL_SEGMENTS, type Account, type Segment } from "@/types/salesforce";
import { REGIONS, REGION_BY_ID, REGION_BY_STATE } from "@/data/reference/regions";
import { TOWNS } from "@/data/reference/towns";
import { STATE_NAMES } from "@/data/reference/geo";
import { blackoutStatus } from "@/lib/seasonality";
import { estimateDeal } from "@/lib/regionInsights";
import { isOpenAt } from "@/lib/dashboard";
import { addDays, parseDate, toISODate, fmtShortDate } from "@/lib/dates";
import { fmtMoney } from "@/lib/format";

export const MAX_STOPS_PER_DAY = 5;
export const MPH = 55;
export const ROAD_FACTOR = 1.3;
export const MEETING_MINUTES = 60;
/** Latest arrival for a visit (5 PM) */
export const DAY_END = 17 * 60;
/** Detour cost when picking stops: one score point per this many miles */
const MILES_PER_POINT = 4;

/* --------------------------------------------------------------- places */

export function destinationName(dest: string): string {
  const r = REGION_BY_ID[dest as keyof typeof REGION_BY_ID];
  if (r) return r.name;
  return STATE_NAMES[dest.toUpperCase()] ?? dest;
}

export function inDestination(dest: string, state: string): boolean {
  if (REGION_BY_ID[dest as keyof typeof REGION_BY_ID]) return REGION_BY_STATE[state] === dest;
  return state === dest.toUpperCase();
}

export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Straight-line miles × 1.3 ÷ 55 mph, in minutes */
export const driveMinutes = (miles: number) => Math.round(((miles * ROAD_FACTOR) / MPH) * 60);

/** "Peoria, IL" / "Peoria" → coordinates, from reference towns or account cities */
export function geocodeCity(text: string | undefined, data: DataSnapshot): { name: string; lat: number; lon: number } | null {
  if (!text?.trim()) return null;
  const [cityRaw, stRaw] = text.split(",").map((s) => s.trim());
  const city = cityRaw.toLowerCase();
  const st = stRaw?.toUpperCase();
  const town = TOWNS.find((t) => t.name.toLowerCase() === city && (!st || t.state === st));
  if (town) return { name: `${town.name}, ${town.state}`, lat: town.lat, lon: town.lon };
  const acc = data.accounts.find((a) => a.BillingCity.toLowerCase() === city && (!st || a.BillingState === st));
  return acc ? { name: `${acc.BillingCity}, ${acc.BillingState}`, lat: acc.BillingLatitude, lon: acc.BillingLongitude } : null;
}

/* ---------------------------------------------------------- local parse */

const SEGMENT_WORDS: [RegExp, Segment][] = [
  [/co-?ops?|cooperatives?/i, "Multi-Location Co-op"],
  [/shuttle|rail/i, "Rail/Shuttle Loader"],
  [/river|terminals?/i, "River Terminal"],
  [/ethanol/i, "Ethanol Plant"],
  [/feed/i, "Feed Mill"],
  [/processors?|crushers?|flour mills?/i, "Processor"],
  [/seed|specialty/i, "Seed Cleaner / Specialty Crop"],
  [/elevators?/i, "Country Elevator"],
];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20 };

function nextMonday(d: Date): Date {
  const add = ((8 - d.getUTCDay()) % 7) || 7;
  return addDays(d, add);
}

/** Keyword parser for plain-language trip requests (no AI key needed) */
export function parseTripLocally(text: string, asOf: Date, fallbackDest = "IL"): TripRequest {
  const t = ` ${text.toLowerCase()} `;

  // Destination: region names first, then state/province names, then 2-letter codes
  let destination = "";
  const region = REGIONS.find((r) => t.includes(r.name.toLowerCase()));
  if (region) destination = region.id;
  if (!destination) {
    const byLength = Object.entries(STATE_NAMES).sort((a, b) => b[1].length - a[1].length);
    const hit = byLength.find(([, name]) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(t));
    if (hit) destination = hit[0];
  }
  if (!destination) {
    const code = text.match(/\b([A-Z]{2})\b/);
    if (code && STATE_NAMES[code[1]]) destination = code[1];
  }

  // Date
  let start = addDays(asOf, 7);
  let m: RegExpMatchArray | null;
  if (/\btomorrow\b/.test(t)) start = addDays(asOf, 1);
  else if (/\bnext week\b/.test(t)) start = nextMonday(asOf);
  else if (/\bthis week\b/.test(t)) start = addDays(asOf, 1);
  else if (/\bnext month\b|\bin a month\b/.test(t)) start = addDays(asOf, 30);
  else if ((m = t.match(/\bin (\d+|a|an|one|two|three|four|five|six) (day|week|month)s?\b/))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : m[1] === "a" || m[1] === "an" ? 1 : WORD_NUM[m[1]] ?? 1;
    start = addDays(asOf, n * (m[2] === "day" ? 1 : m[2] === "week" ? 7 : 30));
  } else if ((m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})?\b/))) {
    const month = MONTHS.indexOf(m[1]);
    const day = m[2] ? Number(m[2]) : 1;
    let d = new Date(Date.UTC(asOf.getUTCFullYear(), month, day));
    if (d <= asOf) d = new Date(Date.UTC(asOf.getUTCFullYear() + 1, month, day));
    start = d;
  }
  // Travel on a weekday
  while (start.getUTCDay() === 0 || start.getUTCDay() === 6) start = addDays(start, 1);

  // Stops
  let stops = 10;
  if ((m = t.match(/\b(?:top|visit|see|plan)?\s*(\d{1,2})\s+(?:stops?|places|visits|elevators?|co-?ops?|accounts|facilities|prospects|customers|plants|mills)/)) || (m = t.match(/\btop (\d{1,2})\b/))) stops = Number(m[1]);
  else if ((m = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s+(?:stops?|elevators?|co-?ops?|accounts|facilities|visits|places)/))) stops = WORD_NUM[m[1]];

  // Segment
  const segs = [...new Set(SEGMENT_WORDS.filter(([re]) => re.test(text)).map(([, sg]) => sg))];
  const segment = segs.length === 1 ? segs[0] : segs.length > 1 && segs.every((sg) => !SEASONAL_SEGMENTS.includes(sg)) ? "year-round" : "any";

  // Start city: "from Peoria" / "starting in Des Moines, IA"
  const city = text.match(/\b(?:from|starting (?:in|at|from)|leaving)\s+([A-Z][A-Za-z.' ]+?(?:,\s*[A-Z]{2})?)(?=[,.;]|\s+(?:on|in|next|and|to)\b|$)/);

  return {
    destination: destination || fallbackDest,
    startDate: toISODate(start),
    stops: Math.min(30, Math.max(1, stops)),
    segment,
    startCity: city?.[1]?.trim(),
  };
}

/* ------------------------------------------------------------- planning */

export interface TripStop {
  account: Account;
  score: number;
  why: string;
  openPipeline: number;
  lastContact: string | null;
  blackout: { status: "hard" | "light" | "none"; text: string };
  day: number;
  date: string;
  /** Arrival time in minutes after midnight */
  arrive: number;
  legMiles: number;
  legMinutes: number;
}

export interface TripDay {
  day: number;
  date: string;
  stops: TripStop[];
  miles: number;
  driveMinutes: number;
}

export interface TripWarning {
  message: string;
  /** Suggest year-round segments in the same area */
  yearRoundCount?: number;
  /** Suggest a later date when the segment can be contacted */
  betterDate?: string;
}

export interface TripPlan {
  request: TripRequest;
  destinationName: string;
  start: { name: string; lat: number; lon: number } | null;
  stops: TripStop[];
  days: TripDay[];
  totalMiles: number;
  totalDriveMinutes: number;
  candidates: number;
  warning: TripWarning | null;
}

export interface TripContext {
  data: DataSnapshot;
  asOf: Date;
  prio: Prioritization;
  ranked: ScoredTarget[];
}

function lastContactByAccount(data: DataSnapshot, asOf: Date): Map<string, string> {
  const m = new Map<string, string>();
  const note = (id: string | undefined, d: string | undefined) => {
    if (!id || !d || parseDate(d) > asOf) return;
    if (!m.has(id) || m.get(id)! < d) m.set(id, d);
  };
  for (const t of data.tasks) note(t.AccountId ?? t.WhatId, t.ActivityDate);
  for (const e of data.events) note(e.AccountId ?? e.WhatId, e.StartDateTime?.slice(0, 10));
  return m;
}

/** Score, pick, route and schedule the stops. `exclude` holds account ids removed or swapped out. */
export function planTrip(req: TripRequest, ctx: TripContext, exclude: Set<string> = new Set()): TripPlan {
  const { data, asOf, prio, ranked } = ctx;
  const travel = parseDate(req.startDate);
  const scoreById = new Map(ranked.map((r) => [r.target.id, r.total]));
  const openBy = new Map<string, number>();
  for (const o of data.opportunities) if (isOpenAt(o, asOf)) openBy.set(o.AccountId, (openBy.get(o.AccountId) ?? 0) + o.Amount);
  const parentOf = (a: Account) => (a.ParentId ? data.accounts.find((p) => p.Id === a.ParentId) : undefined);
  const customers = data.accounts.filter((a) => a.Type === "Customer - Direct");
  const customerCounties = new Set(customers.map((a) => a.County_FIPS__c).filter(Boolean));
  const since = addDays(asOf, -365);
  const recentWins = data.opportunities
    .filter((o) => o.IsWon && parseDate(o.CloseDate) > since && parseDate(o.CloseDate) <= asOf)
    .map((o) => data.accounts.find((a) => a.Id === o.AccountId))
    .filter((a): a is Account => !!a);
  const lastContact = lastContactByAccount(data, asOf);

  const segmentOk = (a: Account) =>
    req.segment === "any" || (req.segment === "year-round" ? !SEASONAL_SEGMENTS.includes(a.Segment__c) : a.Segment__c === req.segment);
  const pool = data.accounts.filter((a) => a.Type !== "Customer - Direct" && inDestination(req.destination, a.BillingState));
  const matching = pool.filter(segmentOk);

  const scored = matching
    .filter((a) => !exclude.has(a.Id))
    .map((a) => {
      const parent = parentOf(a);
      const base = scoreById.get(a.Id) ?? scoreById.get(parent?.Id ?? "") ?? 45;
      const open = openBy.get(a.Id) ?? openBy.get(parent?.Id ?? "") ?? 0;
      const deal = estimateDeal(parent ?? a, openBy, prio);
      const win = recentWins.find((w) => milesBetween({ lat: w.BillingLatitude, lon: w.BillingLongitude }, { lat: a.BillingLatitude, lon: a.BillingLongitude }) <= 40);
      const whitespace = !!a.County_FIPS__c && !customerCounties.has(a.County_FIPS__c);
      const b = blackoutStatus(a, travel);
      let score = base * 0.6 + Math.min(20, Math.log10(Math.max(1, deal)) * 3.5);
      const reasons: [number, string][] = [[base * 0.6, `Prospect score ${base}`]];
      if (open) {
        score += 15;
        reasons.push([15.5, `Open opportunity, ${fmtMoney(open)}`]);
      }
      if (win) {
        score += 10;
        reasons.push([10, `Recent win nearby: ${win.Name}`]);
      }
      if (whitespace) {
        score += 6;
        reasons.push([6, `No customer yet in ${a.County__c ?? "the county"}`]);
      }
      if (b.status === "hard") score *= 0.3;
      else if (b.status === "light") score *= 0.8;
      const why = reasons.sort((x, y) => y[0] - x[0]).find(([, r]) => !r.startsWith("Prospect score") || reasons.length === 1)?.[1] ?? reasons[0][1];
      return {
        account: a,
        score: Math.round(score),
        why,
        openPipeline: open,
        lastContact: lastContact.get(a.Id) ?? (parent ? lastContact.get(parent.Id) : undefined) ?? null,
        blackout: {
          status: b.status,
          text: b.status === "hard" ? `No contact to ${fmtShortDate(b.blackout!.end)}` : b.status === "light" ? "Planting (light)" : "Open",
        },
        resume: b.resumeDate,
      };
    })
    .sort((x, y) => y.score - x.score || x.account.Name.localeCompare(y.account.Name));

  // Keep the trip compact: pick greedily from where we are, trading score against distance
  const start = geocodeCity(req.startCity, data);
  const pool2 = scored.slice(0, Math.max(60, req.stops * 6));
  const picked: typeof scored = [];
  let at = start ?? (pool2[0] ? { lat: pool2[0].account.BillingLatitude, lon: pool2[0].account.BillingLongitude } : null);
  while (picked.length < req.stops && pool2.length && at) {
    let best = 0;
    let bestV = -Infinity;
    pool2.forEach((p, i) => {
      const v = p.score - milesBetween(at!, { lat: p.account.BillingLatitude, lon: p.account.BillingLongitude }) / MILES_PER_POINT;
      if (v > bestV) {
        bestV = v;
        best = i;
      }
    });
    const [next] = pool2.splice(best, 1);
    picked.push(next);
    at = { lat: next.account.BillingLatitude, lon: next.account.BillingLongitude };
  }

  // Blackout warning: most of the picks can't be contacted on the travel date
  let warning: TripWarning | null = null;
  const blocked = picked.filter((p) => p.blackout.status === "hard");
  if (picked.length && blocked.length / picked.length >= 0.5) {
    const yearRound = pool.filter((a) => !SEASONAL_SEGMENTS.includes(a.Segment__c) && blackoutStatus(a, travel).status === "none").length;
    const resumes = blocked.map((p) => p.resume).filter((d): d is Date => !!d).sort((a, b) => +a - +b);
    const better = resumes.length ? resumes[Math.floor(resumes.length * 0.75)] ?? resumes[resumes.length - 1] : undefined;
    const segLabel = req.segment === "any" || req.segment === "year-round" ? "Most of these facilities" : `${req.segment}s`;
    warning = {
      message: `${segLabel} in ${destinationName(req.destination)} are in their harvest no-contact period on ${fmtShortDate(travel)} (${blocked.length} of ${picked.length} stops).`,
      yearRoundCount: yearRound || undefined,
      betterDate: better ? toISODate(better) : undefined,
    };
  }

  // Nearest-neighbour route from the start city (or the top pick)
  const remaining = [...picked];
  const ordered: typeof picked = [];
  let here = start ?? (remaining[0] ? { lat: remaining[0].account.BillingLatitude, lon: remaining[0].account.BillingLongitude } : null);
  while (remaining.length && here) {
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((p, i) => {
      const d = milesBetween(here!, { lat: p.account.BillingLatitude, lon: p.account.BillingLongitude });
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = remaining.splice(best, 1);
    ordered.push(next);
    here = { lat: next.account.BillingLatitude, lon: next.account.BillingLongitude };
  }

  // Days of up to five stops on consecutive weekdays, 8:30 start, last arrival by 5 PM
  const stops: TripStop[] = [];
  const days: TripDay[] = [];
  let date = travel;
  let prev = start ? { lat: start.lat, lon: start.lon } : null;
  let dayIdx = 0;
  ordered.forEach((p) => {
    const cur = days[dayIdx];
    if (cur) {
      const last = cur.stops[cur.stops.length - 1];
      const nextArrive = last.arrive + MEETING_MINUTES + driveMinutes(milesBetween(prev!, { lat: p.account.BillingLatitude, lon: p.account.BillingLongitude }));
      if (cur.stops.length >= MAX_STOPS_PER_DAY || nextArrive > DAY_END) dayIdx += 1;
    }
    if (!days[dayIdx]) {
      if (dayIdx > 0) {
        date = addDays(date, 1);
        while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date = addDays(date, 1);
      }
      days[dayIdx] = { day: dayIdx + 1, date: toISODate(date), stops: [], miles: 0, driveMinutes: 0 };
    }
    const d = days[dayIdx];
    const pos = { lat: p.account.BillingLatitude, lon: p.account.BillingLongitude };
    const legMiles = prev ? milesBetween(prev, pos) : 0;
    const legMinutes = driveMinutes(legMiles);
    const lastStop = d.stops[d.stops.length - 1];
    const arrive = (lastStop ? lastStop.arrive + MEETING_MINUTES : 8 * 60 + 30) + legMinutes;
    const stop: TripStop = {
      account: p.account,
      score: p.score,
      why: p.why,
      openPipeline: p.openPipeline,
      lastContact: p.lastContact,
      blackout: p.blackout,
      day: d.day,
      date: d.date,
      arrive,
      legMiles: Math.round(legMiles),
      legMinutes,
    };
    d.stops.push(stop);
    d.miles += legMiles;
    d.driveMinutes += legMinutes;
    stops.push(stop);
    prev = pos;
  });
  days.forEach((d) => (d.miles = Math.round(d.miles)));

  return {
    request: req,
    destinationName: destinationName(req.destination),
    start,
    stops,
    days,
    totalMiles: days.reduce((s, d) => s + d.miles, 0),
    totalDriveMinutes: days.reduce((s, d) => s + d.driveMinutes, 0),
    candidates: matching.length,
    warning,
  };
}

export const YEAR_ROUND_SEGMENTS = SEGMENTS.filter((s) => !SEASONAL_SEGMENTS.includes(s));

/* --------------------------------------------------------------- output */

export const fmtClock = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
export const fmtDrive = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

export function itineraryRows(plan: TripPlan) {
  return plan.stops.map((s, i) => ({
    stop: i + 1,
    day: s.day,
    date: s.date,
    arrive: fmtClock(s.arrive),
    account: s.account.Name,
    segment: s.account.Segment__c,
    address: `${s.account.BillingStreet}, ${s.account.BillingCity}, ${s.account.BillingState} ${s.account.BillingPostalCode}`,
    phone: s.account.Phone,
    why: s.why,
    open: s.openPipeline,
    lastContact: s.lastContact ?? "",
    blackout: s.blackout.text,
    drive: s.legMinutes ? `${s.legMiles} mi · ${fmtDrive(s.legMinutes)}` : "",
  }));
}

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const icsTime = (date: string, min: number) => `${date.replace(/-/g, "")}T${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}00`;

/** One event per stop, local (floating) times */
export function tripToIcs(plan: TripPlan): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ThiboLiSoft//HarvestSignal//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  plan.stops.forEach((s, i) => {
    const a = s.account;
    lines.push(
      "BEGIN:VEVENT",
      `UID:trip-${plan.request.startDate}-${a.Id}-${i}@harvestsignal`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsTime(s.date, s.arrive)}`,
      `DTEND:${icsTime(s.date, s.arrive + MEETING_MINUTES)}`,
      `SUMMARY:${icsEscape(`Visit: ${a.Name}`)}`,
      `LOCATION:${icsEscape(`${a.BillingStreet}, ${a.BillingCity}, ${a.BillingState} ${a.BillingPostalCode}`)}`,
      `DESCRIPTION:${icsEscape(`Stop ${i + 1} · ${a.Segment__c}\n${s.why}\nBlackout: ${s.blackout.text}\nPhone: ${a.Phone}`)}`,
      `GEO:${a.BillingLatitude};${a.BillingLongitude}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
