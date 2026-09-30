/** Help Center shapes shared by the server loader, the pages and the drawer */

export interface HelpMeta {
  slug: string;
  title: string;
  summary: string;
  order: number;
  related: string[];
}

export interface HelpIndexEntry extends HelpMeta {
  /** Plain text of the body, for search */
  text: string;
}

export interface HelpArticle extends HelpMeta {
  /** MDX compiled to a function body (run with the React JSX runtime) */
  code: string;
}

/** Which article a page's "?" link opens */
export function helpSlugFor(pathname: string): string {
  const rules: [RegExp, string][] = [
    [/^\/$/, "home-dashboard"],
    [/^\/segments/, "segment-prioritization"],
    [/^\/prospects|^\/accounts|^\/leads|^\/opportunities|^\/pipeline|^\/contacts/, "segment-prioritization"],
    [/^\/new-builds/, "new-builds"],
    [/^\/quotes/, "quotes"],
    [/^\/harvest-day/, "harvest-day"],
    [/^\/outreach\/sequences/, "campaigns-sequences"],
    [/^\/outreach/, "exports-templates"],
    [/^\/map/, "map"],
    [/^\/facilities/, "map"],
    [/^\/campaigns/, "campaigns-sequences"],
    [/^\/calendar/, "seasonality-rules"],
    [/^\/templates/, "exports-templates"],
    [/^\/settings/, "getting-started"],
  ];
  return rules.find(([re]) => re.test(pathname))?.[1] ?? "getting-started";
}
