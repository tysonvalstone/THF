import { Suspense } from "react";
import type { Metadata } from "next";
import { ProductsView } from "@/components/quotes/products-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Products</h1>
      <Suspense fallback={<Skeleton className="h-[480px]" />}>
        <ProductsView />
      </Suspense>
    </div>
  );
}
