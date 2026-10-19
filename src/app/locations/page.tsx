import type { Metadata } from "next";
import Link from "next/link";
import { MapPin, Tag } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { loadLocations, loadLocationTypes } from "@/lib/locations";
import { buildTree } from "@/lib/location-tree";
import { partCountsByLocation } from "@/lib/location-stats";
import { siblingLabelsByType } from "@/lib/location-siblings";
import { Button } from "@/components/ui/button";
import { AddLocationDialog } from "./add-location-dialog";
import { LocationTree } from "./location-tree";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Locations" };

export default async function LocationsPage() {
  await requireSession();
  const [locations, types, counts] = await Promise.all([
    loadLocations(),
    loadLocationTypes(),
    partCountsByLocation(),
  ]);
  const tree = buildTree(locations);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Locations</h1>
          <p className="text-muted-foreground">
            {locations.length} storage location{locations.length === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="flex gap-2">
          {locations.length > 0 && (
            <Button variant="outline" asChild>
              <Link href="/locations/labels">
                <Tag className="size-4" />
                Labels
              </Link>
            </Button>
          )}
          <AddLocationDialog
            parentId={null}
            parentLabel={null}
            types={types}
            siblingLabels={siblingLabelsByType(locations, null)}
          />
        </div>
      </div>

      {tree.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <MapPin className="size-10 mx-auto mb-3 opacity-50" />
          <p>No locations yet. Add your first shelf, cabinet or drawer.</p>
        </div>
      ) : (
        <LocationTree tree={tree} partCounts={Object.fromEntries(counts)} />
      )}
    </div>
  );
}
