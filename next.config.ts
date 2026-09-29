import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Help articles are read from content/help at request time (help pages, the drawer API and the assistant)
  outputFileTracingIncludes: {
    "/help/**": ["./content/help/**/*"],
    "/api/help/**": ["./content/help/**/*"],
    "/api/help": ["./content/help/**/*"],
    "/api/ai": ["./content/help/**/*"],
  },
};

export default nextConfig;
