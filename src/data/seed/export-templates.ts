import type { ExportSpec } from "@/lib/ai/types";
import json from "./export-templates.json";

/** Prebuilt export templates (small; safe to bundle in the browser) */
export const PREBUILT_EXPORTS = json as unknown as ExportSpec[];
