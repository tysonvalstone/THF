import { Suspense } from "react";
import type { Metadata } from "next";
import { OnboardingDetail } from "@/components/success/onboarding-detail";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Onboarding project" };

export default async function OnboardingProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-[560px]" />}>
      <OnboardingDetail id={id} />
    </Suspense>
  );
}
