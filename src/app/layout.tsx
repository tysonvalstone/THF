import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { StoreProvider } from "@/lib/data/store";
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
    default: "HarvestSignal · Seasonal selling for ThiboLiSoft",
    template: "%s · HarvestSignal",
  },
  description:
    "Who to call, why now, and what to send: season-, region- and market-aware prospecting for ag software sales.",
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background">
        <StoreProvider>
          <TooltipProvider delayDuration={150}>
            <AppShell>{children}</AppShell>
            <Toaster position="bottom-right" richColors closeButton />
          </TooltipProvider>
        </StoreProvider>
      </body>
    </html>
  );
}
