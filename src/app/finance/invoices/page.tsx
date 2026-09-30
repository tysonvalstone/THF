import { Suspense } from "react";
import type { Metadata } from "next";
import { InvoicesView } from "@/components/finance/invoices-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Invoices" };

export default function InvoicesPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <InvoicesView />
    </Suspense>
  );
}
