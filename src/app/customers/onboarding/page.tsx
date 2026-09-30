import { Suspense } from "react";
import type { Metadata } from "next";
import { OnboardingView } from "@/components/success/onboarding-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Onboarding" };

export default function OnboardingPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Onboarding</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <OnboardingView />
      </Suspense>
    </div>
  );
}
