"use client";

import { useActionState } from "react";
import { setNewPassword, type ActionState } from "@/lib/account/actions";
import { MIN_PASSWORD } from "@/lib/supabase/config";
import { AuthCard, FormError } from "./auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SetPassword({ email, required, next }: { email: string; required: boolean; next: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setNewPassword, {});
  return (
    <AuthCard title={required ? "Choose your password" : "Set a new password"} subtitle={email}>
      <form action={action} className="space-y-4">
        <FormError message={state.error} />
        <input type="hidden" name="next" value={next} />
        {/* Helps password managers save the right account */}
        <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
        <div className="grid gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required autoFocus />
          <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Saving…" : "Save password"}
        </Button>
      </form>
    </AuthCard>
  );
}
