"use client";

import { useMemo } from "react";
import Link from "next/link";
import * as runtime from "react/jsx-runtime";
import type { MDXComponents } from "mdx/types";
import type { HelpArticle, HelpMeta } from "@/lib/help/types";

function Screenshot({ caption }: { caption?: string }) {
  return (
    <figure className="my-5">
      <div className="flex aspect-[16/7] items-center justify-center rounded-md border border-dashed bg-panel text-xs text-muted-foreground">Screenshot</div>
      {caption && <figcaption className="mt-1.5 text-xs text-muted-foreground">{caption}</figcaption>}
    </figure>
  );
}

const COMPONENTS: MDXComponents = {
  Screenshot,
  a: ({ href = "", children }) =>
    href.startsWith("/") ? (
      <Link href={href} className="font-medium text-primary underline-offset-2 hover:underline">
        {children}
      </Link>
    ) : (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
        {children}
      </a>
    ),
  h2: ({ children }) => <h2 className="mt-8 mb-2 text-lg font-semibold text-foreground">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 mb-1.5 text-base font-semibold text-foreground">{children}</h3>,
  p: ({ children }) => <p className="my-3 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-3 list-disc space-y-1.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12.5px] text-foreground">{children}</code>,
  pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-md border bg-panel p-3 text-[12.5px] [&_code]:bg-transparent [&_code]:p-0">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-panel text-left text-xs text-muted-foreground">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-t px-3 py-2 align-top">{children}</td>,
  hr: () => <hr className="my-6" />,
};

type RenderMdx = (props: { components?: MDXComponents }) => React.ReactNode;

/** Runs a compiled MDX function body with the React runtime. MDXContent has no hooks, so it can be called as a function. */
function useMdx(code: string) {
  return useMemo(() => {
    try {
      // The body is produced by our own server from files in /content/help
      const fn = new Function(code) as (rt: typeof runtime) => { default: RenderMdx };
      return fn({ ...runtime }).default;
    } catch {
      return null;
    }
  }, [code]);
}

export function MdxArticle({
  article,
  related,
  onNavigate,
  compact,
}: {
  article: HelpArticle;
  related: HelpMeta[];
  /** When set, related links call this instead of navigating (the drawer) */
  onNavigate?: (slug: string) => void;
  compact?: boolean;
}) {
  const render = useMdx(article.code);
  return (
    <article className="text-sm text-slate-700">
      <h1 className={compact ? "text-lg font-semibold text-foreground" : "text-2xl font-semibold text-foreground"}>{article.title}</h1>
      {render ? render({ components: COMPONENTS }) : <p className="my-3 text-muted-foreground">This article could not be displayed.</p>}
      {related.length > 0 && (
        <section className="mt-10 border-t pt-4">
          <h2 className="text-xs font-medium text-muted-foreground">Related articles</h2>
          <ul className="mt-2 space-y-1.5">
            {related.map((r) => (
              <li key={r.slug}>
                {onNavigate ? (
                  <button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => onNavigate(r.slug)}>
                    {r.title}
                  </button>
                ) : (
                  <Link href={`/help/${r.slug}`} className="font-medium text-primary hover:underline">
                    {r.title}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
