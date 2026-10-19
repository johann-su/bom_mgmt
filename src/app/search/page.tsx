import type { Metadata } from "next";
import Link from "next/link";
import { Search } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { listParts, stockLocationsByPart } from "@/lib/part-queries";
import { firstImages } from "@/lib/part-images";
import { loadLocationOptions } from "@/lib/locations";
import { matchLocations } from "@/lib/location-search";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PartsTable } from "../parts/parts-table";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireSession();
  const { q = "" } = await searchParams;
  const query = q.trim();

  if (!query) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-24 text-center text-muted-foreground">
        <Search className="size-10 mx-auto mb-3 opacity-50" />
        <p>Search parts by name, MPN or attribute, and locations by code (A/1/IV) or name.</p>
      </div>
    );
  }

  const [rows, locations] = await Promise.all([listParts({ q: query, limit: 100 }), loadLocationOptions()]);
  const ids = rows.map((r) => r.id);
  const [thumbs, where] = await Promise.all([firstImages(ids), stockLocationsByPart(ids)]);
  const byId = new Map(locations.map((l) => [l.id, l]));
  const matchingLocations = matchLocations(locations, query).slice(0, 30);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Results for “{query}”</h1>

      {matchingLocations.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Locations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {matchingLocations.map((l) => (
              <Link
                key={l.id}
                href={`/locations/${l.id}`}
                className="rounded-md border px-3 py-1.5 text-sm hover:border-primary/50"
              >
                <span className="font-mono font-medium">{l.code}</span>
                {l.name && <span className="text-muted-foreground"> · {l.name}</span>}
                <div className="text-xs text-muted-foreground">{l.path}</div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <h2 className="text-lg font-semibold mb-3">
        {rows.length} part{rows.length === 1 ? "" : "s"}
      </h2>
      {rows.length > 0 && (
        <PartsTable
          rows={rows.map((r) => ({
            ...r,
            thumb: thumbs.get(r.id) ?? null,
            locations: (where.get(r.id) ?? [])
              .map((id) => byId.get(id))
              .filter((l) => !!l)
              .map((l) => ({ code: l.code, path: l.path })),
          }))}
        />
      )}
    </div>
  );
}
