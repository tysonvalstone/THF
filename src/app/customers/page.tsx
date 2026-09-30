import { Suspense } from "react";
import type { Metadata } from "next";
import { CustomersView } from "@/components/success/customers-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Customer health" };

export default function CustomersPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Customer health</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <CustomersView />
      </Suspense>
    </div>
  );
}
