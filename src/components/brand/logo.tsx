import Link from "next/link";
import { cn } from "@/lib/utils";

export const BRAND = {
  name: "HarvestSignal",
  /** Harvest gold: 3.4:1 on white, so the mark holds up as a graphic on light surfaces */
  gold: "#B5821E",
  /** Lighter gold for the mark on the green tile (app icons) */
  goldLight: "#F0C25A",
  green: "#1F5F4A",
  ink: "#0f172a",
} as const;

/** Mark geometry on a 48-unit grid; the viewBox crops it to a 1:2 box */
export const MARK_VIEWBOX = "12 -1 24 48";
export const MARK_STEM_PATH = "M22.9 15H25.1V45.5A1.1 1.1 0 0 1 22.9 45.5Z";
export const MARK_GRAIN_PATH =
  "M22.5 38C23.48 33.81 19.15 28.28 14.19 27.36C13.88 32.4 18.2 37.93 22.5 38Z" +
  "M25.5 38C29.8 37.93 34.12 32.4 33.81 27.36C28.85 28.28 24.52 33.81 25.5 38Z" +
  "M22.5 29.5C23.48 25.31 19.15 19.78 14.19 18.86C13.88 23.9 18.2 29.43 22.5 29.5Z" +
  "M25.5 29.5C29.8 29.43 34.12 23.9 33.81 18.86C28.85 19.78 24.52 25.31 25.5 29.5Z" +
  "M22.5 21C23.48 16.81 19.15 11.28 14.19 10.36C13.88 15.4 18.2 20.93 22.5 21Z" +
  "M25.5 21C29.8 20.93 34.12 15.4 33.81 10.36C28.85 11.28 24.52 16.81 25.5 21Z" +
  "M24 20.5C27.35 18.1 27.35 11.86 24 8.5C20.65 11.86 20.65 18.1 24 20.5Z";
export const MARK_SIGNAL_PATH = "M20.53 6.4A5 5 0 0 1 27.47 6.4M17.4 3.17A9.5 9.5 0 0 1 30.6 3.17";
export const MARK_SIGNAL_WIDTH = 2.4;

/** The wheat-ear mark. `size` is its height; the mark is half as wide. */
export function LogoMark({
  size = 28,
  className,
  decorative = false,
}: {
  size?: number;
  className?: string;
  /** Hide from assistive tech when the wordmark sits next to it */
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox={MARK_VIEWBOX}
      width={size / 2}
      height={size}
      className={cn("shrink-0", className)}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": BRAND.name })}
    >
      <path d={MARK_STEM_PATH} fill={BRAND.gold} />
      <path d={MARK_GRAIN_PATH} fill={BRAND.gold} />
      <path
        d={MARK_SIGNAL_PATH}
        fill="none"
        stroke={BRAND.green}
        strokeWidth={MARK_SIGNAL_WIDTH}
        strokeLinecap="round"
      />
    </svg>
  );
}

const SIZES = {
  sm: { mark: 28, text: "text-[15px]", gap: "gap-1.5" },
  md: { mark: 32, text: "text-lg", gap: "gap-2" },
  lg: { mark: 42, text: "text-[22px]", gap: "gap-2.5" },
} as const;

/** Mark + wordmark lockup. Renders a link when `href` is given. */
export function Logo({
  size = "sm",
  href,
  className,
  compact = false,
}: {
  size?: "sm" | "md" | "lg";
  href?: string;
  className?: string;
  /** Drop the wordmark on very narrow screens (it stays available to screen readers) */
  compact?: boolean;
}) {
  const s = SIZES[size];
  const content = (
    <>
      <LogoMark size={s.mark} decorative />
      <span
        className={cn(
          "font-semibold leading-none tracking-[-0.015em] whitespace-nowrap",
          s.text,
          compact && "max-[359px]:sr-only",
        )}
      >
        <span className="text-foreground">Harvest</span>
        <span className="text-primary">Signal</span>
      </span>
    </>
  );
  const cls = cn("inline-flex shrink-0 items-center", s.gap, className);
  return href ? (
    <Link href={href} className={cls}>
      {content}
    </Link>
  ) : (
    <span className={cls}>{content}</span>
  );
}
