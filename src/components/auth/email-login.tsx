"use client";

import { useActionState, useState } from "react";
import { requestPasswordReset, signInWithEmail, type ActionState } from "@/lib/account/actions";
import { AuthCard, FormError } from "./auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function EmailLogin({ next }: { next?: string }) {
  const [view, setView] = useState<"sign-in" | "reset">("sign-in");
  const [email, setEmail] = useState("");
  const [signInState, signIn, signingIn] = useActionState<ActionState, FormData>(signInWithEmail, {});
  const [resetState, reset, resetting] = useActionState<ActionState, FormData>(requestPasswordReset, {});

  if (view === "reset") {
    return (
      <AuthCard
        title="Reset your password"
        subtitle="We'll email you a link to choose a new password."
        footer={
          <button type="button" className="text-primary hover:underline" onClick={() => setView("sign-in")}>
            Back to sign in
          </button>
        }
      >
        {resetState.message ? (
          <p className="text-sm" role="status">
            {resetState.message}
          </p>
        ) : (
          <form action={reset} className="space-y-4">
            <FormError message={resetState.error} />
            <div className="grid gap-1.5">
              <Label htmlFor="reset-email">Email</Label>
              <Input id="reset-email" name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={resetting}>
              {resetting ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Sign in" subtitle="Use your work email and password." guest>
      <form action={signIn} className="space-y-4">
        <FormError message={signInState.error} />
        <input type="hidden" name="next" value={next ?? "/"} />
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setView("reset")}>
              Forgot password?
            </button>
          </div>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <Button type="submit" variant="outline" className="w-full" disabled={signingIn}>
          {signingIn ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}
