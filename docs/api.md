# REST API (`/api/v1`)

*Read before touching `/api/v1`, API keys, or the shared mutation core
(`src/lib/part-mutations.ts`, `src/lib/bom-mutations.ts`). Update in the same
change that alters this behaviour.*

A stable, versioned API so scripts and integrations — a barcode-scanner
station, a KiCad plugin pushing BOMs, Home Assistant showing what runs low,
n8n — can work with the inventory without a session cookie and without
reaching into the database. It mirrors Print Vault's `/api/v1`
(`stl_proj_mgmt`): same key handling, envelope, pagination and OpenAPI
generation, with this app's resources.

The browser's own routes under `/api/*` (file upload/download, BOM CSV export)
are **not** part of it: session-cookie only, no stability promise.

## Turning it on and getting a key

`ENABLE_API=true` (off by default) mounts the api-key plugin, every
`/api/v1` route (404 otherwise, including `openapi.json`) and
**Settings → API keys**, where every user creates keys for themselves: a name,
the scopes, an expiry (30 days to never). The key (`bv_…`) is shown **once**;
only its hash is stored. A key acts as its user — stock it books is logged
under their name — deleting the user deletes their keys, and **Revoke** takes
effect on the very next request.

Why opt-in: it opens no unauthenticated surface, but a key is a long-lived
bearer credential that bypasses SSO and its MFA — a second door an operator
relying on `DISABLE_PASSWORD_LOGIN` may not want.

## Authentication and scopes

`Authorization: Bearer bv_…` (or an `x-api-key` header).

| Scope | Allows |
|---|---|
| `parts:read` | Parts with their stock per location, locations, categories, files (download), the stock movement log |
| `parts:write` | Create, edit and delete parts; upload and delete their files |
| `stock:write` | Book stock — add, remove, set (stock-take), level, place, move — and build BOMs |
| `boms:read` | BOMs with stock, requirements and buildable units |
| `boms:write` | Create, edit and delete BOMs and their lines |

A write scope implies the read scope that shows its result: `parts:write` →
`parts:read`, `boms:write` → `boms:read`, and `stock:write` → `parts:read`
(stock is read on parts). Booking stock is its own scope so a scanner or build
station can count parts in and out without being able to edit or delete them.
There are no owner checks: the inventory is a shared workspace, as in the app.

## Conventions

- **Base URL** `{BETTER_AUTH_URL}/api/v1`. **`GET /api/v1/openapi.json`** is the
  machine-readable contract (OpenAPI 3.1, readable without a key) — point
  Swagger UI, n8n's HTTP node or a client generator at it.
- **JSON in and out**, except uploads (raw bytes in) and downloads. Never
  cacheable (`Cache-Control: no-store`). Request bodies are **strict**: an
  unknown field is a 400, not a silently ignored no-op.
- **Errors** are `{ "error", "code" }`; `code` is stable, `error` is for
  humans. Validation errors add `issues: [{ path, message }]`.

  | Status | `code` | Meaning |
  |---|---|---|
  | 400 | `invalid_request` | Malformed body/parameters, unknown location or category, a mode the part's tracking doesn't take |
  | 401 | `unauthorized` | No key, or invalid/expired/revoked |
  | 403 | `insufficient_scope` | The key lacks the scope (named in the message and `WWW-Authenticate`) |
  | 404 | `not_found` | No such part/BOM/location/file |
  | 409 | `conflict` | The inventory's state refuses it: not enough stock, a part a BOM still lists |
  | 413 | `payload_too_large` | Upload over 50 MB |
  | 429 | `rate_limited` | Over 600 requests/minute for this key; see `Retry-After` |
  | 503 | `unavailable` | File storage is down |

- **Lists** are `{ data, nextCursor }`. Parts and movements are
  keyset-paginated: pass `?cursor=<nextCursor>` with the same `sort` until it is
  `null`; `limit` 1–200, default 50. Locations, categories and BOMs are
  returned whole with `nextCursor: null` — same envelope, so paging can be added
  later without breaking clients that already follow it.
- **Locations in bodies** are a location id or code (`"A/1/IV"`; exact, then
  case-insensitive when unambiguous); `null` is the part's unsorted pile.
- **Stock values** have one shape whatever the tracking mode:
  `{ quantity, level }` — a count for `exact` parts, a level
  (`empty`/`low`/`plenty`; `binary` uses only `empty`/`plenty`) for level/binary
  ones, neither for `none`.
- Text fields are strings; `""` means unset (as in the app).

## Endpoints

| Method & path | Scope | What it does |
|---|---|---|
| `GET /me` | any | The key's user and scopes — check your setup with this |
| `GET /parts` | `parts:read` | List. Filters: `q`, `mpn` (exact), `category`, `location` (incl. nested), `tracking`, `lowStock`, `unsorted`, `updatedSince`; `sort` = `name_asc` (default), `created_desc/asc`, `updated_desc/asc` |
| `POST /parts` | `parts:write` | Create, optionally with first `stock` |
| `GET /parts/{id}` | `parts:read` | One part with stock, files and the BOMs using it |
| `PATCH /parts/{id}` | `parts:write` | Change only the fields sent |
| `DELETE /parts/{id}` | `parts:write` | Delete with stock, history and files (409 while a BOM lists it) |
| `POST /parts/{id}/stock` | `stock:write` | Book stock in one place: `add`/`remove`/`set`, `level`, `place` |
| `POST /parts/{id}/stock/move` | `stock:write` | Move between places |
| `POST /parts/{id}/files?filename=` | `parts:write` | Attach an image/document (raw body) |
| `GET /files/{id}`, `DELETE /files/{id}` | `parts:read`, `parts:write` | Download (Range supported) / delete |
| `GET /categories`, `GET /locations`, `GET /locations/{id}` | `parts:read` | Catalog; a location's contents are `GET /parts?location={id}` |
| `GET /movements` | `parts:read` | The stock log. Filters `part`, `bom`, `kind`, `since`; `sort` = `created_desc`/`created_asc` |
| `GET /boms`, `POST /boms` | `boms:read`, `boms:write` | List / create (empty) |
| `GET /boms/{id}?units=` | `boms:read` | Lines with stock, `required`/`shortfall` for `units`, buildable units |
| `PATCH /boms/{id}`, `DELETE /boms/{id}` | `boms:write` | Rename/redescribe / delete (parts untouched) |
| `PUT /boms/{id}/lines/{partId}`, `DELETE …` | `boms:write` | Set (add or replace, idempotent) / remove the part's line |
| `POST /boms/{id}/build` | `stock:write` | Take `units` worth of parts out of stock, all or nothing; answers with the draws |

```sh
KEY=bv_…
API=https://bins.example.com/api/v1

# Where are my 555s?
curl -s -H "Authorization: Bearer $KEY" "$API/parts?mpn=NE555P" | jq '.data[0].stock'

# Received 100, put them in bin A/1/IV
curl -s -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"mode":"add","location":"A/1/IV","quantity":100,"note":"LCSC order"}' \
  "$API/parts/$PART/stock"

# Shopping list for 25 units
curl -s -H "Authorization: Bearer $KEY" "$API/boms/$BOM?units=25" \
  | jq '.lines[] | select(.shortfall > 0) | {part: .part.name, shortfall}'
```

`updatedAt` on a part moves only when the part itself is edited — **stock
changes are movements**. To follow them, poll
`GET /movements?sort=created_asc&since=<last createdAt seen>` and skip ids you
already have (`since` is inclusive).

Not covered yet, deliberately: creating/editing locations and location types,
label templates and printing, the generic-part wizard, spreadsheet and BOM CSV
import, user management, and event delivery (webhooks).

## How it is built

| Piece | Where | Pure? |
|---|---|---|
| Scopes, key prefix, header parsing | `src/lib/api/scopes.ts` | yes |
| Request/response schemas (zod) | `src/lib/api/schemas.ts` | yes |
| Query params, keyset cursors | `src/lib/api/params.ts` | yes |
| Bodies → mutation-core input (PATCH merge, levels, location refs) | `src/lib/api/translate.ts` | yes |
| Rows → response shapes | `src/lib/api/serialize.ts` | yes |
| Status/error mapping | `src/lib/api/http.ts` | yes |
| OpenAPI document | `src/lib/api/openapi.ts` | yes |
| Auth + scope + error wrapper, body readers | `src/lib/api/route.ts` | no |
| Reads | `src/lib/api/queries.ts` | no |
| Category references (find-or-create by name) | `src/lib/api/resolve.ts` | no |
| Key listing/revocation | `src/lib/api/keys.ts` | no |
| Routes | `src/app/api/v1/**/route.ts` | — |
| Settings → API keys | `src/app/settings/api-keys/` | — |

**Writes go through the app's own mutation core**: `src/lib/part-mutations.ts`
(parts, stock), `src/lib/bom-mutations.ts` (BOMs, lines, build) and
`src/lib/part-files.ts`. The server actions and MCP tools are thin wrappers
over the same functions, so validation, the movement log and page
revalidation are identical on every path. Don't add an API write that bypasses
them — add the mutation there and call it from both.

Core failures carry a `code` (`MutationResult` in `part-mutations.ts`):
`not_found` → 404, `conflict` → 409, none → 400. Forms and MCP only show the
message; the code is what keeps the API's statuses from depending on wording.

### Keys: `@better-auth/api-key`, with our own scope check

- **Never a session.** `enableSessionForAPIKeys: false`: a key opens
  `/api/v1` with its scopes, never cookie-guarded pages or server actions.
- **Scopes are the plugin's "permissions"**, stored as `{ resource: actions[] }`;
  `scopes.ts` is the only place that translates to `parts:write`. Unknown
  permissions are dropped on read, so a key can't gain a scope we don't enforce.
- **We check scopes ourselves** after `verifyApiKey({ key })` instead of passing
  `permissions` to it: the plugin reports a missing permission as
  `KEY_NOT_FOUND`, which would turn every 403 into a 401.
- **`permissions` is server-only.** Keys are created by the Settings server
  action calling `auth.api.createApiKey({ body: { userId, permissions, … } })`
  without request headers. A key made straight through
  `POST /api/auth/api-key/create` carries no permissions and gets 403 on
  everything but `GET /me`.
- **The plugin's default rate limit is 10 requests per *day*.** Configured to
  600/minute in `src/lib/auth.ts`; the `apikey` columns default to the same.
- **`apikey.reference_id` has a cascading FK** (the plugin declares a plain
  string). `route.ts` also re-reads the user row per request and refuses a key
  whose user is gone. Keys are `bv_…`, and only that prefix is taken from the
  `Authorization` header, so an MCP JWT sent here is "no key", not a lookup.
- The table is transcribed from the plugin schema (migration
  `0015_api_keys.sql`) and listed in the adapter's `schema` map — **diff it
  against the plugin when bumping better-auth**, as with the MCP tables.

### Reads

- Part filters reuse the parts list's SQL (`partSearchFilter`, `lowStockFilter`,
  `totalStock` in `src/lib/part-queries.ts`), so the API finds what the app finds.
- **Keyset cursors** record their sort and carry the sort key as Postgres text
  (`to_char(…, 'US')` for timestamps — a JS Date would round to milliseconds and
  skip rows at a page boundary — or the name). Pages compare
  `(key, id) > (cursor)`, which matches `ORDER BY key, id` including collation.
- `GET /parts?location=` matches any stock row in the subtree: an emptied bin
  is still the part's home.
- Stock entries: unsorted pile first (dropped once empty — it isn't a place),
  then locations by code; zero rows at locations stay.
- Movements keep the code a place had at the time: `location: null` is the
  unsorted pile; `{ id: null, code }` is a location deleted since.

### Writes

- **PATCH merges into the current state** (`updatePartValues`): the core's
  `updatePart` replaces every field with the full part form, so every field a
  PATCH omits is filled from the part as it is. Lists (`orderUrls`,
  `attributes`) are replaced whole — unlike MCP's `update_part`, which merges
  attributes for an LLM's convenience. `null` is a value (no category / no
  minimum); only an absent key keeps it. The generic-part wizard's stored
  choice isn't API-editable but is carried through, so a PATCH can't drop it.
- **Initial stock and stock bodies must fit the tracking mode** (a count, a
  level, or just a location). The core would quietly ignore the wrong one, so
  `translate.ts` refuses it; moving part of a level/binary part is refused rather
  than silently moving everything.
- `categoryName` finds or creates a category like the importer and MCP do;
  `categoryId` is checked up front so an unknown one is a 400, not an FK 500.
- `PUT /boms/{id}/lines/{partId}` is an upsert (`setBomLine`), addressed by
  part because a BOM lists each part once — pushing a BOM is a PUT per line,
  safe to repeat. Omitted `reference`/`notes` are cleared (PUT = the whole line).
- Building is `stock:write`, not `boms:write`: it changes stock, and a build
  kiosk needs no say over the BOM. It answers with the draws (`buildBom`
  returns them; the action only reports their count).

### The OpenAPI document

`openapi.ts` renders the zod registry in `schemas.ts` (input mode, so optional
and defaulted request fields aren't `required`) plus a hand-written path table
with each operation's scope (`x-required-scope`). `openapi.test.ts` fails when
the table and the route files drift apart — paths, exported methods, and the
scope each route passes to `apiRoute` — or when a `$ref` dangles. Routes must
therefore be declared as `export const METHOD = apiRoute(scope, …)`.

## Adding an endpoint

1. Shapes in `schemas.ts` (register response schemas in `apiSchemas`).
2. The route via `apiRoute(scope, …)`; writes through the mutation core (add
   the mutation there if it's missing, and point the server action at it).
3. An entry in `OPERATIONS` (`openapi.ts`) — the parity test enforces it.
4. Unit tests for new pure logic; a row in the endpoints table above.

## Verifying a change

Unit tests cover scopes, params/cursors, the PATCH merge and stock
translation, serialization, the error mapping and the document. The rest needs
a running app with `ENABLE_API=true` — preferably against a scratch database
(`createdb`, then `DATABASE_URL=… node scripts/migrate.mjs`) with
`STORAGE_BACKEND=filesystem`. Create keys through the Settings action (its id
is in the served client chunks: `__next_internal_action_entry_do_not_use__`;
POST with a `Next-Action` header and the session cookie), then drive `/api/v1`
with curl. Locations have no API yet: seed them through `/setup` or SQL.
