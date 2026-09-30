import { Suspense } from "react";
import type { Metadata } from "next";
import { ApprovalsView } from "@/components/layout/approvals-view";

export const metadata: Metadata = { title: "Approvals" };

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsView />
    </Suspense>
  );
}
