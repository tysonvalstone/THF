import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/session";
import { SetPassword } from "@/components/auth/set-password";

export const metadata: Metadata = { title: "Set password" };

/** After an invitation, a reset link, or signing in with a temporary password */
export default async function PasswordPage() {
  const user = await getSessionUser();
  if (!user || user.mode !== "supabase") redirect("/settings?tab=security");
  return <SetPassword email={user.email} required={!!user.mustChangePassword} next="/" />;
}
