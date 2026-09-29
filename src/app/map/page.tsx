import type { Metadata } from "next";
import { MapView } from "@/components/map/map-view";

export const metadata: Metadata = { title: "Seasonality map" };

export default function MapPage() {
  return <MapView />;
}
