import { Suspense } from "react";
import type { Metadata } from "next";
import { ContractsList } from "@/components/contracts/contracts-list";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Contracts" };

export default function ContractsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Contracts</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <ContractsList />
      </Suspense>
    </div>
  );
}
