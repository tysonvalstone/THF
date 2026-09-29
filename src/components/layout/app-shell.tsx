"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, Gauge, Megaphone, RotateCcw, Sprout, Target } from "lucide-react";
import { useStore } from "@/lib/data/store";
import { TimeTravel, TimeTravelBanner } from "./time-travel";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { USERS } from "@/data/reference/users";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const NAV = [
  { href: "/", label: "Right Now", icon: Gauge },
  { href: "/prospects", label: "Prospects", icon: Target },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/calendar", label: "Season Calendar", icon: CalendarRange },
];

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Sprout className="size-4.5" />
      </span>
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight">HarvestSignal</span>
        <span className="block text-[11px] text-muted-foreground">ThiboLiSoft Sales</span>
      </span>
    </Link>
  );
}

function UserMenu() {
  const { pendingChanges, resetData } = useStore();
  const me = USERS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-full bg-brand-green-dark text-xs font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="User menu"
        >
          {initials(me.Name)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block">{me.Name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{me.Title} · ThiboLiSoft</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Demo data: {pendingChanges ? `${pendingChanges} change${pendingChanges > 1 ? "s" : ""} saved in this browser` : "no changes yet"}
        </DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!pendingChanges}
          onSelect={() => {
            resetData();
            toast.success("Demo data reset", { description: "All records are back to the original seed data." });
          }}
        >
          <RotateCcw className="size-4" />
          Reset demo data
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/prospects" && pathname.startsWith("/accounts")));
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-backdrop-filter:bg-card/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Logo />
          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "relative flex h-14 items-center gap-2 px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
                  isActive(n.href) && "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
                )}
              >
                <n.icon className="size-4" />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <TimeTravel />
            <Button asChild size="sm" className="hidden lg:inline-flex">
              <Link href="/campaigns/new">
                <Megaphone className="size-4" />
                New campaign
              </Link>
            </Button>
            <UserMenu />
          </div>
        </div>
        <nav className="scrollbar-none flex gap-1 overflow-x-auto border-t px-2 md:hidden" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "relative flex h-11 shrink-0 items-center gap-1.5 px-3 text-sm font-medium text-muted-foreground",
                isActive(n.href) && "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary",
              )}
            >
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <TimeTravelBanner />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span>HarvestSignal · built for the ThiboLiSoft hackathon</span>
          <span>Mock Salesforce data. Company and people names are fictional.</span>
        </div>
      </footer>
    </div>
  );
}
