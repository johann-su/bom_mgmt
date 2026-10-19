"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderInput, Pencil, Trash2 } from "lucide-react";
import { parseLabel, parsePattern } from "@/lib/label-pattern";
import type { LocationOption } from "@/lib/location-tree";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "@/components/confirm-button";
import { LocationPicker, ROOT_VALUE } from "@/components/location-picker";
import { deleteLocation, moveLocation, updateLocation } from "../actions";

type LocationInfo = {
  id: string;
  label: string;
  name: string;
  description: string;
  parentId: string | null;
  labelPattern: string;
};

export function LocationActions({
  location,
  locations,
  descendants,
}: {
  location: LocationInfo;
  locations: LocationOption[];
  // The location's own subtree — not valid move targets.
  descendants: string[];
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"edit" | "move" | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteLocation({ id: location.id });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Location deleted");
      router.push(result.parentId ? `/locations/${result.parentId}` : "/locations");
    });
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" onClick={() => setDialog("edit")}>
        <Pencil className="size-4" />
        Edit
      </Button>
      <Button variant="outline" onClick={() => setDialog("move")}>
        <FolderInput className="size-4" />
        Move
      </Button>
      <ConfirmButton
        title="Delete this location?"
        description="Only empty locations can be deleted — move child locations and stock out first."
        confirmLabel="Delete"
        onConfirm={remove}
      >
        <Button variant="outline" disabled={pending} aria-label="Delete location">
          <Trash2 className="size-4" />
        </Button>
      </ConfirmButton>

      {dialog === "edit" && <EditDialog location={location} onClose={() => setDialog(null)} />}
      {dialog === "move" && (
        <MoveDialog
          location={location}
          locations={locations}
          exclude={new Set(descendants)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function EditDialog({ location, onClose }: { location: LocationInfo; onClose: () => void }) {
  const router = useRouter();
  const [label, setLabel] = useState(location.label);
  const [name, setName] = useState(location.name);
  const [description, setDescription] = useState(location.description);
  const [pending, startTransition] = useTransition();
  const pattern = parsePattern(location.labelPattern);
  const labelOk = "error" in pattern || parseLabel(pattern, label.trim()) !== null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const result = await updateLocation({ id: location.id, label, name, description });
              if (result.error) {
                toast.error(result.error);
                return;
              }
              toast.success("Location updated");
              onClose();
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Edit location</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="edit-label">Label</Label>
              <Input
                id="edit-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="font-mono"
                aria-invalid={!labelOk}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {!labelOk && (
              <p className="col-span-2 text-sm text-destructive">
                Doesn&apos;t fit the pattern <code className="font-mono">{location.labelPattern}</code>
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !labelOk}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MoveDialog({
  location,
  locations,
  exclude,
  onClose,
}: {
  location: LocationInfo;
  locations: LocationOption[];
  exclude: Set<string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(location.parentId ?? ROOT_VALUE);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move location</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Everything inside moves along with it.
        </p>
        <LocationPicker
          locations={locations}
          value={target}
          onChange={setTarget}
          exclude={exclude}
          allowRoot
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending || !target}
            onClick={() =>
              startTransition(async () => {
                const result = await moveLocation({
                  id: location.id,
                  parentId: target === ROOT_VALUE ? null : target,
                });
                if (result.error) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Location moved");
                onClose();
                router.refresh();
              })
            }
          >
            {pending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
