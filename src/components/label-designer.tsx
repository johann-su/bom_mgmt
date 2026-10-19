"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Copy,
  QrCode,
  Square,
  Trash2,
  Type,
} from "lucide-react";
import {
  LABEL_VARIABLES,
  SAMPLE_VARIABLES,
  SHEET_PRESETS,
  SYMBOLOGIES,
  parseTemplate,
  unknownVariables,
  type LabelElement,
  type LabelTemplate,
  type LabelVariables,
  type PageLayout,
  type Symbology,
} from "@/lib/label-template";
import { renderLabelBody } from "@/lib/label-render";
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

type Initial = { id: string | null; name: string; template: LabelTemplate };

const SINGLE = "single";
const CUSTOM_SHEET = "custom";

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

function elementSummary(el: LabelElement) {
  if (el.kind === "frame") return "Frame";
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
  const [template, setTemplate] = useState(initial.template);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = template.elements.find((e) => e.id === selectedId) ?? null;
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

  function updateElement(id: string, patch: Partial<LabelElement>) {
    setTemplate((t) => ({
      ...t,
      elements: t.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as LabelElement) : e)),
    }));
  }

  function addElement(kind: LabelElement["kind"]) {
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
    setSelectedId(id);
  }

  function duplicate(el: LabelElement) {
    const id = newId();
    setTemplate((t) => ({ ...t, elements: [...t.elements, { ...el, id, x: el.x + 1, y: el.y + 1 }] }));
    setSelectedId(id);
  }

  function remove(id: string) {
    setTemplate((t) => ({ ...t, elements: t.elements.filter((e) => e.id !== id) }));
    setSelectedId(null);
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
    setTemplate((t) =>
      t.layout.kind === "sheet" ? { ...t, layout: { ...t.layout, ...patch } } : t,
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
        <Button onClick={save} disabled={pending || "error" in validation || !name.trim()}>
          {pending ? "Saving…" : "Save template"}
        </Button>
      </div>

      {notice}

      {template.width > 0 && template.height > 0 ? (
        <LabelCanvas
          template={template}
          vars={vars}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onChange={(id, box) => updateElement(id, box)}
        />
      ) : (
        <div className="rounded-lg bg-muted py-16 text-center text-sm text-muted-foreground">
          Enter a label size.
        </div>
      )}
      <p className="-mt-2 text-xs text-muted-foreground">
        Previewed with {vars === SAMPLE_VARIABLES ? "sample data" : "this location"} ({vars.path}). Drag to move, corner handle to
        resize; snaps to 0.5 mm (hold Alt for free), arrow keys nudge.
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
              onChange={(width) => setTemplate((t) => ({ ...t, width }))}
            />
            <NumberField
              label="Height"
              value={template.height}
              onChange={(height) => setTemplate((t) => ({ ...t, height }))}
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
          </div>
          <ul className="grid gap-1">
            {template.elements.map((el) => (
              <li key={el.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(el.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                    el.id === selectedId ? "bg-accent" : "hover:bg-accent/50",
                  )}
                >
                  {el.kind === "text" ? (
                    <Type className="size-4 shrink-0 text-muted-foreground" />
                  ) : el.kind === "code" ? (
                    <QrCode className="size-4 shrink-0 text-muted-foreground" />
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
          {!selected ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Select an element on the label or in the list to edit it.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h3 className="font-medium capitalize">{selected.kind}</h3>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" aria-label="Duplicate" onClick={() => duplicate(selected)}>
                    <Copy className="size-4" />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Delete element" onClick={() => remove(selected.id)}>
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

              {selected.kind !== "frame" && (
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

              {selected.kind === "frame" && (
                <div className="grid grid-cols-2 gap-2">
                  <NumberField
                    label="Line width"
                    step={0.1}
                    value={selected.strokeWidth}
                    onChange={(strokeWidth) => updateElement(selected.id, { strokeWidth })}
                  />
                  <NumberField
                    label="Corner radius"
                    value={selected.radius}
                    onChange={(radius) => updateElement(selected.id, { radius })}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
