import { TOWNS } from "@/data/reference/towns";
import { REGIONS, REGION_BY_STATE } from "@/data/reference/regions";
import { CANADIAN_PROVINCES, STATE_NAMES } from "@/data/reference/geo";
import type { Account, Country, RegionId } from "@/types/salesforce";

/** States and provinces the app covers (every state in a region), by name */
export const STATE_OPTIONS = [...new Set(REGIONS.flatMap((r) => r.states))]
  .sort((a, b) => (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b))
  .map((s) => ({ value: s, label: STATE_NAMES[s] ?? s }));

export function countryFor(state: string): Country {
  return CANADIAN_PROVINCES.includes(state) ? "Canada" : "United States";
}

export function regionFor(state: string): RegionId {
  return (REGION_BY_STATE[state] ?? "western-corn-belt") as RegionId;
}

/**
 * Approximate coordinates for a city: a known ag town, else the middle of the
 * state's known towns or accounts. Good enough for map dots and trip planning.
 */
export function geocode(city: string, state: string, accounts: Account[] = []): { lat: number; lon: number } {
  const c = city.trim().toLowerCase();
  const town = TOWNS.find((t) => t.state === state && t.name.toLowerCase() === c);
  if (town) return { lat: town.lat, lon: town.lon };
  const acct = accounts.find((a) => a.BillingState === state && a.BillingCity.toLowerCase() === c);
  if (acct) return { lat: acct.BillingLatitude, lon: acct.BillingLongitude };
  const pts = [...TOWNS.filter((t) => t.state === state).map((t) => [t.lat, t.lon]), ...accounts.filter((a) => a.BillingState === state).map((a) => [a.BillingLatitude, a.BillingLongitude])];
  if (!pts.length) return { lat: 41.9, lon: -93.1 };
  return { lat: +(pts.reduce((s, p) => s + p[0], 0) / pts.length).toFixed(4), lon: +(pts.reduce((s, p) => s + p[1], 0) / pts.length).toFixed(4) };
}
