"use client";

import { useState } from "react";
import { ArrowLeft, Check, X } from "lucide-react";
import type { LocationOption } from "@/lib/location-tree";
import type { FilterFacets } from "@/lib/part-queries";
import {
  findFilter,
  STOCK_STATUS_LABELS,
  STOCK_STATUSES,
  toggleFilterValue,
  updateFilter,
  type FilterField,
  type PartFilter,
} from "@/lib/part-filters";
import { TRACKING_INFO, TRACKING_MODES } from "@/lib/stock";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type FilterOptions = FilterFacets & {
  categories: { id: string; name: string }[];
  locations: LocationOption[];
};

/** What the panel's right side shows: a field, or one attribute key. */
export type FilterPane = { field: FilterField; key?: string };

type ValueOption = { value: string; label: string; detail?: string };

const FIELD_LABELS: Record<FilterField, string> = {
  stock: "Stock",
  category: "Category",
  location: "Location",
  manufacturer: "Manufacturer",
  tracking: "Tracking",
  unsorted: "Unsorted stock",
  attr: "Attributes",
};

// The panel's field list, in order.
const FIELDS: FilterField[] = [
  "stock",
  "category",
  "location",
  "attr",
  "manufacturer",
  "tracking",
  "unsorted",
];

// One-click filters for the common questions; clicking an active one removes it.
const PRESETS: { label: string; filter: PartFilter }[] = [
  { label: "Needs restock", filter: { field: "stock", negate: false, values: ["empty", "low"] } },
  { label: "Completely empty", filter: { field: "stock", negate: false, values: ["empty"] } },
  { label: "Has unsorted stock", filter: { field: "unsorted", negate: false, values: [] } },
];

const sameFilter = (a: PartFilter | undefined, b: PartFilter) =>
  !!a && a.negate === b.negate && [...a.values].sort().join() === [...b.values].sort().join() && !a.contains;

function valueOptions(pane: FilterPane, options: FilterOptions): ValueOption[] {
  switch (pane.field) {
    case "stock":
      return STOCK_STATUSES.map((s) => ({ value: s, label: STOCK_STATUS_LABELS[s] }));
    case "category":
      return [
        ...options.categories.map((c) => ({ value: c.id, label: c.name })),
        { value: "", label: "Uncategorised" },
      ];
    case "location":
      return options.locations.map((l) => ({
        value: l.id,
        label: l.name ? `${l.code} · ${l.name}` : l.code,
        detail: l.path,
      }));
    case "manufacturer":
      return options.manufacturers.map((m) => ({ value: m, label: m }));
    case "tracking":
      return TRACKING_MODES.map((t) => ({ value: t, label: TRACKING_INFO[t].label }));
    case "attr": {
      const key = pane.key?.toLowerCase();
      const values = options.attributes.find((a) => a.key.toLowerCase() === key)?.values ?? [];
      return values.map((v) => ({ value: v, label: v }));
    }
    case "unsorted":
      return [];
  }
}

/** A filter as one line of text: "Stock is Empty, Low", "Drive is not Hex". */
export function describeFilter(f: PartFilter, options: FilterOptions): string {
  if (f.field === "unsorted") return f.negate ? "No unsorted stock" : "Has unsorted stock";
  if (f.field === "attr" && f.contains)
    return `${f.key} ${f.negate ? "doesn't contain" : "contains"} "${f.contains}"`;
  if (f.field === "attr" && f.values.length === 0) return f.negate ? `No ${f.key}` : `Has ${f.key}`;
  const labels = new Map(valueOptions(f, options).map((o) => [o.value, o.label]));
  // Location chips name the code only; the path is in the picker.
  const names = f.values.map((v) =>
    f.field === "location" ? (options.locations.find((l) => l.id === v)?.code ?? v) : (labels.get(v) ?? v),
  );
  const shown = names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
  const name = f.field === "attr" ? f.key : FIELD_LABELS[f.field];
  const verb = f.field === "location" ? (f.negate ? "not in" : "in") : f.negate ? "is not" : "is";
  return `${name} ${verb} ${shown}`;
}

/** A removable chip for one active filter (describeFilter) or the search. */
export function FilterChip({
  label,
  onOpen,
  onRemove,
}: {
  label: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex h-7 items-center rounded-md border bg-secondary/50 text-sm">
      <button
        type="button"
        onClick={onOpen}
        className="h-full max-w-72 truncate rounded-l-md px-2 hover:bg-secondary"
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        className="h-full rounded-r-md border-l px-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

// The "is / is not" switch at the top of a pane. Before the field has a
// filter, the choice is remembered and used for the first checked value.
function NegateSwitch({
  negate,
  onChange,
  labels,
}: {
  negate: boolean;
  onChange: (negate: boolean) => void;
  labels: [string, string];
}) {
  return (
    <div className="flex rounded-md border p-0.5">
      {[false, true].map((n) => (
        <Button
          key={String(n)}
          size="sm"
          variant={negate === n ? "secondary" : "ghost"}
          className="h-6 px-2 text-xs"
          onClick={() => onChange(n)}
        >
          {n ? labels[1] : labels[0]}
        </Button>
      ))}
    </div>
  );
}

// Typed text for "value contains"; applies on Enter or when focus leaves, not
// per keystroke, since each change is a navigation.
function ContainsInput({ value, onApply }: { value: string; onApply: (text: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onApply(text.trim())}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (text.trim() !== value) onApply(text.trim());
        }
      }}
      placeholder="Value contains… (Enter)"
      aria-label="Value contains"
      className="h-8"
    />
  );
}

// The right side for one field (or attribute key): every value as a
// checkbox row; each click applies at once.
function ValuesPane({
  pane,
  filters,
  onChange,
  options,
  onBack,
}: {
  pane: FilterPane;
  filters: PartFilter[];
  onChange: (next: PartFilter[]) => void;
  options: FilterOptions;
  onBack?: () => void;
}) {
  const current = findFilter(filters, pane.field, pane.key);
  const [pendingNegate, setPendingNegate] = useState(false);
  const negate = current?.negate ?? pendingNegate;
  const values = valueOptions(pane, options);
  const selected = new Set(current?.values ?? []);
  const isAttr = pane.field === "attr";
  const hasAny = isAttr && !!current && current.values.length === 0 && !current.contains;

  function setNegate(n: boolean) {
    if (current)
      onChange(updateFilter(filters, pane.field, pane.key, (c) => (c ? { ...c, negate: n } : null)));
    else setPendingNegate(n);
  }

  function setAttr(next: Partial<PartFilter> | null) {
    onChange(
      updateFilter(filters, "attr", pane.key, (c) =>
        next ? { field: "attr", key: c?.key ?? pane.key, negate, values: [], ...next } : null,
      ),
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {onBack && (
          <Button size="icon" variant="ghost" className="size-6" onClick={onBack} aria-label="All attributes">
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <span className="mr-auto truncate text-sm font-medium">
          {isAttr ? pane.key : FIELD_LABELS[pane.field]}
        </span>
        <NegateSwitch
          negate={negate}
          onChange={setNegate}
          labels={pane.field === "location" ? ["In", "Not in"] : ["Is", "Is not"]}
        />
      </div>
      {isAttr && (
        <div className="space-y-1 border-b p-2">
          <ContainsInput
            key={current?.contains ?? ""}
            value={current?.contains ?? ""}
            onApply={(text) =>
              setAttr(text ? { contains: text } : current?.contains ? null : (current ?? null))
            }
          />
        </div>
      )}
      <Command className="min-h-0 flex-1 rounded-none">
        {values.length > 8 && <CommandInput placeholder={`Search ${values.length}…`} />}
        <CommandList className="max-h-none flex-1">
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup>
            {isAttr && (
              <CommandItem value="__any" onSelect={() => setAttr(hasAny ? null : {})}>
                <Check className={cn("size-4", hasAny ? "opacity-100" : "opacity-0")} />
                <span className="italic">{negate ? "Doesn't have this attribute" : "Any value"}</span>
              </CommandItem>
            )}
            {values.map((o) => (
              <CommandItem
                key={o.value}
                // cmdk matches on `value`; make it unique and searchable.
                value={`${o.label} ${o.detail ?? ""} ${o.value}`}
                onSelect={() => onChange(toggleFilterValue(filters, pane.field, pane.key, o.value, negate))}
              >
                <Check className={cn("size-4", selected.has(o.value) ? "opacity-100" : "opacity-0")} />
                <div className="min-w-0">
                  <div className="truncate">{o.label}</div>
                  {o.detail && <div className="truncate text-xs text-muted-foreground">{o.detail}</div>}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

/**
 * The filter panel: active filters on top, fields on the left, the chosen
 * field's values on the right. Every click applies immediately through
 * `onChange`; the parent keeps the panel open meanwhile.
 */
export function FilterPanel({
  filters,
  onChange,
  options,
  pane,
  onPane,
  pending,
}: {
  filters: PartFilter[];
  onChange: (next: PartFilter[]) => void;
  options: FilterOptions;
  pane: FilterPane;
  onPane: (pane: FilterPane) => void;
  pending: boolean;
}) {
  function count(field: FilterField): number {
    const own = filters.filter((f) => f.field === field);
    if (field === "attr" || field === "unsorted") return own.length;
    return own.reduce((n, f) => n + f.values.length, 0);
  }

  const navItem = (active: boolean) =>
    cn(
      "flex w-full shrink-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
      active && "bg-accent font-medium",
    );

  return (
    <div className="flex h-[min(30rem,75vh)] flex-col">
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 border-b px-3 py-2">
        {filters.length === 0 ? (
          <span className="text-sm text-muted-foreground">No filters — pick values below.</span>
        ) : (
          filters.map((f, i) => (
            <FilterChip
              key={i}
              label={describeFilter(f, options)}
              onOpen={() => onPane({ field: f.field, key: f.key })}
              onRemove={() => onChange(filters.filter((_, j) => j !== i))}
            />
          ))
        )}
        <span className="ml-auto flex items-center gap-2">
          {pending && <span className="text-xs text-muted-foreground">Updating…</span>}
          {filters.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7" onClick={() => onChange([])}>
              Clear all
            </Button>
          )}
        </span>
      </div>
      <div className="grid min-h-0 flex-1 sm:grid-cols-[12rem_1fr]">
        <nav className="flex gap-0.5 overflow-auto border-b p-1.5 max-sm:max-h-24 max-sm:flex-wrap sm:flex-col sm:border-r sm:border-b-0">
          <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground max-sm:hidden">
            Quick
          </div>
          {PRESETS.map((p) => {
            const active = sameFilter(findFilter(filters, p.filter.field), p.filter);
            return (
              <button
                key={p.label}
                type="button"
                className={cn(navItem(false), "max-sm:w-auto")}
                onClick={() => {
                  onChange(
                    updateFilter(filters, p.filter.field, undefined, () => (active ? null : p.filter)),
                  );
                  onPane({ field: p.filter.field });
                }}
              >
                <Check className={cn("size-3.5", active ? "opacity-100" : "opacity-0")} />
                {p.label}
              </button>
            );
          })}
          <div className="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground max-sm:hidden">Fields</div>
          {FIELDS.map((field) => {
            const n = count(field);
            return (
              <button
                key={field}
                type="button"
                className={cn(navItem(pane.field === field), "max-sm:w-auto")}
                onClick={() => onPane({ field })}
              >
                {FIELD_LABELS[field]}
                {n > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 text-xs tabular-nums text-primary-foreground">
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="flex min-h-0 flex-col">
          {pane.field === "unsorted" ? (
            <div className="space-y-1 p-2">
              {(
                [
                  [null, "Any"],
                  [false, "Has unsorted stock"],
                  [true, "Has no unsorted stock"],
                ] as const
              ).map(([negate, label]) => {
                const current = findFilter(filters, "unsorted");
                const active = negate === null ? !current : current?.negate === negate;
                return (
                  <button
                    key={label}
                    type="button"
                    className={navItem(active)}
                    onClick={() =>
                      onChange(
                        updateFilter(filters, "unsorted", undefined, () =>
                          negate === null ? null : { field: "unsorted", negate, values: [] },
                        ),
                      )
                    }
                  >
                    <Check className={cn("size-4", active ? "opacity-100" : "opacity-0")} />
                    {label}
                  </button>
                );
              })}
              <p className="px-2 pt-2 text-xs text-muted-foreground">
                Stock that was added without putting it away in a location.
              </p>
            </div>
          ) : pane.field === "attr" && !pane.key ? (
            <Command className="min-h-0 flex-1 rounded-none">
              <CommandInput placeholder="Search attributes…" />
              <CommandList className="max-h-none flex-1">
                <CommandEmpty>No part has attributes yet.</CommandEmpty>
                <CommandGroup>
                  {options.attributes.map((a) => {
                    const active = !!findFilter(filters, "attr", a.key);
                    return (
                      <CommandItem
                        key={a.key}
                        value={a.key}
                        onSelect={() => onPane({ field: "attr", key: a.key })}
                      >
                        <Check className={cn("size-4", active ? "opacity-100" : "opacity-0")} />
                        {a.key}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {a.values.length} value{a.values.length === 1 ? "" : "s"}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          ) : (
            <ValuesPane
              // A fresh pane per field, so a pending "is not" doesn't carry over.
              key={`${pane.field}:${pane.key ?? ""}`}
              pane={pane}
              filters={filters}
              onChange={onChange}
              options={options}
              onBack={pane.field === "attr" ? () => onPane({ field: "attr" }) : undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}
