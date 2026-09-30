"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { HelpArticle, HelpIndexEntry } from "@/lib/help/types";
import { MdxArticle } from "./mdx-article";
import { HelpSearch, snippet, useHelpFuse } from "./help-search";
import { DataTable, type Column } from "@/components/shared/data-table";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/logo";

export function HelpCenter({ index, article }: { index: HelpIndexEntry[]; article: HelpArticle }) {
  const router = useRouter();
  const related = article.related.map((s) => index.find((a) => a.slug === s)).filter((a): a is HelpIndexEntry => !!a);
  const toc = (
    <ol className="space-y-0.5">
      {index.map((a) => (
        <li key={a.slug}>
          <Link
            href={`/help/${a.slug}`}
            aria-current={a.slug === article.slug ? "page" : undefined}
            className={cn(
              "block rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
              a.slug === article.slug && "bg-accent-soft font-medium text-primary hover:bg-accent-soft hover:text-primary",
            )}
          >
            {a.title}
          </Link>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="flex shrink-0 items-center gap-2 text-2xl font-semibold sm:w-[240px]">
          <LogoMark size={26} decorative />
          Help
        </h1>
        <div className="min-w-0 flex-1">
          <HelpSearch index={index} onSelect={(slug) => router.push(`/help/${slug}`)} onSeeAll={(q) => router.push(`/help?q=${encodeURIComponent(q)}`)} />
        </div>
      </div>

      <details className="rounded-md border bg-card p-2 lg:hidden">
        <summary className="cursor-pointer px-1 text-sm font-medium">Contents</summary>
        <nav className="mt-2" aria-label="Help articles">
          {toc}
        </nav>
      </details>

      <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav className="hidden lg:sticky lg:top-24 lg:block lg:self-start" aria-label="Help articles">
          {toc}
        </nav>
        <Suspense fallback={<ArticleBody article={article} related={related} />}>
          <ResultsOrArticle index={index} article={article} related={related} />
        </Suspense>
      </div>
    </div>
  );
}

function ArticleBody({ article, related }: { article: HelpArticle; related: HelpIndexEntry[] }) {
  return (
    <div className="max-w-[760px] min-w-0 rounded-md border bg-card px-5 py-6 sm:px-8">
      <MdxArticle article={article} related={related} />
    </div>
  );
}

/** /help?q=… shows every matching article, paginated; otherwise the article */
function ResultsOrArticle({ index, article, related }: { index: HelpIndexEntry[]; article: HelpArticle; related: HelpIndexEntry[] }) {
  const q = useSearchParams().get("q")?.trim() ?? "";
  const router = useRouter();
  const fuse = useHelpFuse(index);
  const results = useMemo(() => (q.length > 1 ? fuse.search(q).map((r) => r.item) : []), [fuse, q]);
  if (!q) return <ArticleBody article={article} related={related} />;
  const columns: Column<HelpIndexEntry>[] = [
    {
      key: "article",
      header: "Article",
      cell: (a) => (
        <div className="min-w-0 py-0.5">
          <Link href={`/help/${a.slug}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
            {a.title}
          </Link>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{snippet(a.text, q)}</p>
        </div>
      ),
    },
  ];
  return (
    <div className="max-w-[760px] min-w-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">
          Results for &ldquo;{q}&rdquo; <span className="font-normal text-muted-foreground tabular">({results.length})</span>
        </h2>
        <Link href={`/help/${article.slug}`} className="text-sm text-muted-foreground hover:text-foreground">
          Clear search
        </Link>
      </div>
      <DataTable rows={results} columns={columns} rowKey={(a) => a.slug} onRowClick={(a) => router.push(`/help/${a.slug}`)} empty="No articles found" caption="Help search results" />
    </div>
  );
}
