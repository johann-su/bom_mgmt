"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { PartAttribute } from "@/lib/part-attributes";
import type { LocationOption } from "@/lib/location-tree";
import { ACCEPTED_UPLOADS } from "@/lib/file-kind";
import { isNextRedirectError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocationPicker } from "@/components/location-picker";
import { createPart, updatePart } from "./actions";
import { uploadPartFiles } from "./upload";

export type PartFormValues = {
  id?: string;
  name: string;
  description: string;
  categoryId: string | null;
  manufacturer: string;
  mpn: string;
  unit: string;
  minStock: number | null;
  attributes: PartAttribute[];
  notes: string;
};

const EMPTY: PartFormValues = {
  name: "",
  description: "",
  categoryId: null,
  manufacturer: "",
  mpn: "",
  unit: "pcs",
  minStock: null,
  attributes: [],
  notes: "",
};

// Create and edit form. On create it also takes the first stock (location +
// quantity) and files, so a newly bought part is put away in one go.
export function PartForm({
  part,
  categories,
  locations,
}: {
  part?: PartFormValues;
  categories: { id: string; name: string }[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const initial = part ?? EMPTY;
  const [attributes, setAttributes] = useState<PartAttribute[]>(
    initial.attributes.length ? initial.attributes : [{ key: "", value: "" }],
  );
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "none");
  const [locationId, setLocationId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function updateAttribute(index: number, patch: Partial<PartAttribute>) {
    setAttributes((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      name: form.get("name"),
      description: form.get("description"),
      categoryId,
      manufacturer: form.get("manufacturer"),
      mpn: form.get("mpn"),
      unit: form.get("unit"),
      minStock: form.get("minStock"),
      notes: form.get("notes"),
      attributes,
    };
    const uploads = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);

    startTransition(async () => {
      try {
        if (part?.id) {
          const result = await updatePart({ id: part.id, ...values });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Part saved");
          router.push(`/parts/${part.id}`);
          return;
        }
        const result = await createPart({
          ...values,
          initialLocationId: locationId,
          initialQuantity: String(form.get("initialQuantity") ?? ""),
        });
        if (result.error || !result.id) {
          toast.error(result.error ?? "Could not create the part");
          return;
        }
        if (uploads.length) {
          const upload = await uploadPartFiles(result.id, uploads);
          // The part exists either way; say what didn't make it.
          if (upload.error) toast.error(`Part created, but: ${upload.error}`);
        }
        toast.success("Part created");
        router.push(`/parts/${result.id}`);
      } catch (err) {
        if (!isNextRedirectError(err)) toast.error("Something went wrong");
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Part</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              defaultValue={initial.name}
              placeholder="Heat-set insert M3×5"
              required
              autoFocus={!part}
            />
          </div>
          <div className="grid gap-2">
            <Label>Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="unit">Unit</Label>
              <Input id="unit" name="unit" defaultValue={initial.unit} placeholder="pcs" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="minStock">Min. stock</Label>
              <Input
                id="minStock"
                name="minStock"
                type="number"
                min={0}
                step={1}
                defaultValue={initial.minStock ?? ""}
                placeholder="—"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="manufacturer">Manufacturer</Label>
            <Input id="manufacturer" name="manufacturer" defaultValue={initial.manufacturer} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mpn">Manufacturer part number</Label>
            <Input id="mpn" name="mpn" defaultValue={initial.mpn} className="font-mono" />
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" name="description" defaultValue={initial.description} rows={3} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attributes</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {attributes.map((attribute, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input
                value={attribute.key}
                onChange={(e) => updateAttribute(index, { key: e.target.value })}
                placeholder="Thread"
                aria-label="Attribute name"
              />
              <Input
                value={attribute.value}
                onChange={(e) => updateAttribute(index, { value: e.target.value })}
                placeholder="M3"
                aria-label="Attribute value"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Remove attribute"
                onClick={() => setAttributes((prev) => prev.filter((_, i) => i !== index))}
              >
                <X className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAttributes((prev) => [...prev, { key: "", value: "" }])}
            >
              <Plus className="size-4" />
              Add attribute
            </Button>
          </div>
        </CardContent>
      </Card>

      {!part && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Initial stock & files</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="grid gap-2">
              <Label>Location</Label>
              <LocationPicker
                locations={locations}
                value={locationId}
                onChange={setLocationId}
                placeholder="Where is it stored? (optional)"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="initialQuantity">Quantity</Label>
              <Input
                id="initialQuantity"
                name="initialQuantity"
                type="number"
                min={0}
                step={1}
                disabled={!locationId}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="files">Images & datasheets</Label>
              <Input id="files" name="files" type="file" multiple accept={ACCEPTED_UPLOADS} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            name="notes"
            defaultValue={initial.notes}
            rows={4}
            placeholder="Suppliers, order links, usage tips…"
            aria-label="Notes"
          />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : part ? "Save part" : "Create part"}
        </Button>
      </div>
    </form>
  );
}
