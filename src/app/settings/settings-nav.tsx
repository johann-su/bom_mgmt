"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Layers, StickyNote, Tags, UserCog, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/settings", label: "Account", icon: UserCog },
  { href: "/settings/location-types", label: "Location types", icon: Layers },
  { href: "/settings/categories", label: "Categories", icon: Tags },
  { href: "/settings/labels", label: "Label templates", icon: StickyNote },
];

// Hidden unless admin; the page enforces it server-side rather than trusting
// the nav.
const usersItem = { href: "/settings/users", label: "Users", icon: Users };

// Hidden unless the instance enables MCP (ENABLE_MCP); the page 404s too.
const mcpItem = { href: "/settings/mcp", label: "AI access", icon: Bot };

export function SettingsNav({ showUsers, showMcp }: { showUsers: boolean; showMcp: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto sm:flex-col sm:gap-0.5">
      {[...items, ...(showMcp ? [mcpItem] : []), ...(showUsers ? [usersItem] : [])].map((item) => {
        // Nested pages (a template's designer) keep their section highlighted.
        const active =
          pathname === item.href || (item.href !== "/settings" && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
