"use client";

/**
 * Simple sign-in: pick a user, with an optional per-user password.
 *
 * The session is a signed, HTTP-only cookie valid for 30 days (src/lib/session.ts,
 * checked by src/proxy.ts), so the login screen only appears on the first visit.
 * Profiles and the optional password hashes live in the browser's localStorage
 * (a demo check). Production would use Salesforce SSO or the company identity provider.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { APP_USERS } from "@/data/reference/users";
import type { User } from "@/types/salesforce";
import type { Sender } from "@/lib/content/templates";

const PROFILES_KEY = "harvest-signal:profiles:v1";
const SF_KEY = "harvest-signal:salesforce-connection:v1";

export interface Profile {
  photo?: string;
  email?: string;
  title?: string;
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
  user: User | null;
  users: User[];
  profile: (id: string) => Profile;
  me: Profile;
  signIn: (id: string, password?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  updateProfile: (patch: Partial<Omit<Profile, "passwordHash">>) => void;
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
    // storage blocked: the session still works in memory
  }
}

export function AuthProvider({ children, initialUserId }: { children: React.ReactNode; initialUserId: string | null }) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(initialUserId && APP_USERS.some((u) => u.Id === initialUserId) ? initialUserId : null);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [salesforce, setSf] = useState<SalesforceConnection | null>(null);

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
      if (!res.ok) return false;
      setUserId(id);
      return true;
    },
    [profiles],
  );

  const signOut = useCallback(async () => {
    await fetch("/api/session", { method: "DELETE" }).catch(() => undefined);
    // Full load so the server-rendered layout drops the session
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }, []);

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

  const value = useMemo<AuthValue>(
    () => ({
      ready,
      user: APP_USERS.find((u) => u.Id === userId) ?? null,
      users: APP_USERS,
      profile: (id) => profiles[id] ?? {},
      me: (userId && profiles[userId]) || {},
      signIn,
      signOut,
      updateProfile,
      setPassword,
      salesforce,
      setSalesforce,
    }),
    [ready, userId, profiles, signIn, signOut, updateProfile, setPassword, salesforce, setSalesforce],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Email signature details for the signed-in user */
export function useSender(): Sender {
  const { user, me } = useAuth();
  const name = user?.Name ?? "ThiboLiSoft";
  const title = me.title || "Sales";
  const email = me.email ?? "";
  return useMemo(() => ({ name, title, email }), [name, title, email]);
}

/** The signed-in user's Id (for OwnerId on records they create) */
export function useUserId(): string {
  return useAuth().user?.Id ?? APP_USERS[0].Id;
}
