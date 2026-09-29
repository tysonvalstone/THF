"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Avatar } from "./avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function LoginScreen() {
  const { users, profile, signIn, ready } = useAuth();
  const [pending, setPending] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  // Full load so the server sees the new session cookie
  const enter = () => {
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  };

  const choose = async (id: string) => {
    setError(false);
    if (profile(id).passwordHash) {
      setPending(id);
      setPassword("");
      return;
    }
    if (await signIn(id)) enter();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pending) return;
    const ok = await signIn(pending, password);
    if (ok) enter();
    else setError(true);
  };

  const pendingUser = users.find((u) => u.Id === pending);
  // Wait for saved profiles so a password is never skipped
  if (!ready) return <div className="min-h-full bg-background" />;

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm">
        <p className="text-center text-lg font-semibold">HarvestSignal</p>
        <div className="mt-6 rounded-md border bg-card p-6">
          {!pendingUser ? (
            <>
              <h1 className="text-base font-semibold">Select user</h1>
              <ul className="mt-4 space-y-2">
                {users.map((u) => (
                  <li key={u.Id}>
                    <button
                      type="button"
                      onClick={() => choose(u.Id)}
                      className="flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm hover:border-primary hover:bg-accent-soft"
                    >
                      <Avatar name={u.Name} photo={profile(u.Id).photo} size={32} />
                      <span className="flex-1 font-medium">{u.Name}</span>
                      {profile(u.Id).passwordHash && <span className="text-xs text-muted-foreground">Password</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar name={pendingUser.Name} photo={profile(pendingUser.Id).photo} size={40} />
                <div>
                  <p className="font-semibold">{pendingUser.Name}</p>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setPending(null)}>
                    Not you?
                  </button>
                </div>
              </div>
              <label className="grid gap-1.5 text-sm">
                Password
                <Input
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(false);
                  }}
                  aria-invalid={error}
                  className={cn(error && "border-status-critical")}
                />
              </label>
              {error && <p className="text-sm text-status-critical">Incorrect password</p>}
              <Button type="submit" className="w-full" disabled={!password}>
                Sign in
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
