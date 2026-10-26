"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Ruler } from "lucide-react";
import {
  commonLengths,
  FASTENER_TYPES,
  fastenerSizes,
  fastenerType,
  generateFastener,
  hasLength,
  materialsFor,
  parseLength,
  type GeneratedFastener,
} from "@/lib/fasteners";
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
import { createFasteners } from "./actions";

// "From standard": pick a fastener by standard, size, material and length(s).
// One length fills the part form; several (only offered for a new part)
// create a part per length right away.
export function FastenerDialog({
  onFill,
  allowRange,
}: {
  onFill: (part: GeneratedFastener) => void;
  allowRange: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(FASTENER_TYPES[0].id);
  const [size, setSize] = useState("M3");
  const [materialId, setMaterialId] = useState("a2");
  const [lengths, setLengths] = useState<number[]>([]);
  const [otherLength, setOtherLength] = useState("");
  const [pending, startTransition] = useTransition();
  // The label-icon catalogue is large; it's fetched the first time the dialog opens.
  const [icons, setIcons] = useState<Map<string, LabelIcon> | null>(null);
  useEffect(() => {
    if (!open || icons) return;
    loadIcons().then((all) => setIcons(new Map(all.map((i) => [i.id, i]))));
  }, [open, icons]);
  const iconsFor = (ids: string[]) => ids.flatMap((id) => icons?.get(id) ?? []);

  const type = fastenerType(typeId) ?? FASTENER_TYPES[0];
  const sizes = fastenerSizes(type);
  const materials = materialsFor(type);
  const withLength = hasLength(type);
  // Keep the size and material across type changes where the new type has them.
  const currentSize = sizes.includes(size) ? size : sizes.includes("M3") ? "M3" : sizes[0];
  const material = materials.find((m) => m.id === materialId) ?? materials[0];
  const chosen = withLength ? [...lengths].sort((a, b) => a - b) : [];
  const chips = withLength ? [...new Set([...commonLengths(type, currentSize), ...lengths])].sort((a, b) => a - b) : [];
  const previews = (withLength ? chosen : [undefined]).map((length) =>
    generateFastener({ type: type.id, size: currentSize, material: material.id, length }),
  );
  const single = previews.length === 1 ? previews[0] : null;

  function toggleLength(length: number) {
    if (!allowRange) {
      setLengths([length]);
      return;
    }
    setLengths((prev) => (prev.includes(length) ? prev.filter((l) => l !== length) : [...prev, length]));
  }

  function addOtherLength() {
    const length = parseLength(otherLength);
    if (length === null) {
      toast.error("Enter a length in mm, e.g. 14 or 5.7");
      return;
    }
    if (!lengths.includes(length)) toggleLength(length);
    setOtherLength("");
  }

  function fill() {
    if (!single || "error" in single) return;
    onFill(single);
    setOpen(false);
  }

  function createRange() {
    startTransition(async () => {
      const result = await createFasteners({
        type: type.id,
        size: currentSize,
        material: material.id,
        lengths: chosen,
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Ruler className="size-4" />
          From standard
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Fastener from standard</DialogTitle>
          <DialogDescription>
            Fills in the name, ISO/DIN designation and dimensions.
            {allowRange && " Pick several lengths to create one part for each."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2 sm:col-span-2" role="radiogroup" aria-label="Type">
            <Label>Type</Label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {FASTENER_TYPES.map((t) => {
                const on = t.id === type.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    title={[t.title, t.standard && `${t.standard}${t.alias ? ` / ${t.alias}` : ""}`]
                      .filter(Boolean)
                      .join("\n")}
                    onClick={() => setTypeId(t.id)}
                    className={cn(
                      "grid justify-items-center gap-1 rounded-md border p-1.5 text-center hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      on && "border-primary bg-accent/50 ring-1 ring-primary",
                    )}
                  >
                    <IconTile icons={iconsFor(t.icons.slice(0, 1))} className="size-10" />
                    <span className="line-clamp-2 text-[0.7rem] leading-tight">{t.label}</span>
                    <span className="truncate text-[0.6rem] leading-none text-muted-foreground">
                      {t.standard || "no standard"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Size</Label>
            <Select value={currentSize} onValueChange={setSize}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Material</Label>
            <Select value={material.id} onValueChange={setMaterialId}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {materials.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {withLength && (
            <div className="grid gap-2 sm:col-span-2">
              <Label>Length (mm)</Label>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((length) => {
                  const on = chosen.includes(length);
                  return (
                    <Button
                      key={length}
                      type="button"
                      size="sm"
                      className="min-w-10 tabular-nums"
                      variant={on ? "default" : "outline"}
                      aria-pressed={on}
                      onClick={() => toggleLength(length)}
                    >
                      {length}
                    </Button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Input
                  value={otherLength}
                  onChange={(e) => setOtherLength(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addOtherLength();
                    }
                  }}
                  inputMode="decimal"
                  placeholder="Other length"
                  aria-label="Other length in mm"
                  className="w-36"
                />
                <Button type="button" variant="outline" onClick={addOtherLength}>
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          {single && "error" in single ? (
            <p className="text-muted-foreground">{withLength && chosen.length === 0 ? "Pick a length" : single.error}</p>
          ) : single ? (
            <div className="grid grid-cols-[auto_1fr] items-center gap-3">
              <IconTile icons={iconsFor([...type.icons].reverse())} className="h-12 px-2" />
              <div className="grid gap-1">
                <p className="font-medium">{single.name}</p>
                {single.mpn && <p className="font-mono text-xs text-muted-foreground">{single.mpn}</p>}
                <p className="text-xs text-muted-foreground">
                  {single.attributes
                    .filter((a) => a.key !== "Standard" && a.key !== "Material")
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
