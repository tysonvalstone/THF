"use client";

import { useFormStatus } from "react-dom";
import { continueAsGuest } from "@/lib/account/actions";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="h-10 w-full text-sm" disabled={pending}>
      {pending ? "Opening…" : "Continue as Guest"}
    </Button>
  );
}

/** Guest entry: always available, so the sign-in page is never a dead end */
export function GuestButton() {
  return (
    <div>
      <form action={continueAsGuest}>
        <Submit />
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or sign in
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
