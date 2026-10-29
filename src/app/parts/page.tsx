import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { asc } from "drizzle-orm";
import { FileUp, Package, PackagePlus } from "lucide-react";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { listFilterFacets, listParts, stockLocationsByPart } from "@/lib/part-queries";
import { firstImages } from "@/lib/part-images";
import { loadLocations } from "@/lib/locations";
import { describeAll, subtreeIds } from "@/lib/location-tree";
import { getCodeSeparator } from "@/lib/settings";
import { compileFilters, parseFilterParams, serializeFilter, type PartFilter } from "@/lib/part-filters";
import {
  COLLAPSED_COOKIE,
  groupedPage,
  parseCollapsed,
  PART_SORTS,
  paginate,
  parsePartsView,
  partsViewParams,
  sortParts,
  toggleSort,
  type PartSort,
  type PartsView,
} from "@/lib/parts-list-view";
import { Button } from "@/components/ui/button";
import { PartsFilters } from "./parts-filters";
import { PartsPagination, PartsTable } from "./parts-table";
import { ScanLabelDialog } from "./scan-label-dialog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Parts" };

type SearchParams = Promise<{
  q?: string;
  // Repeated; see src/lib/part-filters.ts for the format.
  f?: string | string[];
  // Older single-purpose filters, still accepted from links and bookmarks.
  category?: string;
  location?: string;
  low?: string;
  unsorted?: string;
  sort?: string;
  dir?: string;
  page?: string;
}>;

export default async function PartsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const params = await searchParams;
  const q = params.q ?? "";
  const view = parsePartsView(params);
  const [flatLocations, separator, cats, facets, rows] = await Promise.all([
    loadLocations(),
    getCodeSeparator(),
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    listFilterFacets(),
    // Only the text search runs in SQL; the filters, sorting and paging run
    // on the whole list in JS (part-filters.ts, parts-list-view.ts). The rows
    // are small, and only the shown page's thumbnails are loaded below.
    listParts({ q, limit: 10_000 }),
  ]);
  const locations = describeAll(flatLocations, separator);

  // Ids that no longer exist (a deleted location in a bookmark) are dropped
  // rather than silently matching nothing.
  const known = { location: new Set(locations.map((l) => l.id)), category: new Set(cats.map((c) => c.id)) };
  const filters = parseFilterParams(params)
    .map((f): PartFilter => {
      if (f.field !== "location" && f.field !== "category") return f;
      return {
        ...f,
        values: f.values.filter((v) => known[f.field as "location" | "category"].has(v) || v === ""),
      };
    })
    .filter((f) => f.field === "unsorted" || f.field === "attr" || f.values.length > 0);

  const where = await stockLocationsByPart(rows.map((r) => r.id));
  const codes = new Map(locations.map((l) => [l.id, { code: l.code, path: l.path }]));
  const matches = compileFilters(filters, (id) => subtreeIds(flatLocations, id));
  const filtered = Boolean(q || filters.length);

  const located = rows
    .map((r) => {
      const ids = where.get(r.id) ?? [];
      return {
        ...r,
        unsorted: ids.includes(null),
        locationIds: ids.filter((id): id is string => id !== null),
        locations: ids
          .map((id) => (id ? codes.get(id) : undefined))
          .filter((l): l is { code: string; path: string } => !!l)
          .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
      };
    })
    .filter(matches);
  const sorted = sortParts(located, view.sort, view.dir);
  // Sorted by category, the list is collapsible sections (parts-list-view.ts).
  const grouped =
    view.sort === "category"
      ? groupedPage(sorted, parseCollapsed((await cookies()).get(COLLAPSED_COOKIE)?.value), view.page)
      : null;
  const paged = grouped
    ? { ...grouped, rows: grouped.items.flatMap((i) => (i.kind === "row" ? [i.row] : [])) }
    : { ...paginate(sorted, view.page), total: sorted.length };
  const thumbs = await firstImages(paged.rows.map((r) => r.id));
  const withThumb = <T extends { id: string }>(r: T) => ({ ...r, thumb: thumbs.get(r.id) ?? null });

  // Links keep the search and filters and change only the view.
  const filterEntries: [string, string][] = [
    ...(q ? [["q", q] as [string, string]] : []),
    ...filters.map((f): [string, string] => ["f", serializeFilter(f)]),
  ];
  const href = (next: PartsView) => {
    const query = new URLSearchParams([
      ...filterEntries,
      ...Object.entries(partsViewParams(next)),
    ]).toString();
    return query ? `/parts?${query}` : "/parts";
  };
  const sortHrefs = Object.fromEntries(PART_SORTS.map((s) => [s, href(toggleSort(view, s))])) as Record<
    PartSort,
    string
  >;
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Parts</h1>
          <p className="text-muted-foreground">
            {located.length} part{located.length === 1 ? "" : "s"}
            {filtered ? " match" + (located.length === 1 ? "es" : "") : " in the inventory"}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ScanLabelDialog locations={locations} />
          <Button variant="outline" asChild>
            <Link href="/parts/import">
              <FileUp className="size-4" />
              Import
            </Link>
          </Button>
          <Button asChild>
            <Link href="/parts/new">
              <PackagePlus className="size-4" />
              New part
            </Link>
          </Button>
        </div>
      </div>

      <PartsFilters
        q={q}
        filters={filters}
        options={{ ...facets, categories: cats, locations }}
        view={partsViewParams({ ...view, page: 1 })}
      />

      {located.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <Package className="size-10 mx-auto mb-3 opacity-50" />
          <p>
            {filtered ? "No parts match these filters." : "No parts yet."}{" "}
            {!filtered && (
              <Link href="/parts/new" className="underline">
                Add your first part.
              </Link>
            )}
          </p>
        </div>
      ) : (
        <>
          <PartsTable
            rows={paged.rows.map(withThumb)}
            sorting={{ view, hrefs: sortHrefs }}
            groups={
              grouped
                ? {
                    items: grouped.items.map((i) => (i.kind === "row" ? { ...i, row: withThumb(i.row) } : i)),
                    all: grouped.groups,
                  }
                : undefined
            }
          />
          <PartsPagination
            {...paged}
            total={paged.total}
            prevHref={paged.page > 1 ? href({ ...view, page: paged.page - 1 }) : null}
            nextHref={paged.page < paged.pageCount ? href({ ...view, page: paged.page + 1 }) : null}
          />
        </>
      )}
    </div>
  );
}
