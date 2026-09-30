import { Suspense } from "react";
import type { Metadata } from "next";
import { ContactsView } from "@/components/records/contacts-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Contacts" };

export default function ContactsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-[560px]" />}>
      <ContactsView />
    </Suspense>
  );
}
