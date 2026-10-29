import { STOCK_STATUSES, stockStatus } from "@/lib/part-filters";
import type { Tracking } from "@/lib/stock";

// Sorting and paging of the parts list. Both live in the URL next to the
// filters (?sort=stock&dir=desc&page=2), so a view can be bookmarked and the
// server renders it directly. Sorting happens here rather than in SQL because
// location codes are computed from the label chain in JS, and names want a
// natural order ("M3×4" before "M3×10") that a plain ORDER BY doesn't give.

export const PART_SORTS = ["name", "category", "location", "stock"] as const;
export type PartSort = (typeof PART_SORTS)[number];
export type SortDir = "asc" | "desc";

export const PARTS_PAGE_SIZE = 50;

export type PartsView = { sort: PartSort; dir: SortDir; page: number };

// Grouped by category (collapsible sections, see groupedPage) unless the
// user picks another column.
const DEFAULT_VIEW: PartsView = { sort: "category", dir: "asc", page: 1 };

/** The view from raw search params; anything unknown falls back to the default. */
export function parsePartsView(params: { sort?: string; dir?: string; page?: string }): PartsView {
  const sort = (PART_SORTS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as PartSort)
    : DEFAULT_VIEW.sort;
  const dir: SortDir = params.dir === "desc" ? "desc" : "asc";
  const page = Math.max(1, Math.floor(Number(params.page)) || 1);
  return { sort, dir, page };
}

/** Search params for a view, leaving out the defaults so plain URLs stay plain. */
export function partsViewParams(view: PartsView): Record<string, string> {
  const out: Record<string, string> = {};
  if (view.sort !== DEFAULT_VIEW.sort) out.sort = view.sort;
  if (view.dir !== DEFAULT_VIEW.dir) out.dir = view.dir;
  if (view.page > 1) out.page = String(view.page);
  return out;
}

/** The view after clicking a column header: same column flips, a new one starts ascending. */
export function toggleSort(view: PartsView, sort: PartSort): PartsView {
  const dir: SortDir = view.sort === sort && view.dir === "asc" ? "desc" : "asc";
  return { sort, dir, page: 1 };
}

export type SortablePart = {
  name: string;
  category: string | null;
  tracking: Tracking;
  total: number;
  minStock: number | null;
  locations: { code: string }[];
};

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

// How urgently a part needs attention, lowest first: empty, then low, then
// fine, with untracked parts last since they can't run out.
function stockRank(p: SortablePart): number {
  return STOCK_STATUSES.indexOf(stockStatus(p));
}

// Missing values (no category, no location) sort last in either direction —
// they're the least informative rows, not the "smallest".
function compareMissingLast(a: string | undefined | null, b: string | undefined | null, dir: number) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return dir * natural.compare(a, b);
}

export function sortParts<T extends SortablePart>(rows: T[], sort: PartSort, dir: SortDir): T[] {
  const d = dir === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => natural.compare(a.name, b.name);
  const primary: (a: T, b: T) => number = {
    name: (a: T, b: T) => d * byName(a, b),
    category: (a: T, b: T) => compareMissingLast(a.category, b.category, d),
    location: (a: T, b: T) => compareMissingLast(a.locations[0]?.code, b.locations[0]?.code, d),
    stock: (a: T, b: T) => {
      // Within a rank, counted parts come before level ones (a count says
      // more) and are ordered by quantity; levels are already in the rank.
      const counted = (p: T) => (p.tracking === "exact" ? 0 : 1);
      const qty = (p: T) => (p.tracking === "exact" ? p.total : 0);
      return d * (stockRank(a) - stockRank(b) || counted(a) - counted(b) || qty(a) - qty(b));
    },
  }[sort];
  // Ties always fall back to the name, ascending, so the order is stable and
  // variants of one part stay in their natural sequence.
  return [...rows].sort((a, b) => primary(a, b) || byName(a, b));
}

export function paginate<T>(rows: T[], page: number, pageSize = PARTS_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: current,
    pageCount,
    from: rows.length ? start + 1 : 0,
    to: Math.min(start + pageSize, rows.length),
  };
}

// --- Category groups ---
//
// Sorted by category, the list reads as sections with a header row each, and
// a section can be collapsed to just that header. Which ones are collapsed is
// a per-browser preference kept in a cookie (COLLAPSED_COOKIE), so the server
// can leave their rows out when it pages the list.

export const COLLAPSED_COOKIE = "parts-collapsed";
// Stands for "uncategorised" in the cookie, where "" would vanish in a join.
const NO_CATEGORY = "-";

export function parseCollapsed(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .slice(0, 500)
      .filter(Boolean)
      .map((id) => (id === NO_CATEGORY ? "" : id)),
  );
}

export function serializeCollapsed(ids: Iterable<string>): string {
  return [...ids].map((id) => (id === "" ? NO_CATEGORY : id)).join(",");
}

export type CategoryGroup = {
  // Category id; "" = uncategorised.
  id: string;
  name: string;
  count: number;
  // How many of its parts are out or running low — what a collapsed
  // section still has to tell.
  empty: number;
  low: number;
  collapsed: boolean;
};

export type GroupedItem<T> = { kind: "group"; group: CategoryGroup } | { kind: "row"; row: T };

/**
 * One page of a category-sorted list as header and part rows. Only parts of
 * expanded groups take up page slots; a collapsed group's header shows on the
 * page where its rows would have started, and an expanded group's header
 * repeats on every page it continues onto.
 */
export function groupedPage<T extends SortablePart & { categoryId: string | null }>(
  sorted: T[],
  collapsed: Set<string>,
  page: number,
  pageSize = PARTS_PAGE_SIZE,
) {
  const groups: { group: CategoryGroup; rows: T[] }[] = [];
  for (const row of sorted) {
    const id = row.categoryId ?? "";
    let last = groups.at(-1);
    if (!last || last.group.id !== id) {
      last = {
        group: { id, name: row.category ?? "", count: 0, empty: 0, low: 0, collapsed: collapsed.has(id) },
        rows: [],
      };
      groups.push(last);
    }
    last.rows.push(row);
    last.group.count += 1;
    const status = stockStatus(row);
    if (status === "empty") last.group.empty += 1;
    if (status === "low") last.group.low += 1;
  }

  const visible = groups.reduce((n, g) => n + (g.group.collapsed ? 0 : g.rows.length), 0);
  const paged = paginate(Array.from({ length: visible }), page, pageSize);
  const start = (paged.page - 1) * pageSize;
  const end = start + paged.rows.length;
  const lastPage = paged.page === paged.pageCount;

  const items: GroupedItem<T>[] = [];
  let position = 0;
  for (const { group, rows } of groups) {
    if (group.collapsed) {
      if ((position >= start && position < end) || (position === visible && lastPage)) {
        items.push({ kind: "group", group });
      }
      continue;
    }
    const shown = rows.slice(Math.max(0, start - position), Math.max(0, end - position));
    if (shown.length) {
      items.push({ kind: "group", group });
      for (const row of shown) items.push({ kind: "row", row });
    }
    position += rows.length;
  }
  return {
    items,
    groups: groups.map((g) => g.group),
    page: paged.page,
    pageCount: paged.pageCount,
    from: paged.from,
    to: paged.to,
    total: visible,
  };
}
