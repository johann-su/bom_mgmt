import { asc } from "drizzle-orm";
import { db } from "@/db";
import { locationTypes } from "@/db/schema";
import { describeAll, type FlatLocation } from "@/lib/location-tree";
import { getCodeSeparator } from "@/lib/settings";

// Every location with its type. A workshop has hundreds of locations, not
// millions, so pages load them all once and work on the tree in memory
// (src/lib/location-tree.ts).
export async function loadLocations(): Promise<FlatLocation[]> {
  const rows = await db.query.locations.findMany({
    columns: { id: true, parentId: true, label: true, name: true },
    with: {
      type: {
        columns: { id: true, name: true, icon: true, labelPattern: true, position: true },
      },
    },
  });
  return rows;
}

export async function loadLocationTypes() {
  return db.query.locationTypes.findMany({
    orderBy: [asc(locationTypes.position), asc(locationTypes.name)],
    columns: { id: true, name: true, icon: true, labelPattern: true, labelTemplateId: true },
  });
}

export type LocationTypeOption = Awaited<ReturnType<typeof loadLocationTypes>>[number];

// Code/path for every location, for pickers.
export async function loadLocationOptions() {
  const [locations, separator] = await Promise.all([loadLocations(), getCodeSeparator()]);
  return describeAll(locations, separator);
}

// False on a fresh database — the cue to send the user through /setup.
export async function hasLocationTypes(): Promise<boolean> {
  const row = await db.query.locationTypes.findFirst({ columns: { id: true } });
  return row !== undefined;
}
