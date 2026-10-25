"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, FileDown, FileImage, FileSpreadsheet, FileType } from "lucide-react";
import { pageSize, type LabelVariables, type TemplateOption } from "@/lib/label-template";
import { labelsCsv, renderPages } from "@/lib/label-render";
import type { LabelSlots } from "@/lib/label-slots";
import { downloadBlob, filesOrZip, pagesToPdf, svgToPng, svgsToOutlines } from "@/lib/label-export";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LabelPreview } from "@/components/label-preview";
import { LocationIcon } from "@/components/location-icon";
import { NiimbotPanel } from "./niimbot-panel";

export type PrintItem = {
  id: string;
  depth: number;
  typeId: string;
  typeName: string;
  icon: string;
  vars: LabelVariables;
  slots: LabelSlots;
};


// Previewing every page of a 300-label run would be slow and pointless.
const PREVIEW_PAGES = 4;
export function LabelPrinter({
  items,
  templates,
  initialSelected,
  initialTemplate,
  filename,
}: {
  items: PrintItem[];
  templates: TemplateOption[];
  initialSelected: string[];
  initialTemplate: string;
  filename: string;
}) {
  const [templateKey, setTemplateKey] = useState(initialTemplate);
  const [selected, setSelected] = useState(() => new Set(initialSelected));
  const [skip, setSkip] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const option = templates.find((t) => t.key === templateKey) ?? templates[0];
  const { template } = option;
  const sheet = template.layout.kind === "sheet" ? template.layout : null;
  const chosen = useMemo(() => items.filter((i) => selected.has(i.id)), [items, selected]);
  const rendered = useMemo(
    () => renderPages(template, chosen, sheet ? skip : 0),
    [template, chosen, sheet, skip],
  );
  const types = useMemo(() => [...new Set(items.map((i) => i.typeName))], [items]);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleType(typeName: string) {
    const ofType = items.filter((i) => i.typeName === typeName).map((i) => i.id);
    const allOn = ofType.every((id) => selected.has(id));
    setSelected((s) => {
      const next = new Set(s);
      for (const id of ofType) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function run(kind: string, task: () => Promise<{ blob: Blob; filename: string }>) {
    setBusy(kind);
    try {
      const { blob, filename } = await task();
      downloadBlob(blob, filename);
    } catch (err) {
      console.error(err);
      toast.error(`Couldn't create the ${kind} file`);
    } finally {
      setBusy(null);
    }
  }

  const size = pageSize(template);
  const { pages, errors } = rendered;
  const none = chosen.length === 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <Card className="gap-3 p-4 lg:self-start">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Locations</h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {chosen.length} / {items.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set(items.map((i) => i.id)))}>
            All
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
            None
          </Button>
          {types.map((t) => (
            <Button key={t} size="sm" variant="ghost" onClick={() => toggleType(t)}>
              ± {t}
            </Button>
          ))}
        </div>
        <ul className="-mx-1 max-h-[60vh] overflow-y-auto">
          {items.map((item) => (
            <li key={item.id}>
              <label
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-accent/50"
                style={{ paddingLeft: `${0.25 + item.depth * 1.1}rem` }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggle(item.id)}
                  className="size-4 accent-primary"
                />
                <LocationIcon name={item.icon} className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-mono">{item.vars.code}</span>
                {item.vars.name && <span className="truncate text-muted-foreground">{item.vars.name}</span>}
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <div className="grid min-w-0 content-start gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid min-w-56 flex-1 gap-1">
            <span className="text-xs text-muted-foreground">Template</span>
            <Select value={option.key} onValueChange={setTemplateKey}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {templates.some((t) => !t.builtIn) && (
                  <SelectGroup>
                    <SelectLabel>Saved</SelectLabel>
                    {templates.filter((t) => !t.builtIn).map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectLabel>Built-in</SelectLabel>
                  {templates.filter((t) => t.builtIn).map((t) => (
                    <SelectItem key={t.key} value={t.key}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {sheet && (
            <label className="grid w-36 gap-1 text-xs text-muted-foreground">
              <span>Skip used labels</span>
              <Input
                type="number"
                min={0}
                max={sheet.columns * sheet.rows - 1}
                value={skip}
                onChange={(e) => setSkip(Math.max(0, e.target.valueAsNumber || 0))}
                className="h-9"
              />
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={none || busy !== null}
            onClick={() =>
              run("PDF", async () => ({ blob: await pagesToPdf(pages, size), filename: `${filename}.pdf` }))
            }
          >
            <FileDown className="size-4" />
            {busy === "PDF" ? "Creating…" : "PDF"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={none || busy !== null}>
                <FileType className="size-4" />
                {busy === "SVG" ? "Creating…" : "SVG"}
                <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              <DropdownMenuItem
                onSelect={() => run("SVG", () => filesOrZip(pages, filename, "svg", "image/svg+xml"))}
                className="flex-col items-start gap-0.5"
              >
                <span className="font-medium">Editable</span>
                <span className="text-xs text-muted-foreground">
                  Live text and colours — for Inkscape, Illustrator or printing.
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  run("SVG", async () => {
                    const outlined = await svgsToOutlines(pages);
                    for (const w of outlined.warnings) toast.warning(w);
                    return filesOrZip(outlined.pages, `${filename}-outlines`, "svg", "image/svg+xml");
                  })
                }
                className="flex-col items-start gap-0.5"
              >
                <span className="font-medium">Outlines for 3D printing</span>
                <span className="text-xs text-muted-foreground">
                  Everything as plain filled shapes, white parts cut out — for Bambu Studio, OrcaSlicer or
                  PrusaSlicer.
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            disabled={none || busy !== null}
            onClick={() =>
              run("PNG", async () => {
                const pngs: Blob[] = [];
                for (const page of pages) pngs.push(await svgToPng(page, size));
                return filesOrZip(pngs, filename, "png", "image/png");
              })
            }
          >
            <FileImage className="size-4" />
            {busy === "PNG" ? "Creating…" : "PNG"}
          </Button>
          <Button
            variant="outline"
            disabled={none || busy !== null}
            title="The variables as a spreadsheet, for mail merge in another label designer"
            onClick={() =>
              run("CSV", async () => ({
                blob: new Blob([labelsCsv(chosen.map((i) => i.vars))], { type: "text/csv" }),
                filename: `${filename}.csv`,
              }))
            }
          >
            <FileSpreadsheet className="size-4" />
            CSV
          </Button>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {pages.length} page{pages.length === 1 ? "" : "s"} of {size.width} × {size.height} mm.
          Print the PDF at <strong>actual size</strong> (no “fit to page”). Several SVG/PNG pages
          download as a ZIP.
        </p>

        <NiimbotPanel template={template} labels={chosen} />

        {errors.length > 0 && (
          <ul className="max-h-32 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        {none ? (
          <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
            Select locations to preview their labels.
          </p>
        ) : (
          <div
            className={cn(
              "grid gap-3",
              sheet ? "sm:grid-cols-2" : "grid-cols-2 sm:grid-cols-3",
            )}
          >
            {pages.slice(0, sheet ? PREVIEW_PAGES : PREVIEW_PAGES * 3).map((page, i) => (
              <LabelPreview key={i} svg={page} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
