import { revalidateTag } from "next/cache";
import { DATA_TAG } from "@/lib/data/server";

/** "Refresh data": expire the cached Salesforce read so the next load re-queries. */
export async function POST() {
  revalidateTag(DATA_TAG, { expire: 0 });
  return Response.json({ ok: true, refreshedAt: new Date().toISOString() });
}
