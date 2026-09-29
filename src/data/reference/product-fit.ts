import type { Segment } from "@/types/salesforce";

/**
 * Product fit: how well each ThiboLiSoft module fits each segment (0 = no fit, 1 = core fit).
 * Edit this table to change the "Product fit" input of segment prioritization.
 */
export const MODULES = ["Ceres", "GrainSight", "ScaleTrac", "GrainSight Mobile", "ScaleTrac Mobile"] as const;
export type Module = (typeof MODULES)[number];

export const PRODUCT_FIT: Record<Segment, Record<Module, number>> = {
  "Country Elevator": { Ceres: 1, GrainSight: 1, ScaleTrac: 1, "GrainSight Mobile": 0.8, "ScaleTrac Mobile": 0.8 },
  "Multi-Location Co-op": { Ceres: 1, GrainSight: 1, ScaleTrac: 1, "GrainSight Mobile": 1, "ScaleTrac Mobile": 1 },
  "River Terminal": { Ceres: 0.6, GrainSight: 1, ScaleTrac: 1, "GrainSight Mobile": 0.4, "ScaleTrac Mobile": 0.6 },
  "Rail/Shuttle Loader": { Ceres: 0.8, GrainSight: 1, ScaleTrac: 1, "GrainSight Mobile": 0.8, "ScaleTrac Mobile": 0.8 },
  "Ethanol Plant": { Ceres: 0.4, GrainSight: 1, ScaleTrac: 1, "GrainSight Mobile": 0.8, "ScaleTrac Mobile": 0.4 },
  "Feed Mill": { Ceres: 0.8, GrainSight: 0.4, ScaleTrac: 0.8, "GrainSight Mobile": 0, "ScaleTrac Mobile": 0.6 },
  Processor: { Ceres: 0.4, GrainSight: 1, ScaleTrac: 1, "GrainSight Mobile": 0.4, "ScaleTrac Mobile": 0.4 },
  "Seed Cleaner / Specialty Crop": { Ceres: 0.8, GrainSight: 0.4, ScaleTrac: 0.8, "GrainSight Mobile": 0.2, "ScaleTrac Mobile": 0.6 },
};

/** Average fit across modules, 0–1 */
export function productFitScore(segment: Segment): number {
  const row = PRODUCT_FIT[segment];
  return MODULES.reduce((s, m) => s + row[m], 0) / MODULES.length;
}
