"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { LocationIcon } from "@/components/location-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/confirm-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TypeCanvas } from "./type-canvas";
import {
  LocationTypeDialog,
  preview,
  type LocationTypeRow,
  type PendingLink,
} from "./location-type-dialog";
import { deleteLocationType, moveLocationType } from "./actions";

export type { LocationTypeRow } from "./location-type-dialog";

function holds(type: LocationTypeRow, types: LocationTypeRow[]): string {
  if (type.childTypeIds === null) return "Holds any type";
  const names = types.filter((t) => type.childTypeIds!.includes(t.id)).map((t) => t.name);
  return names.length ? `Holds ${names.join(", ")}` : "Holds parts only";
}

export function LocationTypesEditor({
  types,
  separator,
}: {
  types: LocationTypeRow[];
  separator: string;
}) {
  const [editing, setEditing] = useState<LocationTypeRow | "new" | null>(null);
  // A link drawn on the canvas, confirmed (or fixed) in the child's dialog.
  const [link, setLink] = useState<PendingLink | undefined>();
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>, success?: string) {
    startTransition(async () => {
      const { error } = await action();
      if (error) toast.error(error);
      else if (success) toast.success(success);
    });
  }

  const list = (
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
                  {type.usage} location{type.usage === 1 ? "" : "s"} · {holds(type, types)}
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
                onClick={() => {
                  setLink(undefined);
                  setEditing(type);
                }}
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
        <Button
          onClick={() => {
            setLink(undefined);
            setEditing("new");
          }}
        >
          <Plus className="size-4" />
          Add location type
        </Button>
      </div>
    </div>
  );

  return (
    <div>
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="canvas">Canvas</TabsTrigger>
        </TabsList>
        <TabsContent value="list">{list}</TabsContent>
        <TabsContent value="canvas">
          <TypeCanvas
            types={types}
            onEdit={(type) => {
              setLink(undefined);
              setEditing(type);
            }}
            onAdd={() => {
              setLink(undefined);
              setEditing("new");
            }}
            onLink={(child, pending) => {
              setLink(pending);
              setEditing(child ?? "new");
            }}
          />
        </TabsContent>
      </Tabs>

      {editing && (
        <LocationTypeDialog
          // Remount per target so the form starts from that type's values.
          key={`${editing === "new" ? "new" : editing.id}:${link?.parentId ?? ""}`}
          type={editing === "new" ? null : editing}
          types={types}
          separator={separator}
          link={link}
          onClose={() => {
            setEditing(null);
            setLink(undefined);
          }}
        />
      )}
    </div>
  );
}
