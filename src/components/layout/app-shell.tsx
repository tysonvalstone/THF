"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { SeasonBar } from "./season-bar";
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
import { useAuth } from "@/lib/auth";
import { Avatar } from "@/components/auth/avatar";
import { LoginScreen } from "@/components/auth/login-screen";
import { ChatPanel, useChatOpen } from "@/components/ai/chat-panel";
import { cn } from "@/lib/utils";

/** Top-level sections; each section's pages show as tabs under the header */
const NAV: { href: string; label: string; tabs: [string, string][]; also: string[] }[] = [
  { href: "/", label: "Home", tabs: [["/", "Overview"], ["/segments", "Segments"], ["/prospects", "Prospects"]], also: ["/accounts", "/leads", "/opportunities", "/settings"] },
  { href: "/map", label: "Map", tabs: [["/map", "Map"], ["/facilities", "Facilities"]], also: [] },
  { href: "/campaigns", label: "Campaigns", tabs: [["/campaigns", "Campaigns"], ["/campaigns/sequences", "Sequences"], ["/calendar", "Calendar"]], also: [] },
  { href: "/templates", label: "Templates", tabs: [["/templates/exports", "Exports"]], also: [] },
];

const within = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function sectionFor(pathname: string) {
  return NAV.find((n) => n.tabs.some(([href]) => within(pathname, href)) || n.also.some((href) => within(pathname, href))) ?? NAV[0];
}

function SectionTabs({ pathname }: { pathname: string }) {
  const section = sectionFor(pathname);
  // Only on the section's own pages (not record pages), and only when there is a choice
  const current = section.tabs.find(([href]) => pathname === href);
  if (section.tabs.length < 2 || !current) return null;
  return (
    <nav className="mx-auto flex w-full max-w-[1400px] gap-5 border-b px-4" aria-label={`${section.label} pages`}>
      {section.tabs.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={href === current[0] ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 border-transparent py-2.5 text-sm text-muted-foreground hover:text-foreground",
            href === current[0] && "border-primary font-medium text-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

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
  const { user, me: profile, signOut } = useAuth();
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50" aria-label="User menu">
          <Avatar name={user.Name} photo={profile.photo} size={32} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block">{user.Name}</span>
          {profile.email && <span className="block text-xs font-normal text-muted-foreground">{profile.email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
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
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { error } = useStore();
  const auth = useAuth();
  const chatOpen = useChatOpen();
  if (pathname === "/login") return <>{children}</>;
  if (!auth.user) return <LoginScreen />;
  const active = sectionFor(pathname).href;
  const isActive = (href: string) => href === active;
  return (
    <div className={cn("flex min-h-full flex-col", chatOpen && "lg:pr-[400px]")}>
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
        <SeasonBar />
      </header>
      {error && (
        <div className="border-b border-status-critical/30 bg-card px-4 py-2 text-center text-sm text-status-critical" role="alert">
          {error}
        </div>
      )}
      <SectionTabs pathname={pathname} />
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-20">{children}</main>
      <ChatPanel />
    </div>
  );
}
