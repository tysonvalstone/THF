import "server-only";
import { cookies } from "next/headers";
import { APP_USERS } from "@/data/reference/users";
import { SESSION_COOKIE, readSessionValue } from "@/lib/session";
import { APP_ROLES, GUEST_ID, supabaseConfigured, type AppRole, type SessionUser } from "./config";
import { createClient } from "./server";

/** Builds the app user from verified JWT claims */
export function userFromClaims(claims: Record<string, unknown>): SessionUser {
  const app = (claims.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const email = String(claims.email ?? "");
  const admin = app.role === "admin";
  const appRole = APP_ROLES.includes(app.app_role as AppRole) ? (app.app_role as AppRole) : admin ? "admin" : "rep";
  return {
    id: String(claims.sub),
    email,
    name: String(meta.full_name || email.split("@")[0] || "User"),
    title: String(meta.title || ""),
    role: admin ? "admin" : "user",
    appRole,
    sfUserId: typeof meta.sf_user_id === "string" && meta.sf_user_id ? meta.sf_user_id : undefined,
    mustChangePassword: meta.must_change_password === true,
    mode: "supabase",
  };
}

/** Guests work Luke Brenneman's territory (the largest book) when viewing as a rep */
export const GUEST_USER: SessionUser = {
  id: GUEST_ID,
  email: "",
  name: "Guest",
  title: "Guest",
  role: "user",
  appRole: "manager",
  sfUserId: "005Hs00000000005AA",
  guest: true,
  mode: "guest",
};

/** Demo users cover each role so every view can be shown */
const DEMO_ROLES: AppRole[] = ["admin", "manager", "finance", "legal"];

/** The signed-in user for this request, or null */
export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieId = await readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (cookieId === GUEST_ID) return GUEST_USER;
  if (supabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return data?.claims ? userFromClaims(data.claims as unknown as Record<string, unknown>) : null;
  }
  const i = APP_USERS.findIndex((x) => x.Id === cookieId);
  const u = APP_USERS[i];
  if (!u) return null;
  const appRole = DEMO_ROLES[i] ?? "rep";
  return { id: u.Id, email: u.Email, name: u.Name, title: u.Title, role: appRole === "admin" ? "admin" : "user", appRole, sfUserId: u.Id, mode: "demo" };
}
