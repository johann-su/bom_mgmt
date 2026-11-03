// Query-string parsing and keyset cursors for the API's list endpoints
// (GET /api/v1/parts, /movements). Pure, so the rules are unit-tested; the
// SQL that consumes them lives in src/lib/api/queries.ts.
//
// Listings are keyset-paginated on (sort key, id): a stable total order, so
// paging never skips or repeats a row while parts are added. The cursor
// records which sort it belongs to, and one from another sort is rejected
// rather than silently misread. Timestamps travel as Postgres' own text form
// (microseconds): a JS Date would round them to milliseconds, and rows
// created within the same millisecond as a page boundary would be skipped.

import { isUuid } from "@/lib/utils";
import { MOVEMENT_KINDS, TRACKING_MODES, type MovementKind, type Tracking } from "@/lib/stock";

export { isUuid };

export const PART_SORTS = [
  "name_asc",
  "created_desc",
  "created_asc",
  "updated_desc",
  "updated_asc",
] as const;
export type PartSort = (typeof PART_SORTS)[number];

export const MOVEMENT_SORTS = ["created_desc", "created_asc"] as const;
export type MovementSort = (typeof MOVEMENT_SORTS)[number];

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

// `at` is the sort key of the last row: a timestamp's text, or a part name.
export type Cursor = { sort: string; at: string; id: string };

// "2026-11-02 14:22:44.116789" — to_char(…, 'YYYY-MM-DD HH24:MI:SS.US').
const PG_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

/** Whether a sort pages by a timestamp (vs. a part name). */
export const sortsByTime = (sort: string) => !sort.startsWith("name_");

export function encodeCursor(sort: string, at: string, id: string): string {
  return Buffer.from(JSON.stringify({ s: sort, a: at, i: id })).toString("base64url");
}

export function decodeCursor(raw: string, sort: string): Cursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const at = parsed?.a;
    if (
      parsed?.s !== sort ||
      typeof at !== "string" ||
      (sortsByTime(sort) ? !PG_TIMESTAMP_RE.test(at) : at.length > 500) ||
      typeof parsed.i !== "string" ||
      !isUuid(parsed.i)
    ) {
      return null;
    }
    return { sort, at, id: parsed.i };
  } catch {
    return null;
  }
}

type Parsed<T> = T | { error: string };

// Thrown by the readers below, caught at the top of each parser.
class ParamError extends Error {}

function limitParam(raw: string | null): number {
  if (raw === null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ParamError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return n;
}

// Only the spellings a client would send on purpose; "yes" or a typo is an
// error rather than a silent false.
function booleanParam(sp: URLSearchParams, name: string): boolean {
  const raw = sp.get(name);
  if (raw === null || raw === "") return false;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new ParamError(`${name} must be true or false`);
}

function idParam(sp: URLSearchParams, name: string, what: string): string | undefined {
  const raw = sp.get(name) || undefined;
  if (raw && !isUuid(raw)) throw new ParamError(`${name} must be ${what}`);
  return raw;
}

function textParam(sp: URLSearchParams, name: string, max = 200): string | undefined {
  const value = sp.get(name)?.trim() || undefined;
  if (value && value.length > max) throw new ParamError(`${name} is too long`);
  return value;
}

function enumParam<T extends string>(sp: URLSearchParams, name: string, values: readonly T[]): T | undefined {
  const raw = sp.get(name) || undefined;
  if (raw && !(values as readonly string[]).includes(raw)) {
    throw new ParamError(`${name} must be one of ${values.join(", ")}`);
  }
  return raw as T | undefined;
}

function timeParam(sp: URLSearchParams, name: string): Date | undefined {
  const raw = sp.get(name);
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) throw new ParamError(`${name} must be an ISO 8601 timestamp`);
  return new Date(ms);
}

function paging<S extends string>(sp: URLSearchParams, sorts: readonly S[]) {
  const sort = enumParam(sp, "sort", sorts) ?? sorts[0];
  const limit = limitParam(sp.get("limit"));
  const rawCursor = sp.get("cursor");
  const cursor = rawCursor ? decodeCursor(rawCursor, sort) : null;
  if (rawCursor && !cursor) throw new ParamError("cursor is invalid or belongs to a different sort");
  return { sort, limit, cursor };
}

function parse<T>(read: () => T): Parsed<T> {
  try {
    return read();
  } catch (err) {
    if (err instanceof ParamError) return { error: err.message };
    throw err;
  }
}

export function parseLimit(raw: string | null): Parsed<number> {
  return parse(() => limitParam(raw));
}

export type PartListQuery = {
  q?: string;
  categoryId?: string;
  mpn?: string;
  locationId?: string;
  tracking?: Tracking;
  lowStock: boolean;
  unsorted: boolean;
  updatedSince?: Date;
  sort: PartSort;
  limit: number;
  cursor: Cursor | null;
};

export function parsePartListQuery(sp: URLSearchParams): Parsed<PartListQuery> {
  return parse(() => ({
    q: textParam(sp, "q"),
    categoryId: idParam(sp, "category", "a category id"),
    mpn: textParam(sp, "mpn"),
    locationId: idParam(sp, "location", "a location id"),
    tracking: enumParam(sp, "tracking", TRACKING_MODES),
    lowStock: booleanParam(sp, "lowStock"),
    unsorted: booleanParam(sp, "unsorted"),
    updatedSince: timeParam(sp, "updatedSince"),
    ...paging(sp, PART_SORTS),
  }));
}

export type MovementListQuery = {
  partId?: string;
  bomId?: string;
  kind?: MovementKind;
  since?: Date;
  sort: MovementSort;
  limit: number;
  cursor: Cursor | null;
};

export function parseMovementListQuery(sp: URLSearchParams): Parsed<MovementListQuery> {
  return parse(() => ({
    partId: idParam(sp, "part", "a part id"),
    bomId: idParam(sp, "bom", "a BOM id"),
    kind: enumParam(sp, "kind", MOVEMENT_KINDS),
    since: timeParam(sp, "since"),
    ...paging(sp, MOVEMENT_SORTS),
  }));
}

/** `?units=` of GET /boms/{id}: how many units to check requirements for. */
export function parseUnits(raw: string | null): Parsed<number> {
  return parse(() => {
    if (raw === null || raw === "") return 1;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) {
      throw new ParamError("units must be an integer from 1 to 1000000");
    }
    return n;
  });
}
