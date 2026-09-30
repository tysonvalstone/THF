"use client";

import { useActionState } from "react";
import { createFirstAdmin, type ActionState } from "@/lib/account/actions";
import { MIN_PASSWORD } from "@/lib/supabase/config";
import { AuthCard, FormError } from "./auth-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Shown only while the Supabase project has no users */
export function SetupAdmin() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createFirstAdmin, {});
  return (
    <AuthCard title="Set up HarvestSignal" subtitle="Create the administrator account. You'll add everyone else from Settings.">
      <form action={action} className="space-y-4">
        <FormError message={state.error} />
        <div className="grid gap-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" autoComplete="name" required autoFocus />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Work email</Label>
          <Input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} required />
          <p className="text-xs text-muted-foreground">At least {MIN_PASSWORD} characters</p>
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Creating…" : "Create administrator"}
        </Button>
      </form>
    </AuthCard>
  );
}
