import type { Metadata } from "next";
import { FacilitiesView } from "@/components/facilities/facilities-view";

export const metadata: Metadata = { title: "Facilities" };

export default function FacilitiesPage() {
  return <FacilitiesView />;
}
