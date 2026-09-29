import type { Metadata } from "next";
import { SequencesView } from "@/components/sequences/sequences-view";

export const metadata: Metadata = { title: "Sequences" };

export default function SequencesPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Sequences</h1>
      <SequencesView />
    </div>
  );
}
