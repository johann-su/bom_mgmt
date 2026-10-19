"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Pencil, Printer, TriangleAlert } from "lucide-react";
import {
  uniqueName,
  type LabelVariables,
  type TemplateOption,
} from "@/lib/label-template";
import { renderLabelSvg } from "@/lib/label-render";
import { assignLabelTemplate } from "@/app/settings/labels/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LabelDesigner } from "@/components/label-designer";
import { LabelPreview } from "@/components/label-preview";

/**
 * This location's printable label, rendered with its real data, with the
 * template its type uses: switch it, edit it in place (the designer in a
 * dialog), print it, or print the labels of everything inside by type.
 */
export function LocationLabel({
  locationId,
  vars,
  type,
  current,
  options,
  sharedWith,
  inside,
}: {
  locationId: string;
  vars: LabelVariables;
  type: { id: string; name: string };
  current: TemplateOption;
  options: TemplateOption[];
  // Other types printing with the same saved template — edits reach them too.
  sharedWith: string[];
  // Locations inside this one, per type, for "Print N Bin labels".
  inside: { typeId: string; typeName: string; count: number }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const rendered = useMemo(() => renderLabelSvg(current.template, vars), [current, vars]);
  const affected = [type.name, ...sharedWith].join(", ");

  function choose(key: string) {
    if (key === current.key) return;
    startTransition(async () => {
      const result = await assignLabelTemplate({ typeId: type.id, key });
      if (result.error) toast.error(result.error);
      else {
        toast.success(`Every ${type.name} now uses this label`);
        router.refresh();
      }
    });
  }

  return (
    <Card className="mb-6 gap-4 p-4 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group relative shrink-0 self-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-72"
        aria-label="Edit label"
        title="Edit label"
      >
        <LabelPreview svg={rendered.body} className="max-h-48" />
        <span className="absolute inset-0 flex items-center justify-center rounded-sm bg-black/0 text-sm font-medium text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white">
          <Pencil className="mr-1.5 size-4" /> Edit
        </span>
      </button>

      <div className="grid min-w-0 flex-1 gap-3">
        <div>
          <h2 className="font-medium">Label</h2>
          <p className="text-sm text-muted-foreground">
            {current.template.width} × {current.template.height} mm · shared by every {type.name}
            {sharedWith.length > 0 && <> and {sharedWith.join(", ")}</>}
          </p>
        </div>

        <Select value={current.key} onValueChange={choose} disabled={pending}>
          <SelectTrigger className="w-full sm:max-w-sm" aria-label={`Label template for ${type.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.some((o) => !o.builtIn) && (
              <SelectGroup>
                <SelectLabel>Your templates</SelectLabel>
                {options.filter((o) => !o.builtIn).map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectGroup>
              <SelectLabel>Built-in</SelectLabel>
              {options.filter((o) => o.builtIn).map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        {rendered.errors.length > 0 && (
          <p className="text-sm text-destructive">{rendered.errors.join("; ")}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/locations/labels?root=${locationId}&only=self`}>
              <Printer className="size-4" />
              Print
            </Link>
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" />
            Edit label
          </Button>
          {inside.map((t) => (
            <Button key={t.typeId} variant="outline" asChild>
              <Link href={`/locations/labels?root=${locationId}&type=${t.typeId}`}>
                <Printer className="size-4" />
                {t.count} {t.typeName} label{t.count === 1 ? "" : "s"}
              </Link>
            </Button>
          ))}
          {!current.builtIn && (
            <Button variant="ghost" asChild>
              <Link href={`/settings/labels/${current.key}`}>
                <ExternalLink className="size-4" />
                Open in designer
              </Link>
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <Dialog open onOpenChange={(open) => !open && setEditing(false)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {type.name} label
              </DialogTitle>
            </DialogHeader>
            <LabelDesigner
              initial={
                current.builtIn
                  ? {
                      id: null,
                      name: uniqueName(`${type.name} label`, options.map((o) => o.name)),
                      template: current.template,
                    }
                  : { id: current.key, name: current.name, template: current.template }
              }
              vars={vars}
              assignToTypeId={type.id}
              notice={
                <p className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  {current.builtIn
                    ? `Saving creates your own copy of “${current.name}” and uses it for every ${type.name}.`
                    : `Changes apply to every location labelled with this template (${affected}).`}
                </p>
              }
              onSaved={() => {
                setEditing(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
