"use client";

import { useId, useMemo, useRef, useState } from "react";
import { renderLabelBody } from "@/lib/label-render";
import {
  resizeRotated,
  snapMove,
  snapResize,
  snapRotation,
  snapTargets,
  touches,
  unionBox,
  type Guide,
  type Rect,
} from "@/lib/label-snap";
import type { Restack } from "@/lib/label-order";
import type { LabelElement, LabelTemplate, LabelVariables } from "@/lib/label-template";

type Mode = "move" | "resize" | "rotate";

type Drag =
  // Moves every selected element together; the group snaps as one box.
  | {
      mode: "move";
      gesture: string;
      start: DOMPoint;
      boxes: Record<string, Rect>;
      group: Rect;
      targets: ReturnType<typeof snapTargets>;
    }
  | {
      mode: "resize" | "rotate";
      gesture: string;
      start: DOMPoint;
      id: string;
      box: Rect;
      targets: ReturnType<typeof snapTargets>;
    }
  // Drag-select on empty label; `base` is the selection kept with Shift.
  | { mode: "select"; start: DOMPoint; base: string[] };

const round = (v: number) => +v.toFixed(2);
const boxOf = (el: LabelElement): Rect => ({ x: el.x, y: el.y, w: el.w, h: el.h, rotation: el.rotation });
// Shift, ⌘ or Ctrl add to / remove from the selection.
const isAdditive = (e: React.PointerEvent | React.KeyboardEvent) => e.shiftKey || e.metaKey || e.ctrlKey;

// Room around the label so handles on the edge stay grabbable.
const PAD = 3;
const MIN_SIZE = 1;
// Distance in screen pixels within which edges snap to other edges.
const SNAP_PX = 6;
// Shift while rotating locks to multiples of this.
const ROTATE_STEP = 15;

const rotateAttr = (el: Rect) =>
  el.rotation ? `rotate(${el.rotation} ${el.x + el.w / 2} ${el.y + el.h / 2})` : undefined;

// Pointer angle around a centre, in degrees clockwise from straight up.
const angleAt = (p: DOMPoint, cx: number, cy: number) =>
  (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;

/**
 * The label at true proportions with its elements draggable (move). Shift-
 * or ⌘-click adds to the selection, as does dragging a box on empty label;
 * a selection moves and nudges as one, and Delete removes it. A single
 * selected element has a
 * bottom-right handle to resize the selected one (Shift keeps proportions)
 * and a top-right handle to rotate it (Shift locks to 15° steps; otherwise it
 * sticks near right angles). Positions snap to `grid` (0 = off) and, with
 * `snapToObjects`, to the label's and other elements' edges and centres,
 * drawing a guide line while aligned. Hold Alt for free placement; arrow keys
 * nudge by one grid step (Shift for 5 mm).
 */
export function LabelCanvas({
  template,
  vars,
  selectedIds,
  grid,
  snapToObjects,
  onSelect,
  onChange,
  onDelete,
  onRestack,
}: {
  template: LabelTemplate;
  vars: LabelVariables;
  selectedIds: string[];
  grid: number;
  snapToObjects: boolean;
  onSelect: (ids: string[]) => void;
  // New boxes by element id. `gesture` is set while dragging — one id per
  // drag, so the whole drag undoes as one step.
  onChange: (boxes: Record<string, Rect>, gesture?: string) => void;
  onDelete: (ids: string[]) => void;
  // ⌘] / ⌘[ bring the selection forward / send it back (⇧ for all the way).
  onRestack: (how: Restack) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // useId output has characters that need escaping inside url(#…).
  const patternId = `label-grid-${useId().replace(/[^\w-]/g, "")}`;
  const gestures = useRef(0);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const body = useMemo(() => renderLabelBody(template, vars).body, [template, vars]);
  const { width, height } = template;
  const selection = template.elements.filter((e) => selectedIds.includes(e.id));
  // Resize and rotate handles only make sense for one element.
  const selected = selection.length === 1 ? selection[0] : undefined;
  // Outline of a multi-selection: the box the group aligns and snaps by.
  const group = selection.length > 1 ? unionBox(selection) : null;

  function toMm(e: React.PointerEvent): DOMPoint {
    const svg = svgRef.current!;
    const point = new DOMPoint(e.clientX, e.clientY);
    return point.matrixTransform(svg.getScreenCTM()!.inverse());
  }

  function startDrag(e: React.PointerEvent, el: LabelElement, mode: Mode) {
    e.stopPropagation();
    // No native drag/text selection; focus by hand so the keys work at once.
    e.preventDefault();
    svgRef.current?.focus({ preventScroll: true });
    let ids = selectedIds;
    if (mode !== "move") ids = [el.id];
    else if (isAdditive(e)) {
      ids = ids.includes(el.id) ? ids.filter((id) => id !== el.id) : [...ids, el.id];
      // Shift-clicking a selected element just deselects it.
      if (!ids.includes(el.id)) return onSelect(ids);
    } else if (!ids.includes(el.id)) ids = [el.id];
    if (ids !== selectedIds) onSelect(ids);
    (e.target as Element).setPointerCapture(e.pointerId);
    const moving = template.elements.filter((o) => ids.includes(o.id));
    const targets = snapTargets(
      template,
      template.elements.filter((o) => !ids.includes(o.id)),
    );
    const gesture = `drag:${++gestures.current}`;
    drag.current =
      mode === "move"
        ? {
            mode,
            gesture,
            start: toMm(e),
            boxes: Object.fromEntries(moving.map((o) => [o.id, boxOf(o)])),
            group: unionBox(moving),
            targets,
          }
        : { mode, gesture, start: toMm(e), id: el.id, box: boxOf(el), targets };
  }

  function startSelect(e: React.PointerEvent) {
    svgRef.current?.focus({ preventScroll: true });
    const base = isAdditive(e) ? selectedIds : [];
    if (base.length !== selectedIds.length) onSelect(base);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { mode: "select", start: toMm(e), base };
  }

  function endDrag() {
    drag.current = null;
    setGuides([]);
    setMarquee(null);
  }

  function moveDrag(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toMm(e);
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (d.mode === "select") {
      const area = {
        x: Math.min(p.x, d.start.x),
        y: Math.min(p.y, d.start.y),
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
      // Ignore the jitter of a plain click on empty label.
      if (area.w + area.h < 0.5) return;
      setMarquee(area);
      const hit = template.elements.filter((el) => touches(el, area)).map((el) => el.id);
      const ids = [...new Set([...d.base, ...hit])];
      if (ids.join() !== selectedIds.join()) onSelect(ids);
      return;
    }
    // Alt turns all snapping off; the threshold is fixed in screen pixels so
    // it feels the same however large the label is drawn.
    const free = e.altKey;
    const opts = {
      grid: free ? 0 : grid,
      objects: snapToObjects && !free,
      threshold: SNAP_PX / svgRef.current!.getScreenCTM()!.a,
    };
    if (d.mode === "rotate") {
      // Relative to where the handle was grabbed, so it doesn't jump on press.
      const cx = d.box.x + d.box.w / 2;
      const cy = d.box.y + d.box.h / 2;
      const turned = (d.box.rotation ?? 0) + angleAt(p, cx, cy) - angleAt(d.start, cx, cy);
      const rotation = snapRotation(turned, { step: e.shiftKey ? ROTATE_STEP : undefined, free });
      onChange({ [d.id]: { ...d.box, rotation } }, d.gesture);
      return;
    }
    if (d.mode === "move") {
      const { box, guides } = snapMove({ ...d.group, x: d.group.x + dx, y: d.group.y + dy }, d.targets, opts);
      const sx = box.x - d.group.x;
      const sy = box.y - d.group.y;
      onChange(
        Object.fromEntries(
          Object.entries(d.boxes).map(([id, b]) => [id, { ...b, x: round(b.x + sx), y: round(b.y + sy) }]),
        ),
        d.gesture,
      );
      setGuides(guides);
      return;
    }
    if (d.box.rotation) {
      onChange({ [d.id]: resizeRotated(d.box, dx, dy, { minSize: MIN_SIZE, keepRatio: e.shiftKey }) }, d.gesture);
      setGuides([]);
      return;
    }
    const result = snapResize({ ...d.box, w: d.box.w + dx, h: d.box.h + dy }, d.targets, {
      ...opts,
      minSize: MIN_SIZE,
      ratio: e.shiftKey ? d.box.w / d.box.h : undefined,
    });
    onChange({ [d.id]: result.box }, d.gesture);
    setGuides(result.guides);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      return onSelect(template.elements.map((el) => el.id));
    }
    if (e.key === "Escape") return onSelect([]);
    if (selection.length === 0) return;
    if ((e.metaKey || e.ctrlKey) && (e.code === "BracketRight" || e.code === "BracketLeft")) {
      // Also keeps ⌘[ from being the browser's Back.
      e.preventDefault();
      const up = e.code === "BracketRight";
      return onRestack(e.shiftKey ? (up ? "front" : "back") : up ? "forward" : "backward");
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return onDelete(selection.map((el) => el.id));
    }
    const step = e.shiftKey ? 5 : grid || 0.5;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!delta) return;
    e.preventDefault();
    onChange(
      Object.fromEntries(
        selection.map((el) => [el.id, { ...boxOf(el), x: round(el.x + delta[0]), y: round(el.y + delta[1]) }]),
      ),
    );
  }

  // Handle size in mm, so it looks the same on a 20 mm and a 100 mm label.
  const handle = Math.max(width, height) / 40 + 0.6;
  // Grid lines: every grid step (faint, hidden when too dense to read) and a
  // stronger line every 5 mm (10 for a 2 mm grid, so both line up), or every
  // step if the grid is coarser than that.
  const major = grid >= 5 ? grid : grid > 0 && (5 / grid) % 1 !== 0 ? 10 : 5;
  const minor = grid >= 0.5 && Math.max(width, height) / grid <= 200 ? grid : 0;

  return (
    <svg
      ref={svgRef}
      viewBox={`${-PAD} ${-PAD} ${width + 2 * PAD} ${height + 2 * PAD}`}
      className="block max-h-[50vh] w-full touch-none rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={startSelect}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      aria-label="Label layout"
    >
      <defs>
        <pattern id={patternId} width={major} height={major} patternUnits="userSpaceOnUse">
          {minor > 0 && minor < major && (
            <path
              d={Array.from({ length: Math.round(major / minor) }, (_, i) => {
                const at = +(i * minor).toFixed(3);
                return `M${at} 0V${major}M0 ${at}H${major}`;
              }).join("")}
              fill="none"
              stroke="#000"
              strokeOpacity="0.04"
              strokeWidth="0.05"
            />
          )}
          <path
            d={`M${major} 0H0V${major}`}
            fill="none"
            stroke="#000"
            strokeOpacity="0.1"
            strokeWidth="0.1"
          />
        </pattern>
      </defs>
      <rect width={width} height={height} fill="#fff" />
      <rect width={width} height={height} fill={`url(#${patternId})`} />
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
          transform={rotateAttr(el)}
          fill="transparent"
          stroke={selectedIds.includes(el.id) ? "#2563eb" : "#000"}
          strokeOpacity={selectedIds.includes(el.id) ? 1 : 0.2}
          strokeWidth={selectedIds.includes(el.id) ? 0.25 : 0.12}
          strokeDasharray={selectedIds.includes(el.id) ? undefined : "0.6 0.4"}
          className="cursor-move"
          onPointerDown={(e) => startDrag(e, el, "move")}
        />
      ))}
      {guides.map((g) =>
        g.axis === "x" ? (
          <line
            key={`x${g.at}`}
            x1={g.at}
            x2={g.at}
            y1={-PAD}
            y2={height + PAD}
            stroke="#ec4899"
            strokeWidth="0.15"
            pointerEvents="none"
          />
        ) : (
          <line
            key={`y${g.at}`}
            x1={-PAD}
            x2={width + PAD}
            y1={g.at}
            y2={g.at}
            stroke="#ec4899"
            strokeWidth="0.15"
            pointerEvents="none"
          />
        ),
      )}
      {group && (
        <rect
          x={group.x}
          y={group.y}
          width={group.w}
          height={group.h}
          fill="none"
          stroke="#2563eb"
          strokeWidth="0.12"
          strokeDasharray="0.8 0.5"
          pointerEvents="none"
        />
      )}
      {marquee && (
        <rect
          x={marquee.x}
          y={marquee.y}
          width={marquee.w}
          height={marquee.h}
          fill="#2563eb"
          fillOpacity="0.08"
          stroke="#2563eb"
          strokeWidth="0.12"
          pointerEvents="none"
        />
      )}
      {selected && (
        // Handles live in the element's own (rotated) frame, on its corners.
        <g transform={rotateAttr(selected)}>
          <rect
            x={selected.x + selected.w - handle / 2}
            y={selected.y + selected.h - handle / 2}
            width={handle}
            height={handle}
            fill="#2563eb"
            className="cursor-nwse-resize"
            onPointerDown={(e) => startDrag(e, selected, "resize")}
          >
            <title>Resize (Shift keeps proportions)</title>
          </rect>
          <circle
            cx={selected.x + selected.w}
            cy={selected.y}
            r={handle / 2}
            fill="#fff"
            stroke="#2563eb"
            strokeWidth={handle / 5}
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={(e) => startDrag(e, selected, "rotate")}
          >
            <title>Rotate (Shift locks to 15° steps)</title>
          </circle>
        </g>
      )}
    </svg>
  );
}
