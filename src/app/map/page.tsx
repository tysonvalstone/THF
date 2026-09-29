import type { Metadata } from "next";
import { MapView } from "@/components/map/map-view";

export const metadata: Metadata = { title: "Map" };

export default async function MapPage({ searchParams }: PageProps<"/map">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return <MapView region={one(sp.region)} state={one(sp.state)} />;
}
