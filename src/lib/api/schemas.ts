// Request and response shapes of the REST API (/api/v1) as zod schemas — the
// single source for request validation, the response types the serializers
// are checked against (src/lib/api/serialize.ts), and the OpenAPI document
// (src/lib/api/openapi.ts). Change a shape here and all three move together.
// Pure: no DB, no auth.
//
// Response schemas are documentation and types, not runtime checks: the
// serializers build them from rows we already trust. Request schemas are the
// gate in front of the mutation core, which still re-validates everything it
// cares about (parsePartInput, parseQuantity, the tracking mode's rules).
// Bodies are strict: a misspelled field is a 400, not a silently ignored
// no-op.

import * as z from "zod";
import { isIconId } from "@/lib/label-icons";
import { MAX_ORDER_URLS } from "@/lib/part-input";
import { MOVEMENT_KINDS, TRACKING_MODES } from "@/lib/stock";

// Everything named here becomes a `components.schemas` entry.
export const apiSchemas = z.registry<{ id: string }>();

// Ids are Postgres UUIDs; guid() accepts any of them, like the path params.
const id = z.guid();
const timestamp = z.iso.datetime().meta({ description: "ISO 8601, UTC" });
const quantity = (min: number) => z.int().min(min).max(1_000_000_000);
const note = z.string().max(500).optional().meta({ description: "Why — shown in the part's stock history" });
const list = <T extends z.ZodType>(item: T, nextCursor: string) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable().meta({ description: nextCursor }) });
const UNPAGINATED =
  "Always null: this list is returned whole. Kept so every list has the same envelope, and paging can be added without breaking clients that follow it.";

// --- Shared -----------------------------------------------------------------

export const ApiError = z
  .object({
    error: z.string().meta({ description: "Human-readable; safe to show to a user" }),
    code: z.string().meta({
      description:
        "Stable machine-readable code: unauthorized, insufficient_scope, invalid_request, not_found, conflict, rate_limited, payload_too_large, unavailable, internal",
    }),
    issues: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional()
      .meta({ description: "Per-field validation problems (invalid_request only)" }),
  })
  .register(apiSchemas, { id: "Error" });

export const ApiUserRef = z
  .object({ id: z.string(), name: z.string() })
  .register(apiSchemas, { id: "UserRef" });

export const ApiCategoryRef = z
  .object({ id, name: z.string() })
  .register(apiSchemas, { id: "CategoryRef" });

export const ApiCategory = ApiCategoryRef.extend({
  partCount: z.int(),
}).register(apiSchemas, { id: "Category" });

export const ApiCategoryList = list(ApiCategory, UNPAGINATED).register(apiSchemas, {
  id: "CategoryList",
});

// --- Stock --------------------------------------------------------------------

export const ApiStockLevel = z
  .enum(["empty", "low", "plenty"])
  .meta({
    description:
      'The stock level of a "level" part. "binary" parts use only empty (out of stock) and plenty (in stock).',
  })
  .register(apiSchemas, { id: "StockLevel" });

const stockValueFields = {
  quantity: z.int().nullable().meta({ description: "The count, for exact parts; null otherwise" }),
  level: ApiStockLevel.nullable().meta({ description: "The level, for level/binary parts; null otherwise" }),
};

export const ApiStockValue = z
  .object(stockValueFields)
  .meta({ description: "Untracked parts (tracking: none) have neither a quantity nor a level" })
  .register(apiSchemas, { id: "StockValue" });

export const ApiLocationRef = z
  .object({
    id,
    code: z.string().meta({ description: 'Labels joined by the instance\'s separator, e.g. "A/1/IV"' }),
    path: z.string().meta({ description: 'Readable, e.g. "Shelf A › Box 1 › Bin IV"' }),
  })
  .register(apiSchemas, { id: "LocationRef" });

export const ApiStockEntry = z
  .object({
    location: ApiLocationRef.nullable().meta({
      description: "null = the part's unsorted pile: on hand, not put away yet",
    }),
    ...stockValueFields,
  })
  .meta({
    description:
      "A part's stock in one place. An entry at quantity 0 / empty is kept: it remembers where the part lives when it runs out.",
  })
  .register(apiSchemas, { id: "StockEntry" });

// --- Files --------------------------------------------------------------------

export const ApiFile = z
  .object({
    id,
    kind: z.enum(["image", "document"]),
    filename: z.string(),
    size: z.int(),
    position: z.int().meta({ description: "Display order; the first image is the part's thumbnail" }),
    downloadUrl: z.string().meta({ description: "GET with a parts:read key" }),
    createdAt: timestamp,
  })
  .register(apiSchemas, { id: "File" });

// --- Parts --------------------------------------------------------------------

export const ApiAttribute = z
  .object({ key: z.string().min(1).max(200), value: z.string().max(200) })
  .strict()
  .meta({ description: 'A free-form spec, e.g. { "key": "Package", "value": "DIP-8" }' })
  .register(apiSchemas, { id: "Attribute" });

export const ApiTracking = z
  .enum(TRACKING_MODES)
  .meta({
    description:
      "How stock is kept: exact (counted), level (plenty/low/empty), binary (in stock/out), none (only where it lives)",
  })
  .register(apiSchemas, { id: "Tracking" });

export const ApiPart = z
  .object({
    id,
    name: z.string(),
    mpn: z.string().meta({ description: 'Manufacturer part number; "" when unknown' }),
    manufacturer: z.string(),
    category: ApiCategoryRef.nullable(),
    unit: z.string().meta({ description: 'What stock is counted in: "pcs", "m", "g", …' }),
    tracking: ApiTracking,
    inStock: ApiStockValue.meta({
      description: "Across all locations: the sum (exact) or the best level anywhere (level/binary)",
    }),
    minStock: z.int().nullable().meta({ description: "Low-stock threshold for exact parts; null = none" }),
    lowStock: z.boolean().meta({
      description: "Needs reordering: below minStock (exact), or nowhere better than low (level/binary)",
    }),
    stock: z.array(ApiStockEntry).meta({ description: "Where it is: unsorted pile first, then by location code" }),
    orderUrls: z.array(z.string()).meta({ description: "Supplier product pages, preferred first" }),
    icon: z.string().meta({ description: 'Label-icon catalogue id shown while the part has no image; "" = none' }),
    attributes: z.array(ApiAttribute),
    imageUrl: z.string().nullable().meta({ description: "The thumbnail (first image) — download with a parts:read key" }),
    url: z.string().meta({ description: "The part's page in the web app" }),
    createdAt: timestamp,
    updatedAt: timestamp.meta({
      description: "Last edit of the part itself. Stock changes don't move it — they are movements.",
    }),
  })
  .register(apiSchemas, { id: "Part" });

export const ApiPartDetail = ApiPart.extend({
  description: z.string().meta({ description: "Markdown" }),
  notes: z.string().meta({ description: "Markdown" }),
  files: z.array(ApiFile),
  boms: z
    .array(z.object({ id, name: z.string(), perUnit: z.int(), url: z.string() }))
    .meta({ description: "BOMs that use the part, with the quantity per built unit" }),
}).register(apiSchemas, { id: "PartDetail" });

export const ApiPartPage = list(ApiPart, "Pass as ?cursor= (with the same sort) for the next page; null = last page")
  .register(apiSchemas, { id: "PartPage" });

// A place stock sits in, in request bodies.
const place = z.string().min(1).max(500).nullable().meta({
  description: 'A location id or code ("A/1/IV"); null = the part\'s unsorted pile',
});

const partFields = {
  name: z.string().min(1).max(200),
  description: z.string().max(20_000).meta({ description: "Markdown" }),
  mpn: z.string().max(200),
  manufacturer: z.string().max(200),
  categoryId: id.nullable().meta({ description: "A category id (GET /categories); null = none" }),
  categoryName: z.string().min(1).max(200).meta({
    description: "Alternative to categoryId: a category by name, created if it doesn't exist yet",
  }),
  unit: z.string().min(1).max(20),
  tracking: ApiTracking,
  minStock: z.int().min(0).max(1_000_000_000).nullable(),
  orderUrls: z.array(z.string().max(2000)).max(MAX_ORDER_URLS).meta({
    description: "http(s) supplier product pages, preferred first",
  }),
  icon: z
    .string()
    .max(200)
    .refine((value) => value === "" || isIconId(value), "Not an icon id from the label-icon catalogue"),
  attributes: z.array(ApiAttribute).max(50),
  notes: z.string().max(10_000).meta({ description: "Markdown" }),
};

const oneCategory = {
  check: (body: { categoryId?: unknown; categoryName?: unknown }) =>
    body.categoryId === undefined || body.categoryName === undefined,
  message: { message: "Pass categoryId or categoryName, not both", path: ["categoryName"] },
};

export const CreatePartBody = z
  .object({
    name: partFields.name,
    description: partFields.description.optional(),
    mpn: partFields.mpn.optional(),
    manufacturer: partFields.manufacturer.optional(),
    categoryId: partFields.categoryId.optional(),
    categoryName: partFields.categoryName.optional(),
    unit: partFields.unit.optional().meta({ description: 'Default "pcs"' }),
    tracking: partFields.tracking.optional().meta({ description: "Default exact" }),
    minStock: partFields.minStock.optional(),
    orderUrls: partFields.orderUrls.optional(),
    icon: partFields.icon.optional(),
    attributes: partFields.attributes.optional(),
    notes: partFields.notes.optional(),
    stock: z
      .object({
        location: place,
        quantity: quantity(0).optional().meta({ description: "For exact parts" }),
        level: ApiStockLevel.optional().meta({ description: "For level/binary parts" }),
      })
      .strict()
      .optional()
      .meta({
        description:
          "First stock, logged as a movement. Untracked parts only take the location (where the part lives).",
      }),
  })
  .strict()
  .refine(oneCategory.check, oneCategory.message)
  .register(apiSchemas, { id: "CreatePart" });

export const UpdatePartBody = z
  .object({
    name: partFields.name.optional(),
    description: partFields.description.optional(),
    mpn: partFields.mpn.optional(),
    manufacturer: partFields.manufacturer.optional(),
    categoryId: partFields.categoryId.optional(),
    categoryName: partFields.categoryName.optional(),
    unit: partFields.unit.optional(),
    tracking: partFields.tracking.optional().meta({
      description:
        "Switching converts the stored stock: counts become levels; levels become counts of 0, to be counted",
    }),
    minStock: partFields.minStock.optional(),
    orderUrls: partFields.orderUrls.optional().meta({ description: "Replaces the list" }),
    icon: partFields.icon.optional(),
    attributes: partFields.attributes.optional().meta({ description: "Replaces the list" }),
    notes: partFields.notes.optional(),
  })
  .strict()
  .refine(oneCategory.check, oneCategory.message)
  .meta({ description: "Fields left out keep their current value" })
  .register(apiSchemas, { id: "UpdatePart" });

// Each mode takes exactly the fields it uses. Which modes a part accepts
// depends on its tracking: exact → add/remove/set, level/binary → level,
// none → place.
export const StockChangeBody = z
  .discriminatedUnion("mode", [
    z
      .object({ mode: z.literal("add"), location: place, quantity: quantity(1), note })
      .strict()
      .meta({ description: "Exact parts: add to the count (received, restocked)" }),
    z
      .object({ mode: z.literal("remove"), location: place, quantity: quantity(1), note })
      .strict()
      .meta({ description: "Exact parts: take from the count (used, lost)" }),
    z
      .object({ mode: z.literal("set"), location: place, quantity: quantity(0), note })
      .strict()
      .meta({ description: "Exact parts: the counted quantity after a stock-take" }),
    z
      .object({ mode: z.literal("level"), location: place, level: ApiStockLevel, note })
      .strict()
      .meta({ description: "Level/binary parts: the level now" }),
    z
      .object({ mode: z.literal("place"), location: z.string().min(1).max(500), note })
      .strict()
      .meta({ description: "Untracked parts: record a location the part lives in" }),
  ])
  .register(apiSchemas, { id: "StockChange" });

export const StockMoveBody = z
  .object({
    from: place,
    to: place,
    quantity: quantity(1).optional().meta({
      description: "Required for exact parts. Level, binary and untracked parts move everything at `from`.",
    }),
    note,
  })
  .strict()
  .register(apiSchemas, { id: "StockMove" });

// --- Movements ------------------------------------------------------------------

export const ApiMovementPlace = z
  .object({
    id: id.nullable().meta({ description: "null when the location has been deleted since" }),
    code: z.string().meta({ description: "The location's code at the time" }),
  })
  .register(apiSchemas, { id: "MovementPlace" });

export const ApiMovement = z
  .object({
    id,
    kind: z.enum(MOVEMENT_KINDS),
    quantity: z.int().meta({
      description:
        "add/remove/adjust/build: the signed change at `location`. move: the amount moved (0 = everything, for level/binary/untracked parts). level: the new level (0 empty, 1 low, 2 plenty).",
    }),
    part: z.object({ id, name: z.string() }),
    location: ApiMovementPlace.nullable().meta({ description: "null = the unsorted pile" }),
    toLocation: ApiMovementPlace.nullable().meta({
      description: "move only: where it went; null = the unsorted pile, or not a move",
    }),
    bom: z.object({ id, name: z.string() }).nullable().meta({ description: "build only: the BOM built" }),
    note: z.string(),
    user: ApiUserRef.nullable().meta({ description: "Who booked it; null if the account was deleted" }),
    createdAt: timestamp,
  })
  .meta({ description: "One entry of the append-only stock log" })
  .register(apiSchemas, { id: "Movement" });

export const ApiMovementPage = list(ApiMovement, "Pass as ?cursor= (with the same sort) for the next page; null = last page")
  .register(apiSchemas, { id: "MovementPage" });

// --- Locations ------------------------------------------------------------------

export const ApiLocation = ApiLocationRef.extend({
  label: z.string().meta({ description: "This location's own label within its parent" }),
  name: z.string().meta({ description: 'Optional human name ("Fasteners"); "" = none' }),
  description: z.string(),
  type: z.object({ id, name: z.string() }),
  parentId: id.nullable().meta({ description: "null = top level" }),
  url: z.string(),
  partsUrl: z.string().meta({ description: "Parts stored here or anywhere inside: GET /parts?location=<id>" }),
  createdAt: timestamp,
  updatedAt: timestamp,
}).register(apiSchemas, { id: "Location" });

export const ApiLocationDetail = ApiLocation.extend({
  children: z.array(ApiLocationRef).meta({ description: "The locations directly inside, in display order" }),
}).register(apiSchemas, { id: "LocationDetail" });

export const ApiLocationList = list(ApiLocation, UNPAGINATED).register(apiSchemas, { id: "LocationList" });

// --- BOMs -------------------------------------------------------------------------

export const ApiBom = z
  .object({
    id,
    name: z.string(),
    description: z.string(),
    lineCount: z.int(),
    buildableUnits: z.int().nullable().meta({
      description: "Complete units current stock covers; null = no counted line limits it",
    }),
    url: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .register(apiSchemas, { id: "Bom" });

export const ApiBomLine = z
  .object({
    part: z.object({
      id,
      name: z.string(),
      mpn: z.string(),
      manufacturer: z.string(),
      unit: z.string(),
      tracking: ApiTracking,
    }),
    perUnit: z.int().meta({ description: "Quantity per built unit" }),
    reference: z.string().meta({ description: 'Reference designators or where it goes ("R1, R2")' }),
    notes: z.string(),
    inStock: ApiStockValue,
    required: z.int().meta({ description: "perUnit × units" }),
    shortfall: z.int().meta({ description: "How many are missing for `units`; 0 = enough" }),
  })
  .register(apiSchemas, { id: "BomLine" });

export const ApiBomDetail = ApiBom.extend({
  units: z.int().meta({ description: "The unit count `required` and `shortfall` are computed for (?units=)" }),
  lines: z.array(ApiBomLine),
}).register(apiSchemas, { id: "BomDetail" });

export const ApiBomList = list(ApiBom, UNPAGINATED).register(apiSchemas, { id: "BomList" });

export const CreateBomBody = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(20_000).optional(),
  })
  .strict()
  .register(apiSchemas, { id: "CreateBom" });

export const UpdateBomBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(20_000).optional(),
  })
  .strict()
  .meta({ description: "Fields left out keep their current value" })
  .register(apiSchemas, { id: "UpdateBom" });

export const SetBomLineBody = z
  .object({
    quantity: quantity(1).meta({ description: "Per built unit" }),
    reference: z.string().max(500).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .meta({ description: "The whole line: reference and notes left out are cleared" })
  .register(apiSchemas, { id: "SetBomLine" });

export const BuildBomBody = z
  .object({ units: z.int().min(1).max(1_000_000), note })
  .strict()
  .register(apiSchemas, { id: "BuildBom" });

export const ApiBuildResult = z
  .object({
    units: z.int(),
    draws: z
      .array(z.object({ part: z.object({ id, name: z.string() }), location: ApiLocationRef.nullable(), quantity: z.int() }))
      .meta({
        description:
          "What was taken from where — emptiest bins first. Only exact parts are taken; level and untracked parts are left as they are.",
      }),
  })
  .register(apiSchemas, { id: "BuildResult" });

// --- Me -------------------------------------------------------------------------

export const ApiMe = z
  .object({
    user: ApiUserRef.extend({ role: z.string() }),
    key: z.object({
      id: z.string(),
      name: z.string().nullable(),
      scopes: z.array(z.string()),
      expiresAt: timestamp.nullable(),
    }),
  })
  .register(apiSchemas, { id: "Me" });

export type ApiPartOut = z.output<typeof ApiPart>;
export type ApiPartDetailOut = z.output<typeof ApiPartDetail>;
export type ApiStockValueOut = z.output<typeof ApiStockValue>;
export type ApiStockEntryOut = z.output<typeof ApiStockEntry>;
export type ApiFileOut = z.output<typeof ApiFile>;
export type ApiMovementOut = z.output<typeof ApiMovement>;
export type ApiLocationOut = z.output<typeof ApiLocation>;
export type ApiLocationDetailOut = z.output<typeof ApiLocationDetail>;
export type ApiBomOut = z.output<typeof ApiBom>;
export type ApiBomLineOut = z.output<typeof ApiBomLine>;
export type ApiBomDetailOut = z.output<typeof ApiBomDetail>;
export type ApiStockLevelOut = z.output<typeof ApiStockLevel>;
export type CreatePartBodyIn = z.output<typeof CreatePartBody>;
export type UpdatePartBodyIn = z.output<typeof UpdatePartBody>;
export type StockChangeBodyIn = z.output<typeof StockChangeBody>;
export type StockMoveBodyIn = z.output<typeof StockMoveBody>;
