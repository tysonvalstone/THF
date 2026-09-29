import { RecordView } from "@/components/records/record-view";

export default async function LeadPage({ params }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  return <RecordView id={id} />;
}
