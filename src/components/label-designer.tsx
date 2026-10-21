"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Copy,
  QrCode,
  Redo2,
  Library,
  Replace,
  Shapes,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import {
  LABEL_VARIABLES,
  SAMPLE_VARIABLES,
  SHEET_PRESETS,
  SYMBOLOGIES,
  graphicBox,
  parseTemplate,
  unknownVariables,
  type LabelElement,
  type LabelTemplate,
  type LabelVariables,
  type PageLayout,
  type Symbology,
} from "@/lib/label-template";
import { renderLabelBody } from "@/lib/label-render";
import { alignElements, distributeElements, type Alignment } from "@/lib/label-snap";
import { parseClipboard, placePasted, serializeElements } from "@/lib/label-clipboard";
import { importSvg, type ImportedSvg } from "@/lib/svg-sanitize";
import { createHistory, record, redo, undo, type History } from "@/lib/undo-history";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { saveLabelTemplate } from "@/app/settings/labels/actions";
import { LabelCanvas } from "@/components/label-canvas";
import { IconPickerDialog } from "@/components/icon-picker-dialog";

type Initial = { id: string | null; name: string; template: LabelTemplate };

const SINGLE = "single";
const CUSTOM_SHEET = "custom";

// Grid pitches offered in mm; "0" turns grid snapping off.
const GRID_SIZES = ["0", "0.5", "1", "2", "2.5", "5"];

const ALIGNMENTS = [
  ["left", AlignStartVertical, "Align left"],
  ["center", AlignCenterVertical, "Centre horizontally"],
  ["right", AlignEndVertical, "Align right"],
  ["top", AlignStartHorizontal, "Align top"],
  ["middle", AlignCenterHorizontal, "Centre vertically"],
  ["bottom", AlignEndHorizontal, "Align bottom"],
] as const satisfies readonly (readonly [Alignment, unknown, string])[];

const isSvgFile = (f: File) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name);
// "Copy as SVG" from Figma, Inkscape, icon sites etc. puts markup on the clipboard.
const looksLikeSvg = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(text);

// Keyboard shortcuts leave text fields (and selected page text) to the browser.
function isEditingText(target: EventTarget | null) {
  if ((target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) return true;
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed;
}

// Only ever called from event handlers, to time undo-step merging.
const now = () => Date.now();

const newId = () => `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function NumberField({
  label,
  value,
  onChange,
  step = 0.5,
  min,
  unit = "mm",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  unit?: string;
}) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      <span>
        {label} {unit && <span className="opacity-70">({unit})</span>}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="h-8 tabular-nums"
      />
    </label>
  );
}

/** A colour swatch; with `noneLabel`, a checkbox clears it (e.g. no fill). */
function ColorField({
  label,
  value,
  fallback,
  noneLabel,
  onChange,
}: {
  label: string;
  value: string | undefined;
  // Shown (and picked when "none" is unticked) while no colour is set.
  fallback: string;
  noneLabel?: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="grid gap-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <div className="flex h-8 items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5",
            value === undefined && noneLabel && "opacity-40",
          )}
        />
        {noneLabel && (
          <label className="flex items-center gap-1.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={value === undefined}
              onChange={(e) => onChange(e.target.checked ? undefined : fallback)}
              className="size-4 accent-primary"
            />
            {noneLabel}
          </label>
        )}
      </div>
    </div>
  );
}

function elementSummary(el: LabelElement) {
  if (el.kind === "frame") return "Frame";
  if (el.kind === "graphic") return el.name ? `Graphic: ${el.name}` : "Graphic";
  if (el.kind === "code") return `${SYMBOLOGIES[el.symbology].name}: ${el.text || "—"}`;
  return el.text || "Text";
}

/**
 * The label editor: live canvas plus label/paper and element panels. Used on
 * its own page (Settings → Label templates) and in the location page's
 * "Edit label" dialog, which previews with that location's real data and
 * assigns the saved template to the location's type.
 */
export function LabelDesigner({
  initial,
  vars = SAMPLE_VARIABLES,
  assignToTypeId,
  notice,
  onSaved,
}: {
  initial: Initial;
  vars?: LabelVariables;
  assignToTypeId?: string;
  // Shown above the canvas, e.g. "Changes apply to every Bin".
  notice?: React.ReactNode;
  // Replaces the default of navigating to the saved template's page.
  onSaved?: (id: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [history, setHistory] = useState(() => createHistory(initial.template));
  const template = history.present;
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [grid, setGrid] = useState("0.5");
  const [snapToObjects, setSnapToObjects] = useState(true);
  const [pending, startTransition] = useTransition();

  // Ids can outlive their element (after undo), so derive from the template.
  const selection = template.elements.filter((e) => selectedIds.includes(e.id));
  const selected = selection.length === 1 ? selection[0] : null;
  const validation = useMemo(() => parseTemplate(template), [template]);
  const renderErrors = useMemo(() => renderLabelBody(template, vars).errors, [template, vars]);
  const unknown = useMemo(() => unknownVariables(template), [template]);
  const presetIndex = SHEET_PRESETS.findIndex(
    (p) =>
      JSON.stringify(p.layout) === JSON.stringify(template.layout) &&
      p.label[0] === template.width &&
      p.label[1] === template.height,
  );
  const layoutValue =
    template.layout.kind === "single" ? SINGLE : presetIndex >= 0 ? String(presetIndex) : CUSTOM_SHEET;

  /**
   * Every template change goes through here so it can be undone. `key` names
   * what changed, so a burst of the same change (typing in one field) is one
   * undo step; `gesture` is a canvas drag, merged however long it pauses.
   */
  function setTemplate(
    update: (t: LabelTemplate) => LabelTemplate,
    { key, gesture }: { key?: string; gesture?: string } = {},
  ) {
    const at = now();
    setHistory((h) =>
      record(h, update(h.present), gesture ? { key: gesture, at, window: Infinity } : { key, at }),
    );
  }

  // ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Y redoes. Text fields keep the browser's
  // own undo for their contents.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      const isUndo = key === "z" && !e.shiftKey;
      const isRedo = (key === "z" && e.shiftKey) || (key === "y" && e.ctrlKey && !e.metaKey);
      if (!isUndo && !isRedo) return;
      if (isEditingText(e.target)) return;
      e.preventDefault();
      setHistory((h: History<LabelTemplate>) => (isUndo ? undo(h) : redo(h)));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** Patches several elements as one undo step (a group drag, an align). */
  function updateElements(patches: Record<string, Partial<LabelElement>>, gesture?: string) {
    const ids = Object.keys(patches).sort();
    const fields = [...new Set(Object.values(patches).flatMap(Object.keys))].sort();
    const key = `el:${ids.join("+")}:${fields.join(",")}`;
    setTemplate((t) => {
      // Unchanged (a click that didn't really move anything) → no undo step.
      const changed = t.elements.some((el) =>
        Object.entries(patches[el.id] ?? {}).some(([k, v]) => !Object.is(el[k as keyof LabelElement], v)),
      );
      if (!changed) return t;
      return {
        ...t,
        elements: t.elements.map((e) => (patches[e.id] ? ({ ...e, ...patches[e.id] } as LabelElement) : e)),
      };
    }, { key, gesture });
  }

  // ⌘C / ⌘X / ⌘V via the system clipboard, so elements travel between
  // templates and tabs. Paste uses the native event (reading the clipboard
  // otherwise prompts); copy also runs on keydown, since Safari skips the
  // copy event when no page text is selected. Re-subscribed each render so
  // the handlers see the current selection.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || (key !== "c" && key !== "x")) return;
      if (selection.length === 0 || isEditingText(e.target)) return;
      e.preventDefault();
      navigator.clipboard.writeText(serializeElements(selection)).then(
        () => key === "x" && remove(selection.map((el) => el.id)),
        () => toast.error("Couldn't copy to the clipboard"),
      );
    }
    function onCopy(e: ClipboardEvent) {
      if (selection.length === 0 || isEditingText(e.target) || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", serializeElements(selection));
      if (e.type === "cut") remove(selection.map((el) => el.id));
    }
    function onPaste(e: ClipboardEvent) {
      if (isEditingText(e.target)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const file = [...(e.clipboardData?.files ?? [])].find(isSvgFile);
      if (file || looksLikeSvg(text)) {
        e.preventDefault();
        if (file) return void importGraphicFile(file);
        const result = importSvg(text);
        return "error" in result ? void toast.error(result.error) : placeGraphic(result, "");
      }
      const pasted = parseClipboard(text);
      if (!pasted) return;
      e.preventDefault();
      const placed = placePasted(template.elements, pasted, newId);
      setTemplate((t) => ({ ...t, elements: [...t.elements, ...placed] }));
      setSelectedIds(placed.map((el) => el.id));
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
    };
  });

  function updateElement(id: string, patch: Partial<LabelElement>) {
    updateElements({ [id]: patch });
  }

  /** Click in the list: select it alone, or Shift/⌘/Ctrl to toggle it. */
  function pick(id: string, additive: boolean) {
    if (!additive) return setSelectedIds([id]);
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  // The hidden file picker serves both "add graphic" and "replace graphic".
  const fileInput = useRef<HTMLInputElement>(null);
  const [iconsOpen, setIconsOpen] = useState(false);
  const replacing = useRef<string | null>(null);

  function chooseGraphic(replaceId: string | null) {
    replacing.current = replaceId;
    fileInput.current?.click();
  }

  /** Adds a graphic, or swaps the drawing of `replaceId` keeping its box. */
  function placeGraphic(svg: ImportedSvg, name: string, replaceId: string | null = null) {
    if (replaceId) {
      updateElement(replaceId, { markup: svg.markup, viewBox: svg.viewBox, name });
      return;
    }
    const id = newId();
    const element: LabelElement = {
      id, kind: "graphic", ...graphicBox(template, svg.viewBox),
      markup: svg.markup, viewBox: svg.viewBox, stretch: false, ...(name ? { name } : {}),
    };
    setTemplate((t) => ({ ...t, elements: [...t.elements, element] }));
    setSelectedIds([id]);
  }

  async function importGraphicFile(file: File, replaceId: string | null = null) {
    if (!isSvgFile(file)) {
      toast.error("Only SVG files can be added — PNG and JPG aren't vector graphics");
      return;
    }
    const result = importSvg(await file.text());
    if ("error" in result) toast.error(result.error);
    else placeGraphic(result, file.name.replace(/\.svg$/i, "").slice(0, 100), replaceId);
  }

  function addElement(kind: Exclude<LabelElement["kind"], "graphic">) {
    const { width: w, height: h } = template;
    const id = newId();
    const element: LabelElement =
      kind === "text"
        ? {
            id, kind, x: 1, y: 1, w: Math.max(5, w - 2), h: Math.min(8, h - 2), text: "{{code}}",
            fontSize: 10, bold: false, mono: false, align: "start", fit: true,
          }
        : kind === "code"
          ? {
              id, kind, x: 1, y: 1, w: Math.min(15, h - 2), h: Math.min(15, h - 2),
              symbology: "datamatrix", text: "{{code}}",
            }
          : { id, kind, x: 0, y: 0, w, h, strokeWidth: 0.3, radius: 1 };
    setTemplate((t) => ({ ...t, elements: [...t.elements, element] }));
    setSelectedIds([id]);
  }

  function duplicate(els: LabelElement[]) {
    const copies = els.map((el) => ({ ...el, id: newId(), x: el.x + 1, y: el.y + 1 }));
    setTemplate((t) => ({ ...t, elements: [...t.elements, ...copies] }));
    setSelectedIds(copies.map((c) => c.id));
  }

  function remove(ids: string[]) {
    setTemplate((t) => ({ ...t, elements: t.elements.filter((e) => !ids.includes(e.id)) }));
    setSelectedIds([]);
  }

  // Align and distribute buttons, for one element (against the label) or
  // several (against each other).
  function renderArrange(els: LabelElement[]) {
    const several = els.length > 1;
    return (
      <div className="grid gap-1 text-xs text-muted-foreground">
        <span>{several ? "Align to each other" : "Align on label"}</span>
        <div className="flex flex-wrap gap-1">
          {ALIGNMENTS.map(([how, Icon, title]) => (
            <Button
              key={how}
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={title}
              title={title}
              onClick={() => updateElements(alignElements(els, template, how))}
            >
              <Icon className="size-4" />
            </Button>
          ))}
          {several &&
            (
              [
                ["x", AlignHorizontalDistributeCenter, "Distribute horizontally"],
                ["y", AlignVerticalDistributeCenter, "Distribute vertically"],
              ] as const
            ).map(([axis, Icon, title]) => (
              <Button
                key={axis}
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label={title}
                title={els.length < 3 ? `${title} (select 3 or more)` : title}
                disabled={els.length < 3}
                onClick={() => updateElements(distributeElements(els, axis))}
              >
                <Icon className="size-4" />
              </Button>
            ))}
        </div>
      </div>
    );
  }

  function setLayout(value: string) {
    if (value === SINGLE) {
      setTemplate((t) => ({ ...t, layout: { kind: "single" } }));
    } else if (value === CUSTOM_SHEET) {
      setTemplate((t) => ({
        ...t,
        layout: {
          kind: "sheet", pageWidth: 210, pageHeight: 297,
          columns: Math.max(1, Math.floor(200 / t.width)), rows: Math.max(1, Math.floor(287 / t.height)),
          marginTop: 5, marginLeft: 5, gapX: 0, gapY: 0,
        },
      }));
    } else {
      const preset = SHEET_PRESETS[Number(value)];
      setTemplate((t) => ({ ...t, width: preset.label[0], height: preset.label[1], layout: preset.layout }));
    }
  }

  function setSheet(patch: Partial<Extract<PageLayout, { kind: "sheet" }>>) {
    setTemplate(
      (t) => (t.layout.kind === "sheet" ? { ...t, layout: { ...t.layout, ...patch } } : t),
      { key: `sheet:${Object.keys(patch).join(",")}` },
    );
  }

  function save() {
    startTransition(async () => {
      const result = await saveLabelTemplate({ id: initial.id, name, template, assignToTypeId });
      if (result.error || !result.id) {
        toast.error(result.error ?? "Couldn't save the template");
        return;
      }
      toast.success("Label saved");
      if (onSaved) onSaved(result.id);
      else if (!initial.id) router.replace(`/settings/labels/${result.id}`);
      else router.refresh();
    });
  }

  const sheet = template.layout.kind === "sheet" ? template.layout : null;
  const problems = [
    ...("error" in validation ? [validation.error] : []),
    ...unknown.map((v) => `Unknown variable {{${v}}}`),
    ...renderErrors,
  ];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="template-name">Template name</Label>
          <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex gap-1">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Undo"
            title="Undo (⌘Z)"
            disabled={history.past.length === 0}
            onClick={() => setHistory(undo)}
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Redo"
            title="Redo (⇧⌘Z)"
            disabled={history.future.length === 0}
            onClick={() => setHistory(redo)}
          >
            <Redo2 className="size-4" />
          </Button>
        </div>
        <Button onClick={save} disabled={pending || "error" in validation || !name.trim()}>
          {pending ? "Saving…" : "Save template"}
        </Button>
      </div>

      {notice}

      <div className="-mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted-foreground">Grid</span>
          <Select value={grid} onValueChange={setGrid}>
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRID_SIZES.map((g) => (
                <SelectItem key={g} value={g}>
                  {g === "0" ? "Off" : `${g} mm`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={snapToObjects}
            onChange={(e) => setSnapToObjects(e.target.checked)}
            className="size-4 accent-primary"
          />
          Snap to edges &amp; centres
        </label>
      </div>

      {template.width > 0 && template.height > 0 ? (
        // Dropping an .svg file on the label adds it as a graphic.
        <div
          onDragOver={(e) => {
            if ([...e.dataTransfer.items].some((i) => i.kind === "file")) e.preventDefault();
          }}
          onDrop={(e) => {
            const file = e.dataTransfer.files[0];
            if (!file) return;
            e.preventDefault();
            void importGraphicFile(file);
          }}
        >
          <LabelCanvas
            template={template}
            vars={vars}
            selectedIds={selectedIds}
            grid={Number(grid)}
            snapToObjects={snapToObjects}
            onSelect={setSelectedIds}
            onChange={updateElements}
            onDelete={remove}
          />
        </div>
      ) : (
        <div className="rounded-lg bg-muted py-16 text-center text-sm text-muted-foreground">
          Enter a label size.
        </div>
      )}
      <p className="-mt-2 text-xs text-muted-foreground">
        Previewed with {vars === SAMPLE_VARIABLES ? "sample data" : "this location"} ({vars.path}). Drag to move; the square handle
        resizes (Shift keeps proportions), the round one rotates (Shift locks to 15°). Shift-click or drag a
        box to select several. Hold Alt to place freely, arrow keys nudge, Delete removes, ⌘C / ⌘V copy and paste. Drop or paste an SVG to add a graphic.
      </p>

      {problems.length > 0 && (
        <ul className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="gap-3 p-4">
          <h3 className="font-medium">Label &amp; paper</h3>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Width"
              value={template.width}
              onChange={(width) => setTemplate((t) => ({ ...t, width }), { key: "width" })}
            />
            <NumberField
              label="Height"
              value={template.height}
              onChange={(height) => setTemplate((t) => ({ ...t, height }), { key: "height" })}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">Paper</span>
            <Select value={layoutValue} onValueChange={setLayout}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SINGLE}>One label per page (label printer)</SelectItem>
                {SHEET_PRESETS.map((p, i) => (
                  <SelectItem key={p.name} value={String(i)}>
                    {p.name}
                  </SelectItem>
                ))}
                <SelectItem value={CUSTOM_SHEET}>Custom sheet…</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {sheet && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Page width" value={sheet.pageWidth} onChange={(v) => setSheet({ pageWidth: v })} />
              <NumberField label="Page height" value={sheet.pageHeight} onChange={(v) => setSheet({ pageHeight: v })} />
              <NumberField label="Columns" unit="" step={1} min={1} value={sheet.columns} onChange={(v) => setSheet({ columns: v })} />
              <NumberField label="Rows" unit="" step={1} min={1} value={sheet.rows} onChange={(v) => setSheet({ rows: v })} />
              <NumberField label="Top margin" value={sheet.marginTop} onChange={(v) => setSheet({ marginTop: v })} />
              <NumberField label="Left margin" value={sheet.marginLeft} onChange={(v) => setSheet({ marginLeft: v })} />
              <NumberField label="Column gap" value={sheet.gapX} onChange={(v) => setSheet({ gapX: v })} />
              <NumberField label="Row gap" value={sheet.gapY} onChange={(v) => setSheet({ gapY: v })} />
            </div>
          )}

          <h3 className="mt-2 font-medium">Elements</h3>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => addElement("text")}>
              <Type className="size-4" /> Text
            </Button>
            <Button size="sm" variant="outline" onClick={() => addElement("code")}>
              <QrCode className="size-4" /> Code
            </Button>
            <Button size="sm" variant="outline" onClick={() => addElement("frame")}>
              <Square className="size-4" /> Frame
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIconsOpen(true)}>
              <Library className="size-4" /> Icon
            </Button>
            <Button size="sm" variant="outline" onClick={() => chooseGraphic(null)}>
              <Shapes className="size-4" /> SVG file
            </Button>
            <IconPickerDialog
              open={iconsOpen}
              onOpenChange={setIconsOpen}
              onPick={(icon) => placeGraphic(icon, icon.name)}
            />
            <input
              ref={fileInput}
              type="file"
              accept=".svg,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importGraphicFile(file, replacing.current);
              }}
            />
          </div>
          <ul className="grid gap-1">
            {template.elements.map((el) => (
              <li key={el.id}>
                <button
                  type="button"
                  onClick={(e) => pick(el.id, e.shiftKey || e.metaKey || e.ctrlKey)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    selectedIds.includes(el.id) ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  {el.kind === "text" ? (
                    <Type className="size-4 shrink-0 text-muted-foreground" />
                  ) : el.kind === "code" ? (
                    <QrCode className="size-4 shrink-0 text-muted-foreground" />
                  ) : el.kind === "graphic" ? (
                    <Shapes className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <Square className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-xs">{elementSummary(el)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="gap-3 p-4">
          {selection.length > 1 ? (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{selection.length} elements</h3>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Duplicate" onClick={() => duplicate(selection)}>
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete elements"
                    onClick={() => remove(selection.map((el) => el.id))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              {renderArrange(selection)}
              <p className="text-xs text-muted-foreground">
                Drag any of them to move the group. Select one to edit its contents.
              </p>
            </>
          ) : !selected ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Select an element on the label or in the list to edit it. Shift-click or drag a box to select
              several.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-medium capitalize">{selected.kind}</h3>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Duplicate" onClick={() => duplicate([selected])}>
                    <Copy className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Delete element" onClick={() => remove([selected.id])}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <NumberField label="X" value={selected.x} onChange={(x) => updateElement(selected.id, { x })} />
                <NumberField label="Y" value={selected.y} onChange={(y) => updateElement(selected.id, { y })} />
                <NumberField label="W" value={selected.w} onChange={(w) => updateElement(selected.id, { w })} />
                <NumberField label="H" value={selected.h} onChange={(h) => updateElement(selected.id, { h })} />
              </div>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="w-24">
                  <NumberField
                    label="Rotation"
                    unit="°"
                    step={15}
                    value={selected.rotation ?? 0}
                    onChange={(rotation) => updateElement(selected.id, { rotation })}
                  />
                </div>
                {renderArrange([selected])}
              </div>

              {selected.kind === "graphic" && (
                <div className="grid gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={!selected.stretch}
                      onChange={(e) => updateElement(selected.id, { stretch: !e.target.checked })}
                      className="size-4 accent-primary"
                    />
                    Keep proportions
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => chooseGraphic(selected.id)}>
                      <Replace className="size-4" /> Replace…
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title="Make the box match the graphic's shape, keeping its width"
                      onClick={() =>
                        updateElement(selected.id, {
                          h: +((selected.w * selected.viewBox[3]) / selected.viewBox[2]).toFixed(2),
                        })
                      }
                    >
                      Fit box to graphic
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Thermal label printers print every colour as black or white.
                  </p>
                </div>
              )}

              {(selected.kind === "text" || selected.kind === "code") && (
                <div className="grid gap-1.5">
                  <Label htmlFor="element-text">{selected.kind === "code" ? "Encoded content" : "Text"}</Label>
                  <Textarea
                    id="element-text"
                    value={selected.text}
                    onChange={(e) => updateElement(selected.id, { text: e.target.value })}
                    rows={selected.kind === "code" ? 1 : 2}
                    className="font-mono text-sm"
                  />
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(LABEL_VARIABLES).map(([v, description]) => (
                      <button
                        key={v}
                        type="button"
                        title={description}
                        onClick={() => updateElement(selected.id, { text: `${selected.text}{{${v}}}` })}
                        className="rounded border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selected.kind === "code" && (
                <div className="grid gap-1">
                  <span className="text-xs text-muted-foreground">Code type</span>
                  <Select
                    value={selected.symbology}
                    onValueChange={(symbology) =>
                      updateElement(selected.id, { symbology: symbology as Symbology })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SYMBOLOGIES).map(([id, s]) => (
                        <SelectItem key={id} value={id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {selected.kind === "text" && (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Font size"
                      unit="pt"
                      step={1}
                      min={1}
                      value={selected.fontSize}
                      onChange={(fontSize) => updateElement(selected.id, { fontSize })}
                    />
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <span>Align</span>
                      <div className="flex gap-1">
                        {(
                          [
                            ["start", AlignLeft],
                            ["middle", AlignCenter],
                            ["end", AlignRight],
                          ] as const
                        ).map(([align, Icon]) => (
                          <Button
                            key={align}
                            size="icon"
                            variant={selected.align === align ? "secondary" : "ghost"}
                            className="size-8"
                            aria-label={`Align ${align}`}
                            onClick={() => updateElement(selected.id, { align })}
                          >
                            <Icon className="size-4" />
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-4 text-sm">
                    {(
                      [
                        ["bold", "Bold"],
                        ["mono", "Monospace"],
                        ["fit", "Shrink to fit"],
                      ] as const
                    ).map(([key, text]) => (
                      <label key={key} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected[key]}
                          onChange={(e) => updateElement(selected.id, { [key]: e.target.checked })}
                          className="size-4 accent-primary"
                        />
                        {text}
                      </label>
                    ))}
                  </div>
                </>
              )}

              {(selected.kind === "frame" || selected.kind === "text") && (
                <div className="grid gap-2">
                  {selected.kind === "text" && (
                    <h4 className="mt-1 text-sm font-medium">Text box</h4>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {selected.kind === "text" && (
                      <ColorField
                        label="Text colour"
                        value={selected.color}
                        fallback="#000000"
                        onChange={(color) => updateElement(selected.id, { color })}
                      />
                    )}
                    <ColorField
                      label="Background"
                      value={selected.fill}
                      fallback={selected.kind === "text" ? "#000000" : "#ffffff"}
                      noneLabel="None"
                      onChange={(fill) =>
                        // Turning on a (black) background behind default black
                        // text would hide it, so make that a white-on-black badge.
                        selected.kind === "text" && !selected.fill && fill && !selected.color
                          ? updateElement(selected.id, { fill, color: "#ffffff" })
                          : updateElement(selected.id, { fill })
                      }
                    />
                    <ColorField
                      label="Border colour"
                      value={selected.stroke}
                      fallback="#000000"
                      onChange={(stroke) => updateElement(selected.id, { stroke })}
                    />
                    <NumberField
                      label="Border width"
                      step={0.1}
                      min={0}
                      value={selected.strokeWidth ?? 0}
                      onChange={(strokeWidth) => updateElement(selected.id, { strokeWidth })}
                    />
                    <NumberField
                      label="Corner radius"
                      min={0}
                      value={selected.radius ?? 0}
                      onChange={(radius) => updateElement(selected.id, { radius })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Thermal label printers print every colour as black or white.
                  </p>
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
