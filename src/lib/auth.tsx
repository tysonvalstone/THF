"use client";

/**
 * The signed-in user, on the client.
 *
 * Supabase mode (production): email + password accounts in Supabase Auth.
 * The server reads the verified session and passes it in as `initialUser`;
 * administrators add and manage users under Settings → Users.
 *
 * Demo mode (no Supabase env vars): pick one of the demo users, with an
 * optional per-user password kept in this browser. The session is a signed,
 * HTTP-only cookie (src/lib/session.ts).
 *
 * Profile photos are stored in this browser in both modes.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { APP_USERS } from "@/data/reference/users";
import type { User } from "@/types/salesforce";
import type { Sender } from "@/lib/content/templates";
import type { SessionUser } from "@/lib/supabase/config";
import { signOut as supabaseSignOut } from "@/lib/account/actions";

const PROFILES_KEY = "harvest-signal:profiles:v1";
const SF_KEY = "harvest-signal:salesforce-connection:v1";

export interface Profile {
  photo?: string;
  email?: string;
  title?: string;
  /** Demo mode only */
  passwordHash?: string;
}

export interface SalesforceConnection {
  connected: boolean;
  environment: "Production" | "Sandbox";
  domain: string;
  orgName: string;
  connectedBy: string;
  connectedAt: string;
  lastSyncAt: string;
}

interface AuthValue {
  ready: boolean;
  mode: "supabase" | "demo";
  session: SessionUser | null;
  isAdmin: boolean;
  user: User | null;
  /** Demo users (demo mode sign-in) */
  users: User[];
  profile: (id: string) => Profile;
  me: Profile;
  /** Demo mode sign-in */
  signIn: (id: string, password?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Omit<Profile, "passwordHash">>) => void;
  /** Demo mode password */
  setPassword: (current: string | undefined, next: string | null) => Promise<boolean>;
  salesforce: SalesforceConnection | null;
  setSalesforce: (c: SalesforceConnection | null) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

async function hash(userId: string, password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked: nothing to persist
  }
}

export function AuthProvider({ children, initialUser, mode }: { children: React.ReactNode; initialUser: SessionUser | null; mode: "supabase" | "demo" }) {
  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [salesforce, setSf] = useState<SalesforceConnection | null>(null);
  const session = initialUser;
  const userId = session?.id ?? null;

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only state loads after mount */
    setProfiles(read(PROFILES_KEY, {}));
    setSf(read(SF_KEY, null));
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const saveProfiles = useCallback((next: Record<string, Profile>) => {
    setProfiles(next);
    write(PROFILES_KEY, next);
  }, []);

  const signIn = useCallback(
    async (id: string, password?: string) => {
      const p = profiles[id];
      if (p?.passwordHash && (!password || (await hash(id, password)) !== p.passwordHash)) return false;
      const res = await fetch("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: id }) });
      return res.ok;
    },
    [profiles],
  );

  const signOut = useCallback(async () => {
    if (mode === "supabase") {
      await supabaseSignOut();
      return;
    }
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    // Full load so the server-rendered layout drops the session
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, [mode]);

  const updateProfile = useCallback(
    (patch: Partial<Omit<Profile, "passwordHash">>) => {
      if (!userId) return;
      saveProfiles({ ...profiles, [userId]: { ...profiles[userId], ...patch } });
    },
    [userId, profiles, saveProfiles],
  );

  const setPassword = useCallback(
    async (current: string | undefined, next: string | null) => {
      if (!userId) return false;
      const p = profiles[userId] ?? {};
      if (p.passwordHash && (!current || (await hash(userId, current)) !== p.passwordHash)) return false;
      const passwordHash = next ? await hash(userId, next) : undefined;
      saveProfiles({ ...profiles, [userId]: { ...p, passwordHash } });
      return true;
    },
    [userId, profiles, saveProfiles],
  );

  const setSalesforce = useCallback((c: SalesforceConnection | null) => {
    setSf(c);
    write(SF_KEY, c);
  }, []);

  const value = useMemo<AuthValue>(() => {
    const user: User | null = session
      ? { Id: session.id, Name: session.name, Title: session.title, Email: session.email, Territory__c: "", Regions__c: [] }
      : null;
    return {
      ready,
      mode,
      session,
      isAdmin: session?.role === "admin",
      user,
      users: APP_USERS,
      profile: (id) => profiles[id] ?? {},
      me: (userId && profiles[userId]) || {},
      signIn,
      signOut,
      updateProfile,
      setPassword,
      salesforce,
      setSalesforce,
    };
  }, [ready, mode, session, userId, profiles, signIn, signOut, updateProfile, setPassword, salesforce, setSalesforce]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Email signature details for the signed-in user */
export function useSender(): Sender {
  const { session, me } = useAuth();
  const name = session?.name ?? "ThiboLiSoft";
  const title = session?.title || me.title || "Sales";
  const email = (session?.mode === "supabase" ? session.email : me.email) ?? "";
  return useMemo(() => ({ name, title, email }), [name, title, email]);
}

/** Owner Id for records the user creates: their linked Salesforce user, else their own id */
export function useUserId(): string {
  const { session } = useAuth();
  return session?.sfUserId ?? session?.id ?? APP_USERS[0].Id;
}
