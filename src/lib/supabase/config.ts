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

/** What a person does in the business; drives navigation, visibility and approvals */
export type AppRole = "rep" | "manager" | "finance" | "legal" | "admin";
export const APP_ROLES: AppRole[] = ["rep", "manager", "finance", "legal", "admin"];
export const APP_ROLE_LABEL: Record<AppRole, string> = { rep: "Sales rep", manager: "Sales manager", finance: "Finance", legal: "Legal", admin: "Administrator" };

/** Guest sessions (judges, demos): mock data only, Demo Mode on, role switcher */
export const GUEST_ID = "guest";

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
  /** Business role (Rep / Manager / Finance / Legal / Admin) */
  appRole: AppRole;
  guest?: boolean;
  mode: "supabase" | "demo" | "guest";
}
