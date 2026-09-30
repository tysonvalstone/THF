"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";
import { AuthCard } from "./auth-card";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") ? n : "/");

/**
 * Landing page for links in invitation and password-reset emails. Handles the
 * three shapes Supabase can send: tokens in the URL hash, a token_hash to
 * verify, or a PKCE code. Then continues to `next` (usually the set-password page).
 */
export function ConfirmLink() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const supabase = createClient();
      const url = new URL(window.location.href);
      const hash = new URLSearchParams(url.hash.slice(1));
      const next = safeNext(url.searchParams.get("next"));
      const linkError = hash.get("error_description") ?? url.searchParams.get("error_description");
      if (linkError) return setError(linkError.replace(/\+/g, " "));

      let failed: string | null = null;
      if (hash.get("access_token") && hash.get("refresh_token")) {
        const { error } = await supabase.auth.setSession({ access_token: hash.get("access_token")!, refresh_token: hash.get("refresh_token")! });
        failed = error?.message ?? null;
      } else if (url.searchParams.get("token_hash") && url.searchParams.get("type")) {
        const { error } = await supabase.auth.verifyOtp({ token_hash: url.searchParams.get("token_hash")!, type: url.searchParams.get("type") as EmailOtpType });
        failed = error?.message ?? null;
      } else if (url.searchParams.get("code")) {
        const { error } = await supabase.auth.exchangeCodeForSession(url.searchParams.get("code")!);
        failed = error?.message ?? null;
      } else {
        failed = "This link is incomplete.";
      }
      if (failed) return setError(failed);
      // Full load so the server sees the new session cookies
      window.location.replace(next);
    };
    void run();
  }, []);

  return error ? (
    <AuthCard
      title="This link didn't work"
      subtitle="It may have expired or already been used. Ask for a new one."
      footer={
        <Link href="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      }
    >
      <p className="text-sm text-muted-foreground">{error}</p>
    </AuthCard>
  ) : (
    <AuthCard title="Signing you in…">
      <p className="text-sm text-muted-foreground">One moment.</p>
    </AuthCard>
  );
}
