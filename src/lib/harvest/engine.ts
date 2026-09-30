/**
 * Harvest Day Simulator engine. Pure and deterministic: the same facility and
 * settings always replay the same day, and both scenarios (manual and
 * automated) share the exact same trucks, so a side-by-side comparison only
 * differs by scale time.
 *
 * Model (one peak October receiving day, 5:00 am to 11:00 pm):
 *
 * Volume
 *   Storage facilities (elevators, co-op locations, terminals, loaders, seed
 *   plants): peak-day receipts = storage x PEAK_DAY_FRACTION. Harvest receipts
 *   run about 1.25x storage over a ~45-day harvest (grain also ships out while
 *   it comes in), and a peak day is about 1.6x the average day:
 *   1.25 / 45 x 1.6 = 4.4% of storage per peak day.
 *   Co-op parents are modeled as their flagship location (1.5x the average
 *   location's storage).
 *   Ethanol plants: annual gallons / 2.8 gal/bu / 365 x 1.5 harvest surge
 *   (plants fill storage with cheap new-crop corn).
 *   Processors and feed mills: annual tons to bushels (grain share x 2,000 lb
 *   / test weight) / 365 x surge.
 *   Every volume is multiplied by this year's County_Yield_Factor__c and
 *   capped at what the pits could physically take in 18 hours at 85%.
 *
 * Trucks
 *   72% semis (900-1,100 bu), 20% straight trucks (450-650 bu), 8% wagons
 *   (250-400 bu); a seeded PRNG (from the account Id) picks the mix, sizes
 *   and arrival minutes, so a facility always replays the same day.
 *
 * Arrivals
 *   Hourly profile: light at dawn, building through midday, peaking 3-9 pm as
 *   combines run and trucks shuttle from the field, tapering to 11 pm.
 *
 * Service
 *   Trucks queue on the road for the scale + probe (servers = scales). Scale
 *   time per truck covers weigh-in, probe, grade and the tare crossing on the
 *   way out (manual default 5 min, ScaleTrac + GrainSight Mobile default 2 min;
 *   each truck varies 70-130% of that). Then the truck needs a dump pit: pit
 *   time = 1.5 min to pull on and open the hoppers + bushels / pit rate. Up to
 *   two trucks per pit can wait between the scale and the pits; when that
 *   space is full the truck stays on the scale and blocks it.
 *
 * Losses
 *   A truck still waiting for the scale when its wait passes the limit (default
 *   45 min) leaves for the nearest competitor; its bushels are lost at the
 *   handling margin. After 11 pm the line is worked off with no more losses.
 */
import type { FacilityType, Segment } from "@/types/salesforce";

export const DAY_START_HOUR = 5;
export const DAY_END_HOUR = 23;
export const DAY_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;

/** Arrival weights for each hour 5 am ... 10 pm (normalized at use) */
export const ARRIVAL_PROFILE = [0.6, 1.2, 2.2, 3.2, 4.2, 5, 5.6, 6, 6.6, 7.6, 9.2, 10.4, 10.8, 10.6, 9.6, 7.8, 5, 2.4];

export const HARVEST_TURNS = 1.5;
export const HARVEST_DAYS = 45;
export const PEAK_DAY_FACTOR = 1.8;
export const PEAK_DAY_FRACTION = (HARVEST_TURNS / HARVEST_DAYS) * PEAK_DAY_FACTOR;
export const ETHANOL_GAL_PER_BU = 2.8;
export const ETHANOL_SURGE = 1.5;
export const PROCESSOR_SURGE = 1.3;
export const PIT_SETUP_MINUTES = 1.5;
export const STAGING_PER_PIT = 2;
/** Share of pit capacity usable over 18 hours (clamp for demand) */
export const PIT_UTILIZATION = 0.85;

export type TruckKind = "semi" | "straight" | "wagon";

export interface FacilityInput {
  id: string;
  facilityType: FacilityType;
  segment: Segment;
  storageBu?: number;
  gallons?: number;
  tons?: number;
  locations?: number;
  /** A co-op parent account (modeled as its flagship location) */
  coopParent?: boolean;
  scales: number;
  pits: number;
  pitRateBph: number;
  yieldFactor: number;
}

export interface EngineSettings {
  /** Scale + probe minutes per truck (incl. the tare crossing) */
  serviceMinutes: number;
  waitLimitMinutes: number;
}

export interface Truck {
  i: number;
  kind: TruckKind;
  bu: number;
  /** Minutes after 5:00 am */
  arrive: number;
  /** 0.7 to 1.3: this truck's scale time relative to the average */
  svcFactor: number;
}

export interface TruckTrace extends Truck {
  /** Scale index, -1 if it never reached one */
  scale: number;
  scaleStart: number;
  /** Weighing and probing done */
  scaleEnd: number;
  /** Left the scale (later than scaleEnd when the pits were backed up) */
  scaleRelease: number;
  pit: number;
  pitStart: number;
  pitEnd: number;
  lost: boolean;
  /** When a lost truck gave up */
  leaveAt: number;
}

export interface MinuteSeries {
  /** Trucks waiting on the road for the scale */
  queue: Uint16Array;
  /** How long the truck at the front of the line has waited */
  wait: Float32Array;
  served: Uint16Array;
  lost: Uint16Array;
  buReceived: Float64Array;
  buLost: Float64Array;
}

export interface WorstHour {
  hour: number;
  label: string;
  trucksWaiting: number;
  waitMinutes: number;
}

export interface DaySim {
  settings: EngineSettings;
  scales: number;
  pits: number;
  trucks: TruckTrace[];
  series: MinuteSeries;
  dailyBushels: number;
  trucksServed: number;
  trucksLost: number;
  bushelsLost: number;
  bushelsReceived: number;
  worstHour: WorstHour;
  maxQueue: number;
  maxWait: number;
}

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------
const STORAGE_TYPES: FacilityType[] = ["Grain Elevator", "Cooperative", "Seed Processor", "Agronomy Retailer"];

/** Peak harvest-day volume, bushels (before yield factor and pit cap) */
export function baseDailyBushels(f: FacilityInput): number {
  if (f.facilityType === "Ethanol Plant" && f.gallons) return (f.gallons / ETHANOL_GAL_PER_BU / 365) * ETHANOL_SURGE;
  if (!STORAGE_TYPES.includes(f.facilityType) && f.tons) {
    // Tons of product: grain share and test weight by processor type
    const [share, lbPerBu] = f.facilityType === "Feed Mill" ? [0.6, 56] : f.facilityType === "Oilseed Crusher" ? [1, 60] : f.facilityType === "Flour Mill" ? [1.35, 60] : [1, 56];
    return ((f.tons * share * 2000) / lbPerBu / 365) * PROCESSOR_SURGE;
  }
  if (f.storageBu) {
    const storage = f.coopParent && (f.locations ?? 1) > 1 ? Math.min(f.storageBu, (f.storageBu / (f.locations ?? 1)) * 1.5) : f.storageBu;
    return storage * PEAK_DAY_FRACTION;
  }
  return 0;
}

/** Bushels the pits can take in the 18-hour day */
export function pitCapacityBushels(f: Pick<FacilityInput, "pits" | "pitRateBph">): number {
  return Math.max(1, f.pits) * f.pitRateBph * (DAY_MINUTES / 60) * PIT_UTILIZATION;
}

export function dailyBushels(f: FacilityInput): number {
  const demand = baseDailyBushels(f) * (f.yieldFactor || 1);
  return Math.round(Math.min(demand, pitCapacityBushels(f)));
}

// ---------------------------------------------------------------------------
// Trucks and arrivals
// ---------------------------------------------------------------------------
const PROFILE_SUM = ARRIVAL_PROFILE.reduce((s, w) => s + w, 0);
const PROFILE_CDF = ARRIVAL_PROFILE.reduce<number[]>((acc, w) => [...acc, (acc[acc.length - 1] ?? 0) + w / PROFILE_SUM], []);

/** Minute of the day (0..1080) for a uniform draw, following the hourly profile */
export function arrivalMinute(u: number): number {
  let h = 0;
  while (h < PROFILE_CDF.length - 1 && u > PROFILE_CDF[h]) h++;
  const lo = h ? PROFILE_CDF[h - 1] : 0;
  const within = (u - lo) / (PROFILE_CDF[h] - lo || 1);
  return h * 60 + within * 60;
}

/** The day's trucks, sorted by arrival. Same facility, same trucks. */
export function generateTrucks(f: FacilityInput): Truck[] {
  const total = dailyBushels(f);
  const rnd = mulberry32(hashSeed(f.id));
  const out: Truck[] = [];
  let bu = 0;
  while (bu < total && out.length < 5000) {
    // Farms run trucks in convoys: 1 (55%), 2 (30%) or 3 (15%) a few minutes apart
    const g = rnd();
    const size = g < 0.55 ? 1 : g < 0.85 ? 2 : 3;
    let at = arrivalMinute(rnd());
    for (let j = 0; j < size && bu < total; j++) {
      const k = rnd();
      const kind: TruckKind = k < 0.72 ? "semi" : k < 0.92 ? "straight" : "wagon";
      const w = rnd();
      const load = Math.round(kind === "semi" ? 900 + w * 200 : kind === "straight" ? 450 + w * 200 : 250 + w * 150);
      out.push({ i: 0, kind, bu: load, arrive: Math.min(DAY_MINUTES - 0.5, at), svcFactor: 0.7 + rnd() * 0.6 });
      bu += load;
      at += 1 + rnd() * 3;
    }
  }
  out.sort((a, b) => a.arrive - b.arrive);
  out.forEach((t, i) => (t.i = i));
  return out;
}

// ---------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------
const EPS = 1e-9;

export function pitMinutes(bu: number, rateBph: number): number {
  return PIT_SETUP_MINUTES + (bu / Math.max(1000, rateBph)) * 60;
}

export interface DayCore {
  scale: Int8Array;
  pit: Int8Array;
  scaleStart: Float64Array;
  scaleEnd: Float64Array;
  scaleRelease: Float64Array;
  pitStart: Float64Array;
  pitEnd: Float64Array;
  /** 1 when the truck gave up */
  lost: Uint8Array;
}

/**
 * Discrete-event run of the day on typed arrays (fast enough to rank ~1,000
 * facilities). The road queue is FIFO over arrival order, so it is simply the
 * range [head, next arrival).
 */
export function runCore(trucks: Truck[], f: Pick<FacilityInput, "scales" | "pits" | "pitRateBph">, s: EngineSettings): DayCore {
  const n = trucks.length;
  const nScales = Math.max(1, Math.round(f.scales));
  const nPits = Math.max(1, Math.round(f.pits));
  const stagingCap = nPits * STAGING_PER_PIT;
  const L = s.waitLimitMinutes;
  const c: DayCore = {
    scale: new Int8Array(n).fill(-1),
    pit: new Int8Array(n).fill(-1),
    scaleStart: new Float64Array(n).fill(Infinity),
    scaleEnd: new Float64Array(n).fill(Infinity),
    scaleRelease: new Float64Array(n).fill(Infinity),
    pitStart: new Float64Array(n).fill(Infinity),
    pitEnd: new Float64Array(n).fill(Infinity),
    lost: new Uint8Array(n),
  };
  const arrive = new Float64Array(n);
  for (let i = 0; i < n; i++) arrive[i] = trucks[i].arrive;
  const staging = new Int32Array(n);
  let sTail = 0,
    sh = 0,
    qh = 0,
    ptr = 0;
  const scaleTruck = new Int32Array(nScales).fill(-1);
  const scaleDone = new Float64Array(nScales).fill(Infinity);
  const scaleBlocked = new Uint8Array(nScales);
  const pitTruck = new Int32Array(nPits).fill(-1);
  const pitDone = new Float64Array(nPits).fill(Infinity);

  for (let guard = 0; guard < n * 12 + 100; guard++) {
    let t = Infinity;
    if (ptr < n) t = arrive[ptr];
    if (qh < ptr) {
      const dl = arrive[qh] + L;
      if (dl <= DAY_MINUTES && dl < t) t = dl;
    }
    for (let k = 0; k < nScales; k++) if (scaleTruck[k] >= 0 && !scaleBlocked[k] && scaleDone[k] < t) t = scaleDone[k];
    for (let p = 0; p < nPits; p++) if (pitTruck[p] >= 0 && pitDone[p] < t) t = pitDone[p];
    if (t === Infinity) break;

    // Pits finish
    for (let p = 0; p < nPits; p++) {
      if (pitTruck[p] >= 0 && pitDone[p] <= t + EPS) {
        c.pitEnd[pitTruck[p]] = pitDone[p];
        pitTruck[p] = -1;
        pitDone[p] = Infinity;
      }
    }
    // Scales finish weighing (the truck then needs room at the pits)
    for (let k = 0; k < nScales; k++) {
      if (scaleTruck[k] >= 0 && !scaleBlocked[k] && scaleDone[k] <= t + EPS) {
        c.scaleEnd[scaleTruck[k]] = scaleDone[k];
        scaleBlocked[k] = 1;
      }
    }
    // Arrivals join the line
    while (ptr < n && arrive[ptr] <= t + EPS) ptr++;

    // Move trucks forward until nothing changes
    for (let moved = true; moved;) {
      moved = false;
      for (let p = 0; p < nPits; p++) {
        if (pitTruck[p] < 0 && sh < sTail) {
          const i = staging[sh++];
          pitTruck[p] = i;
          c.pit[i] = p;
          c.pitStart[i] = t;
          pitDone[p] = t + pitMinutes(trucks[i].bu, f.pitRateBph);
          moved = true;
        }
      }
      // Blocked scales release in the order they finished
      for (;;) {
        let best = -1;
        for (let k = 0; k < nScales; k++) if (scaleBlocked[k] && (best < 0 || c.scaleEnd[scaleTruck[k]] < c.scaleEnd[scaleTruck[best]])) best = k;
        if (best < 0 || sTail - sh >= stagingCap) break;
        const i = scaleTruck[best];
        c.scaleRelease[i] = t;
        staging[sTail++] = i;
        scaleTruck[best] = -1;
        scaleBlocked[best] = 0;
        scaleDone[best] = Infinity;
        moved = true;
      }
    }
    // Free scales take the front of the line
    for (let k = 0; k < nScales; k++) {
      if (scaleTruck[k] >= 0 || qh >= ptr) continue;
      const i = qh++;
      scaleTruck[k] = i;
      c.scale[i] = k;
      c.scaleStart[i] = t;
      scaleDone[k] = t + s.serviceMinutes * trucks[i].svcFactor;
    }
    // Anyone past the limit gives up (only during the posted day)
    while (qh < ptr && t <= DAY_MINUTES + EPS && arrive[qh] + L <= t + EPS) c.lost[qh++] = 1;
  }
  return c;
}

/** Every truck's timeline for the day */
export function runDay(trucks: Truck[], f: Pick<FacilityInput, "scales" | "pits" | "pitRateBph">, s: EngineSettings): TruckTrace[] {
  const c = runCore(trucks, f, s);
  return trucks.map((t, i) => ({
    ...t,
    scale: c.scale[i],
    scaleStart: c.scaleStart[i],
    scaleEnd: c.scaleEnd[i],
    scaleRelease: c.scaleRelease[i],
    pit: c.pit[i],
    pitStart: c.pitStart[i],
    pitEnd: c.pitEnd[i],
    lost: c.lost[i] === 1,
    leaveAt: c.lost[i] ? t.arrive + s.waitLimitMinutes : Infinity,
  }));
}

/** When the truck left the road queue (scale or gave up) */
export const queueExit = (t: TruckTrace) => (t.lost ? t.leaveAt : t.scaleStart);

export function minuteSeries(trs: TruckTrace[]): MinuteSeries {
  const M = DAY_MINUTES + 1;
  const dq = new Int32Array(M + 1);
  const dServed = new Int32Array(M + 1);
  const dLost = new Int32Array(M + 1);
  const dRec = new Float64Array(M + 1);
  const dBuLost = new Float64Array(M + 1);
  const idx = (x: number) => Math.min(M, Math.max(0, Math.ceil(x - EPS)));
  for (const t of trs) {
    dq[idx(t.arrive)]++;
    const out = queueExit(t);
    if (out !== Infinity) dq[idx(out)]--;
    if (t.lost) {
      dLost[idx(t.leaveAt)]++;
      dBuLost[idx(t.leaveAt)] += t.bu;
    } else if (t.pitEnd !== Infinity) {
      dServed[idx(t.pitEnd)]++;
      dRec[idx(t.pitEnd)] += t.bu;
    }
  }
  const s: MinuteSeries = {
    queue: new Uint16Array(M),
    wait: new Float32Array(M),
    served: new Uint16Array(M),
    lost: new Uint16Array(M),
    buReceived: new Float64Array(M),
    buLost: new Float64Array(M),
  };
  let q = 0,
    sv = 0,
    ls = 0,
    rec = 0,
    bl = 0,
    h = 0;
  for (let m = 0; m < M; m++) {
    q += dq[m];
    sv += dServed[m];
    ls += dLost[m];
    rec += dRec[m];
    bl += dBuLost[m];
    s.queue[m] = Math.max(0, q);
    s.served[m] = sv;
    s.lost[m] = ls;
    s.buReceived[m] = rec;
    s.buLost[m] = bl;
    // FIFO: the front of the line is the earliest arrival that hasn't left it
    while (h < trs.length && queueExit(trs[h]) <= m + EPS) h++;
    s.wait[m] = h < trs.length && trs[h].arrive <= m ? m - trs[h].arrive : 0;
  }
  return s;
}

export function hourLabel(h: number): string {
  const a = DAY_START_HOUR + h;
  const f = (x: number) => (x % 12 === 0 ? 12 : x % 12);
  const per = (x: number) => (x < 12 || x === 24 ? "am" : "pm");
  return per(a) === per(a + 1) ? `${f(a)}–${f(a + 1)} ${per(a)}` : `${f(a)} ${per(a)}–${f(a + 1)} ${per(a + 1)}`;
}

export function worstHourOf(series: MinuteSeries): WorstHour {
  let best: WorstHour = { hour: 0, label: hourLabel(0), trucksWaiting: 0, waitMinutes: 0 };
  let bestAvg = -1;
  for (let h = 0; h < DAY_END_HOUR - DAY_START_HOUR; h++) {
    let sum = 0,
      max = 0,
      wait = 0;
    for (let m = h * 60; m < h * 60 + 60; m++) {
      sum += series.queue[m];
      max = Math.max(max, series.queue[m]);
      wait = Math.max(wait, series.wait[m]);
    }
    const avg = sum / 60;
    if (avg > bestAvg + 1e-9 || (Math.abs(avg - bestAvg) < 1e-9 && wait > best.waitMinutes)) {
      bestAvg = avg;
      best = { hour: h, label: hourLabel(h), trucksWaiting: max, waitMinutes: Math.round(wait) };
    }
  }
  return best;
}

export function simulateDay(f: FacilityInput, s: EngineSettings, trucks: Truck[] = generateTrucks(f)): DaySim {
  const trs = runDay(trucks, f, s);
  const series = minuteSeries(trs);
  let lost = 0,
    buLost = 0,
    buRec = 0,
    served = 0;
  for (const t of trs) {
    if (t.lost) {
      lost++;
      buLost += t.bu;
    } else {
      served++;
      buRec += t.bu;
    }
  }
  let maxQueue = 0,
    maxWait = 0;
  for (let m = 0; m < series.queue.length; m++) {
    maxQueue = Math.max(maxQueue, series.queue[m]);
    maxWait = Math.max(maxWait, series.wait[m]);
  }
  return {
    settings: s,
    scales: Math.max(1, Math.round(f.scales)),
    pits: Math.max(1, Math.round(f.pits)),
    trucks: trs,
    series,
    dailyBushels: trucks.reduce((a, t) => a + t.bu, 0),
    trucksServed: served,
    trucksLost: lost,
    bushelsLost: buLost,
    bushelsReceived: buRec,
    worstHour: worstHourOf(series),
    maxQueue,
    maxWait: Math.round(maxWait),
  };
}

/**
 * Losses only (no traces or series): for ranking ~1,000 facilities quickly.
 * Same model and trucks as simulateDay, so the numbers match exactly.
 */
export function quickLoss(f: FacilityInput, s: EngineSettings, trucks: Truck[] = generateTrucks(f)): { trucksLost: number; bushelsLost: number } {
  const c = runCore(trucks, f, s);
  let n = 0,
    bu = 0;
  for (let i = 0; i < trucks.length; i++)
    if (c.lost[i]) {
      n++;
      bu += trucks[i].bu;
    }
  return { trucksLost: n, bushelsLost: bu };
}

/** Average load across the truck mix (72% semis, 20% straight trucks, 8% wagons) */
export const AVG_TRUCK_BU = 0.72 * 1000 + 0.2 * 550 + 0.08 * 325;
const PEAK_SHARE = Math.max(...ARRIVAL_PROFILE) / PROFILE_SUM;

/**
 * Fast screen for ranking: false when even a busy peak hour (expected peak
 * arrivals + 3 standard deviations, doubled variance for convoys) stays under
 * 75% of what the scales and pits can clear in an hour, so no truck can come
 * close to the wait limit. The engine test checks this against every seeded
 * facility (screen says no loss => the full simulation loses nothing).
 */
export function mayLoseTrucks(f: FacilityInput, s: EngineSettings): boolean {
  const trucksPerDay = dailyBushels(f) / AVG_TRUCK_BU;
  const lambda = trucksPerDay * PEAK_SHARE;
  const busyHour = lambda + 3 * Math.sqrt(2 * lambda) + 2;
  const scaleCap = (Math.max(1, Math.round(f.scales)) * 60) / s.serviceMinutes;
  const pitCap = (Math.max(1, Math.round(f.pits)) * 60) / pitMinutes(AVG_TRUCK_BU, f.pitRateBph);
  return busyHour > 0.85 * Math.min(scaleCap, pitCap);
}

/** Clock label for a minute of the day, e.g. "3:45 pm" */
export function clockLabel(minute: number): string {
  const total = DAY_START_HOUR * 60 + Math.floor(minute);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}
