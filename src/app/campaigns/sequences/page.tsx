import { redirect } from "next/navigation";

/** Sequences moved to Outreach */
export default async function OldSequencesPage({ searchParams }: PageProps<"/campaigns/sequences">) {
  const q = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [])));
  redirect(`/outreach/sequences${q.size ? `?${q}` : ""}`);
}
