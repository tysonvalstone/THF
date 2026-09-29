import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/data/store";
import { AuthProvider } from "@/lib/auth";
import { cookies } from "next/headers";
import { SESSION_COOKIE, readSessionValue } from "@/lib/session";
import { AppShell } from "@/components/layout/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "HarvestSignal",
    template: "%s · HarvestSignal",
  },
  description: "Sales intelligence for grain, feed and processing markets.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const userId = await readSessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <AuthProvider initialUserId={userId}>
          <StoreProvider>
            <TooltipProvider delayDuration={150}>
              <AppShell>{children}</AppShell>
              <Toaster position="bottom-right" offset={{ bottom: 84, right: 20 }} richColors closeButton />
            </TooltipProvider>
          </StoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
