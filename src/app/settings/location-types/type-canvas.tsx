"use client";

import "@xyflow/react/dist/style.css";
import { useRef, useState, useTransition } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { LayoutGrid, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  applyNodeChanges,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  type Connection,
  type FinalConnectionState,
  type ReactFlowInstance,
  useNodes,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { autoLayout, placeTypes, routeLink, withLink, withoutLink } from "@/lib/type-canvas";
import { SELF_TYPE } from "@/lib/code-grammar";
import { LocationIcon } from "@/components/location-icon";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deleteLocationType, saveTypePositions, setTypeChildren } from "./actions";
import type { LocationTypeRow, PendingLink } from "./location-type-dialog";

// The type grammar as a node graph: each location type is a node, and a link
// A → B means "an A can hold a B". Dragging from a node's right handle onto
// another node opens the child's dialog to confirm the link (onto itself: Box
// in Box; onto empty canvas: a new type there); a selected link is removed with its × or Backspace. Every change
// goes through the same server checks as the edit dialog and is rolled back if
// refused.

type Rules = Record<string, string[] | null>;

type TypeNodeData = {
  type: LocationTypeRow;
  holds: string[] | null;
  // "Holds Box, Drawer" / "Parts only" / "Holds any type".
  summary: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleAny: () => void;
};
type TypeNode = Node<TypeNodeData, "type">;
type HoldEdge = Edge<{ onRemove: () => void }, "hold">;

const handleClass = "!size-3 !border-2 !border-background !bg-muted-foreground";

function TypeNodeView({ data, selected }: NodeProps<TypeNode>) {
  const { type, holds } = data;
  const any = holds === null;
  return (
    <div
      className={cn(
        "w-60 rounded-lg border bg-card px-3 py-2 text-sm text-card-foreground shadow-xs",
        any && "border-dashed",
        selected && "ring-2 ring-ring",
      )}
      onDoubleClick={data.onEdit}
    >
      <Handle type="target" position={Position.Left} className={handleClass} />
      <div className="flex items-center gap-2">
        <LocationIcon name={type.icon} className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{type.name}</span>
        <code className="ml-auto shrink-0 rounded bg-muted px-1 font-mono text-xs">{type.labelPattern}</code>
      </div>
      <div className="mt-1.5 flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
        <span className="mr-auto truncate" title={data.summary}>
          {data.summary}
        </span>
        <button
          type="button"
          className="nodrag rounded px-1 hover:bg-muted hover:text-foreground"
          onClick={data.onToggleAny}
          title={any ? "Only allow the linked types" : "Allow any type inside"}
        >
          {any ? "Restrict" : "Allow any"}
        </button>
        <button
          type="button"
          className="nodrag rounded p-0.5 hover:bg-muted hover:text-foreground"
          onClick={data.onEdit}
          aria-label={`Edit ${type.name}`}
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          className="nodrag rounded p-0.5 enabled:hover:bg-muted enabled:hover:text-destructive disabled:opacity-40"
          onClick={data.onDelete}
          disabled={type.usage > 0}
          aria-label={`Delete ${type.name}`}
          title={
            type.usage > 0
              ? `${type.usage === 1 ? "1 location still uses" : `${type.usage} locations still use`} ${type.name}`
              : `Delete ${type.name}`
          }
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <Handle type="source" position={Position.Right} className={handleClass} />
    </div>
  );
}

// A link between two types: a curve, or — when that would run behind cards
// (pointing back left, or across a type in between) — a detour around them
// (routeLink). A type that holds itself gets a loop over its top.
function HoldEdgeView(props: EdgeProps<HoldEdge>) {
  const { source, target, sourceX, sourceY, targetX, targetY } = props;
  // Every card's box, so the route can keep clear of all of them.
  const cards = useNodes().map((n) => ({
    x: n.position.x,
    y: n.position.y,
    width: n.measured?.width ?? 240,
    height: n.measured?.height ?? 56,
  }));
  let path: string;
  let labelX: number;
  let labelY: number;
  if (source === target) {
    const lift = 80;
    path = `M ${sourceX} ${sourceY} C ${sourceX + 70} ${sourceY - lift}, ${targetX - 70} ${targetY - lift}, ${targetX} ${targetY}`;
    labelX = (sourceX + targetX) / 2;
    labelY = sourceY - lift * 0.75;
  } else {
    const link = routeLink({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, cards);
    path = link.path;
    labelX = link.label.x;
    labelY = link.label.y;
  }
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerEnd={props.markerEnd}
        style={{ strokeWidth: props.selected ? 2.5 : 1.5 }}
      />
      {props.selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className="nodrag nopan absolute flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs hover:text-destructive"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
            }}
            onClick={props.data?.onRemove}
            aria-label="Remove link"
          >
            <X className="size-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

function summarize(holds: string[] | null, byId: Map<string, LocationTypeRow>): string {
  if (holds === null) return "Holds any type";
  const names = holds.flatMap((id) => byId.get(id)?.name ?? []);
  return names.length ? `Holds ${names.join(", ")}` : "Parts only";
}

const nodeTypes = { type: TypeNodeView };
const edgeTypes = { hold: HoldEdgeView };

function rulesOf(types: LocationTypeRow[]): Rules {
  return Object.fromEntries(types.map((t) => [t.id, t.childTypeIds]));
}

function nodesOf(types: LocationTypeRow[]): Node[] {
  const spots = placeTypes(types);
  return types.map((t) => ({
    id: t.id,
    type: "type",
    position: spots.get(t.id)!,
    // Only empty types can go (the server refuses the rest too); Backspace
    // on one asks first, see onBeforeDelete.
    deletable: t.usage === 0,
    data: {},
  }));
}

export function TypeCanvas({
  types,
  onEdit,
  onAdd,
  onLink,
}: {
  types: LocationTypeRow[];
  onEdit: (type: LocationTypeRow) => void;
  onAdd: () => void;
  // `child` is null when the link was dropped on empty canvas: a new type.
  onLink: (child: LocationTypeRow | null, link: PendingLink) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [, startTransition] = useTransition();
  // Local copies so links and drags show at once; re-seeded whenever the
  // server sends new types (after any save, here or in the dialog).
  const [seeded, setSeeded] = useState(types);
  const [rules, setRules] = useState<Rules>(() => rulesOf(types));
  const [positions, setPositions] = useState<Node[]>(() => nodesOf(types));
  const flow = useRef<ReactFlowInstance<TypeNode, HoldEdge> | null>(null);
  // The type whose deletion is being confirmed.
  const [deleting, setDeleting] = useState<LocationTypeRow | null>(null);
  // Links are derived from `rules`, so only their selection is kept here.
  const [selectedEdges, setSelectedEdges] = useState<Set<string>>(new Set());
  if (seeded !== types) {
    setSeeded(types);
    setRules(rulesOf(types));
    setPositions(nodesOf(types));
  }
  const byId = new Map(types.map((t) => [t.id, t]));

  // Applies new child lists (one per changed type) at once, saving them in
  // turn; the first refusal rolls the whole batch back.
  function change(updates: Rules, success?: string) {
    const before = rules;
    setRules({ ...rules, ...updates });
    startTransition(async () => {
      for (const [id, childTypeIds] of Object.entries(updates)) {
        const { error } = await setTypeChildren({ id, childTypeIds });
        if (error) {
          toast.error(error);
          setRules(before);
          return;
        }
      }
      if (success) toast.success(success);
    });
  }

  // A new link isn't saved straight away: the child's dialog opens so its
  // labels can be checked against the parent's (and fixed) before linking.
  // Linking from "any" narrows the parent to this one link.
  function connect(c: Connection) {
    const parent = byId.get(c.source);
    const child = byId.get(c.target);
    if (!parent || !child) return;
    onLink(child, { parentId: parent.id, childTypeIds: withLink(rules[parent.id], child.id) });
  }

  // A link dropped on empty canvas creates a type there: from a right handle
  // a new child of that node, from a left handle a new parent holding it.
  function dropLink(event: MouseEvent | TouchEvent, state: FinalConnectionState) {
    if (state.isValid || !state.fromNode || !state.fromHandle || state.toNode) return;
    const point = "changedTouches" in event ? event.changedTouches[0] : event;
    const drop = flow.current?.screenToFlowPosition({ x: point.clientX, y: point.clientY });
    if (!drop) return;
    const from = state.fromNode.id;
    // Centre the new node's matching handle on the drop point (node: w-60, ~3rem tall).
    const at = { x: state.fromHandle.type === "source" ? drop.x : drop.x - 240, y: drop.y - 24 };
    onLink(
      null,
      state.fromHandle.type === "source"
        ? { parentId: from, childTypeIds: withLink(rules[from], SELF_TYPE), at }
        : { parentId: SELF_TYPE, childTypeIds: [from], at },
    );
  }

  function remove(parentId: string, childId: string) {
    change({ [parentId]: withoutLink(rules[parentId], childId) });
  }

  function tidy() {
    const layout = autoLayout(types.map((t) => ({ ...t, childTypeIds: rules[t.id] })));
    setPositions((nodes) => nodes.map((n) => ({ ...n, position: layout.get(n.id) ?? n.position })));
    startTransition(async () => {
      await saveTypePositions({
        positions: [...layout].map(([id, p]) => ({ id, x: p.x, y: p.y })),
      });
    });
  }

  const nodes: TypeNode[] = positions.flatMap((n) => {
    const type = byId.get(n.id);
    if (!type) return [];
    return [
      {
        ...n,
        type: "type" as const,
        data: {
          type,
          holds: rules[type.id] ?? null,
          summary: summarize(rules[type.id] ?? null, byId),
          onEdit: () => onEdit(type),
          onDelete: () => setDeleting(type),
          onToggleAny: () =>
            change(
              { [type.id]: rules[type.id] === null ? [] : null },
              rules[type.id] === null
                ? `${type.name} now holds only linked types — draw links to allow some`
                : undefined,
            ),
        },
      },
    ];
  });

  const edges: HoldEdge[] = Object.entries(rules).flatMap(([parent, children]) =>
    (children ?? [])
      .filter((child) => byId.has(child))
      .map((child) => ({
        id: `${parent}->${child}`,
        source: parent,
        target: child,
        type: "hold" as const,
        selected: selectedEdges.has(`${parent}->${child}`),
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        data: { onRemove: () => remove(parent, child) },
      })),
  );

  return (
    <div className="h-[32rem] overflow-hidden rounded-lg border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={resolvedTheme === "dark" ? "dark" : "light"}
        onNodesChange={(changes: NodeChange[]) => setPositions((n) => applyNodeChanges(changes, n))}
        onNodeDragStop={(_, __, dragged) =>
          startTransition(async () => {
            await saveTypePositions({
              positions: dragged.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y })),
            });
          })
        }
        onEdgesChange={(changes: EdgeChange[]) =>
          setSelectedEdges((current) => {
            const next = new Set(current);
            for (const c of changes) {
              if (c.type === "select") {
                if (c.selected) next.add(c.id);
                else next.delete(c.id);
              }
            }
            return next;
          })
        }
        onConnect={connect}
        onConnectEnd={dropLink}
        onInit={(instance) => (flow.current = instance)}
        isValidConnection={(c) => !(rules[c.source] ?? []).includes(c.target)}
        onEdgesDelete={(deleted) => {
          // Several links may share a parent: fold them into one list per type.
          const updates: Rules = {};
          for (const e of deleted) {
            updates[e.source] = withoutLink(updates[e.source] ?? rules[e.source], e.target);
          }
          change(updates);
        }}
        // Backspace on a selected type asks for confirmation instead of
        // deleting at once; links still go straight away.
        onBeforeDelete={async ({ nodes: selected }) => {
          const type = selected.length > 0 ? byId.get(selected[0].id) : undefined;
          if (!type) return true;
          setDeleting(type);
          return false;
        }}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} />
        <Controls showInteractive={false} />
        <Panel position="top-left" className="flex gap-2">
          <Button size="sm" onClick={onAdd}>
            <Plus className="size-4" />
            Add type
          </Button>
          <Button size="sm" variant="outline" onClick={tidy}>
            <LayoutGrid className="size-4" />
            Tidy up
          </Button>
        </Panel>
        <Panel position="bottom-right" className="max-w-xs text-right text-xs text-muted-foreground">
          Drag from a type&apos;s right handle onto another to let it hold that type, or into empty
          space to create one. Select a link or an unused type to remove it. Dashed types hold any
          type.
        </Panel>
      </ReactFlow>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{deleting?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              No location uses this type, so nothing else is lost — its links to other types go
              with it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                const type = deleting;
                if (!type) return;
                startTransition(async () => {
                  const { error } = await deleteLocationType({ id: type.id });
                  if (error) toast.error(error);
                  else toast.success(`${type.name} deleted`);
                });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
