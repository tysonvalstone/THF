import { Suspense } from "react";
import type { Metadata } from "next";
import { ContractDetail } from "@/components/contracts/contract-detail";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Contract" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <ContractDetail id={id} />
    </Suspense>
  );
}
