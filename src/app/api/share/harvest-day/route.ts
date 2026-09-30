import { getSessionUser } from "@/lib/supabase/session";
import { cleanSettings, createShareToken, sharePath } from "@/lib/harvest/share-token";

const ID = /^[\w-]{1,40}$/;

function origin(req: Request): string {
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdHost) return `${req.headers.get("x-forwarded-proto") ?? "https"}://${fwdHost}`;
  return new URL(req.url).origin;
}

/**
 * Signs read-only Harvest Day links (signed-in users only).
 * Body: { accountId, settings? } -> { url }, or { accountIds: [...], settings? } -> { urls: { id: url } }
 */
export async function POST(req: Request) {
  if (!(await getSessionUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  let body: { accountId?: unknown; accountIds?: unknown; settings?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const settings = cleanSettings(body.settings);
  const base = origin(req);
  if (Array.isArray(body.accountIds)) {
    const ids = [...new Set(body.accountIds.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, 5000);
    const urls: Record<string, string> = {};
    for (const id of ids) urls[id] = base + sharePath(await createShareToken(id, settings));
    return Response.json({ urls });
  }
  if (typeof body.accountId !== "string" || !ID.test(body.accountId)) return Response.json({ error: "accountId required" }, { status: 400 });
  return Response.json({ url: base + sharePath(await createShareToken(body.accountId, settings)) });
}
