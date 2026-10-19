import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, locationTypes } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { LocationTypesEditor } from "./location-types-editor";

export const dynamic = "force-dynamic";

export default async function LocationTypesPage() {
  await requireSession();
  const types = await db
    .select({
      id: locationTypes.id,
      name: locationTypes.name,
      labelPattern: locationTypes.labelPattern,
      icon: locationTypes.icon,
      usage: count(locations.id),
    })
    .from(locationTypes)
    .leftJoin(locations, eq(locations.typeId, locationTypes.id))
    .groupBy(locationTypes.id)
    .orderBy(asc(locationTypes.position), asc(locationTypes.name));

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Location types</h2>
      <p className="text-sm text-muted-foreground mb-4">
        The kinds of storage in your hierarchy and how each is labeled. Any type can be nested
        in any other, so a shelf can hold boxes and loose drawers alike.
      </p>
      <LocationTypesEditor types={types} />
    </section>
  );
}
