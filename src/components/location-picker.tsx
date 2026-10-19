"use client";

import type { LocationOption } from "@/lib/location-tree";
import { Combobox } from "@/components/combobox";

export const ROOT_VALUE = "__root__";

// Picks a location by code ("A/1/IV") or path ("Shelf A › Box 1 › Bin IV").
// `allowRoot` adds a "Top level" entry (value ROOT_VALUE) for re-parenting.
export function LocationPicker({
  locations,
  value,
  onChange,
  exclude,
  allowRoot,
  placeholder = "Choose a location…",
  id,
}: {
  locations: LocationOption[];
  value: string | null;
  onChange: (id: string) => void;
  exclude?: Set<string>;
  allowRoot?: boolean;
  placeholder?: string;
  id?: string;
}) {
  const options = [
    ...(allowRoot ? [{ value: ROOT_VALUE, label: "Top level", detail: "No parent location" }] : []),
    ...locations
      .filter((l) => !exclude?.has(l.id))
      .map((l) => ({
        value: l.id,
        label: l.name ? `${l.code} · ${l.name}` : l.code,
        detail: l.path,
      })),
  ];
  return (
    <Combobox
      id={id}
      options={options}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      searchPlaceholder="Search by code, path or name…"
      emptyText="No location matches."
    />
  );
}
