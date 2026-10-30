import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { locations, locationTypes } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { firstLabel, parsePattern } from "@/lib/label-pattern";
import { getCodeSeparator } from "@/lib/settings";
import { loadLocations, loadLocationTypes } from "@/lib/locations";
import { CodeSeparatorForm } from "./code-separator-form";
import { LocationTypesEditor } from "./location-types-editor";

export const dynamic = "force-dynamic";

export default async function LocationTypesPage() {
  await requireSession();
  const [rows, grammar, all, separator] = await Promise.all([
    db
      .select({
        id: locationTypes.id,
        name: locationTypes.name,
        labelPattern: locationTypes.labelPattern,
        icon: locationTypes.icon,
        canvasX: locationTypes.canvasX,
        canvasY: locationTypes.canvasY,
        usage: count(locations.id),
      })
      .from(locationTypes)
      .leftJoin(locations, eq(locations.typeId, locationTypes.id))
      .groupBy(locationTypes.id)
      .orderBy(asc(locationTypes.position), asc(locationTypes.name)),
    loadLocationTypes(),
    loadLocations(),
    getCodeSeparator(),
  ]);
  const childTypeIds = new Map(grammar.map((t) => [t.id, t.childTypeIds]));
  const types = rows.map((t) => ({
    ...t,
    childTypeIds: childTypeIds.get(t.id) ?? null,
    labels: all.filter((l) => l.type.id === t.id).map((l) => l.label),
  }));
  const sampleLabels = types.flatMap((t) => {
    const parsed = parsePattern(t.labelPattern);
    return "error" in parsed ? [] : [firstLabel(parsed)];
  });

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">Location types</h2>
      <p className="text-sm text-muted-foreground mb-4">
        The kinds of storage in your hierarchy and how each is labeled. By default any type can
        be nested in any other, so a shelf can hold boxes and loose drawers alike; restrict a
        type to say what belongs inside it.
      </p>
      <LocationTypesEditor types={types} separator={separator} />

      <h2 className="text-lg font-semibold mt-8 mb-1">Location codes</h2>
      <p className="text-sm text-muted-foreground mb-4">
        A location&apos;s code is its chain of labels, as searched for and printed on labels.
      </p>
      <CodeSeparatorForm separator={separator} sampleLabels={sampleLabels} />
    </section>
  );
}
