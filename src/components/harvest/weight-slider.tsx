"use client";

import { useId } from "react";
import { Slider } from "@/components/ui/slider";
import { MAX_HARVEST_WEIGHT, setHarvestWeight, useHarvestWeight } from "@/lib/harvest/weight";
import { cn } from "@/lib/utils";

/** Weight of "Harvest $ at risk" in prospect ranking, 0–2× (saved in this browser) */
export function HarvestWeightSlider({ className }: { className?: string }) {
  const weight = useHarvestWeight();
  const id = useId();
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <label htmlFor={id} className="font-medium">
          Harvest $ at risk
        </label>
        <span className="text-muted-foreground tabular">{weight.toFixed(1)}×</span>
      </div>
      <Slider id={id} min={0} max={MAX_HARVEST_WEIGHT} step={0.1} value={[weight]} onValueChange={(v) => setHarvestWeight(v[0] ?? 1)} aria-label="Harvest $ at risk weight in prospect ranking" />
    </div>
  );
}
