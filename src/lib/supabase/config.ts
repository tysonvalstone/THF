/**
 * Supabase Auth is used when the project URL and publishable key are set
 * (the Vercel Supabase integration adds them). Without them the app falls
 * back to the demo sign-in, so it still runs with no environment variables.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

export type Role = "admin" | "user";

export const MIN_PASSWORD = 8;

/** The signed-in user as the app sees it (from the verified JWT, or the demo cookie) */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  title: string;
  role: Role;
  /** Salesforce User Id this login maps to (record ownership, sender) */
  sfUserId?: string;
  mustChangePassword?: boolean;
  mode: "supabase" | "demo";
}
