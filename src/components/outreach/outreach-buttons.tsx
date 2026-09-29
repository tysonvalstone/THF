"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ScoredTarget } from "@/lib/scoring";
import { recordHref } from "@/lib/links";
import { Button } from "@/components/ui/button";

export function OutreachButtons({ target, size = "sm" }: { target: ScoredTarget; size?: "xs" | "sm" }) {
  return (
    <Button asChild size={size} variant="outline">
      <Link href={recordHref(target.target.id)}>
        Open record <ArrowRight />
      </Link>
    </Button>
  );
}
