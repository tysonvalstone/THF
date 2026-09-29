import type { Metadata } from "next";
import { SegmentPrioritization } from "@/components/segments/segment-prioritization";

export const metadata: Metadata = { title: "Segments" };

export default function SegmentsPage() {
  return <SegmentPrioritization />;
}
