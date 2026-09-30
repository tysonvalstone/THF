import { Suspense } from "react";
import type { Metadata } from "next";
import { QuoteDetail } from "@/components/quotes/quote-detail";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<Skeleton className="h-[640px]" />}>
      <QuoteDetail id={id} />
    </Suspense>
  );
}
