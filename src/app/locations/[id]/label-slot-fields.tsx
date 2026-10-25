"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeOff, Library, RotateCcw, Upload } from "lucide-react";
import type { SlotValue, LabelSlots, TemplateSlot } from "@/lib/label-slots";
import { importSvg, type ImportedSvg } from "@/lib/svg-sanitize";
import { setLocationLabelSlot } from "@/app/locations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconPickerDialog } from "@/components/icon-picker-dialog";

/**
 * This location's own content for the slots its label template offers: a
 * text field per text slot, and icon/upload/hide per graphic slot. Each
 * change saves straight away; "reset" goes back to the template's default.
 */
export function LabelSlotFields({
  locationId,
  slots,
  values,
}: {
  locationId: string;
  slots: TemplateSlot[];
  values: LabelSlots;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // One icon picker and file input serve every graphic slot.
  const [pickingFor, setPickingFor] = useState<string | null>(null);
  const uploadFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function save(name: string, value: SlotValue | null) {
    startTransition(async () => {
      const result = await setLocationLabelSlot({ id: locationId, name, value });
      if (result.error) toast.error(result.error);
      else router.refresh();
    });
  }

  function saveGraphic(name: string, svg: ImportedSvg, label: string) {
    save(name, { kind: "graphic", markup: svg.markup, viewBox: svg.viewBox, ...(label ? { name: label } : {}) });
  }

  async function upload(file: File) {
    const name = uploadFor.current;
    if (!name) return;
    if (!(file.type === "image/svg+xml" || /\.svg$/i.test(file.name))) {
      toast.error("Only SVG files can be used — PNG and JPG aren't vector graphics");
      return;
    }
    const result = importSvg(await file.text());
    if ("error" in result) toast.error(result.error);
    else saveGraphic(name, result, file.name.replace(/\.svg$/i, "").slice(0, 100));
  }

  return (
    <div className="grid gap-2">
      {slots.map((slot) => {
        const value = values[slot.name];
        // A value of the wrong kind is ignored when printing, so it reads as the default here too.
        const own = value && (value.kind === "none" || value.kind === slot.kind) ? value : undefined;
        return (
          <div key={slot.name} className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground" title={slot.name}>
              {slot.name}
            </span>
            {own?.kind === "none" ? (
              <span className="flex-1 text-sm text-muted-foreground italic">Hidden on this label</span>
            ) : slot.kind === "text" ? (
              <Input
                // Remount when the saved value changes, so the field shows it.
                key={own?.kind === "text" ? own.text : ""}
                defaultValue={own?.kind === "text" ? own.text : ""}
                placeholder={slot.element.text || "(empty)"}
                disabled={pending}
                onBlur={(e) => {
                  const text = e.target.value;
                  const current = own?.kind === "text" ? own.text : "";
                  if (text !== current) save(slot.name, text ? { kind: "text", text } : null);
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="h-8 min-w-0 flex-1 text-sm sm:max-w-64"
              />
            ) : (
              <>
                <GraphicThumb value={own?.kind === "graphic" ? own : slot.element} />
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                  {own?.kind === "graphic" ? (own.name ?? "Own graphic") : "Template default"}
                </span>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => setPickingFor(slot.name)}>
                  <Library className="size-4" /> Icon…
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    uploadFor.current = slot.name;
                    fileInput.current?.click();
                  }}
                >
                  <Upload className="size-4" /> SVG…
                </Button>
              </>
            )}
            {own?.kind !== "none" && (
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={pending}
                aria-label={`Hide ${slot.name} on this label`}
                title="Hide on this label"
                onClick={() => save(slot.name, { kind: "none" })}
              >
                <EyeOff className="size-4" />
              </Button>
            )}
            {own && (
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={pending}
                aria-label={`Reset ${slot.name} to the template's default`}
                title="Back to the template's default"
                onClick={() => save(slot.name, null)}
              >
                <RotateCcw className="size-4" />
              </Button>
            )}
          </div>
        );
      })}

      <IconPickerDialog
        open={pickingFor !== null}
        onOpenChange={(open) => !open && setPickingFor(null)}
        onPick={(icon) => pickingFor && saveGraphic(pickingFor, icon, icon.name)}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

// The markup is sanitised on every save and load (parseSlotValue, parseTemplate).
function GraphicThumb({ value }: { value: { markup: string; viewBox: [number, number, number, number] } }) {
  return (
    <svg
      viewBox={value.viewBox.join(" ")}
      className="size-8 shrink-0 rounded-sm bg-white p-0.5 text-black ring-1 ring-border"
      dangerouslySetInnerHTML={{ __html: value.markup }}
    />
  );
}
