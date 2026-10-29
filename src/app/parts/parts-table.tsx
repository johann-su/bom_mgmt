import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import type { PartListRow } from "@/lib/part-queries";
import type { CategoryGroup, GroupedItem, PartSort, PartsView } from "@/lib/parts-list-view";
import { formatStock, isLowStock } from "@/lib/stock";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { setCategoriesCollapsed } from "./list-actions";

export type PartsTableRow = PartListRow & {
  thumb: string | null;
  locations: { code: string; path: string }[];
  // Has stock that isn't put away in a location yet.
  unsorted: boolean;
};

export function PartsTable({
  rows,
  sorting,
  groups,
}: {
  rows: PartsTableRow[];
  // Clickable column headers; without it (search results) they're plain.
  sorting?: { view: PartsView; hrefs: Record<PartSort, string> };
  // Set when sorted by category: the page as collapsible sections
  // (groupedPage in parts-list-view.ts), used instead of `rows`. The
  // category column is left out — the section headers say it.
  groups?: { items: GroupedItem<PartsTableRow>[]; all: CategoryGroup[] };
}) {
  const grouped = !!groups;

  function renderRow(row: PartsTableRow) {
    const low = isLowStock(row.total, row.minStock, row.tracking);
    return (
      <TableRow key={row.id}>
        <TableCell>
          <Link href={`/parts/${row.id}`} className="flex items-center gap-3 hover:underline">
            <PartThumb fileId={row.thumb} icon={row.icon} className="size-10" />
            <div className="min-w-0">
              <div className="truncate font-medium">{row.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {[row.manufacturer, row.mpn].filter(Boolean).join(" · ")}
              </div>
            </div>
          </Link>
        </TableCell>
        {!grouped && (
          <TableCell className="hidden md:table-cell text-muted-foreground">{row.category ?? "—"}</TableCell>
        )}
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
        <TableCell
          className={cn(
            "text-right tabular-nums",
            low && "text-destructive font-medium",
            row.tracking === "none" && "text-muted-foreground",
          )}
        >
          {formatStock(row.tracking, row.total, row.unit)}
          {low && row.tracking === "exact" && <div className="text-xs font-normal">min {row.minStock}</div>}
        </TableCell>
      </TableRow>
    );
  }

  // A section header; the whole row is a button that folds the section.
  function renderGroup(group: CategoryGroup) {
    const Chevron = group.collapsed ? ChevronRight : ChevronDown;
    return (
      <TableRow key={`group:${group.id}`} className="bg-muted/40 hover:bg-muted/60">
        <TableCell colSpan={3} className="p-0">
          <form action={setCategoriesCollapsed.bind(null, [group.id], !group.collapsed)}>
            <button
              type="submit"
              aria-expanded={!group.collapsed}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <Chevron className="size-3.5" />
              <span className="text-foreground">{group.name || "Uncategorised"}</span>
              <span className="tabular-nums opacity-70">{group.count}</span>
              {(group.empty > 0 || group.low > 0) && (
                <span className="ml-2 font-normal text-destructive">
                  {[group.empty && `${group.empty} empty`, group.low && `${group.low} low`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </button>
          </form>
        </TableCell>
      </TableRow>
    );
  }

  function sortHead(sort: PartSort, label: string, className?: string) {
    if (!sorting) return <TableHead className={className}>{label}</TableHead>;
    const { view, hrefs } = sorting;
    const active = view.sort === sort;
    const Icon = !active ? ChevronsUpDown : view.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead
        className={className}
        aria-sort={active ? (view.dir === "asc" ? "ascending" : "descending") : undefined}
      >
        <Link
          href={hrefs[sort]}
          scroll={false}
          className={cn(
            "inline-flex items-center gap-1 hover:text-foreground",
            active ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {label}
          <Icon className={cn("size-3.5", !active && "opacity-50")} />
        </Link>
      </TableHead>
    );
  }

  const allIds = groups?.all.map((g) => g.id) ?? [];
  return (
    <>
      {groups && allIds.length > 1 && (
        <div className="mb-2 flex justify-end gap-1">
          <form action={setCategoriesCollapsed.bind(null, allIds, true)}>
            <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
              Collapse all
            </Button>
          </form>
          <form action={setCategoriesCollapsed.bind(null, allIds, false)}>
            <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
              Expand all
            </Button>
          </form>
        </div>
      )}
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              {sortHead("name", "Part")}
              {!grouped && sortHead("category", "Category", "hidden md:table-cell")}
              {sortHead("location", "Location")}
              {sortHead("stock", "In stock", "text-right")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups
              ? groups.items.map((item) =>
                  item.kind === "row" ? renderRow(item.row) : renderGroup(item.group),
                )
              : rows.map(renderRow)}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

export function PartsPagination({
  page,
  pageCount,
  from,
  to,
  total,
  prevHref,
  nextHref,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-2">
        <span className="tabular-nums">
          Page {page} of {pageCount}
        </span>
        {pageLink(prevHref, "Previous page", <ChevronLeft className="size-4" />)}
        {pageLink(nextHref, "Next page", <ChevronRight className="size-4" />)}
      </div>
    </div>
  );
}

function pageLink(href: string | null, label: string, icon: React.ReactNode) {
  return href ? (
    <Button variant="outline" size="icon" asChild>
      <Link href={href} aria-label={label}>
        {icon}
      </Link>
    </Button>
  ) : (
    <Button variant="outline" size="icon" disabled aria-label={label}>
      {icon}
    </Button>
  );
}
