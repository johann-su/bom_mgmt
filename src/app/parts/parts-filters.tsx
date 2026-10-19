"use client";

import { useRouter, usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Filters live in the URL (?q=&category=&low=1) so a filtered list can be
// bookmarked and the server renders it directly.
export function PartsFilters({
  categories,
  q,
  category,
  low,
}: {
  categories: { id: string; name: string }[];
  q: string;
  category: string;
  low: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();

  function navigate(next: { q?: string; category?: string; low?: boolean }) {
    const params = new URLSearchParams();
    const merged = { q, category, low, ...next };
    if (merged.q) params.set("q", merged.q);
    if (merged.category) params.set("category", merged.category);
    if (merged.low) params.set("low", "1");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-56 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          navigate({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
        }}
      >
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          key={q}
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Filter by name, MPN, manufacturer, attribute…"
          className="pl-8"
          aria-label="Filter parts"
        />
      </form>
      <Select value={category || "all"} onValueChange={(v) => navigate({ category: v === "all" ? "" : v })}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant={low ? "default" : "outline"}
        onClick={() => navigate({ low: !low })}
        aria-pressed={low}
      >
        Low stock
      </Button>
    </div>
  );
}
