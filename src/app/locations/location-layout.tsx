import type { LayoutNode } from "@/lib/location-layout";
import { LocationIcon } from "@/components/location-icon";

// The storage layout as a left-to-right diagram: one box per type path
// ("Box ×12, 1–6"), joined by connector lines. Read-only — the tree view is
// where locations get added and moved.
export function LocationLayout({ layout }: { layout: LayoutNode[] }) {
  const renderBranch = (nodes: LayoutNode[]) => (
    <ul className="flex flex-col gap-2">
      {nodes.map((node) => (
        // Each child gets a horizontal stub (before:) and its share of the
        // vertical spine (after:), trimmed to the middle on the first/last
        // child so the spine runs exactly between the outermost stubs.
        <li
          key={node.key}
          className="relative flex items-center pl-6 before:absolute before:left-0 before:top-1/2 before:w-6 before:border-t before:border-border after:absolute after:left-0 after:top-0 after:bottom-0 after:border-l after:border-border first:after:top-1/2 last:after:bottom-1/2"
        >
          <div className="flex shrink-0 items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-sm shadow-xs">
            <LocationIcon name={node.type.icon} className="size-4 text-muted-foreground" />
            <span className="font-medium">{node.type.name}</span>
            <span className="text-muted-foreground tabular-nums">×{node.count}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {node.first === node.last ? node.first : `${node.first}–${node.last}`}
            </span>
          </div>
          {node.children.length > 0 && (
            <div className="relative flex items-center pl-6 before:absolute before:left-0 before:top-1/2 before:w-6 before:border-t before:border-border">
              {renderBranch(node.children)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="overflow-x-auto rounded-lg border p-4">
      <div className="flex w-max items-center">
        {/* The implicit root every top-level location hangs off. */}
        <span className="size-3 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
        <div className="relative flex items-center pl-6 before:absolute before:left-0 before:top-1/2 before:w-6 before:border-t before:border-border">
          {renderBranch(layout)}
        </div>
      </div>
    </div>
  );
}
