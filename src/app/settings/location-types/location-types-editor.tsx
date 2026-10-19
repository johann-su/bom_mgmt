"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { describePattern, nextLabels, parsePattern } from "@/lib/label-pattern";
import { LOCATION_ICONS } from "@/lib/location-icons";
import { LocationIcon } from "@/components/location-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { ConfirmButton } from "@/components/confirm-button";
import {
  createLocationType,
  deleteLocationType,
  moveLocationType,
  updateLocationType,
} from "./actions";

export type LocationTypeRow = {
  id: string;
  name: string;
  labelPattern: string;
  icon: string;
  usage: number;
};

const PRESETS = [
  { label: "Letters", pattern: "{A}" },
  { label: "Numbers", pattern: "{N}" },
  { label: "Roman", pattern: "{R}" },
  { label: "Padded", pattern: "{NN}" },
  { label: "Grid", pattern: "{A}{N:1-6}" },
];

function preview(pattern: string): { labels: string[]; description: string } | { error: string } {
  const parsed = parsePattern(pattern);
  if ("error" in parsed) return parsed;
  return { labels: nextLabels(parsed, [], 8), description: describePattern(parsed) };
}

export function LocationTypesEditor({ types }: { types: LocationTypeRow[] }) {
  const [editing, setEditing] = useState<LocationTypeRow | "new" | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>, success?: string) {
    startTransition(async () => {
      const { error } = await action();
      if (error) toast.error(error);
      else if (success) toast.success(success);
    });
  }

  return (
    <div className="grid gap-3">
      {types.map((type, index) => {
        const shown = preview(type.labelPattern);
        return (
          <Card key={type.id} className="flex flex-row items-center gap-4 p-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <LocationIcon name={type.icon} className="size-5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{type.name}</span>
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {type.labelPattern}
                </code>
                <span className="text-xs text-muted-foreground">
                  {type.usage} location{type.usage === 1 ? "" : "s"}
                </span>
              </div>
              {"labels" in shown && (
                <div className="mt-1 truncate text-sm text-muted-foreground">
                  {shown.labels.join(", ")}
                  {shown.labels.length === 8 ? ", …" : ""}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Move up"
                disabled={pending || index === 0}
                onClick={() => run(() => moveLocationType({ id: type.id, direction: -1 }))}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Move down"
                disabled={pending || index === types.length - 1}
                onClick={() => run(() => moveLocationType({ id: type.id, direction: 1 }))}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Edit"
                onClick={() => setEditing(type)}
              >
                <Pencil className="size-4" />
              </Button>
              <ConfirmButton
                title={`Delete "${type.name}"?`}
                description="Only types no location uses can be deleted."
                confirmLabel="Delete"
                disabled={pending || type.usage > 0}
                onConfirm={() => run(() => deleteLocationType({ id: type.id }), "Type deleted")}
              >
                <Button variant="ghost" size="icon" aria-label="Delete" disabled={type.usage > 0}>
                  <Trash2 className="size-4" />
                </Button>
              </ConfirmButton>
            </div>
          </Card>
        );
      })}

      <div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" />
          Add location type
        </Button>
      </div>

      {editing && (
        <LocationTypeDialog
          // Remount per target so the form starts from that type's values.
          key={editing === "new" ? "new" : editing.id}
          type={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function LocationTypeDialog({
  type,
  onClose,
}: {
  type: LocationTypeRow | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(type?.name ?? "");
  const [pattern, setPattern] = useState(type?.labelPattern ?? "{N}");
  const [icon, setIcon] = useState(type?.icon ?? "box");
  const [pending, startTransition] = useTransition();
  const shown = preview(pattern);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const input = { name, labelPattern: pattern, icon };
      const { error } = type
        ? await updateLocationType({ id: type.id, ...input })
        : await createLocationType(input);
      if (error) {
        toast.error(error);
        return;
      }
      toast.success(type ? "Location type updated" : "Location type added");
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{type ? "Edit location type" : "New location type"}</DialogTitle>
            <DialogDescription>
              The label pattern decides how locations of this type are named and suggested.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[1fr_10rem] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="type-name">Name</Label>
              <Input
                id="type-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Shelf, Box, Drawer…"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Icon</Label>
              <Select value={icon} onValueChange={setIcon}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LOCATION_ICONS).map(([key, Icon]) => (
                    <SelectItem key={key} value={key}>
                      <Icon className="size-4" />
                      <span className="capitalize">{key}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="type-pattern">Label pattern</Label>
            <Input
              id="type-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="font-mono"
              spellCheck={false}
              aria-invalid={"error" in shown}
              required
            />
            <div className="flex flex-wrap gap-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.pattern}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setPattern(preset.pattern)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            {"error" in shown ? (
              <p className="text-sm text-destructive">{shown.error}</p>
            ) : (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="mb-1.5 text-xs text-muted-foreground">
                  {shown.description} — first labels:
                </div>
                <div className="flex flex-wrap gap-1">
                  {shown.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="font-mono">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Pattern syntax</summary>
              <ul className="mt-2 grid gap-1 pl-1">
                <li>
                  <code className="font-mono">{"{A}"}</code> /{" "}
                  <code className="font-mono">{"{a}"}</code> letters: A … Z, AA, AB …
                </li>
                <li>
                  <code className="font-mono">{"{N}"}</code> numbers;{" "}
                  <code className="font-mono">{"{NN}"}</code> zero-padded to two digits
                </li>
                <li>
                  <code className="font-mono">{"{R}"}</code> /{" "}
                  <code className="font-mono">{"{r}"}</code> roman numerals: I, II, III …
                </li>
                <li>
                  Ranges: <code className="font-mono">{"{N:0-9}"}</code>,{" "}
                  <code className="font-mono">{"{A:A-F}"}</code> — bounded counters roll over,
                  so <code className="font-mono">{"{A}{N:1-6}"}</code> gives A1 … A6, B1 …
                </li>
                <li>
                  Anything else is literal text, e.g.{" "}
                  <code className="font-mono">{"S-{NN}"}</code>; write{" "}
                  <code className="font-mono">{"{{"}</code> for a brace.
                </li>
              </ul>
            </details>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || "error" in shown}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
