import { cookies } from "next/headers";
import { APP_USERS } from "@/data/reference/users";
import { SESSION_COOKIE, createSessionValue } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabase/config";

/**
 * Demo mode: starts or ends the 30-day session. The optional per-user password is a
 * browser-side demo check (see src/lib/auth.tsx) that runs before this call.
 */
export async function POST(req: Request) {
  // Demo sign-in only; with Supabase configured, accounts sign in with email and password
  if (supabaseConfigured()) return Response.json({ error: "Not found" }, { status: 404 });
  let userId: string | undefined;
  try {
    ({ userId } = (await req.json()) as { userId?: string });
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!userId || !APP_USERS.some((u) => u.Id === userId)) return Response.json({ error: "Unknown user" }, { status: 400 });
  const { value, expires } = await createSessionValue(userId);
  (await cookies()).set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
  return Response.json({ ok: true });
}

export async function DELETE() {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
