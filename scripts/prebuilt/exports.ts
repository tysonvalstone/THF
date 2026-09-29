/**
 * Prebuilt export templates for the Template Builder.
 *
 *   npx tsx scripts/prebuilt/exports.ts
 *
 * Writes src/data/seed/export-templates.json. The main seed generator can
 * call writeExportTemplates(outDir) as well.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExportSpec } from "../../src/lib/ai/types";

export const PREBUILT_EXPORT_TEMPLATES: ExportSpec[] = [
  {
    id: "tpl-pipeline-by-segment",
    name: "Pipeline by Segment",
    description: "Open opportunities grouped by segment with seasonal win rates and expected value.",
    source: "opportunities",
    filters: [{ field: "is_open", op: "isTrue" }],
    columns: [
      { field: "account" },
      { field: "name" },
      { field: "stage" },
      { field: "amount" },
      { field: "win_rate" },
      { field: "expected_value" },
      { field: "close_date" },
    ],
    groupBy: "segment",
    sort: [{ field: "expected_value", dir: "desc" }],
    totals: ["amount", "expected_value"],
    format: "xlsx",
    prebuilt: true,
  },
  {
    id: "tpl-territory-coverage",
    name: "Territory Coverage",
    description: "Every facility by state and county, with customer coverage and open pipeline.",
    source: "accounts",
    filters: [],
    columns: [
      { field: "state" },
      { field: "county" },
      { field: "name" },
      { field: "segment" },
      { field: "is_customer" },
      { field: "locations" },
      { field: "open_pipeline" },
    ],
    groupBy: "state",
    sort: [
      { field: "state", dir: "asc" },
      { field: "name", dir: "asc" },
    ],
    totals: ["open_pipeline", "locations"],
    format: "xlsx",
    prebuilt: true,
  },
  {
    id: "tpl-accounts-in-blackout",
    name: "Accounts in Blackout",
    description: "Accounts in a harvest or planting no-contact window, soonest to clear first.",
    source: "accounts",
    filters: [{ field: "blackout", op: "neq", value: "None" }],
    columns: [
      { field: "name" },
      { field: "state" },
      { field: "segment" },
      { field: "blackout" },
      { field: "blackout_until" },
      { field: "score" },
      { field: "open_pipeline" },
    ],
    groupBy: null,
    sort: [{ field: "blackout_until", dir: "asc" }],
    totals: [],
    format: "pdf",
    prebuilt: true,
  },
  {
    id: "tpl-sf-opportunity-import",
    name: "Salesforce Opportunity Import",
    description: "Open opportunities with Salesforce API field names, ready for Data Loader.",
    source: "opportunities",
    filters: [{ field: "is_open", op: "isTrue" }],
    columns: [
      { field: "name" },
      { field: "account_id" },
      { field: "stage" },
      { field: "amount" },
      { field: "close_date" },
      { field: "probability" },
      { field: "type" },
      { field: "lead_source" },
      { field: "owner_id" },
      { field: "next_step" },
      { field: "economic_buyer" },
    ],
    groupBy: null,
    sort: [{ field: "close_date", dir: "asc" }],
    totals: [],
    format: "csv",
    prebuilt: true,
  },
];

export function writeExportTemplates(outDir: string) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "export-templates.json"), JSON.stringify(PREBUILT_EXPORT_TEMPLATES, null, 1) + "\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const out = resolve(process.cwd(), "src/data/seed");
  writeExportTemplates(out);
  console.log(`Wrote ${PREBUILT_EXPORT_TEMPLATES.length} export templates to ${join(out, "export-templates.json")}`);
}
