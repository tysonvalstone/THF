/** Prebuilt email sequences (client-safe). Regenerate with `npx tsx scripts/prebuilt/sequences.ts`. */
import type { Sequence } from "@/lib/ai/types";
import json from "./sequences.json";

export const PREBUILT_SEQUENCES = json as unknown as Sequence[];
