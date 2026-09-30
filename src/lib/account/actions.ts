"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient, createClient, createStatelessClient } from "@/lib/supabase/server";
import { MIN_PASSWORD, supabaseConfigured } from "@/lib/supabase/config";

export interface ActionState {
  error?: string;
  message?: string;
}


async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Only same-site paths */
function safeNext(next: FormDataEntryValue | null): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/* ------------------------------------------------------------- sign in */

export async function signInWithEmail(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for every failure, so the form doesn't reveal which emails exist
  if (error) return { error: error.code === "user_banned" ? "This account is disabled. Contact your administrator." : "Email or password is incorrect." };
  redirect(safeNext(form.get("next")));
}

export async function signOut(): Promise<void> {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

/** Sends a reset link. The reply is the same whether or not the email has an account. */
export async function requestPasswordReset(_prev: ActionState, form: FormData): Promise<ActionState> {
  const email = text(form, "email").toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter a valid email address." };
  const { error } = await createStatelessClient().auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/confirm?next=/account/password` });
  if (error && error.status === 429) return { error: "Too many requests. Try again in a few minutes." };
  return { message: "If that email has an account, a reset link is on its way." };
}

/* ------------------------------------------------------ first-run admin */

/** True when the project has no users yet (the first visitor sets up the administrator) */
export async function needsSetup(): Promise<boolean> {
  if (!supabaseConfigured()) return false;
  try {
    const { data, error } = await createAdminClient().auth.admin.listUsers({ page: 1, perPage: 1 });
    return !error && data.users.length === 0;
  } catch {
    return false;
  }
}

function allowedAdmin(email: string): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !list.length || list.includes(email);
}

export async function createFirstAdmin(_prev: ActionState, form: FormData): Promise<ActionState> {
  const name = text(form, "name");
  const email = text(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter your name and a valid email." };
  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters for the password.` };
  if (!(await needsSetup())) return { error: "An administrator already exists. Sign in instead." };
  if (!allowedAdmin(email)) return { error: "This email isn't allowed to set up HarvestSignal." };
  const { error } = await createAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "admin" },
    user_metadata: { full_name: name },
  });
  if (error) return { error: error.message };
  const supabase = await createClient();
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.error) return { error: "Account created. Sign in to continue." };
  redirect("/settings?tab=users");
}

/* ----------------------------------------------------------- passwords */

/** Sets a new password for the signed-in user (after an invite, a reset link or a temporary password) */
export async function setNewPassword(_prev: ActionState, form: FormData): Promise<ActionState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  if (password !== confirm) return { error: "The passwords don't match." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } });
  if (error) return { error: error.code === "same_password" ? "Choose a password you haven't used here." : error.message };
  // Pick up the new metadata in the session cookie
  await supabase.auth.refreshSession();
  redirect(safeNext(form.get("next")));
}

/** Settings → Security: checks the current password first */
export async function changePassword(current: string, next: string): Promise<ActionState> {
  if (next.length < MIN_PASSWORD) return { error: `Use at least ${MIN_PASSWORD} characters.` };
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims as { email?: string } | undefined)?.email;
  if (!email) return { error: "Your session has expired. Sign in again." };
  const checker = createStatelessClient();
  const check = await checker.auth.signInWithPassword({ email, password: current });
  if (check.error) return { error: "Current password is incorrect." };
  await checker.auth.signOut();
  const { error } = await supabase.auth.updateUser({ password: next, data: { must_change_password: false } });
  if (error) return { error: error.code === "same_password" ? "Choose a new password." : error.message };
  return { message: "Password updated" };
}

/* ------------------------------------------------------------- profile */

export async function updateMyProfile(input: { name: string; title: string }): Promise<ActionState> {
  const name = input.name.trim().slice(0, 80);
  if (!name) return { error: "Enter your name." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ data: { full_name: name, title: input.title.trim().slice(0, 80) } });
  if (error) return { error: error.message };
  await supabase.auth.refreshSession();
  return { message: "Profile saved" };
}
