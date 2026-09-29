import { RecordView } from "@/components/records/record-view";

export default async function AccountPage({ params }: PageProps<"/accounts/[id]">) {
  const { id } = await params;
  return <RecordView id={id} />;
}
