"use client";

import type { LocationOption } from "@/lib/location-tree";
import { UNSORTED_VALUE } from "@/lib/stock";
import { Combobox } from "@/components/combobox";

export const ROOT_VALUE = "__root__";
// Picks a location by code ("A/1/IV") or path ("Shelf A › Box 1 › Bin IV").
// `allowRoot` adds a "Top level" entry (value ROOT_VALUE) for re-parenting;
// `allowUnsorted` an "Unsorted" one (value UNSORTED_VALUE) for stock that
// isn't put away yet. `current` (location ids / UNSORTED_VALUE) are listed
// first in their own section — e.g. where the part is already stored.
export function LocationPicker({
  locations,
  value,
  onChange,
  exclude,
  allowRoot,
  allowUnsorted,
  current,
  placeholder = "Choose a location…",
  id,
}: {
  locations: LocationOption[];
  value: string | null;
  onChange: (id: string) => void;
  exclude?: Set<string>;
  allowRoot?: boolean;
  allowUnsorted?: boolean;
  current?: Set<string>;
  placeholder?: string;
  id?: string;
}) {
  const all = [
    ...(allowRoot ? [{ value: ROOT_VALUE, label: "Top level", detail: "No parent location" }] : []),
    ...(allowUnsorted && !exclude?.has(UNSORTED_VALUE)
      ? [{ value: UNSORTED_VALUE, label: "Unsorted", detail: "Not put away in a location yet" }]
      : []),
    ...locations
      .filter((l) => !exclude?.has(l.id))
      .map((l) => ({
        value: l.id,
        label: l.name ? `${l.code} · ${l.name}` : l.code,
        detail: l.path,
      })),
  ];
  const pinned = all.filter((o) => current?.has(o.value));
  const options =
    pinned.length === 0
      ? all
      : [
          ...pinned.map((o) => ({ ...o, group: "Stored here" })),
          ...all
            .filter((o) => !current?.has(o.value))
            .map((o) => ({ ...o, group: "Other locations" })),
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
