// The MCP tools: the inventory as calls an LLM client can make on the user's
// behalf. Read tools answer "do I have it, where is it, can I build this";
// write tools create, edit, import and delete parts and book stock — through
// the same code paths as the app's own forms (src/lib/part-mutations.ts,
// src/lib/part-import.ts), so validation, the movement log and page
// revalidation are identical. Argument translation lives in tool-input.ts.
//
// Every result carries app URLs (from BETTER_AUTH_URL, never the request) so
// the model can link the user to what it found or changed.

import { and, asc, count, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bomItems, boms, categories, files, parts, stock } from "@/db/schema";
import { appUrl } from "@/lib/app-url";
import { listBoms, loadBomLines } from "@/lib/bom-queries";
import { loadLocationOptions, loadLocations } from "@/lib/locations";
import { subtreeIds } from "@/lib/location-tree";
import { recentMovements } from "@/lib/movement-queries";
import { listParts, stockLocationsByPart } from "@/lib/part-queries";
import { createPart, changeStock, deletePart, moveStock, updatePart } from "@/lib/part-mutations";
import { createGenericParts } from "@/lib/generic-part-mutations";
import { suggestCategory } from "@/lib/category-suggest";
import { rangeParam } from "@/lib/generic-parts";
import { ensureCategories, runPartImport } from "@/lib/part-import";
import { guessPartMapping, PART_CSV_FIELDS, readPartCsv } from "@/lib/part-csv";
import {
  buildableUnits,
  isLowStock,
  levelLabel,
  requirements,
  totalStock,
  TRACKING_MODES,
  type Tracking,
} from "@/lib/stock";
import {
  InvalidParamsError,
  optionalBoolean,
  optionalInt,
  optionalString,
  optionalStringArray,
  readOnlyTools,
  requireEnum,
  requireObjectArray,
  requireString,
  requireUuid,
  ToolError,
  type McpTool,
} from "@/lib/mcp/protocol";
import {
  importRowsToTable,
  partFormValues,
  readAttributes,
  resolveLocation,
  resolveStockPlace,
  UNSORTED_REF,
  type PartPatch,
} from "@/lib/mcp/tool-input";
import {
  applyGenericChoice,
  describeGenericType,
  genericCatalogue,
  generatedPartView,
  readGenericChoice,
  readGenericValues,
  readRange,
  requireGenericType,
  resolveStrict,
} from "@/lib/mcp/generic-input";

const INSTRUCTIONS_COMMON = `This server is a workshop parts inventory: parts (with MPN, manufacturer, category, unit, attributes, order link), the storage locations they sit in, stock counts per location, and bills of materials (BOMs).

- Locations are addressed by code, e.g. "A/1/IV" (shelf A, box 1, bin IV). list_locations lists them.
- Stock that isn't put away yet sits in a part's "unsorted" pile; stock tools take "unsorted" as a location. Putting it away is a move_stock from "unsorted".
- Quantities are whole numbers in the part's unit ("pcs", "m", "g").
- Each part has a stock tracking mode. "exact" parts are counted. "level" parts (bulk screws, nuts…) only record a level per location — "Plenty", "Low" or "Empty" — and "binary" ones "In stock" / "Out of stock"; their stock shows as that label, and builds don't take them out of stock. "none" parts only record where they live. Set levels with adjust_stock mode "level".`;

const INSTRUCTIONS_READ_ONLY = `
- Access is read-only on this instance: you can look things up, but the user makes changes in the app (part pages link from every result's url).`;

const INSTRUCTIONS_WRITE = `
- Locations themselves are managed in the app, not here.
- Standard fasteners and connectors (ISO/DIN screws, nuts, washers, heat-set inserts; JST, Dupont, pin headers) are "generic parts": create them with create_generic_parts, not create_part, so name, designation and specs come out in the app's format and match existing ones. describe_generic_part lists the types and their options. To change one (another material, length), pass \`generic\` to update_part.
- Find parts with search_parts before creating one — a part with the same MPN usually already exists. import_parts matches on MPN, then name, and updates instead of duplicating.
- Every stock change is logged in the part's history with your note; prefer a short note saying why ("used for X", "stock-take").
- For a large or uncertain import, call import_parts with dryRun: true first and show the user the preview.
- Deleting a part removes its stock and history for good; only do it when the user asked for it.`;

/** What the model is told at initialize; it must not mention tools it can't call. */
export function inventoryInstructions({ allowWrites }: { allowWrites: boolean }): string {
  return INSTRUCTIONS_COMMON + (allowWrites ? INSTRUCTIONS_WRITE : INSTRUCTIONS_READ_ONLY);
}

const PART_ID_HINT = "use search_parts to find one";
const BOM_ID_HINT = "use list_boms to find one";

const partUrl = (id: string) => appUrl(`/parts/${id}`).toString();
const bomUrl = (id: string) => appUrl(`/boms/${id}`).toString();

// --- Shared lookups --------------------------------------------------------

async function requirePart(id: string) {
  const part = await db.query.parts.findFirst({
    where: eq(parts.id, id),
    with: { category: { columns: { name: true } } },
  });
  if (!part) throw new ToolError(`No part with id ${id} — ${PART_ID_HINT}`);
  return part;
}

/** A category id from its name (case-insensitive), created on first use like the importer does. */
async function categoryIdFor(name: string | null): Promise<string | null> {
  if (name === null) return null;
  const ids = await db.transaction((tx) => ensureCategories(tx, [name]));
  return ids.get(name.toLowerCase()) ?? null;
}

/** A write's `{ error }` is something the model can fix, so it becomes a ToolError. */
function check<T extends { error?: string }>(result: T): T {
  if (result.error) throw new ToolError(result.error);
  return result;
}

/** The current state of a part, returned after every write so the model sees the effect. */
async function partDetail(id: string, { movements = 10 } = {}) {
  const part = await requirePart(id);
  const [stockRows, locations, partFiles, usedIn, history] = await Promise.all([
    db.select({ locationId: stock.locationId, quantity: stock.quantity }).from(stock).where(eq(stock.partId, id)),
    loadLocationOptions(),
    db
      .select({ filename: files.filename, kind: files.kind })
      .from(files)
      .where(eq(files.partId, id))
      .orderBy(asc(files.position), asc(files.createdAt)),
    db
      .select({ bomId: boms.id, name: boms.name, perUnit: bomItems.quantity })
      .from(bomItems)
      .innerJoin(boms, eq(boms.id, bomItems.bomId))
      .where(eq(bomItems.partId, id))
      .orderBy(asc(boms.name)),
    movements > 0 ? recentMovements({ partId: id, limit: movements }) : Promise.resolve([]),
  ]);
  const byLocation = new Map(locations.map((l) => [l.id, l]));
  const tracking = part.tracking;
  const total = totalStock(tracking, stockRows.map((s) => s.quantity));
  const show = (s: { quantity: number }) =>
    tracking === "exact" ? { quantity: s.quantity } : tracking === "none" ? {} : { level: levelLabel(tracking, s.quantity) };
  return {
    id: part.id,
    url: partUrl(part.id),
    name: part.name,
    mpn: part.mpn,
    manufacturer: part.manufacturer,
    category: part.category?.name ?? null,
    unit: part.unit,
    description: part.description,
    notes: part.notes,
    attributes: part.attributes,
    // The generic-part choice it was made from (describe_generic_part), or null.
    generic: part.generic,
    orderUrls: part.orderUrls,
    tracking,
    totalStock: stockValue(tracking, total),
    minStock: part.minStock,
    lowStock: isLowStock(total, part.minStock, tracking),
    // Rows at 0 are kept: they remember where the part lives when it runs out.
    // An emptied unsorted pile is left out.
    stock: [
      ...stockRows
        .filter((s) => s.locationId === null && s.quantity > 0)
        .map((s) => ({ location: UNSORTED_REF, path: "Not put away yet", ...show(s) })),
      ...stockRows
        .map((s) => ({ ...s, location: s.locationId ? byLocation.get(s.locationId) : undefined }))
        .filter((s) => s.location)
        .map((s) => ({ location: s.location!.code, path: s.location!.path, ...show(s) }))
        .sort((a, b) => a.location.localeCompare(b.location, undefined, { numeric: true })),
    ],
    usedInBoms: usedIn.map((b) => ({ ...b, url: bomUrl(b.bomId) })),
    files: partFiles,
    ...(movements > 0
      ? {
          recentMovements: history.map((m) => ({
            at: m.createdAt.toISOString(),
            kind: m.kind,
            quantity: m.quantity,
            // An empty path is the unsorted pile (see stock_movements).
            location: m.locationPath || UNSORTED_REF,
            toLocation: m.kind === "move" ? m.toLocationPath || UNSORTED_REF : null,
            note: m.note || null,
            by: m.userName,
            bom: m.bomName,
          })),
        }
      : {}),
  };
}

// --- Argument schemas shared by create/update ------------------------------

const ATTRIBUTES_SCHEMA = {
  description: 'Key/value attributes, e.g. {"Package": "DIP-8", "Thread": "M3"} or [{"key": "Package", "value": "DIP-8"}].',
  anyOf: [
    { type: "object", additionalProperties: { type: "string" } },
    {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, value: { type: "string" } },
        required: ["key", "value"],
      },
    },
  ],
};

const PART_FIELD_PROPERTIES = {
  name: { type: "string", description: "Part name, e.g. \"NE555 timer\" or \"M3x8 socket head screw\"." },
  mpn: { type: "string", description: "Manufacturer part number." },
  manufacturer: { type: "string" },
  description: { type: "string", description: "Markdown." },
  category: {
    type: ["string", "null"],
    description: "Category name; created if it doesn't exist yet (list_categories shows the existing ones).",
  },
  unit: { type: "string", description: 'Unit stock is counted in: "pcs" (default), "m", "g", …' },
  tracking: {
    type: "string",
    enum: [...TRACKING_MODES],
    description:
      'How stock is kept: "exact" counts (default), "level" (plenty/low/empty — bulk parts not worth counting), "binary" (in stock/out), "none" (only where it lives). Switching an existing part converts its stock; levels → exact starts every location at 0.',
  },
  minStock: {
    type: ["integer", "null"],
    minimum: 0,
    description: "Low-stock threshold across all locations, for exact parts; null = not tracked. Level/binary parts are low when no location is Plenty / In stock.",
  },
  orderUrls: {
    type: "array",
    items: { type: "string" },
    description: "http(s) product pages of the shops/suppliers to reorder from, preferred first. On update this replaces the whole list ([] clears it).",
  },
  notes: { type: "string", description: "Markdown." },
};

function readTracking(args: Record<string, unknown>): Tracking | undefined {
  return args.tracking === undefined || args.tracking === null
    ? undefined
    : requireEnum(args, "tracking", TRACKING_MODES);
}

/** A stock value for the model: a count, a level label, or null (untracked). */
function stockValue(tracking: Tracking, quantity: number): number | string | null {
  if (tracking === "exact") return quantity;
  if (tracking === "none") return null;
  return levelLabel(tracking, quantity);
}

/** Reads minStock as given (number, numeric string, or null to clear). */
function readMinStock(args: Record<string, unknown>): number | null | undefined {
  const value = args.minStock;
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new InvalidParamsError('"minStock" must be a whole number or null');
  }
  return n;
}

/** The text fields of a create/update call, as sent. Absent fields stay absent. */
function readTextFields(args: Record<string, unknown>) {
  const out: Partial<Record<"name" | "mpn" | "manufacturer" | "description" | "unit" | "notes", string>> = {};
  for (const field of ["name", "mpn", "manufacturer", "description", "unit", "notes"] as const) {
    const value = args[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== "string") throw new InvalidParamsError(`"${field}" must be a string`);
    out[field] = value ?? "";
  }
  return out;
}

function readCategory(args: Record<string, unknown>): string | null | undefined {
  if (args.category === undefined) return undefined;
  if (args.category === null || args.category === "") return null;
  return requireString(args, "category");
}

// --- Tools -----------------------------------------------------------------

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

/**
 * The tools for one request. Without `allowWrites` (ENABLE_MCP_WRITE unset)
 * only the read-only ones exist: write tools are neither listed nor callable,
 * so a client connected while writes were on loses them on its next request.
 */
export function inventoryTools({ userId, allowWrites }: { userId: string; allowWrites: boolean }): McpTool[] {
  const tools: McpTool[] = [
    {
      name: "search_parts",
      title: "Search parts",
      description:
        "Searches the parts inventory by name, MPN, manufacturer, description or attribute values. Returns each part's id, total stock and the locations holding it. With no query it lists parts alphabetically.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to match, e.g. \"555\", \"M3 screw\", \"10k 0805\"." },
          category: { type: "string", description: "Only parts in this category (by name)." },
          lowStockOnly: { type: "boolean", description: "Only parts below their minimum stock — what needs reordering." },
          limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
        },
      },
      annotations: READ_ONLY,
      run: async (args) => {
        const categoryName = optionalString(args, "category");
        let categoryId: string | null = null;
        if (categoryName) {
          const category = await db.query.categories.findFirst({
            where: sql`lower(${categories.name}) = lower(${categoryName})`,
            columns: { id: true },
          });
          if (!category) throw new ToolError(`No category "${categoryName}" — list_categories shows them`);
          categoryId = category.id;
        }
        const limit = optionalInt(args, "limit", { min: 1, max: 200, fallback: 50 });
        // One extra row tells whether the list was cut off.
        const rows = await listParts({
          q: optionalString(args, "query"),
          categoryId,
          lowStock: optionalBoolean(args, "lowStockOnly", false),
          limit: limit + 1,
        });
        const shown = rows.slice(0, limit);
        const [where, locations] = await Promise.all([
          stockLocationsByPart(shown.map((p) => p.id)),
          loadLocationOptions(),
        ]);
        const codeById = new Map(locations.map((l) => [l.id, l.code]));
        return {
          parts: shown.map((p) => ({
            id: p.id,
            url: partUrl(p.id),
            name: p.name,
            mpn: p.mpn,
            manufacturer: p.manufacturer,
            category: p.category,
            unit: p.unit,
            tracking: p.tracking,
            totalStock: stockValue(p.tracking, p.total),
            minStock: p.minStock,
            lowStock: isLowStock(p.total, p.minStock, p.tracking),
            locations: (where.get(p.id) ?? [])
              .map((id) => (id ? codeById.get(id) : UNSORTED_REF))
              .filter(Boolean),
          })),
          truncated: rows.length > limit,
        };
      },
    },
    {
      name: "get_part",
      title: "Get part",
      description:
        "Everything about one part: description, notes, attributes, order link, stock per location, the BOMs that use it, attached files and recent stock movements.",
      inputSchema: {
        type: "object",
        properties: { partId: { type: "string", description: "Part id from search_parts." } },
        required: ["partId"],
      },
      annotations: READ_ONLY,
      run: async (args) => partDetail(requireUuid(args, "partId", PART_ID_HINT), { movements: 20 }),
    },
    {
      name: "describe_generic_part",
      title: "Describe generic part",
      description:
        "The generic-part catalogue: standard parts the app derives completely from a few choices (ISO/DIN fasteners, JST/Dupont connectors, pin headers). Without arguments, lists the families and types. With family + type, returns the type's parameters — select options and the range parameter (length, pin count) — resolved for `values` (defaults fill what you leave out; one choice can change another's options), plus a preview of the part(s) `range` would make. Values may be given by option value or label.",
      inputSchema: {
        type: "object",
        properties: {
          family: { type: "string", description: 'Family id, e.g. "fasteners", "connectors".' },
          type: { type: "string", description: 'Type id within the family, e.g. "socket-cap", "jst-xh".' },
          values: {
            type: "object",
            additionalProperties: { type: ["string", "number"] },
            description: 'Parameter id → value, e.g. {"size": "M3", "material": "a2"}.',
          },
          range: {
            type: "array",
            items: { type: ["string", "number"] },
            description: "Range values to preview (lengths in mm, pin counts).",
          },
        },
      },
      annotations: READ_ONLY,
      run: async (args) => {
        const family = optionalString(args, "family");
        const type = optionalString(args, "type");
        if (!family || !type) {
          if (type) throw new InvalidParamsError('Pass "family" together with "type"');
          return { families: genericCatalogue() };
        }
        return describeGenericType(family, requireGenericType(family, type), readGenericValues(args.values), args.range);
      },
    },
    {
      name: "list_locations",
      title: "List locations",
      description:
        "Lists the storage locations (code, full path, optional name) with how many different parts each holds. Use the code to address a location in other tools.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string", description: "Only locations whose code, path or name contains this." } },
      },
      annotations: READ_ONLY,
      run: async (args) => {
        const query = optionalString(args, "query")?.toLowerCase();
        const [locations, counts] = await Promise.all([
          loadLocationOptions(),
          db
            .select({ locationId: stock.locationId, parts: count() })
            .from(stock)
            .where(gt(stock.quantity, 0))
            .groupBy(stock.locationId),
        ]);
        const partsAt = new Map(counts.map((c) => [c.locationId, c.parts]));
        return {
          locations: locations
            .filter((l) => !query || [l.code, l.path, l.name].some((s) => s.toLowerCase().includes(query)))
            .map((l) => ({ code: l.code, path: l.path, name: l.name || null, parts: partsAt.get(l.id) ?? 0 })),
        };
      },
    },
    {
      name: "get_location",
      title: "Get location contents",
      description: "What is stored in one location, including the locations nested inside it.",
      inputSchema: {
        type: "object",
        properties: {
          location: { type: "string", description: 'Location code, e.g. "A/1".' },
          includeNested: { type: "boolean", default: true, description: "Also list what sits in locations inside this one." },
        },
        required: ["location"],
      },
      annotations: READ_ONLY,
      run: async (args) => {
        const [locations, tree] = await Promise.all([loadLocationOptions(), loadLocations()]);
        const location = resolveLocation(locations, requireString(args, "location"));
        const ids = optionalBoolean(args, "includeNested", true)
          ? subtreeIds(tree, location.id)
          : new Set([location.id]);
        const inside = locations.filter((l) => ids.has(l.id));
        const rows = await db
          .select({
            partId: parts.id,
            name: parts.name,
            mpn: parts.mpn,
            unit: parts.unit,
            tracking: parts.tracking,
            locationId: stock.locationId,
            quantity: stock.quantity,
          })
          .from(stock)
          .innerJoin(parts, eq(parts.id, stock.partId))
          .where(
            and(
              inArray(stock.locationId, inside.map((l) => l.id)),
              // Untracked parts hold nothing but still live here.
              or(gt(stock.quantity, 0), eq(parts.tracking, "none")),
            ),
          )
          .orderBy(asc(parts.name));
        const codeById = new Map(inside.map((l) => [l.id, l.code]));
        return {
          code: location.code,
          path: location.path,
          name: location.name || null,
          url: appUrl(`/locations/${location.id}`).toString(),
          nestedLocations: inside.filter((l) => l.id !== location.id).map((l) => l.code),
          contents: rows.map((r) => ({
            partId: r.partId,
            name: r.name,
            mpn: r.mpn,
            location: codeById.get(r.locationId!),
            quantity: stockValue(r.tracking, r.quantity),
            unit: r.unit,
          })),
        };
      },
    },
    {
      name: "list_categories",
      title: "List categories",
      description: "Lists the part categories with how many parts each has.",
      inputSchema: { type: "object", properties: {} },
      annotations: READ_ONLY,
      run: async () => {
        const rows = await db
          .select({ name: categories.name, parts: count(parts.id) })
          .from(categories)
          .leftJoin(parts, eq(parts.categoryId, categories.id))
          .groupBy(categories.id)
          .orderBy(asc(categories.name));
        return { categories: rows };
      },
    },
    {
      name: "list_boms",
      title: "List BOMs",
      description: "Lists the bills of materials with their line count and how many complete units current stock can build.",
      inputSchema: { type: "object", properties: {} },
      annotations: READ_ONLY,
      run: async () => ({
        boms: (await listBoms()).map((b) => ({
          id: b.id,
          url: bomUrl(b.id),
          name: b.name,
          description: b.description,
          lines: b.lineCount,
          buildableUnits: b.buildable,
        })),
      }),
    },
    {
      name: "get_bom",
      title: "Get BOM",
      description:
        "One bill of materials: every line with quantity per unit and stock on hand, how many units can be built, and — for a given number of units — what is short.",
      inputSchema: {
        type: "object",
        properties: {
          bomId: { type: "string", description: "BOM id from list_boms." },
          units: { type: "integer", minimum: 1, default: 1, description: "How many units to check requirements for." },
        },
        required: ["bomId"],
      },
      annotations: READ_ONLY,
      run: async (args) => {
        const bomId = requireUuid(args, "bomId", BOM_ID_HINT);
        const bom = await db.query.boms.findFirst({ where: eq(boms.id, bomId) });
        if (!bom) throw new ToolError(`No BOM with id ${bomId} — ${BOM_ID_HINT}`);
        const units = optionalInt(args, "units", { min: 1, max: 1_000_000, fallback: 1 });
        const lines = await loadBomLines(bomId);
        const needs = requirements(lines, units);
        return {
          id: bom.id,
          url: bomUrl(bom.id),
          name: bom.name,
          description: bom.description,
          buildableUnits: buildableUnits(lines),
          units,
          lines: lines.map((l, i) => ({
            partId: l.partId,
            name: l.name,
            mpn: l.mpn,
            manufacturer: l.manufacturer,
            unit: l.unit,
            perUnit: l.perUnit,
            reference: l.reference,
            notes: l.notes,
            tracking: l.tracking,
            inStock: stockValue(l.tracking, l.inStock),
            required: needs[i].required,
            shortfall: needs[i].shortfall,
          })),
        };
      },
    },

    // --- Writes ---
    {
      name: "create_part",
      title: "Create part",
      description:
        'Adds a new part to the inventory, optionally with its first stock in one location (a quantity without a location goes to "unsorted"). Check search_parts first so you don\'t create a duplicate. Returns the created part.',
      inputSchema: {
        type: "object",
        properties: {
          ...PART_FIELD_PROPERTIES,
          attributes: ATTRIBUTES_SCHEMA,
          location: { type: "string", description: 'Location code for the initial stock; omit or "unsorted" if it isn\'t put away yet.' },
          quantity: { type: "integer", minimum: 0, description: "Initial stock at `location` (exact parts)." },
          level: { type: "string", description: 'Initial level at `location` for level/binary parts: "Plenty", "Low", "Empty" / "In stock", "Out of stock".' },
        },
        required: ["name"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args) => {
        const location = optionalString(args, "location");
        const quantity = args.quantity;
        const category = readCategory(args);
        const minStock = readMinStock(args);
        const tracking = readTracking(args) ?? "exact";
        const level = optionalString(args, "level");
        const { id } = check(
          await createPart(userId, {
            ...readTextFields(args),
            tracking,
            categoryId: category ? await categoryIdFor(category) : "",
            minStock: minStock == null ? "" : String(minStock),
            orderUrls: optionalStringArray(args, "orderUrls"),
            attributes: readAttributes(args.attributes),
            initialLocationId: location ? resolveStockPlace(await loadLocationOptions(), location) : null,
            initialQuantity:
              tracking === "exact"
                ? quantity === undefined || quantity === null
                  ? ""
                  : String(quantity)
                : (level ?? ""),
          }),
        );
        return { created: true, part: await partDetail(id!, { movements: 0 }) };
      },
    },
    {
      name: "create_generic_parts",
      title: "Create generic parts",
      description:
        "Creates standard parts from the generic-part catalogue (see describe_generic_part), one per `range` value — e.g. M3 socket head screws in 6, 8 and 10 mm. Name, designation (MPN), description, specs, icon and category are generated exactly as the app's \"Generic part\" wizard does, and the choice is stored on each part. Parts that already exist (same name or MPN) are skipped and returned under `existing`, so this is safe to repeat. Generic parts track stock as a level; pass location + level to stock the new ones. With dryRun: true nothing is written.",
      inputSchema: {
        type: "object",
        properties: {
          family: { type: "string", description: "Family id from describe_generic_part." },
          type: { type: "string", description: "Type id from describe_generic_part." },
          values: {
            type: "object",
            additionalProperties: { type: ["string", "number"] },
            description: "Parameter id → value (option value or label); omitted ones get their default.",
          },
          range: {
            type: "array",
            items: { type: ["string", "number"] },
            maxItems: 50,
            description: "One part per value of the type's range parameter (lengths in mm, pin counts). Omit for types without one.",
          },
          location: { type: "string", description: 'Location code to stock the new parts in, or "unsorted".' },
          level: { type: "string", description: 'Initial level there: "Plenty", "Low" or "Empty".' },
          dryRun: { type: "boolean", default: false, description: "Preview only; nothing is written." },
        },
        required: ["family", "type"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const family = requireString(args, "family");
        const type = requireGenericType(family, requireString(args, "type"));
        const given = readGenericValues(args.values);
        const { values, params } = resolveStrict(type, given);
        const range = rangeParam(params);
        const chosen = readRange(range, given, args.range);
        if (range && chosen.length === 0) {
          throw new InvalidParamsError(`Pass at least one ${range.label.toLowerCase()} in "range"`);
        }
        const location = optionalString(args, "location");
        const dryRun = optionalBoolean(args, "dryRun", false);
        const result = check(
          await createGenericParts(userId, {
            family,
            type,
            values,
            range: chosen,
            dryRun,
            initialLocationId: location ? resolveStockPlace(await loadLocationOptions(), location) : null,
            initialLevel: optionalString(args, "level"),
          }),
        );
        const existing = (result.existing ?? []).map((p) => ({ ...p, url: partUrl(p.id) }));
        if (dryRun) {
          return { dryRun, category: result.category, wouldCreate: (result.planned ?? []).map(generatedPartView), existing };
        }
        return {
          category: result.category,
          created: (result.created ?? []).map((p) => ({ ...p, url: partUrl(p.id) })),
          existing,
        };
      },
    },
    {
      name: "update_part",
      title: "Update part",
      description:
        "Edits a part. Only the fields you pass change; everything else is kept. `attributes` are merged by key (existing keys get the new value, new keys are added); list keys in `removeAttributes` to delete them. Pass null for category or minStock to clear it. Stock is changed with adjust_stock, not here. `generic` re-runs the generic-part wizard (describe_generic_part) — e.g. the same screw in black oxide: name, MPN, description and specs are regenerated, except fields edited by hand since the part was generated (listed in `keptEdited`); text fields you pass in the same call still win.",
      inputSchema: {
        type: "object",
        properties: {
          partId: { type: "string", description: "Part id from search_parts." },
          ...PART_FIELD_PROPERTIES,
          attributes: ATTRIBUTES_SCHEMA,
          removeAttributes: { type: "array", items: { type: "string" }, description: "Attribute keys to remove." },
          generic: {
            type: "object",
            description:
              'The generic-part choice to regenerate the part from: {"family", "type", "values"}, with exactly one range value in values (e.g. "length": "8"). get_part shows the current one.',
            properties: {
              family: { type: "string" },
              type: { type: "string" },
              values: { type: "object", additionalProperties: { type: ["string", "number"] } },
            },
            required: ["family", "type"],
          },
        },
        required: ["partId"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const id = requireUuid(args, "partId", PART_ID_HINT);
        const stored = await requirePart(id);
        const regenerated = args.generic === undefined ? null : applyGenericChoice(stored, readGenericChoice(args.generic, "generic"));
        const existing = regenerated?.part ?? stored;
        let category = readCategory(args);
        // Like the form: a generated part files itself only if it has no category yet.
        if (regenerated && category === undefined && !stored.categoryId) {
          const cats = await db.select({ id: categories.id, name: categories.name }).from(categories);
          const suggestion = suggestCategory(regenerated.category, cats);
          if (suggestion) category = "id" in suggestion ? cats.find((c) => c.id === suggestion.id)!.name : suggestion.name;
        }
        const patch: PartPatch = {
          ...readTextFields(args),
          minStock: readMinStock(args),
          tracking: readTracking(args),
          ...(args.orderUrls !== undefined ? { orderUrls: optionalStringArray(args, "orderUrls") } : {}),
          attributes: readAttributes(args.attributes),
          removeAttributes: optionalStringArray(args, "removeAttributes"),
          ...(category !== undefined ? { categoryId: await categoryIdFor(category) } : {}),
        };
        check(await updatePart(id, partFormValues(existing, patch)));
        return {
          updated: true,
          ...(regenerated?.kept.length ? { keptEdited: regenerated.kept } : {}),
          part: await partDetail(id, { movements: 0 }),
        };
      },
    },
    {
      name: "adjust_stock",
      title: "Adjust stock",
      description:
        'Changes a part\'s stock in one location. Exact parts: "add" (received, restocked), "remove" (used, lost) by `quantity`, or "set" the count after a stock-take. Level/binary parts: "level" with `level` ("Plenty", "Low", "Empty" / "In stock", "Out of stock"). Untracked parts: "place" records the location as one it lives in. Logged in the part\'s history with your note. A part can be stocked in a new location simply by adding to it.',
      inputSchema: {
        type: "object",
        properties: {
          partId: { type: "string", description: "Part id from search_parts." },
          location: { type: "string", description: 'Location code, e.g. "A/1", or "unsorted".' },
          mode: { type: "string", enum: ["add", "remove", "set", "level", "place"] },
          quantity: { type: "integer", minimum: 0, description: "For add, remove and set." },
          level: { type: "string", description: 'For mode "level".' },
          note: { type: "string", description: "Why, shown in the history." },
        },
        required: ["partId", "location", "mode"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args) => {
        const partId = requireUuid(args, "partId", PART_ID_HINT);
        await requirePart(partId);
        const locationId = resolveStockPlace(await loadLocationOptions(), requireString(args, "location"));
        const mode = requireEnum(args, "mode", ["add", "remove", "set", "level", "place"] as const);
        check(
          await changeStock(userId, {
            partId,
            locationId,
            mode,
            quantity: mode === "level" ? (optionalString(args, "level") ?? "") : String(args.quantity ?? ""),
            note: optionalString(args, "note"),
          }),
        );
        return { ok: true, part: await partDetail(partId, { movements: 0 }) };
      },
    },
    {
      name: "move_stock",
      title: "Move stock",
      description:
        'Moves some of a part\'s stock from one location to another; from "unsorted" puts unsorted stock away. For level, binary and untracked parts everything there moves and `quantity` is ignored. Logged in the part\'s history.',
      inputSchema: {
        type: "object",
        properties: {
          partId: { type: "string", description: "Part id from search_parts." },
          from: { type: "string", description: 'Location code to take from, or "unsorted".' },
          to: { type: "string", description: 'Location code to put into, or "unsorted".' },
          quantity: { type: "integer", minimum: 1, description: "Required for exact parts." },
          note: { type: "string" },
        },
        required: ["partId", "from", "to"],
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args) => {
        const partId = requireUuid(args, "partId", PART_ID_HINT);
        await requirePart(partId);
        const locations = await loadLocationOptions();
        check(
          await moveStock(userId, {
            partId,
            fromLocationId: resolveStockPlace(locations, requireString(args, "from")),
            toLocationId: resolveStockPlace(locations, requireString(args, "to")),
            quantity: String(args.quantity ?? ""),
            note: optionalString(args, "note"),
          }),
        );
        return { ok: true, part: await partDetail(partId, { movements: 0 }) };
      },
    },
    {
      name: "import_parts",
      title: "Import parts",
      description: `Creates or updates many parts at once, optionally booking stock — e.g. from an order confirmation or a spreadsheet the user pasted. Rows are matched to existing parts by MPN, then by name: a match is updated (empty fields never overwrite), anything else is created. Pass either \`parts\` (objects with fields ${[...PART_CSV_FIELDS, "attributes"].join(", ")}) or \`csv\` (raw CSV text with a header row; distributor exports from DigiKey, Mouser, LCSC are recognized; "Attr: <name>" columns become attributes). With dryRun: true nothing is written and you get a preview.`,
      inputSchema: {
        type: "object",
        properties: {
          parts: {
            type: "array",
            description: 'Rows to import. A row needs a name or an MPN; a quantity without a location is booked as "unsorted".',
            items: {
              type: "object",
              properties: {
                ...PART_FIELD_PROPERTIES,
                category: { type: "string", description: "Category name; created if missing." },
                minStock: { type: "integer", minimum: 0 },
                attributes: ATTRIBUTES_SCHEMA,
                location: { type: "string", description: 'Location code for the stock in this row; omit (or "unsorted") if it isn\'t put away yet.' },
                quantity: { type: "integer", minimum: 0 },
              },
              additionalProperties: false,
            },
          },
          csv: { type: "string", description: "CSV text including its header row, instead of `parts`." },
          stockMode: {
            type: "string",
            enum: ["add", "set"],
            default: "add",
            description: '"add" adds quantities to what is there (received goods); "set" makes them the new count (inventory sheet — re-importing is then harmless).',
          },
          dryRun: { type: "boolean", default: false, description: "Preview only; nothing is written." },
          note: { type: "string", description: "Note on the booked stock movements." },
        },
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      run: async (args) => {
        const csv = optionalString(args, "csv");
        if (csv && args.parts !== undefined) throw new InvalidParamsError('Pass either "parts" or "csv", not both');
        let table: { rows: string[][]; mapping: unknown };
        if (csv) {
          const parsed = readPartCsv(csv);
          table = { rows: [parsed.headers, ...parsed.rows], mapping: guessPartMapping(parsed.headers) };
        } else {
          table = importRowsToTable(requireObjectArray(args, "parts"));
        }
        const dryRun = optionalBoolean(args, "dryRun", false);
        const result = check(
          await runPartImport(userId, {
            ...table,
            stockMode: args.stockMode === undefined ? "add" : requireEnum(args, "stockMode", ["add", "set"] as const),
            dryRun,
            note: optionalString(args, "note") ?? "Imported via MCP",
          }),
        );
        return {
          dryRun,
          summary: result.summary,
          // Rows the planner skipped, by 1-based line (the header is line 1).
          errors: result.errors,
          ...(dryRun ? { preview: result.preview } : { partsUrl: appUrl("/parts").toString() }),
        };
      },
    },
    {
      name: "delete_part",
      title: "Delete part",
      description:
        "Permanently deletes a part together with its stock records, movement history and attached files. Refused while a BOM still uses the part. Only call this when the user explicitly asked to delete it.",
      inputSchema: {
        type: "object",
        properties: { partId: { type: "string", description: "Part id from search_parts." } },
        required: ["partId"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      run: async (args) => {
        const id = requireUuid(args, "partId", PART_ID_HINT);
        const part = await requirePart(id);
        check(await deletePart(id));
        return { deleted: true, id, name: part.name };
      },
    },
  ];
  return allowWrites ? tools : readOnlyTools(tools);
}
