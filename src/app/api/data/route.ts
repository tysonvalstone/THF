import { loadAppData } from "@/lib/data/server";

export const maxDuration = 60;

/** One payload for the whole app; the browser does all ranking math in memory. */
export async function GET(req: Request) {
  // Demo Mode always uses the mock data, even when Salesforce is configured
  const data = await loadAppData({ forceMock: new URL(req.url).searchParams.get("mock") === "1" });
  return Response.json(data, {
    headers: {
      // Mock data is static; live data is cached server-side for an hour.
      "Cache-Control": data.mode === "mock" ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" : "private, no-store",
    },
  });
}
