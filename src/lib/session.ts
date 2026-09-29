/**
 * Signed session cookie: "<userId>.<expiresMs>.<hmac>", HTTP-only, 30 days.
 * Used by src/proxy.ts (every page request), the root layout and /api/session.
 * Web Crypto only, so it runs in any runtime.
 */
export const SESSION_COOKIE = "hs_session";
export const SESSION_DAYS = 30;

const SECRET = process.env.SESSION_SECRET || "harvest-signal-demo-session";

async function hmac(text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createSessionValue(userId: string, now = Date.now()): Promise<{ value: string; expires: Date }> {
  const expires = now + SESSION_DAYS * 86_400_000;
  const payload = `${userId}.${expires}`;
  return { value: `${payload}.${await hmac(payload)}`, expires: new Date(expires) };
}

/** The user id, or null when the cookie is missing, tampered with or expired */
export async function readSessionValue(value: string | undefined): Promise<string | null> {
  if (!value) return null;
  const [userId, expires, sig] = value.split(".");
  if (!userId || !expires || !sig || !/^[\w-]+$/.test(userId)) return null;
  if (Number(expires) < Date.now()) return null;
  return (await hmac(`${userId}.${expires}`)) === sig ? userId : null;
}
