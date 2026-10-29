"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ListFilter, Search, X } from "lucide-react";
import { serializeFilter, type PartFilter } from "@/lib/part-filters";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  describeFilter,
  FilterChip,
  FilterPanel,
  type FilterOptions,
  type FilterPane,
} from "./parts-filter-panel";

export type { FilterOptions } from "./parts-filter-panel";

// Search and filters live in the URL (?q=&f=stock:empty,low&f=attr.Drive~hex,
// format in src/lib/part-filters.ts) so a filtered list can be bookmarked and
// the server renders it directly. Changing either keeps the sort (`view`) and
// goes back to the first page.
export function PartsFilters({
  q,
  filters,
  options,
  view,
}: {
  q: string;
  filters: PartFilter[];
  options: FilterOptions;
  view: Record<string, string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<FilterPane>({ field: "stock" });
  // While the panel is open its edits are the truth: each click navigates,
  // and a quick second click mustn't be undone by the first one's render.
  const [draft, setDraft] = useState(filters);
  const shown = open ? draft : filters;

  function navigate(next: { q?: string; filters?: PartFilter[] }) {
    const params = new URLSearchParams();
    const query = next.q ?? q;
    if (query) params.set("q", query);
    for (const f of next.filters ?? shown) params.append("f", serializeFilter(f));
    for (const [key, value] of Object.entries(view)) params.set(key, value);
    const search = params.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname, { scroll: false }));
  }

  function apply(next: PartFilter[]) {
    setDraft(next);
    navigate({ filters: next });
  }

  function openPanel(at?: FilterPane) {
    setDraft(filters);
    if (at) setPane(at);
    setOpen(true);
  }

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
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
            placeholder="Search by name, MPN, manufacturer, attribute…"
            className="pl-8"
            aria-label="Search parts"
          />
        </form>
        <Popover open={open} onOpenChange={(next) => (next ? openPanel() : setOpen(false))}>
          <PopoverTrigger asChild>
            <Button variant={filters.length ? "secondary" : "outline"}>
              <ListFilter className="size-4" />
              Filter
              {filters.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
                  {filters.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[44rem] max-w-[calc(100vw-2rem)] p-0" align="end">
            <FilterPanel
              filters={draft}
              onChange={apply}
              options={options}
              pane={pane}
              onPane={setPane}
              pending={pending}
            />
          </PopoverContent>
        </Popover>
      </div>
      {(filters.length > 0 || q) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-sm text-muted-foreground">Filtered by</span>
          {q && (
            <FilterChip
              label={`Search "${q}"`}
              onOpen={() => document.querySelector<HTMLInputElement>('input[name="q"]')?.focus()}
              onRemove={() => navigate({ q: "" })}
            />
          )}
          {filters.map((f, i) => (
            <FilterChip
              key={`${i}:${serializeFilter(f)}`}
              label={describeFilter(f, options)}
              onOpen={() => openPanel({ field: f.field, key: f.key })}
              onRemove={() => navigate({ filters: filters.filter((_, j) => j !== i) })}
            />
          ))}
          <Button variant="ghost" size="sm" className="h-7" onClick={() => navigate({ q: "", filters: [] })}>
            <X className="size-4" />
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
