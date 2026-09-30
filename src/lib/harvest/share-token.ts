/**
 * Signed share tokens for the read-only Harvest Day page:
 * base64url(JSON { a: accountId, s: settings }) + "." + base64url(HMAC-SHA256).
 * Web Crypto only (runs in Node, the edge and the browser); only the server
 * knows SESSION_SECRET, so only the server signs real links.
 */
import type { SimSettings } from "./summary";

const SECRET = () => process.env.SESSION_SECRET || "harvest-signal-demo-session";

export interface SharePayload {
  a: string;
  s?: Partial<SimSettings>;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

async function sign(text: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(SECRET()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(text))));
}

const SETTING_KEYS: (keyof SimSettings)[] = ["manualMinutes", "automatedMinutes", "waitLimitMinutes", "marginPerBu", "seasonDays"];

/** Keeps only finite, known settings */
export function cleanSettings(s: unknown): Partial<SimSettings> | undefined {
  if (!s || typeof s !== "object") return undefined;
  const out: Partial<SimSettings> = {};
  for (const k of SETTING_KEYS) {
    const v = (s as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < 10_000) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export async function createShareToken(accountId: string, settings?: Partial<SimSettings>): Promise<string> {
  const s = cleanSettings(settings);
  const body = b64url(enc.encode(JSON.stringify(s ? { a: accountId, s } : { a: accountId })));
  return `${body}.${await sign(body)}`;
}

/** The payload, or null when the token is malformed or its signature doesn't match */
export async function readShareToken(token: string): Promise<SharePayload | null> {
  const [body, sig, extra] = decodeURIComponent(token).split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = await sign(body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SharePayload;
    if (typeof p.a !== "string" || !/^[\w-]{1,40}$/.test(p.a)) return null;
    return { a: p.a, s: cleanSettings(p.s) };
  } catch {
    return null;
  }
}

export const sharePath = (token: string) => `/share/harvest-day/${token}`;
