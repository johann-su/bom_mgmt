"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { LocationOption } from "@/lib/location-tree";
import { changeStock, moveStock } from "@/app/parts/stock-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Combobox, type ComboboxOption } from "@/components/combobox";
import {
  formatStock,
  fromPickerValue,
  levelChoices,
  UNSORTED_VALUE,
  type Tracking,
} from "@/lib/stock";
import { LocationPicker } from "@/components/location-picker";

export type StockMode = "add" | "remove" | "set" | "move" | "level" | "place";

const MODE_LABELS: Record<StockMode, string> = {
  add: "Add",
  remove: "Remove",
  set: "Count",
  move: "Move",
  level: "Set level",
  place: "Store here",
};

export type StockPart = { id: string; name: string; unit: string; tracking: Tracking };

// The modes callers ask for are the counted ones; a level/binary part turns
// add/remove/count into "set level", an untracked one into "store here".
function modeFor(tracking: Tracking, mode: StockMode): StockMode {
  if (mode === "move" || tracking === "exact") return mode;
  return tracking === "none" ? "place" : "level";
}

// One dialog for every stock change. Fix the part (part page), the location
// (location page), or both (a row's "change" button); whatever isn't fixed
// gets a picker. Location values are picker values: UNSORTED_VALUE stands for
// the unsorted pile, and is sent to the actions as null. What the dialog
// offers follows the part's tracking mode (see modeFor).
export function StockDialog({
  part,
  partOptions,
  locationId: fixedLocationId,
  locations,
  stockByLocation = {},
  modes: requestedModes = ["add", "remove", "set", "move"],
  initialMode = "add",
  trigger,
}: {
  part: StockPart | null;
  // Required when `part` is null.
  partOptions?: (ComboboxOption & { unit: string; tracking: Tracking })[];
  locationId?: string;
  locations: LocationOption[];
  // Current stock value of the (fixed) part per picker value (location id,
  // or UNSORTED_VALUE).
  stockByLocation?: Record<string, number>;
  modes?: StockMode[];
  initialMode?: StockMode;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pickedMode, setMode] = useState<StockMode>(initialMode);
  const [partId, setPartId] = useState<string | null>(part?.id ?? null);
  const [locationId, setLocationId] = useState<string | null>(fixedLocationId ?? null);
  const [toLocationId, setToLocationId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const chosenPart =
    part ??
    (partOptions
      ?.filter((o) => o.value === partId)
      .map((o) => ({ id: o.value, name: o.label, unit: o.unit, tracking: o.tracking }))[0] ??
      null);
  const tracking = chosenPart?.tracking ?? "exact";
  const counted = tracking === "exact";
  // Untracked parts have no unsorted pile to move from or into.
  const modes = [...new Set(requestedModes.map((m) => modeFor(tracking, m)))].filter(
    (m) => !(m === "move" && tracking === "none" && fixedLocationId === UNSORTED_VALUE),
  );
  // Picking another part can change the modes on offer.
  const mode = modes.includes(modeFor(tracking, pickedMode))
    ? modeFor(tracking, pickedMode)
    : modes[0];
  const levels = levelChoices(tracking);
  const needsQuantity = mode === "level" || (counted && mode !== "place");
  const current = locationId ? (stockByLocation[locationId] ?? 0) : null;
  const location = locations.find((l) => l.id === locationId);
  const placeLabel =
    locationId === UNSORTED_VALUE
      ? "Unsorted"
      : location && `${location.code}${location.name ? ` · ${location.name}` : ""}`;

  function reset() {
    setQuantity("");
    setNote("");
    setToLocationId(null);
    if (!part) setPartId(null);
    if (!fixedLocationId) setLocationId(null);
    setMode(initialMode);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosenPart || !locationId || (mode === "move" && !toLocationId)) return;
    if (needsQuantity && quantity === "") return;
    startTransition(async () => {
      const result =
        mode === "move"
          ? await moveStock({
              partId: chosenPart.id,
              fromLocationId: fromPickerValue(locationId),
              toLocationId: fromPickerValue(toLocationId!),
              quantity,
              note,
            })
          : await changeStock({
              partId: chosenPart.id,
              locationId: fromPickerValue(locationId),
              mode,
              quantity: mode === "place" ? undefined : quantity,
              note,
            });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Stock updated");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{part ? part.name : "Put a part here"}</DialogTitle>
            <DialogDescription>
              {placeLabel || "Change stock"}
              {current !== null &&
                chosenPart &&
                tracking !== "none" &&
                ` — ${formatStock(tracking, current, chosenPart.unit)} here now`}
            </DialogDescription>
          </DialogHeader>

          {modes.length > 1 && (
            <Tabs value={mode} onValueChange={(v) => setMode(v as StockMode)}>
              <TabsList className="w-full">
                {modes.map((m) => (
                  <TabsTrigger key={m} value={m}>
                    {MODE_LABELS[m]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {!part && partOptions && (
            <div className="grid gap-2">
              <Label>Part</Label>
              <Combobox
                options={partOptions}
                value={partId}
                onChange={setPartId}
                placeholder="Choose a part…"
                searchPlaceholder="Search by name or MPN…"
                emptyText="No part matches."
              />
            </div>
          )}

          {!fixedLocationId && (
            <div className="grid gap-2">
              <Label>{mode === "move" ? "From" : "Location"}</Label>
              <LocationPicker
                locations={locations}
                value={locationId}
                onChange={setLocationId}
                allowUnsorted={tracking !== "none"}
              />
            </div>
          )}

          {mode === "move" && (
            <div className="grid gap-2">
              <Label>To</Label>
              <LocationPicker
                locations={locations}
                value={toLocationId}
                onChange={setToLocationId}
                exclude={locationId ? new Set([locationId]) : undefined}
                allowUnsorted={tracking !== "none"}
              />
            </div>
          )}

          {mode === "level" && (
            <div className="grid gap-2">
              <Label>Level</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Level">
                {levels.map((l) => (
                  <Button
                    key={l.value}
                    type="button"
                    role="radio"
                    aria-checked={quantity === String(l.value)}
                    variant={quantity === String(l.value) ? "default" : "outline"}
                    onClick={() => setQuantity(String(l.value))}
                  >
                    {l.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {mode === "move" && !counted && (
            <p className="text-sm text-muted-foreground">
              {tracking === "none"
                ? "The part will live in the new location instead."
                : "Everything there moves; the new location keeps the better level."}
            </p>
          )}
          {mode === "place" && (
            <p className="text-sm text-muted-foreground">
              Its stock isn&apos;t tracked — this only records where it lives.
            </p>
          )}

          {mode !== "place" && (
            <div className={counted ? "grid grid-cols-[8rem_1fr] gap-3" : "grid"}>
              {counted && (
                <div className="grid gap-2">
                  <Label htmlFor="stock-qty">{mode === "set" ? "Counted" : "Quantity"}</Label>
                  <Input
                    id="stock-qty"
                    type="number"
                    inputMode="numeric"
                    min={mode === "set" ? 0 : 1}
                    step={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="stock-note">Note (optional)</Label>
                <Input
                  id="stock-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={mode === "add" ? "Order #, supplier…" : "Why?"}
                />
              </div>
            </div>
          )}
          {mode === "move" && counted && current !== null && quantity === "" && current > 0 && (
            <Button
              type="button"
              variant="link"
              className="h-auto justify-self-start p-0"
              onClick={() => setQuantity(String(current))}
            >
              Move all {current}
            </Button>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                !chosenPart ||
                !locationId ||
                (mode === "move" && !toLocationId) ||
                (needsQuantity && quantity === "")
              }
            >
              {pending ? "Saving…" : MODE_LABELS[mode]}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
