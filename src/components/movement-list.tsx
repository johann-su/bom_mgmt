import Link from "next/link";
import { ArrowRight, Hammer, Minus, Plus, Scale } from "lucide-react";
import type { MovementRow } from "@/lib/movement-queries";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_ICON = { add: Plus, remove: Minus, adjust: Scale, move: ArrowRight, build: Hammer };

// A location as recorded at the time — linked while it still exists. No
// path means the unsorted pile (a deleted location keeps its path).
function Place({ id, path }: { id: string | null; path: string }) {
  if (!path) return <span className="text-muted-foreground">Unsorted</span>;
  return id ? (
    <Link href={`/locations/${id}`} className="font-mono hover:underline">
      {path}
    </Link>
  ) : (
    <span className="font-mono text-muted-foreground line-through">{path}</span>
  );
}

export function MovementList({
  movements,
  showPart = false,
}: {
  movements: MovementRow[];
  showPart?: boolean;
}) {
  if (movements.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No stock changes yet.</p>;
  }
  return (
    <ul className="divide-y">
      {movements.map((m) => {
        const Icon = KIND_ICON[m.kind];
        return (
          <li key={m.id} className="flex items-start gap-3 py-2.5 text-sm">
            <div
              className={cn(
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full",
                m.kind === "add" || (m.kind === "adjust" && m.quantity > 0)
                  ? "bg-primary/15 text-primary"
                  : m.kind === "move"
                    ? "bg-muted text-muted-foreground"
                    : "bg-destructive/15 text-destructive",
              )}
            >
              <Icon className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5">
                {showPart && (
                  <Link href={`/parts/${m.partId}`} className="font-medium hover:underline">
                    {m.partName}
                  </Link>
                )}
                {m.kind === "move" ? (
                  <>
                    <span>moved {formatQuantity(m.quantity, m.unit)}</span>
                    <Place id={m.locationId} path={m.locationPath} />
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                    <Place id={m.toLocationId} path={m.toLocationPath} />
                  </>
                ) : (
                  <>
                    <span className="tabular-nums font-medium">
                      {m.quantity > 0 ? "+" : "−"}
                      {formatQuantity(Math.abs(m.quantity), m.unit)}
                    </span>
                    <span className="text-muted-foreground">
                      {m.kind === "adjust" ? "counted at" : m.kind === "build" ? "used from" : "at"}
                    </span>
                    <Place id={m.locationId} path={m.locationPath} />
                  </>
                )}
                {m.bomId && (
                  <span className="text-muted-foreground">
                    for{" "}
                    <Link href={`/boms/${m.bomId}`} className="hover:underline">
                      {m.bomName}
                    </Link>
                  </span>
                )}
              </div>
              {m.note && <div className="text-muted-foreground">“{m.note}”</div>}
            </div>
            <div className="shrink-0 text-right text-xs text-muted-foreground">
              <div>{formatDateTime(m.createdAt)}</div>
              {m.userName && <div>{m.userName}</div>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
