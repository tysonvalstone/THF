"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_HARVEST_WEIGHT, getHarvestWeight, subscribeHarvestWeight } from "./weight-store";

export { DEFAULT_HARVEST_WEIGHT, MAX_HARVEST_WEIGHT, getHarvestWeight, setHarvestWeight } from "./weight-store";

/** Weight of "Harvest $ at risk" in prospect ranking (0–2×); re-renders when it changes */
export function useHarvestWeight(): number {
  return useSyncExternalStore(subscribeHarvestWeight, getHarvestWeight, () => DEFAULT_HARVEST_WEIGHT);
}
