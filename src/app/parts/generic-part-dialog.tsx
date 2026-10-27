"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Shapes } from "lucide-react";
import { isIconAttribute } from "@/lib/part-attributes";
import { GENERIC_FAMILIES, resolveSpec } from "@/lib/generic-families";
import {
  rangeParam,
  resolveValues,
  sortRange,
  specFor,
  type GeneratedPart,
  type GenericSpec,
  type GenericValues,
} from "@/lib/generic-parts";
import { loadIcons, type LabelIcon } from "@/lib/label-icons";
import { cn } from "@/lib/utils";
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
import { createGenericParts } from "./actions";

// "Generic part": pick a family (fasteners, connectors), a type and its
// parameters (src/lib/generic-parts.ts). One value of the range parameter
// (length, pin count) fills the part form; several — only offered for a new
// part — create a part each right away. `initial` is the choice the part was
// made from (parts.generic); the dialog opens on it, so editing a screw's
// material is a change of one select.
export function GenericPartDialog({
  onFill,
  allowRange,
  initial,
}: {
  onFill: (part: GeneratedPart, spec: GenericSpec) => void;
  allowRange: boolean;
  initial: GenericSpec | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [familyId, setFamilyId] = useState(GENERIC_FAMILIES[0].id);
  // The type picked in each family, so switching tabs back keeps it.
  const [typeIds, setTypeIds] = useState<Record<string, string>>({});
  // One value map for every type: shared ids (size, material, pins) carry
  // over when switching type, and resolveValues drops what doesn't apply.
  const [rawValues, setRawValues] = useState<GenericValues>({});
  // Chosen range values (lengths, pin counts) per parameter id.
  const [ranges, setRanges] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState("");
  const [pending, startTransition] = useTransition();
  // The label-icon catalogue is large; it's fetched the first time the dialog opens.
  const [icons, setIcons] = useState<Map<string, LabelIcon> | null>(null);
  useEffect(() => {
    if (!open || icons) return;
    loadIcons().then((all) => setIcons(new Map(all.map((i) => [i.id, i]))));
  }, [open, icons]);
  const iconsFor = (ids: string[]) => ids.flatMap((id) => icons?.get(id) ?? []);
  // A stored choice the wizard can't offer any more (a renamed option): the
  // dialog says so and starts from defaults rather than guessing.
  const restored = initial && resolveSpec(initial);
  const stale = initial !== null && !restored;

  // Each opening starts on the part's stored choice; without one, the last
  // choice made in this form is kept.
  function changeOpen(next: boolean) {
    if (next && initial && restored) {
      const range = rangeParam(restored.type.params(restored.values));
      setFamilyId(initial.family);
      setTypeIds((prev) => ({ ...prev, [initial.family]: initial.type }));
      setRawValues(restored.values);
      setRanges(range ? { [range.id]: [restored.values[range.id]] } : {});
    }
    setOpen(next);
  }

  const family = GENERIC_FAMILIES.find((f) => f.id === familyId) ?? GENERIC_FAMILIES[0];
  const type = family.types.find((t) => t.id === typeIds[family.id]) ?? family.types[0];
  const { values, params } = resolveValues(type, rawValues);
  const range = rangeParam(params);
  // Only values valid for this type: pin counts are shared between series,
  // and 40 pins on a header isn't a Dupont housing.
  const chosen = range ? sortRange((ranges[range.id] ?? []).filter((v) => range.parse(v) !== null)) : [];
  const chips = range ? sortRange([...range.options, ...chosen]) : [];
  const previews = range
    ? chosen.map((value) => type.generate({ ...values, [range.id]: value }))
    : [type.generate(values)];
  const single = previews.length === 1 ? previews[0] : null;

  function toggle(value: string) {
    if (!range) return;
    setRanges((prev) => {
      const current = prev[range.id] ?? [];
      const next = !allowRange
        ? [value]
        : current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
      return { ...prev, [range.id]: next };
    });
  }

  function addOther() {
    if (!range) return;
    const value = range.parse(other);
    if (value === null) {
      toast.error(`Not a valid ${range.label.toLowerCase()}`);
      return;
    }
    if (!chosen.includes(value)) toggle(value);
    setOther("");
  }

  function fill() {
    if (!single || "error" in single) return;
    const chosenValues = range ? { ...values, [range.id]: chosen[0] } : values;
    onFill(single, specFor(family.id, type, chosenValues));
    setOpen(false);
  }

  function createRange() {
    startTransition(async () => {
      const result = await createGenericParts({
        family: family.id,
        type: type.id,
        values,
        range: chosen,
      });
      if (result.error) {
        toast.error(result.error);
        if (!result.created) return;
      }
      const skipped = result.skipped ? ` — ${result.skipped} already existed` : "";
      toast.success(`Created ${result.created ?? 0} part${result.created === 1 ? "" : "s"}${skipped}`);
      setOpen(false);
      router.push("/parts");
    });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Shapes className="size-4" />
          {restored ? "Edit generic part" : "Generic part"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generic part</DialogTitle>
          <DialogDescription>
            {family.description}
            {allowRange && range && " Pick several values to create one part each."}
            {restored && " Fields you edited by hand are kept."}
          </DialogDescription>
          {stale && (
            <p className="text-sm text-muted-foreground">
              This part&apos;s saved wizard choice no longer matches the options here, so the wizard starts from
              defaults.
            </p>
          )}
        </DialogHeader>
        <Tabs value={family.id} onValueChange={setFamilyId}>
          <TabsList className="w-full">
            {GENERIC_FAMILIES.map((f) => (
              <TabsTrigger key={f.id} value={f.id}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2" role="radiogroup" aria-label="Type">
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {family.types.map((t) => {
                const on = t.id === type.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={t.title}
                    onClick={() => setTypeIds((prev) => ({ ...prev, [family.id]: t.id }))}
                    className={cn(
                      "grid min-w-0 grid-cols-[minmax(0,1fr)] justify-items-center gap-1 rounded-md border p-1.5 text-center hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      on && "border-primary bg-accent/50 ring-1 ring-primary",
                    )}
                  >
                    <IconTile icons={iconsFor([t.icon])} className="size-10" />
                    <span className="line-clamp-2 text-[0.7rem] leading-tight">{t.label}</span>
                    <span className="max-w-full truncate text-[0.6rem] leading-none text-muted-foreground">{t.detail}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {params.map((param) =>
            param.kind === "select" ? (
              <div key={param.id} className="grid gap-2">
                <Label>{param.label}</Label>
                <Select
                  value={values[param.id]}
                  onValueChange={(value) => setRawValues((prev) => ({ ...prev, [param.id]: value }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {param.options.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null,
          )}
          {range && (
            <div className="grid gap-2 sm:col-span-2">
              <Label>{range.label}</Label>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((value) => {
                  const on = chosen.includes(value);
                  return (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      className="min-w-10 tabular-nums"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      onClick={() => toggle(value)}
                    >
                      {value}
                    </Button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  value={other}
                  onChange={(e) => setOther(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOther();
                    }
                  }}
                  inputMode="decimal"
                  placeholder={range.placeholder}
                  aria-label={`Other ${range.label.toLowerCase()}`}
                  className="w-36"
                />
                <Button type="button" variant="outline" onClick={addOther}>
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          {range && chosen.length === 0 ? (
            <p className="text-muted-foreground">Pick a value under {range.label}</p>
          ) : single && "error" in single ? (
            <p className="text-muted-foreground">{single.error}</p>
          ) : single ? (
            <div className="grid grid-cols-[auto_1fr] items-center gap-3">
              <IconTile icons={iconsFor(single.preview)} className="h-12 px-2" />
              <div className="grid gap-1">
                <p className="font-medium">{single.name}</p>
                {single.mpn && <p className="font-mono text-xs text-muted-foreground">{single.mpn}</p>}
                <p className="text-xs text-muted-foreground">
                  {/* The icon-N pictures are already shown in the tile. */}
                  {single.attributes
                    .filter((a) => !isIconAttribute(a.key))
                    .map((a) => `${a.key} ${a.value}`)
                    .join(" · ")}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-1">
              <p className="text-muted-foreground">{previews.length} parts, created without stock:</p>
              <ul className="max-h-40 overflow-y-auto">
                {previews.map((p, i) => (
                  <li key={i}>{"error" in p ? p.error : p.name}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          {previews.length > 1 ? (
            <Button type="button" onClick={createRange} disabled={pending || previews.some((p) => "error" in p)}>
              {pending ? "Creating…" : `Create ${previews.length} parts`}
            </Button>
          ) : (
            <Button type="button" onClick={fill} disabled={!single || "error" in single}>
              Fill form
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Catalogue icons side by side, drawn black on white like they print on a
// bin label (and like the label designer's icon picker shows them).
function IconTile({ icons, className }: { icons: LabelIcon[]; className?: string }) {
  return (
    <span className={cn("flex items-center justify-center gap-1.5 rounded bg-white p-1 text-black", className)}>
      {icons.map((icon) => (
        <svg
          key={icon.id}
          viewBox={icon.viewBox.join(" ")}
          className="h-full w-auto"
          aria-hidden
          // Sanitised at import (scripts/import-label-icons.ts).
          dangerouslySetInnerHTML={{ __html: icon.markup }}
        />
      ))}
    </span>
  );
}
