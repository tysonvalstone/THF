import "server-only";
import { cookies } from "next/headers";
import { APP_USERS } from "@/data/reference/users";
import { SESSION_COOKIE, readSessionValue } from "@/lib/session";
import { supabaseConfigured, type SessionUser } from "./config";
import { createClient } from "./server";

/** Builds the app user from verified JWT claims */
export function userFromClaims(claims: Record<string, unknown>): SessionUser {
  const app = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const email = String(claims.email ?? "");
  return {
    id: String(claims.sub),
    email,
    name: String(meta.full_name || email.split("@")[0] || "User"),
    title: String(meta.title || ""),
    role: app.role === "admin" ? "admin" : "user",
    sfUserId: typeof meta.sf_user_id === "string" && meta.sf_user_id ? meta.sf_user_id : undefined,
    mustChangePassword: meta.must_change_password === true,
    mode: "supabase",
  };
}

/** The signed-in user for this request, or null */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return data?.claims ? userFromClaims(data.claims as unknown as Record<string, unknown>) : null;
  }
  const id = await readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  const u = APP_USERS.find((x) => x.Id === id);
  return u ? { id: u.Id, email: u.Email, name: u.Name, title: u.Title, role: u.Id === APP_USERS[0].Id ? "admin" : "user", sfUserId: u.Id, mode: "demo" } : null;
}
