"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { TimeTravel } from "./time-travel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { USERS } from "@/data/reference/users";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/segments", label: "Segments" },
  { href: "/prospects", label: "Prospects" },
  { href: "/facilities", label: "Facilities" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/calendar", label: "Calendar" },
];

export function Logo() {
  return (
    <Link href="/" className="text-[15px] font-semibold text-foreground">
      HarvestSignal
    </Link>
  );
}

function DataBadge() {
  const { mode, loadedAt, refreshing, refresh, warnings, ready } = useStore();
  const live = mode === "live";
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium",
              live ? "border-primary/40 text-primary" : "border-border text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", live ? "bg-primary" : "bg-slate-400")} aria-hidden />
            {live ? "Live Salesforce" : "Mock data"}
          </span>
        </TooltipTrigger>
        <TooltipContent>{loadedAt ? `Loaded ${new Date(loadedAt).toLocaleString()}${warnings.length ? ` · ${warnings.length} warning(s)` : ""}` : "Loading"}</TooltipContent>
      </Tooltip>
      <Button
        variant="ghost"
        size="sm"
        className="hidden lg:inline-flex"
        disabled={refreshing || !ready}
        onClick={async () => {
          await refresh();
          toast.success("Data refreshed");
        }}
      >
        {refreshing ? "Refreshing…" : "Refresh data"}
      </Button>
    </div>
  );
}

function UserMenu() {
  const { pendingChanges, resetData, readOnly } = useStore();
  const me = USERS[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-8 items-center justify-center rounded-md border bg-card text-xs font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-label="User menu"
        >
          {initials(me.Name)}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block">{me.Name}</span>
          <span className="block text-xs font-normal text-muted-foreground">{me.Title}, ThiboLiSoft</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {readOnly ? "Read-only" : `${pendingChanges} local change${pendingChanges === 1 ? "" : "s"}`}
        </DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!pendingChanges || readOnly}
          onSelect={() => {
            resetData();
            toast.success("Local changes reset");
          }}
        >
          Reset local changes
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { error } = useStore();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href) || (href === "/prospects" && (pathname.startsWith("/accounts") || pathname.startsWith("/leads")));
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                  isActive(n.href) && "bg-accent-soft font-medium text-primary hover:bg-accent-soft hover:text-primary",
                )}
                aria-current={isActive(n.href) ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <DataBadge />
            <TimeTravel />
            <UserMenu />
          </div>
        </div>
        <nav className="scrollbar-none flex gap-1 overflow-x-auto border-t px-2 py-1.5 md:hidden" aria-label="Main">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1 text-sm text-muted-foreground",
                isActive(n.href) && "bg-accent-soft font-medium text-primary",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      {error && (
        <div className="border-b border-status-critical/30 bg-card px-4 py-2 text-center text-sm text-status-critical" role="alert">
          {error}
        </div>
      )}
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-12">{children}</main>
    </div>
  );
}
