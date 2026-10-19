"use client";

import { useMemo, useRef } from "react";
import { renderLabelBody } from "@/lib/label-render";
import type { LabelElement, LabelTemplate, LabelVariables } from "@/lib/label-template";

type Box = { x: number; y: number; w: number; h: number };

// Room around the label so handles on the edge stay grabbable.
const PAD = 3;
const SNAP = 0.5;
const MIN_SIZE = 1;

const snap = (v: number, free: boolean) => (free ? +v.toFixed(2) : Math.round(v / SNAP) * SNAP);

/**
 * The label at true proportions with its elements draggable (move) and a
 * corner handle to resize the selected one. Positions snap to 0.5 mm — hold
 * Alt for free placement; arrow keys nudge (Shift for 5 mm).
 */
export function LabelCanvas({
  template,
  vars,
  selectedId,
  onSelect,
  onChange,
}: {
  template: LabelTemplate;
  vars: LabelVariables;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, box: Box) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; mode: "move" | "resize"; start: DOMPoint; box: Box } | null>(
    null,
  );
  const body = useMemo(() => renderLabelBody(template, vars).body, [template, vars]);
  const { width, height } = template;
  const selected = template.elements.find((e) => e.id === selectedId);

  function toMm(e: React.PointerEvent): DOMPoint {
    const svg = svgRef.current!;
    const point = new DOMPoint(e.clientX, e.clientY);
    return point.matrixTransform(svg.getScreenCTM()!.inverse());
  }

  function startDrag(e: React.PointerEvent, el: LabelElement, mode: "move" | "resize") {
    e.stopPropagation();
    e.preventDefault();
    onSelect(el.id);
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { id: el.id, mode, start: toMm(e), box: { x: el.x, y: el.y, w: el.w, h: el.h } };
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toMm(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const free = e.altKey;
    if (d.mode === "move") {
      onChange(d.id, { ...d.box, x: snap(d.box.x + dx, free), y: snap(d.box.y + dy, free) });
    } else {
      onChange(d.id, {
        ...d.box,
        w: Math.max(MIN_SIZE, snap(d.box.w + dx, free)),
        h: Math.max(MIN_SIZE, snap(d.box.h + dy, free)),
      });
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!selected) return;
    const step = e.shiftKey ? 5 : SNAP;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!delta) return;
    e.preventDefault();
    onChange(selected.id, {
      x: +(selected.x + delta[0]).toFixed(2),
      y: +(selected.y + delta[1]).toFixed(2),
      w: selected.w,
      h: selected.h,
    });
  }

  // Handle size in mm, so it looks the same on a 20 mm and a 100 mm label.
  const handle = Math.max(width, height) / 40 + 0.6;

  return (
    <svg
      ref={svgRef}
      viewBox={`${-PAD} ${-PAD} ${width + 2 * PAD} ${height + 2 * PAD}`}
      className="block max-h-[50vh] w-full touch-none rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={() => onSelect(null)}
      onPointerMove={moveDrag}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      aria-label="Label layout"
    >
      <defs>
        <pattern id="label-grid" width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M5 0H0V5" fill="none" stroke="#000" strokeOpacity="0.07" strokeWidth="0.1" />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#fff" />
      <rect width={width} height={height} fill="url(#label-grid)" />
      <g dangerouslySetInnerHTML={{ __html: body }} />
      <rect
        width={width}
        height={height}
        fill="none"
        stroke="#000"
        strokeOpacity="0.25"
        strokeWidth="0.15"
        pointerEvents="none"
      />
      {/* Frames usually span the whole label; their hit areas go underneath
          so they don't swallow clicks meant for the text and codes inside. */}
      {[...template.elements]
        .sort((a, b) => Number(b.kind === "frame") - Number(a.kind === "frame"))
        .map((el) => (
        <rect
          key={el.id}
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          fill="transparent"
          stroke={el.id === selectedId ? "#2563eb" : "#000"}
          strokeOpacity={el.id === selectedId ? 1 : 0.2}
          strokeWidth={el.id === selectedId ? 0.25 : 0.12}
          strokeDasharray={el.id === selectedId ? undefined : "0.6 0.4"}
          className="cursor-move"
          onPointerDown={(e) => startDrag(e, el, "move")}
        />
      ))}
      {selected && (
        <rect
          x={selected.x + selected.w - handle / 2}
          y={selected.y + selected.h - handle / 2}
          width={handle}
          height={handle}
          fill="#2563eb"
          className="cursor-nwse-resize"
          onPointerDown={(e) => startDrag(e, selected, "resize")}
        />
      )}
    </svg>
  );
}
