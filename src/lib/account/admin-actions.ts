"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import type { User as AuthUser } from "@supabase/supabase-js";
import { createAdminClient, createClient, createStatelessClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/supabase/config";

/**
 * User administration. Every action re-checks that the caller is an active
 * administrator against the Auth server (not just the JWT, which can be up to
 * an hour old), and roles live in app_metadata, which users can't edit.
 */

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  title: string;
  role: Role;
  sfUserId: string | null;
  status: "active" | "invited" | "disabled" | "must-change-password";
  createdAt: string;
  lastSignInAt: string | null;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function requireAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  const { data: u } = await createAdminClient().auth.admin.getUserById(sub);
  const banned = u.user?.banned_until && new Date(u.user.banned_until) > new Date();
  return u.user?.app_metadata?.role === "admin" && !banned ? { id: sub } : null;
}

function toManaged(u: AuthUser): ManagedUser {
  const meta = u.user_metadata ?? {};
  const banned = !!u.banned_until && new Date(u.banned_until) > new Date();
  return {
    id: u.id,
    email: u.email ?? "",
    name: String(meta.full_name || ""),
    title: String(meta.title || ""),
    role: u.app_metadata?.role === "admin" ? "admin" : "user",
    sfUserId: typeof meta.sf_user_id === "string" && meta.sf_user_id ? meta.sf_user_id : null,
    status: banned ? "disabled" : !u.email_confirmed_at && !u.last_sign_in_at ? "invited" : meta.must_change_password ? "must-change-password" : "active",
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
  };
}

async function allUsers(): Promise<AuthUser[]> {
  const admin = createAdminClient();
  const out: AuthUser[] = [];
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    out.push(...data.users);
    if (data.users.length < 200) break;
  }
  return out;
}

async function activeAdminCount(): Promise<number> {
  return (await allUsers()).filter((u) => u.app_metadata?.role === "admin" && !(u.banned_until && new Date(u.banned_until) > new Date())).length;
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** 14 characters, letters and digits, easy to read aloud */
function tempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from(randomBytes(14), (b) => alphabet[b % alphabet.length]).join("");
}

const cleanEmail = (e: string) => e.trim().toLowerCase();
const validEmail = (e: string) => /^\S+@\S+\.\S+$/.test(e);

export async function listUsers(): Promise<Result<{ users: ManagedUser[] }>> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage users." };
  try {
    const users = (await allUsers()).map(toManaged).sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
    return { ok: true, users };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not load users" };
  }
}

export interface NewUserInput {
  email: string;
  name: string;
  title: string;
  role: Role;
  sfUserId: string | null;
  /** "password": create now with a temporary password; "invite": email an invitation link */
  access: "password" | "invite";
}

export async function createUser(input: NewUserInput): Promise<Result<{ user: ManagedUser; tempPassword?: string }>> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can add users." };
  const email = cleanEmail(input.email);
  if (!validEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (!input.name.trim()) return { ok: false, error: "Enter the person's name." };
  const admin = createAdminClient();
  const user_metadata = { full_name: input.name.trim(), title: input.title.trim(), sf_user_id: input.sfUserId ?? "" };
  const app_metadata = { role: input.role === "admin" ? "admin" : "user" };

  if (input.access === "invite") {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: user_metadata, redirectTo: `${await origin()}/auth/confirm?next=/account/password` });
    if (error) return { ok: false, error: error.message };
    const { data: updated, error: roleError } = await admin.auth.admin.updateUserById(data.user.id, { app_metadata });
    if (roleError) return { ok: false, error: roleError.message };
    return { ok: true, user: toManaged(updated.user ?? data.user) };
  }

  const password = tempPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata,
    user_metadata: { ...user_metadata, must_change_password: true },
  });
  if (error) return { ok: false, error: error.code === "email_exists" ? "A user with this email already exists." : error.message };
  return { ok: true, user: toManaged(data.user), tempPassword: password };
}

export interface UserPatch {
  name?: string;
  title?: string;
  role?: Role;
  sfUserId?: string | null;
}

export async function updateUser(id: string, patch: UserPatch): Promise<Result<{ user: ManagedUser }>> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Only administrators can edit users." };
  const admin = createAdminClient();
  const { data: current, error: getError } = await admin.auth.admin.getUserById(id);
  if (getError || !current.user) return { ok: false, error: "User not found." };
  const wasAdmin = current.user.app_metadata?.role === "admin";
  if (patch.role === "user" && wasAdmin) {
    if (id === me.id) return { ok: false, error: "You can't remove your own administrator role." };
    if ((await activeAdminCount()) <= 1) return { ok: false, error: "At least one administrator is required." };
  }
  const meta = { ...(current.user.user_metadata ?? {}) };
  if (patch.name !== undefined) meta.full_name = patch.name.trim();
  if (patch.title !== undefined) meta.title = patch.title.trim();
  if (patch.sfUserId !== undefined) meta.sf_user_id = patch.sfUserId ?? "";
  const { data, error } = await admin.auth.admin.updateUserById(id, {
    user_metadata: meta,
    ...(patch.role ? { app_metadata: { ...current.user.app_metadata, role: patch.role } } : {}),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: toManaged(data.user) };
}

export async function setUserDisabled(id: string, disabled: boolean): Promise<Result<{ user: ManagedUser }>> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Only administrators can disable users." };
  if (id === me.id) return { ok: false, error: "You can't disable your own account." };
  const admin = createAdminClient();
  const { data: current } = await admin.auth.admin.getUserById(id);
  if (disabled && current.user?.app_metadata?.role === "admin" && (await activeAdminCount()) <= 1) return { ok: false, error: "At least one administrator is required." };
  // A ban blocks sign-in and token refresh; existing access tokens expire within the hour
  const { data, error } = await admin.auth.admin.updateUserById(id, { ban_duration: disabled ? "876000h" : "none" });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user: toManaged(data.user) };
}

/** Emails a reset link, or sets a new temporary password shown once to the administrator */
export async function resetUserPassword(id: string, method: "email" | "password"): Promise<Result<{ tempPassword?: string; message: string }>> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can reset passwords." };
  const admin = createAdminClient();
  const { data: current } = await admin.auth.admin.getUserById(id);
  const email = current.user?.email;
  if (!email) return { ok: false, error: "User not found." };
  if (method === "email") {
    const { error } = await createStatelessClient().auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/confirm?next=/account/password` });
    if (error) return { ok: false, error: error.message };
    return { ok: true, message: `Reset link sent to ${email}` };
  }
  const password = tempPassword();
  const { error } = await admin.auth.admin.updateUserById(id, { password, user_metadata: { ...current.user!.user_metadata, must_change_password: true } });
  if (error) return { ok: false, error: error.message };
  return { ok: true, tempPassword: password, message: `Temporary password set for ${email}` };
}

export async function deleteUser(id: string): Promise<Result> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Only administrators can delete users." };
  if (id === me.id) return { ok: false, error: "You can't delete your own account." };
  const admin = createAdminClient();
  const { data: current } = await admin.auth.admin.getUserById(id);
  if (current.user?.app_metadata?.role === "admin" && (await activeAdminCount()) <= 1) return { ok: false, error: "At least one administrator is required." };
  // Ban first so a still-valid access token can't refresh, then delete
  await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
