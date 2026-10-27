"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, ImageIcon, Plus, Sparkles, X } from "lucide-react";
import { resolveSpec } from "@/lib/generic-families";
import type { GeneratedPart, GenericSpec } from "@/lib/generic-parts";
import type { PartAttribute } from "@/lib/part-attributes";
import type { LocationOption } from "@/lib/location-tree";
import { ACCEPTED_UPLOADS } from "@/lib/file-kind";
import { isNextRedirectError } from "@/lib/utils";
import { levelChoices, TRACKING_INFO, TRACKING_MODES, type Tracking } from "@/lib/stock";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { attachShopFiles, createPart, lookupOrderUrl, updatePart } from "./actions";
import { applyGenerated, GENERATED_FIELDS, type GeneratedField } from "@/lib/generic-fill";
import { GenericPartDialog } from "./generic-part-dialog";
import { fillAttributes, shopFiles, suggestCategory, type ShopFile } from "./product-fill";
import { uploadPartFiles } from "./upload";

export type PartFormValues = {
  id?: string;
  name: string;
  description: string;
  categoryId: string | null;
  manufacturer: string;
  mpn: string;
  unit: string;
  tracking: Tracking;
  minStock: number | null;
  orderUrls: string[];
  icon: string;
  attributes: PartAttribute[];
  generic: GenericSpec | null;
  notes: string;
};

const EMPTY: PartFormValues = {
  name: "",
  description: "",
  categoryId: null,
  manufacturer: "",
  mpn: "",
  unit: "pcs",
  tracking: "exact",
  minStock: null,
  orderUrls: [],
  icon: "",
  attributes: [],
  generic: null,
  notes: "",
};

// Fields "Fill from link" may set; it only fills the ones still empty.
const FILLABLE = ["name", "manufacturer", "mpn", "description"] as const;

// Create and edit form. On create it also takes the first stock (location +
// quantity) and files, so a newly bought part is put away in one go.
// `prefill` seeds a new part (e.g. from a scanned bag label); `autoLookup`
// then also runs "Fill from link" right away.
export function PartForm({
  part,
  prefill,
  autoLookup,
  categories,
  locations,
}: {
  part?: PartFormValues;
  prefill?: Partial<PartFormValues> & { initialQuantity?: number };
  autoLookup?: boolean;
  categories: { id: string; name: string }[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = part ?? { ...EMPTY, ...prefill };
  const [attributes, setAttributes] = useState<PartAttribute[]>(
    initial.attributes.length ? initial.attributes : [{ key: "", value: "" }],
  );
  // "new" = create `newCategory` on save (typed, or the shop's suggestion).
  // Supplier product pages, preferred first; one empty row to type into.
  const [orderUrls, setOrderUrls] = useState<string[]>(
    initial.orderUrls.length ? initial.orderUrls : [""],
  );
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "none");
  const [newCategory, setNewCategory] = useState("");
  const [shopCategory, setShopCategory] = useState<string[]>([]);
  // The shop's datasheet/photo, attached after saving unless unticked.
  const [offeredFiles, setOfferedFiles] = useState<(ShopFile & { checked: boolean })[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  // Catalogue icon shown as the thumbnail while the part has no image. Only
  // the "Generic part" wizard sets it (a generic screw or JST housing has no
  // photo worth fetching);
  // editing a part keeps whatever it has.
  const [icon, setIcon] = useState(initial.icon);
  // The wizard choice the part is made from, saved with it so the wizard
  // reopens on it; kept as stored until the wizard fills again.
  const [generic, setGeneric] = useState<GenericSpec | null>(initial.generic);
  const [tracking, setTracking] = useState<Tracking>(initial.tracking);
  // First level of a new level/binary part; "unset" = no stock booked yet.
  const [initialLevel, setInitialLevel] = useState("unset");
  const [pending, startTransition] = useTransition();
  const [lookingUp, startLookup] = useTransition();
  // Which link "Fill from link" is reading, for its button label.
  const [lookupIndex, setLookupIndex] = useState<number | null>(null);

  function updateAttribute(index: number, patch: Partial<PartAttribute>) {
    setAttributes((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  // Selects the existing category matching a shop/standard category path, or
  // proposes creating its leaf. False if the path suggests nothing.
  function applyCategory(path: string[]) {
    const suggestion = suggestCategory(path, categories);
    if (!suggestion) return false;
    if ("id" in suggestion) setCategoryId(suggestion.id);
    else {
      setCategoryId("new");
      setNewCategory(suggestion.name);
    }
    return true;
  }

  // A generic part from the wizard: unlike "Fill from link" it replaces what
  // the wizard filled last time, since the user just chose it — picking
  // again (another material) must update the form. What the user edited
  // since is kept (applyGenerated), judged against the previous choice
  // regenerated from its spec.
  function fillFromGeneric(generated: GeneratedPart, spec: GenericSpec) {
    const form = formRef.current;
    if (!form) return;
    const input = (name: string) =>
      form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
    const restored = generic && resolveSpec(generic);
    const before = restored && restored.type.generate(restored.values);
    const previous = before && !("error" in before) ? before : null;
    const fields = Object.fromEntries(GENERATED_FIELDS.map((name) => [name, input(name)?.value ?? ""]));
    const result = applyGenerated(
      { fields: fields as Record<GeneratedField, string>, icon, attributes },
      previous,
      generated,
    );
    for (const name of GENERATED_FIELDS) {
      const field = input(name);
      if (field) field.value = result.fields[name];
    }
    if (categoryId === "none" || categoryId === "new") applyCategory(generated.category);
    setIcon(result.icon);
    setAttributes(result.attributes);
    setGeneric(spec);
    // Screws and crimp housings aren't worth counting; a new one defaults to
    // a level (the user can still switch back).
    if (!part) setTracking("level");
    if (result.kept.length) {
      const names = result.kept.map((f) => (f === "mpn" ? "MPN" : f));
      toast.info(`Kept your edited ${names.join(", ")}`);
    }
  }

  // Reads the shop page behind one order link and fills empty fields from its
  // product data; anything already typed is kept.
  function fillFromLink(index: number, url: string) {
    const form = formRef.current;
    if (!form) return;
    const field = (name: string) =>
      form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
    setLookupIndex(index);
    startLookup(async () => {
      const result = await lookupOrderUrl({ url });
      if (result.error || !result.product) {
        toast.error(result.error ?? "No product data found");
        return;
      }
      const product = result.product;
      const filled: string[] = [];
      for (const name of FILLABLE) {
        const input = field(name);
        const value = product[name];
        if (input && value && !input.value.trim()) {
          input.value = value;
          filled.push(name === "mpn" ? "MPN" : name);
        }
      }
      if (categoryId === "none" && applyCategory(product.category)) filled.push("category");
      setShopCategory(product.category);
      const added = product.attributes.filter(
        (shop) => !attributes.some((a) => a.key.trim().toLowerCase() === shop.key.toLowerCase()),
      ).length;
      if (added > 0) {
        setAttributes((prev) => fillAttributes(prev, product.attributes));
        filled.push(`${added} attribute${added === 1 ? "" : "s"}`);
      }
      const offered = shopFiles(product, field("name")?.value ?? "");
      setOfferedFiles(offered.map((f) => ({ ...f, checked: true })));
      if (offered.length) filled.push(offered.map((f) => f.label.toLowerCase()).join(" & "));
      if (filled.length) toast.success(`Filled ${filled.join(", ")}`);
      else toast.info("Nothing to fill — those fields are already set");
    });
  }

  // Coming from a scanned label: look the part up once, on arrival.
  const autoLooked = useRef(false);
  useEffect(() => {
    if (!autoLookup || autoLooked.current) return;
    autoLooked.current = true;
    fillFromLink(0, orderUrls[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount
  }, []);

  // Best effort after the part is saved; the part stands either way.
  async function attachOfferedFiles(partId: string) {
    const wanted = offeredFiles.filter((f) => f.checked).map(({ url, name }) => ({ url, name }));
    if (!wanted.length) return;
    const result = await attachShopFiles({ partId, files: wanted });
    if (result.error) toast.error(`Part saved, but: ${result.error}`);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const values = {
      name: form.get("name"),
      description: form.get("description"),
      categoryId,
      newCategory,
      manufacturer: form.get("manufacturer"),
      mpn: form.get("mpn"),
      unit: form.get("unit"),
      tracking,
      // The minimum is a count, so the field is off for other modes; keep the
      // stored one for when the part is counted again.
      minStock: tracking === "exact" ? form.get("minStock") : (initial.minStock ?? ""),
      orderUrls,
      icon,
      generic,
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
          await attachOfferedFiles(part.id);
          toast.success("Part saved");
          router.push(`/parts/${part.id}`);
          return;
        }
        const result = await createPart({
          ...values,
          initialLocationId: locationId,
          initialQuantity:
            tracking === "exact"
              ? String(form.get("initialQuantity") ?? "")
              : // A level picked before switching to binary may not exist there.
                levelChoices(tracking).some((l) => String(l.value) === initialLevel)
                ? initialLevel
                : "",
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
        await attachOfferedFiles(result.id);
        toast.success("Part created");
        router.push(`/parts/${result.id}`);
      } catch (err) {
        if (!isNextRedirectError(err)) toast.error("Something went wrong");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Part</CardTitle>
          <CardAction>
            <GenericPartDialog onFill={fillFromGeneric} allowRange={!part} initial={generic} />
          </CardAction>
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
                <SelectItem value="new">New category…</SelectItem>
              </SelectContent>
            </Select>
            {categoryId === "new" && (
              <Input
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="Category name, e.g. Resistors"
                aria-label="New category name"
                required
              />
            )}
            {shopCategory.length > 0 && (
              <p className="text-xs text-muted-foreground">Shop: {shopCategory.join(" › ")}</p>
            )}
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
                disabled={tracking !== "exact"}
                title={tracking !== "exact" ? "Only counted parts have a minimum" : undefined}
              />
            </div>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label>Stock tracking</Label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Select value={tracking} onValueChange={(v) => setTracking(v as Tracking)}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRACKING_MODES.map((m) => (
                    <SelectItem key={m} value={m}>
                      {TRACKING_INFO[m].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{TRACKING_INFO[tracking].hint}</p>
            </div>
            {part && tracking !== initial.tracking && (
              <p className="text-xs text-muted-foreground">
                {tracking === "exact"
                  ? "Levels aren't counts — every location starts at 0 and needs counting after saving."
                  : tracking === "none"
                    ? "Stored stock is dropped; the locations are kept."
                    : initial.tracking === "exact"
                      ? "Counts become levels: none left is empty, below the minimum is low."
                      : "Levels carry over."}
              </p>
            )}
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
            <Label htmlFor="orderUrl-0">Order links</Label>
            {orderUrls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  id={`orderUrl-${index}`}
                  type="text"
                  inputMode="url"
                  value={url}
                  onChange={(e) =>
                    setOrderUrls((prev) => prev.map((u, i) => (i === index ? e.target.value : u)))
                  }
                  placeholder={
                    index === 0
                      ? "https://… (optional) — where to reorder when it runs low"
                      : "https://… another supplier's product page"
                  }
                  aria-label={`Order link ${index + 1}`}
                  // A row added with + takes the cursor (the first row is there on load).
                  autoFocus={index > 0 && url === ""}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fillFromLink(index, url)}
                  disabled={lookingUp || !url.trim()}
                  title="Fill empty fields from the shop's product page"
                >
                  <Sparkles className="size-4" />
                  {lookingUp && lookupIndex === index ? "Reading…" : "Fill from link"}
                </Button>
                {orderUrls.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove order link"
                    title="Remove this link"
                    onClick={() => setOrderUrls((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <X className="size-4" />
                  </Button>
                )}
                {index === orderUrls.length - 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Add another order link"
                    title="Add another supplier's link"
                    onClick={() => setOrderUrls((prev) => [...prev, ""])}
                  >
                    <Plus className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            {orderUrls.filter((u) => u.trim()).length > 1 && (
              <p className="text-xs text-muted-foreground">
                The first link is the preferred supplier behind the Order button.
              </p>
            )}
            {offeredFiles.length > 0 && (
              <div className="grid gap-1 text-sm">
                <span className="text-muted-foreground">Attach from the shop when saving:</span>
                {offeredFiles.map((file, index) => (
                  <label key={file.url} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={file.checked}
                      onChange={(e) =>
                        setOfferedFiles((prev) =>
                          prev.map((f, i) => (i === index ? { ...f, checked: e.target.checked } : f)),
                        )
                      }
                    />
                    {file.label === "Datasheet" ? (
                      <FileText className="size-4 text-muted-foreground" />
                    ) : (
                      <ImageIcon className="size-4 text-muted-foreground" />
                    )}
                    <a href={file.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                      {file.label}
                    </a>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="description">
              Description <span className="font-normal text-muted-foreground">(Markdown)</span>
            </Label>
            <Textarea id="description" name="description" defaultValue={initial.description} rows={6} />
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
                placeholder="Where is it stored? (empty = unsorted)"
              />
            </div>
            {tracking === "exact" ? (
              <div className="grid gap-2">
                <Label htmlFor="initialQuantity">Quantity</Label>
                <Input
                  id="initialQuantity"
                  name="initialQuantity"
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={prefill?.initialQuantity ?? ""}
                />
              </div>
            ) : tracking !== "none" ? (
              <div className="grid gap-2">
                <Label>Level</Label>
                <Select value={initialLevel} onValueChange={setInitialLevel}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">—</SelectItem>
                    {levelChoices(tracking).map((l) => (
                      <SelectItem key={l.value} value={String(l.value)}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div />
            )}
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
            placeholder="Usage tips, alternatives, …"
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
