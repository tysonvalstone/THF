import type { PriceSeries } from "@/types/reference";
import prices from "./prices.json";

/** Monthly commodity price series (small; safe to bundle in the browser) */
export const PRICES = prices as unknown as PriceSeries[];
