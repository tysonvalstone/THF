import { OpportunityView } from "@/components/records/opportunity-view";

export default async function OpportunityPage({ params }: PageProps<"/opportunities/[id]">) {
  const { id } = await params;
  return <OpportunityView id={id} />;
}
