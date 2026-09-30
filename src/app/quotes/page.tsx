import { Suspense } from "react";
import type { Metadata } from "next";
import { QuotesList } from "@/components/quotes/quotes-list";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Quotes" };

export default function QuotesPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Quotes</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <QuotesList />
      </Suspense>
    </div>
  );
}
