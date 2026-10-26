import type { Metadata } from "next";
import Link from "next/link";
import { asc } from "drizzle-orm";
import { FileUp, Package, PackagePlus } from "lucide-react";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { listParts, stockLocationsByPart } from "@/lib/part-queries";
import { firstImages } from "@/lib/part-images";
import { loadLocationOptions } from "@/lib/locations";
import { Button } from "@/components/ui/button";
import { PartsFilters } from "./parts-filters";
import { PartsTable } from "./parts-table";
import { ScanLabelDialog } from "./scan-label-dialog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Parts" };

type SearchParams = Promise<{ q?: string; category?: string; low?: string; unsorted?: string }>;

export default async function PartsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const { q = "", category = "", low, unsorted } = await searchParams;
  const [cats, rows, locations] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    listParts({ q, categoryId: category || null, lowStock: low === "1", unsorted: unsorted === "1" }),
    loadLocationOptions(),
  ]);
  const ids = rows.map((r) => r.id);
  const [thumbs, where] = await Promise.all([firstImages(ids), stockLocationsByPart(ids)]);
  const codes = new Map(locations.map((l) => [l.id, { code: l.code, path: l.path }]));
  const filtered = Boolean(q || category || low || unsorted);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Parts</h1>
          <p className="text-muted-foreground">
            {rows.length} part{rows.length === 1 ? "" : "s"}
            {filtered ? " match" + (rows.length === 1 ? "es" : "") : " in the inventory"}.
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
        categories={cats}
        q={q}
        category={category}
        low={low === "1"}
        unsorted={unsorted === "1"}
      />

      {rows.length === 0 ? (
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
        <PartsTable
          rows={rows.map((r) => ({
            ...r,
            thumb: thumbs.get(r.id) ?? null,
            unsorted: (where.get(r.id) ?? []).includes(null),
            locations: (where.get(r.id) ?? [])
              .map((id) => (id ? codes.get(id) : undefined))
              .filter((l): l is { code: string; path: string } => !!l)
              .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
          }))}
        />
      )}
    </div>
  );
}
