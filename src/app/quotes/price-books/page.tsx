import { Suspense } from "react";
import type { Metadata } from "next";
import { PriceBooksView } from "@/components/quotes/price-books-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Price books" };

export default function PriceBooksPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Price books</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <PriceBooksView />
      </Suspense>
    </div>
  );
}
