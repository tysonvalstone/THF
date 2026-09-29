import { helpArticle } from "@/lib/help/content";

/** One compiled article, for the page-level help drawer */
export async function GET(_req: Request, ctx: RouteContext<"/api/help/[slug]">) {
  const { slug } = await ctx.params;
  const article = await helpArticle(slug);
  return article ? Response.json(article) : Response.json({ error: "Not found" }, { status: 404 });
}
