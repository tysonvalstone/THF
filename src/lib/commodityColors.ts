"use client";

import { useCallback, useEffect, useState } from "react";
import { REGION_BY_ID, REGION_BY_STATE } from "@/data/reference/regions";
import type { Commodity, RegionId } from "@/types/salesforce";

/** Commodities that get their own colour (wheat classes are grouped) */
export type ColorCommodity = "Corn" | "Soybeans" | "Wheat" | "Canola" | "Sorghum" | "Barley" | "Pulses" | "Rice";
export const COLOR_COMMODITIES: ColorCommodity[] = ["Corn", "Soybeans", "Wheat", "Canola", "Sorghum", "Barley", "Pulses", "Rice"];

export const DEFAULT_COMMODITY_COLORS: Record<ColorCommodity, string> = {
  Corn: "#eda100",
  Soybeans: "#1baf7a",
  Wheat: "#b5651d",
  Canola: "#e87ba4",
  Sorghum: "#eb6834",
  Barley: "#4a3aa7",
  Pulses: "#008300",
  Rice: "#2a78d6",
};

export function toColorCommodity(c: Commodity): ColorCommodity {
  if (c === "Winter Wheat" || c === "Spring Wheat") return "Wheat";
  return c as ColorCommodity;
}

/** The most important crop in a state/province's sales region */
export function dominantCommodity(stateCode: string): ColorCommodity | null {
  const regionId = REGION_BY_STATE[stateCode] as RegionId | undefined;
  if (!regionId) return null;
  const crop = [...REGION_BY_ID[regionId].crops].sort((a, b) => b.importance - a.importance)[0];
  return crop ? toColorCommodity(crop.commodity) : null;
}

const KEY = "harvest-signal:commodity-colors:v1";

export function useCommodityColors() {
  const [colors, setColors] = useState<Record<ColorCommodity, string>>(DEFAULT_COMMODITY_COLORS);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state loads after mount
      if (raw) setColors({ ...DEFAULT_COMMODITY_COLORS, ...(JSON.parse(raw) as Partial<Record<ColorCommodity, string>>) });
    } catch {
      // ignore
    }
  }, []);
  const save = (next: Record<ColorCommodity, string>) => {
    setColors(next);
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };
  const setColor = useCallback((c: ColorCommodity, hex: string) => save({ ...colors, [c]: hex }), [colors]);
  const reset = useCallback(() => save(DEFAULT_COMMODITY_COLORS), []);
  return { colors, setColor, reset };
}
