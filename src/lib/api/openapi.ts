// The OpenAPI 3.1 description of /api/v1, served at /api/v1/openapi.json.
// Component schemas are generated from the zod schemas the routes validate
// with (src/lib/api/schemas.ts), so the document can't drift from what the
// API accepts; the path table below is hand-written and unit-tested to match
// the route files, reference only schemas that exist, and name every
// operation's scope. Pure — the server URL is passed in.

import * as z from "zod";
import { MAX_UPLOAD_BYTES } from "@/lib/file-kind";
import { MOVEMENT_KINDS, TRACKING_MODES } from "@/lib/stock";
import { API_SCOPE_DESCRIPTIONS, API_SCOPES, type ApiScope } from "./scopes";
import { DEFAULT_LIMIT, MAX_LIMIT, MOVEMENT_SORTS, PART_SORTS } from "./params";
import { apiSchemas } from "./schemas";

type Json = Record<string, unknown>;

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const json = (schema: Json, description = "OK") => ({
  description,
  content: { "application/json": { schema } },
});
const body = (id: string) => ({ required: true, content: { "application/json": { schema: ref(id) } } });
const errorResponse = (description: string) => json(ref("Error"), description);
const noContent = (description: string) => ({ description });

const COMMON_ERRORS = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "429": { $ref: "#/components/responses/RateLimited" },
};

const pathParam = (name: string, description: string) => ({
  name,
  in: "path",
  required: true,
  description,
  schema: { type: "string", format: "uuid" },
});

const queryParam = (name: string, description: string, schema: Json = { type: "string" }) => ({
  name,
  in: "query",
  required: false,
  description,
  schema,
});

const uuid = { type: "string", format: "uuid" };
const boolean = { type: "boolean", default: false };
const paging = (sorts: readonly string[]) => [
  queryParam("sort", "Order", { type: "string", enum: [...sorts], default: sorts[0] }),
  queryParam("limit", "Page size", { type: "integer", minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT }),
  queryParam("cursor", "`nextCursor` from the previous page (same sort)"),
];

type Operation = {
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  scope: ApiScope | null;
  parameters?: Json[];
  requestBody?: Json;
  responses: Record<string, unknown>;
};

function operation(op: Operation) {
  return {
    operationId: op.operationId,
    summary: op.summary,
    description: [op.description, op.scope ? `Requires the \`${op.scope}\` scope.` : "Works with any valid key."]
      .filter(Boolean)
      .join("\n\n"),
    tags: [op.tag],
    "x-required-scope": op.scope,
    ...(op.parameters ? { parameters: op.parameters } : {}),
    ...(op.requestBody ? { requestBody: op.requestBody } : {}),
    responses: { ...op.responses, ...COMMON_ERRORS },
  };
}

const partId = pathParam("id", "Part id");
const bomId = pathParam("id", "BOM id");

export const OPERATIONS: Record<string, Record<string, Operation>> = {
  "/me": {
    get: {
      operationId: "getMe",
      summary: "The key's user and scopes",
      tag: "Account",
      scope: null,
      responses: { "200": json(ref("Me")) },
    },
  },
  "/parts": {
    get: {
      operationId: "listParts",
      summary: "List parts",
      description:
        "Keyset-paginated; filters combine with AND. Each part comes with its stock per location. `updatedSince` sees edits of the part itself — stock changes are in `GET /movements`.",
      tag: "Parts",
      scope: "parts:read",
      parameters: [
        queryParam("q", "Text match on name, MPN, manufacturer, description and attribute values"),
        queryParam("mpn", "Exact manufacturer part number, case-insensitive"),
        queryParam("category", "Category id", uuid),
        queryParam("location", "Only parts stored in this location or any location inside it (an empty home counts)", uuid),
        queryParam("tracking", "Stock tracking mode", { type: "string", enum: [...TRACKING_MODES] }),
        queryParam("lowStock", "Only parts that need reordering", boolean),
        queryParam("unsorted", "Only parts with stock not put away yet", boolean),
        queryParam("updatedSince", "Only parts edited at or after this ISO 8601 time", { type: "string", format: "date-time" }),
        ...paging(PART_SORTS),
      ],
      responses: {
        "200": json(ref("PartPage")),
        "400": errorResponse("Invalid filter"),
        "404": errorResponse("Unknown location"),
      },
    },
    post: {
      operationId: "createPart",
      summary: "Create a part",
      description: "Optionally with its first stock, logged as a movement under the key's user.",
      tag: "Parts",
      scope: "parts:write",
      requestBody: body("CreatePart"),
      responses: {
        "201": json(ref("PartDetail"), "Created"),
        "400": errorResponse("Invalid body, unknown category or location"),
      },
    },
  },
  "/parts/{id}": {
    get: {
      operationId: "getPart",
      summary: "Get a part with its stock, files and BOM usage",
      tag: "Parts",
      scope: "parts:read",
      parameters: [partId],
      responses: { "200": json(ref("PartDetail")), "404": errorResponse("No such part") },
    },
    patch: {
      operationId: "updatePart",
      summary: "Update a part",
      description: "Only the fields sent change; `orderUrls` and `attributes` replace the whole list. Stock is booked with `POST /parts/{id}/stock`.",
      tag: "Parts",
      scope: "parts:write",
      parameters: [partId],
      requestBody: body("UpdatePart"),
      responses: {
        "200": json(ref("PartDetail")),
        "400": errorResponse("Invalid body or unknown category"),
        "404": errorResponse("No such part"),
      },
    },
    delete: {
      operationId: "deletePart",
      summary: "Delete a part",
      description: "Removes the part with its stock, history and files, for good.",
      tag: "Parts",
      scope: "parts:write",
      parameters: [partId],
      responses: {
        "204": noContent("Deleted"),
        "404": errorResponse("No such part"),
        "409": errorResponse("A BOM still lists the part"),
      },
    },
  },
  "/parts/{id}/stock": {
    post: {
      operationId: "changeStock",
      summary: "Book stock in one place",
      description:
        "Exact parts: `add`, `remove` or `set` (stock-take). Level/binary parts: `level`. Untracked parts: `place` (where it lives). Logged in the part's history; answers with the part.",
      tag: "Stock",
      scope: "stock:write",
      parameters: [partId],
      requestBody: body("StockChange"),
      responses: {
        "200": json(ref("PartDetail")),
        "400": errorResponse("Invalid body, unknown location, or a mode the part's tracking doesn't take"),
        "404": errorResponse("No such part"),
        "409": errorResponse("Not enough stock there"),
      },
    },
  },
  "/parts/{id}/stock/move": {
    post: {
      operationId: "moveStock",
      summary: "Move stock between places",
      description: "From `null` (the unsorted pile) puts stock away. Answers with the part.",
      tag: "Stock",
      scope: "stock:write",
      parameters: [partId],
      requestBody: body("StockMove"),
      responses: {
        "200": json(ref("PartDetail")),
        "400": errorResponse("Invalid body or unknown location"),
        "404": errorResponse("No such part"),
        "409": errorResponse("Not enough stock to move"),
      },
    },
  },
  "/parts/{id}/files": {
    post: {
      operationId: "uploadPartFile",
      summary: "Attach an image or document",
      description: `The raw file bytes as the body (at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB). The extension decides the kind; images, PDFs, text, CSV, ZIP, STEP/STL/3MF and KiCad files are allowed.`,
      tag: "Files",
      scope: "parts:write",
      parameters: [partId, { ...queryParam("filename", "File name, including its extension"), required: true }],
      requestBody: {
        required: true,
        content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
      },
      responses: {
        "201": json(ref("File"), "Attached"),
        "400": errorResponse("Missing or disallowed filename, or an empty body"),
        "404": errorResponse("No such part"),
        "413": errorResponse("File too large"),
        "503": errorResponse("File storage unavailable"),
      },
    },
  },
  "/files/{id}": {
    get: {
      operationId: "downloadFile",
      summary: "Download a file",
      description: "Supports `Range` requests.",
      tag: "Files",
      scope: "parts:read",
      parameters: [pathParam("id", "File id")],
      responses: {
        "200": {
          description: "The file",
          content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
        },
        "206": noContent("Partial content"),
        "404": errorResponse("No such file"),
      },
    },
    delete: {
      operationId: "deleteFile",
      summary: "Delete a file",
      tag: "Files",
      scope: "parts:write",
      parameters: [pathParam("id", "File id")],
      responses: { "204": noContent("Deleted"), "404": errorResponse("No such file") },
    },
  },
  "/categories": {
    get: {
      operationId: "listCategories",
      summary: "List categories",
      tag: "Catalog",
      scope: "parts:read",
      responses: { "200": json(ref("CategoryList")) },
    },
  },
  "/locations": {
    get: {
      operationId: "listLocations",
      summary: "List storage locations",
      description: "Every location, depth-first in the app's display order.",
      tag: "Catalog",
      scope: "parts:read",
      responses: { "200": json(ref("LocationList")) },
    },
  },
  "/locations/{id}": {
    get: {
      operationId: "getLocation",
      summary: "Get a location",
      description: "List what it holds with `GET /parts?location={id}`.",
      tag: "Catalog",
      scope: "parts:read",
      parameters: [pathParam("id", "Location id")],
      responses: { "200": json(ref("LocationDetail")), "404": errorResponse("No such location") },
    },
  },
  "/movements": {
    get: {
      operationId: "listMovements",
      summary: "List stock movements",
      description:
        "The append-only stock log. To follow it, poll with `sort=created_asc&since=<last createdAt seen>` and skip ids you already have.",
      tag: "Stock",
      scope: "parts:read",
      parameters: [
        queryParam("part", "Only this part's movements", uuid),
        queryParam("bom", "Only builds of this BOM", uuid),
        queryParam("kind", "Only this kind", { type: "string", enum: [...MOVEMENT_KINDS] }),
        queryParam("since", "Only movements at or after this ISO 8601 time", { type: "string", format: "date-time" }),
        ...paging(MOVEMENT_SORTS),
      ],
      responses: { "200": json(ref("MovementPage")), "400": errorResponse("Invalid filter") },
    },
  },
  "/boms": {
    get: {
      operationId: "listBoms",
      summary: "List BOMs",
      tag: "BOMs",
      scope: "boms:read",
      responses: { "200": json(ref("BomList")) },
    },
    post: {
      operationId: "createBom",
      summary: "Create a BOM",
      description: "Starts empty; add lines with `PUT /boms/{id}/lines/{partId}`.",
      tag: "BOMs",
      scope: "boms:write",
      requestBody: body("CreateBom"),
      responses: { "201": json(ref("BomDetail"), "Created"), "400": errorResponse("Invalid body") },
    },
  },
  "/boms/{id}": {
    get: {
      operationId: "getBom",
      summary: "Get a BOM with stock and requirements",
      tag: "BOMs",
      scope: "boms:read",
      parameters: [
        bomId,
        queryParam("units", "Units to compute `required` and `shortfall` for", {
          type: "integer",
          minimum: 1,
          maximum: 1_000_000,
          default: 1,
        }),
      ],
      responses: {
        "200": json(ref("BomDetail")),
        "400": errorResponse("Invalid units"),
        "404": errorResponse("No such BOM"),
      },
    },
    patch: {
      operationId: "updateBom",
      summary: "Rename or redescribe a BOM",
      tag: "BOMs",
      scope: "boms:write",
      parameters: [bomId],
      requestBody: body("UpdateBom"),
      responses: {
        "200": json(ref("BomDetail")),
        "400": errorResponse("Invalid body"),
        "404": errorResponse("No such BOM"),
      },
    },
    delete: {
      operationId: "deleteBom",
      summary: "Delete a BOM",
      description: "Parts and stock are untouched.",
      tag: "BOMs",
      scope: "boms:write",
      parameters: [bomId],
      responses: { "204": noContent("Deleted"), "404": errorResponse("No such BOM") },
    },
  },
  "/boms/{id}/lines/{partId}": {
    put: {
      operationId: "setBomLine",
      summary: "Set a BOM's line for a part",
      description: "Adds the line if the BOM doesn't list the part yet, replaces it otherwise.",
      tag: "BOMs",
      scope: "boms:write",
      parameters: [bomId, pathParam("partId", "Part id")],
      requestBody: body("SetBomLine"),
      responses: {
        "200": json(ref("BomLine"), "Replaced"),
        "201": json(ref("BomLine"), "Added"),
        "400": errorResponse("Invalid body"),
        "404": errorResponse("No such BOM or part"),
      },
    },
    delete: {
      operationId: "removeBomLine",
      summary: "Remove a part from a BOM",
      tag: "BOMs",
      scope: "boms:write",
      parameters: [bomId, pathParam("partId", "Part id")],
      responses: { "204": noContent("Removed"), "404": errorResponse("No such BOM, or it doesn't list the part") },
    },
  },
  "/boms/{id}/build": {
    post: {
      operationId: "buildBom",
      summary: "Build units of a BOM",
      description:
        "Takes every counted line's parts out of stock, emptiest bins first, all or nothing. Each draw is logged as a build movement.",
      tag: "Stock",
      scope: "stock:write",
      parameters: [bomId],
      requestBody: body("BuildBom"),
      responses: {
        "200": json(ref("BuildResult")),
        "400": errorResponse("Invalid body"),
        "404": errorResponse("No such BOM"),
        "409": errorResponse("Not enough stock, or the BOM has no lines"),
      },
    },
  },
};

function componentSchemas(): Record<string, Json> {
  const { schemas } = z.toJSONSchema(apiSchemas, {
    io: "input",
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, Json> };
  // Per-schema $schema/$id are noise inside an OpenAPI document.
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => {
      const rest = { ...schema };
      delete rest.$schema;
      delete rest.$id;
      return [id, rest];
    }),
  );
}

export function buildOpenApiDocument(serverUrl: string) {
  const paths = Object.fromEntries(
    Object.entries(OPERATIONS).map(([path, ops]) => [
      path,
      Object.fromEntries(Object.entries(ops).map(([method, op]) => [method, operation(op)])),
    ]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "Bin Vault API",
      version: "1",
      description: [
        "The inventory's REST API. Authenticate with a personal API key from Settings → API keys, sent as `Authorization: Bearer bv_…` (or `x-api-key`). A key acts as the user who created it, limited to its scopes:",
        ...API_SCOPES.map((s) => `- \`${s}\` — ${API_SCOPE_DESCRIPTIONS[s]}`),
        "A write scope implies the read scope that shows its result (`stock:write` → `parts:read`). Errors are `{ error, code }` with a matching status; lists are `{ data, nextCursor }`.",
      ].join("\n"),
    },
    servers: [{ url: serverUrl }],
    security: [{ bearerKey: [] }, { headerKey: [] }],
    tags: ["Account", "Parts", "Stock", "Files", "Catalog", "BOMs"].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        bearerKey: { type: "http", scheme: "bearer", description: "A bv_… API key" },
        headerKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      responses: {
        Unauthorized: errorResponse("Missing, invalid, expired or revoked key"),
        Forbidden: errorResponse("The key lacks the scope"),
        RateLimited: errorResponse("Too many requests for this key; see Retry-After"),
      },
      schemas: componentSchemas(),
    },
  };
}
