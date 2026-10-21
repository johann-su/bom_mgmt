"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { nextLabels, parseLabel, parsePattern } from "@/lib/label-pattern";
import type { LocationTypeOption } from "@/lib/locations";
import { LocationIcon } from "@/components/location-icon";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createLocations } from "./actions";

// Adds locations inside `parentId` (null = top level): one with a chosen
// label (pre-filled with the next free one), or several at once with
// consecutive labels.
export function AddLocationDialog({
  parentId,
  parentLabel,
  types,
  siblingLabels,
  defaultTypeId,
  trigger,
}: {
  parentId: string | null;
  parentLabel: string | null;
  types: LocationTypeOption[];
  // Existing labels among the new location's would-be siblings (any type).
  siblingLabels: string[];
  defaultTypeId?: string;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(defaultTypeId ?? types[0]?.id ?? "");
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [label, setLabel] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [count, setCount] = useState("6");
  const [pending, startTransition] = useTransition();

  const type = types.find((t) => t.id === typeId);
  const parsed = type ? parsePattern(type.labelPattern) : null;
  const pattern = parsed && !("error" in parsed) ? parsed : null;
  const existing = siblingLabels;
  const bulkCount = Math.min(Math.max(1, Number(count) || 1), 200);
  const suggestions = pattern ? nextLabels(pattern, existing, mode === "bulk" ? bulkCount : 1) : [];
  // The label field shows the suggestion until the user types their own.
  const shownLabel = label ?? suggestions[0] ?? "";
  const labelError =
    mode === "single" && pattern && shownLabel && !parseLabel(pattern, shownLabel)
      ? `Doesn't fit ${pattern.source}`
      : mode === "single" && existing.includes(shownLabel)
        ? "Already exists here"
        : null;

  function reset() {
    setLabel(null);
    setName("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createLocations({
        parentId,
        typeId,
        ...(mode === "single" ? { label: shownLabel, name } : { count: bulkCount }),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.ids!.length === 1 ? "Location added" : `${result.ids!.length} locations added`,
      );
      reset();
      setOpen(false);
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
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus className="size-4" />
            Add location
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{parentLabel ? `Add to ${parentLabel}` : "Add top-level location"}</DialogTitle>
            <DialogDescription>
              Labels follow the type&apos;s pattern; the next free one is suggested.
            </DialogDescription>
          </DialogHeader>

          {types.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create a location type under Settings → Location types first.
            </p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select
                  value={typeId}
                  onValueChange={(v) => {
                    setTypeId(v);
                    setLabel(null);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <LocationIcon name={t.icon} className="size-4" />
                        {t.name}
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.labelPattern}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Tabs value={mode} onValueChange={(v) => setMode(v as "single" | "bulk")}>
                <TabsList className="w-full">
                  <TabsTrigger value="single">One</TabsTrigger>
                  <TabsTrigger value="bulk">Several</TabsTrigger>
                </TabsList>
              </Tabs>

              {mode === "single" ? (
                <div className="grid grid-cols-[8rem_1fr] gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="loc-label">Label</Label>
                    <Input
                      id="loc-label"
                      value={shownLabel}
                      onChange={(e) => setLabel(e.target.value)}
                      className="font-mono"
                      aria-invalid={!!labelError}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="loc-name">Name (optional)</Label>
                    <Input
                      id="loc-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Fasteners"
                    />
                  </div>
                  {labelError && <p className="col-span-2 text-sm text-destructive">{labelError}</p>}
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="loc-count">How many</Label>
                  <Input
                    id="loc-count"
                    type="number"
                    min={1}
                    max={200}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className="w-28"
                  />
                  <div className="flex flex-wrap gap-1">
                    {suggestions.slice(0, 24).map((l) => (
                      <Badge key={l} variant="secondary" className="font-mono">
                        {l}
                      </Badge>
                    ))}
                    {suggestions.length > 24 && (
                      <span className="text-xs text-muted-foreground">
                        … {suggestions.length - 24} more
                      </span>
                    )}
                  </div>
                  {suggestions.length < bulkCount && (
                    <p className="text-sm text-muted-foreground">
                      The pattern only has {suggestions.length} free label(s) left.
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !type || !!labelError || suggestions.length === 0 && mode === "bulk"}
            >
              {pending ? "Adding…" : mode === "bulk" ? `Add ${suggestions.length}` : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
