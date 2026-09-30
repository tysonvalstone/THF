/**
 * Weight of the "Harvest $ at risk" factor in prospect ranking (0–2×, default
 * 1×), kept in localStorage. Plain module (no React), so scoring can read it
 * on the server too, where it is always the default. The hook lives in
 * ./weight.ts.
 */
const KEY = "harvest-signal:harvest-weight:v1";
export const DEFAULT_HARVEST_WEIGHT = 1;
export const MAX_HARVEST_WEIGHT = 2;

let weight = DEFAULT_HARVEST_WEIGHT;
let loaded = false;
const listeners = new Set<() => void>();

const clamp = (w: number) => Math.min(MAX_HARVEST_WEIGHT, Math.max(0, Math.round(w * 10) / 10));

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw !== null && Number.isFinite(Number(raw))) weight = clamp(Number(raw));
  } catch {
    // storage blocked: keep the default
  }
}

export function getHarvestWeight(): number {
  load();
  return weight;
}

export function setHarvestWeight(w: number) {
  load();
  const next = clamp(w);
  if (next === weight) return;
  weight = next;
  try {
    window.localStorage.setItem(KEY, String(next));
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}

export function subscribeHarvestWeight(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    loaded = false;
    load();
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}
