"use client";

import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Avatar({ name, photo, size = 32, className }: { name: string; photo?: string; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-slate-100 font-semibold text-slate-700", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local data URL */}
      {photo ? <img src={photo} alt="" className="size-full object-cover" /> : initials(name)}
    </span>
  );
}
