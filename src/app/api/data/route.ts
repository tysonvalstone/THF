import { loadAppData } from "@/lib/data/server";

export const maxDuration = 60;

/** One payload for the whole app; the browser does all ranking math in memory. */
export async function GET() {
  const data = await loadAppData();
  return Response.json(data, {
    headers: {
      // Mock data is static; live data is cached server-side for an hour.
      "Cache-Control": data.mode === "mock" ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" : "private, no-store",
    },
  });
}
