"use client";

import { Suspense } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderSearch } from "@/components/header-search";
import { ScanLocationButton } from "@/components/scan-location-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { APP_NAME, BrandMark } from "@/components/brand-mark";

type SessionUser = { name: string; email: string };

// Page chrome. Signed-in members get the sidebar app; signed-out visitors
// only ever see the auth pages (the proxy redirects everything else), which
// get a bare header.
export function AppShell({
  user,
  children,
}: {
  user: SessionUser | null;
  children: React.ReactNode;
}) {
  if (!user) {
    return (
      <div className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <BrandMark />
          <span className="font-semibold">{APP_NAME}</span>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar user={user} />
      <SidebarInset>
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger />
          <div className="ml-auto flex w-full max-w-sm items-center gap-1">
            <div className="flex-1">
              {/* useSearchParams needs a boundary to render outside a page. */}
              <Suspense>
                <HeaderSearch />
              </Suspense>
            </div>
            <ScanLocationButton />
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
