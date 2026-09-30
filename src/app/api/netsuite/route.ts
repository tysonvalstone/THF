import { loadNetSuite } from "@/lib/data/netsuite";
import { getSessionUser } from "@/lib/supabase/session";
import { can } from "@/lib/roles";

export const maxDuration = 60;

/**
 * Read-only NetSuite invoices and payments; { mode: "off" } without
 * credentials. Signed-in users with Finance access only (never guests).
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || user.guest || !can(user.appRole, "see:finance")) {
    return Response.json({ mode: "off", invoices: [], payments: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const result = await loadNetSuite({ refresh });
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
