"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import type { LocationNode } from "@/lib/location-tree";
import { LocationIcon } from "@/components/location-icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function allIds(nodes: LocationNode[]): string[] {
  return nodes.flatMap((n) => [n.id, ...allIds(n.children)]);
}

export function LocationTree({
  tree,
  partCounts,
}: {
  tree: LocationNode[];
  partCounts: Record<string, number>;
}) {
  // Top level starts expanded: shelves are few, their contents are the point.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.map((n) => n.id)));

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A render function rather than a nested component, so rows don't remount
  // on every state change (see AGENTS.md → Code organization).
  const renderNode = (node: LocationNode) => {
    const open = expanded.has(node.id);
    const parts = partCounts[node.id] ?? 0;
    return (
      <li key={node.id}>
        <div
          className="flex items-center gap-1 rounded-md py-1 pr-2 hover:bg-accent/50"
          style={{ paddingLeft: `${node.depth * 1.25 + 0.25}rem` }}
        >
          <button
            type="button"
            onClick={() => toggle(node.id)}
            aria-label={open ? "Collapse" : "Expand"}
            aria-expanded={open}
            className={cn(
              "flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent",
              node.children.length === 0 && "invisible",
            )}
          >
            <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
          </button>
          <Link
            href={`/locations/${node.id}`}
            className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-sm"
          >
            <LocationIcon name={node.type.icon} className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">{node.type.name}</span>
            <span className="font-mono font-semibold">{node.label}</span>
            {node.name && <span className="truncate">{node.name}</span>}
          </Link>
          {node.children.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {node.children.length} inside
            </span>
          )}
          {parts > 0 && (
            <span className="ml-2 rounded-full bg-muted px-2 text-xs tabular-nums">
              {parts} part{parts === 1 ? "" : "s"}
            </span>
          )}
        </div>
        {open && node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="flex justify-end gap-1 border-b pb-2 mb-1">
        <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(allIds(tree)))}>
          <ChevronsUpDown className="size-4" />
          Expand all
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
          <ChevronsDownUp className="size-4" />
          Collapse all
        </Button>
      </div>
      <ul>{tree.map(renderNode)}</ul>
    </div>
  );
}
