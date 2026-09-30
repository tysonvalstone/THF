"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { useStore } from "@/lib/data/store";
import { SeasonBar } from "./season-bar";
import { Logo as BrandLogo } from "@/components/brand/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_ROLES, APP_ROLE_LABEL, type AppRole } from "@/lib/supabase/config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { Avatar } from "@/components/auth/avatar";
import { ChatPanel, useChatOpen } from "@/components/ai/chat-panel";
import { cn } from "@/lib/utils";
import { ChevronRight, CircleHelp } from "lucide-react";
import { ApprovalsInbox } from "./approvals-inbox";
import { LifecycleAutomation } from "./lifecycle-automation";
import { ScheduleCallHost } from "@/components/call-desk/schedule-call";
import { Fragment } from "react";
import { HelpDrawer, openHelp } from "@/components/help/help-drawer";
import { helpSlugFor } from "@/lib/help/types";

/** Top-level sections; each section's pages show as tabs under the header */
const NAV: { href: string; label: string; tabs: [string, string][]; also: string[]; separate?: boolean }[] = [
  {
    href: "/",
    label: "Home",
    tabs: [["/", "Overview"], ["/pipeline", "Pipeline"], ["/prospects", "Prospects"], ["/contacts", "Contacts"], ["/segments", "Segments"]],
    also: ["/accounts", "/leads", "/opportunities", "/settings"],
  },
  { href: "/map", label: "Map", tabs: [["/map", "Map"], ["/facilities", "Facilities"], ["/new-builds", "New Builds"]], also: [] },
  { href: "/campaigns", label: "Campaigns", tabs: [["/campaigns", "Campaigns"], ["/calendar", "Calendar"]], also: [] },
  { href: "/outreach/sequences", label: "Outreach", tabs: [["/outreach/sequences", "Sequences"], ["/outreach/exports", "Export templates"]], also: ["/outreach"] },
  { href: "/call-desk", label: "Call Desk", tabs: [["/call-desk", "Today"], ["/call-desk/history", "Past calls"]], also: [] },
  { href: "/quotes", label: "Quoting", tabs: [["/quotes", "Quotes"], ["/contracts", "Contracts"], ["/quotes/products", "Products"], ["/quotes/price-books", "Price books"]], also: [] },
  {
    href: "/finance",
    label: "Finance",
    tabs: [["/finance", "Revenue"], ["/finance/invoices", "Invoices"], ["/finance/forecast", "Forecast"], ["/finance/commissions", "Commissions"]],
    also: [],
  },
  { href: "/customers", label: "Customers", tabs: [["/customers", "Health"], ["/customers/onboarding", "Onboarding"], ["/customers/renewals", "Renewals"]], also: [] },
  { href: "/harvest-day", label: "Harvest Day", tabs: [["/harvest-day", "Simulator"]], also: [], separate: true },
];

/** Tabs limited to certain roles (everything else is open to all roles) */
const TAB_ROLES: Record<string, AppRole[]> = {
  "/finance": ["manager", "finance", "admin"],
  "/finance/invoices": ["manager", "finance", "admin"],
  "/finance/forecast": ["rep", "manager", "finance", "admin"],
  "/finance/commissions": ["rep", "manager", "finance", "admin"],
};
const tabAllowed = (href: string, role: AppRole) => !TAB_ROLES[href] || TAB_ROLES[href].includes(role);

/** Navigation for a role: hidden tabs removed, sections with no tabs left removed */
function navFor(role: AppRole) {
  return NAV.map((n) => {
    const tabs = n.tabs.filter(([href]) => tabAllowed(href, role));
    return { ...n, tabs, href: tabs.some(([h]) => h === n.href) ? n.href : (tabs[0]?.[0] ?? n.href) };
  }).filter((n) => n.tabs.length > 0);
}

const within = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`));

function sectionFor(pathname: string) {
  if (within(pathname, "/help")) return null;
  return NAV.find((n) => n.tabs.some(([href]) => within(pathname, href)) || n.also.some((href) => within(pathname, href))) ?? NAV[0];
}

/** Section tabs (when the section has several pages) and the page's help link */
function SectionTabs({ pathname }: { pathname: string }) {
  const { role } = useAuth();
  const found = sectionFor(pathname);
  const section = found && { ...found, tabs: found.tabs.filter(([href]) => tabAllowed(href, role)) };
  if (!section) return null;
  // Tabs only on the section's own pages (not record pages), and only when there is a choice
  const current = section.tabs.find(([href]) => pathname === href);
  const showTabs = section.tabs.length > 1 && !!current;
  return (
    <div className="border-b">
      <div className="mx-auto flex w-full max-w-[1400px] items-center gap-5 px-4">
        {showTabs && (
          <nav className="flex gap-5" aria-label={`${section.label} pages`}>
            {section.tabs.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={href === current![0] ? "page" : undefined}
                className={cn(
                  "-mb-px border-b-2 border-transparent py-2.5 text-sm text-muted-foreground hover:text-foreground",
                  href === current![0] && "border-primary font-medium text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
        <button
          type="button"
          onClick={() => openHelp(helpSlugFor(pathname))}
          className="ml-auto flex h-10 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Help for this page"
        >
          <CircleHelp className="size-3.5" aria-hidden />
          Help
        </button>
      </div>
    </div>
  );
}

export function Logo() {
  return <BrandLogo href="/" size="sm" compact className="rounded-md" />;
}

function DataBadge() {
  const { mode, loadedAt, refreshing, refresh, warnings, ready } = useStore();
  const { isGuest } = useAuth();
  const live = mode === "live";
  if (isGuest) {
    return (
      <span className="hidden h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium text-muted-foreground sm:inline-flex">
        <span className="size-1.5 rounded-full bg-slate-400" aria-hidden />
        Guest · Demo data
      </span>
    );
  }
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
        className="hidden 2xl:inline-flex"
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
  const { user, me: profile, signOut, session, isAdmin, role, canSwitchRole, setRole } = useAuth();
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
          {(session?.mode === "supabase" ? session.email : profile.email) && (
            <span className="block text-xs font-normal text-muted-foreground">{session?.mode === "supabase" ? session.email : profile.email}</span>
          )}
          {isAdmin && <span className="mt-1 block text-xs font-normal text-primary">Administrator</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">Settings</Link>
        </DropdownMenuItem>
        {isAdmin && session?.mode === "supabase" && (
          <DropdownMenuItem asChild>
            <Link href="/settings?tab=users">Users</Link>
          </DropdownMenuItem>
        )}
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
        {canSwitchRole && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">View as</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={role} onValueChange={(v) => setRole(v as AppRole)}>
              {APP_ROLES.map((r) => (
                <DropdownMenuRadioItem key={r} value={r} onSelect={(e) => e.preventDefault()}>
                  {APP_ROLE_LABEL[r]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
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
  // Sign-in and password pages render on their own, without the app chrome
  if (pathname === "/login" || pathname.startsWith("/auth/") || pathname === "/account/password" || pathname.startsWith("/share/") || !auth.user) return <>{children}</>;
  const active = sectionFor(pathname)?.label;
  const nav = navFor(auth.role);
  const isActive = (label: string) => label === active;
  return (
    <div className={cn("flex min-h-full flex-col", chatOpen && "lg:pr-[400px]")}>
      <header className="sticky top-0 z-40 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-6 px-4">
          <Logo />
          {/* The sales workflow, left to right, spread across the header */}
          <nav className="hidden min-w-0 flex-1 items-center xl:flex" aria-label="Main">
            {nav.map((n, i) => (
              <Fragment key={n.href}>
                {i > 0 &&
                  (n.separate ? (
                    <span className="mx-2 h-5 w-px shrink-0 bg-border" aria-hidden />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-slate-300" aria-hidden />
                  ))}
                <Link
                  href={n.href}
                  className={cn(
                    "flex-1 rounded-md px-2 py-1.5 text-center text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground",
                    isActive(n.label) && "bg-accent-soft font-medium text-primary hover:bg-accent-soft hover:text-primary",
                  )}
                  aria-current={isActive(n.label) ? "page" : undefined}
                >
                  {n.label}
                </Link>
              </Fragment>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2 xl:ml-0">
            <DataBadge />
            <ApprovalsInbox />
            <Link
              href="/help"
              aria-label="Help Center"
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                pathname.startsWith("/help") && "bg-accent-soft text-primary",
              )}
            >
              <CircleHelp className="size-[18px]" aria-hidden />
            </Link>
            <UserMenu />
          </div>
        </div>
        <nav className="scrollbar-none flex gap-1 overflow-x-auto border-t px-2 py-1.5 xl:hidden" aria-label="Main">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn("flex-1 shrink-0 rounded-md px-2.5 py-1 text-center text-sm whitespace-nowrap text-muted-foreground", isActive(n.label) && "bg-accent-soft font-medium text-primary")}
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
      <HelpDrawer />
      <LifecycleAutomation />
      <ScheduleCallHost />
    </div>
  );
}
