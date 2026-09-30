import type { Metadata } from "next";
import { supabaseConfigured } from "@/lib/supabase/config";
import { needsSetup } from "@/lib/account/actions";
import { LoginScreen } from "@/components/auth/login-screen";
import { EmailLogin } from "@/components/auth/email-login";
import { SetupAdmin } from "@/components/auth/setup-admin";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!supabaseConfigured()) return <LoginScreen />;
  if (await needsSetup()) return <SetupAdmin />;
  const next = (await searchParams).next;
  return <EmailLogin next={typeof next === "string" ? next : undefined} />;
}
