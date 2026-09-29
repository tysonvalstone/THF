import "server-only";
import { unstable_cache } from "next/cache";
import { SEED } from "@/data/seed";
import type { DataSnapshot } from "./types";
import { isLiveConfigured, loadSalesforceSnapshot } from "./salesforce";

export type DataMode = "mock" | "live";

export interface AppData {
  mode: DataMode;
  loadedAt: string;
  /** Base URL for record links in live mode, e.g. https://acme.lightning.force.com */
  lightningBaseUrl?: string;
  warnings: string[];
  snapshot: DataSnapshot;
}

export const DATA_TAG = "salesforce-data";

/** Live Salesforce reads are cached for an hour; "Refresh data" expires the tag. */
const loadLive = unstable_cache(
  async (): Promise<AppData> => {
    const r = await loadSalesforceSnapshot();
    return { mode: "live", loadedAt: r.loadedAt, lightningBaseUrl: r.lightningBaseUrl, warnings: r.warnings, snapshot: r.snapshot };
  },
  ["harvest-signal-live-data"],
  { tags: [DATA_TAG], revalidate: 3600 },
);

/**
 * The single server-side data entry point. Mock mode (default) serves the
 * seeded JSON; live mode is enabled by the SF_* environment variables and is
 * read-only by design.
 */
export async function loadAppData(): Promise<AppData> {
  if (!isLiveConfigured()) {
    return { mode: "mock", loadedAt: new Date().toISOString(), warnings: [], snapshot: SEED };
  }
  try {
    return await loadLive();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[data] Live Salesforce load failed, serving mock data:", message);
    return {
      mode: "mock",
      loadedAt: new Date().toISOString(),
      warnings: [`Live Salesforce load failed (${message}). Showing mock data.`],
      snapshot: SEED,
    };
  }
}
