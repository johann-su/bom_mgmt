import Link from "next/link";
import type { PartListRow } from "@/lib/part-queries";
import { formatQuantity } from "@/lib/format";
import { isLowStock } from "@/lib/stock";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PartThumb } from "@/components/part-thumb";

export type PartsTableRow = PartListRow & {
  thumb: string | null;
  locations: { code: string; path: string }[];
  // Has stock that isn't put away in a location yet.
  unsorted: boolean;
};

export function PartsTable({ rows }: { rows: PartsTableRow[] }) {
  return (
    <Card className="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Part</TableHead>
            <TableHead className="hidden md:table-cell">Category</TableHead>
            <TableHead>Location</TableHead>
            <TableHead className="text-right">In stock</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const low = isLowStock(row.total, row.minStock);
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <Link href={`/parts/${row.id}`} className="flex items-center gap-3 hover:underline">
                    <PartThumb fileId={row.thumb} className="size-10" />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{row.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[row.manufacturer, row.mpn].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">
                  {row.category ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {row.unsorted && (
                      <Badge variant="outline" title="Not put away in a location yet">
                        Unsorted
                      </Badge>
                    )}
                    {row.locations.slice(0, 3).map((l) => (
                      <Badge key={l.code} variant="secondary" className="font-mono" title={l.path}>
                        {l.code}
                      </Badge>
                    ))}
                    {row.locations.length > 3 && (
                      <span className="text-xs text-muted-foreground">+{row.locations.length - 3}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className={cn("text-right tabular-nums", low && "text-destructive font-medium")}>
                  {formatQuantity(row.total, row.unit)}
                  {low && <div className="text-xs font-normal">min {row.minStock}</div>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
