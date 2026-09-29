import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { helpArticle, helpIndex } from "@/lib/help/content";
import { HelpCenter } from "@/components/help/help-center";

export async function generateMetadata({ params }: PageProps<"/help/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  const index = await helpIndex();
  const entry = index.find((a) => a.slug === slug?.[0]) ?? index[0];
  return { title: entry ? `${entry.title} · Help` : "Help" };
}

export default async function HelpPage({ params }: PageProps<"/help/[[...slug]]">) {
  const { slug } = await params;
  const index = await helpIndex();
  const target = slug?.[0] ?? index[0]?.slug;
  if (!target || (slug && slug.length > 1)) notFound();
  const article = await helpArticle(target);
  if (!article) notFound();
  return <HelpCenter index={index} article={article} />;
}
