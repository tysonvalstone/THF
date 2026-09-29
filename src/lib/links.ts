export function recordHref(id: string): string {
  return id.startsWith("00Q") ? `/leads/${id}` : `/accounts/${id}`;
}

export function campaignBuilderHref(opts: { regions?: string[]; commodity?: string; types?: string[]; season?: string }): string {
  const p = new URLSearchParams();
  if (opts.regions?.length) p.set("regions", opts.regions.join(","));
  if (opts.commodity) p.set("commodity", opts.commodity);
  if (opts.types?.length) p.set("types", opts.types.join(","));
  if (opts.season) p.set("season", opts.season);
  const q = p.toString();
  return `/campaigns/new${q ? `?${q}` : ""}`;
}
