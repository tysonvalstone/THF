import type { Metadata } from "next";
import { ConfirmLink } from "@/components/auth/confirm-link";

export const metadata: Metadata = { title: "Signing in" };

export default function ConfirmPage() {
  return <ConfirmLink />;
}
