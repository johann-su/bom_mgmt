import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Tag } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { loadLocations, loadLocationTypes } from "@/lib/locations";
import { buildTree } from "@/lib/location-tree";
import { partCountsByLocation } from "@/lib/location-stats";
import { siblingLabels } from "@/lib/location-siblings";
import { buildLayout } from "@/lib/location-layout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddLocationDialog } from "./add-location-dialog";
import { LocationLayout } from "./location-layout";
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
  // No types means nothing can be created yet — run the wizard first.
  if (types.length === 0) redirect("/setup");
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
            siblingLabels={siblingLabels(locations, null)}
          />
        </div>
      </div>

      {tree.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <MapPin className="size-10 mx-auto mb-3 opacity-50" />
          <p>No locations yet. Add your first shelf, cabinet or drawer.</p>
        </div>
      ) : (
        <Tabs defaultValue="tree">
          <TabsList>
            <TabsTrigger value="tree">Tree</TabsTrigger>
            <TabsTrigger value="layout">Layout</TabsTrigger>
          </TabsList>
          <TabsContent value="tree">
            <LocationTree tree={tree} partCounts={Object.fromEntries(counts)} />
          </TabsContent>
          <TabsContent value="layout">
            <LocationLayout layout={buildLayout(locations)} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
