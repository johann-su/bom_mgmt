# MCP server (AI assistants on the inventory)

*Read before touching `/api/mcp`, the MCP tools, or the OAuth provider wiring.*

A remote [MCP](https://modelcontextprotocol.io) server at `POST /api/mcp` lets
Claude, ChatGPT, Cursor or Claude Code work with the inventory: find parts and
where they are, check what a BOM is short of, and — if the operator allows
writes — **create, edit, import and delete parts and book stock**. It mirrors Print Vault's read-only MCP server
(`stl_proj_mgmt`), with write tools added and the auth rebuilt on BetterAuth
1.7's plugins.

## Off by default; writes are a second opt-in

| Flags | Access |
| --- | --- |
| none | no MCP server |
| `ENABLE_MCP=true` | read-only tools |
| `ENABLE_MCP=true` + `ENABLE_MCP_WRITE=true` | read and write tools |

`mcpAccess` in `src/lib/auth-config.ts` derives the level (unit-tested);
`ENABLE_MCP_WRITE` alone does nothing (and logs a warning). Writes are separate
because they are the bigger decision: an approved assistant then changes the
inventory on a user's behalf, and an operator may well want assistants to look
things up but not touch stock counts.

The write flag is applied **per request, not per token**: `inventoryTools`
drops every tool not annotated `readOnlyHint: true` (`readOnlyTools` in
`protocol.ts` — an unannotated tool counts as a write), so write tools are
neither listed nor callable, and the `initialize` instructions stop mentioning
them. Turning writes off therefore takes effect for existing connections
immediately, with no reconnect; turning them on hands existing connections the
write tools too. That is deliberate — the flag is the operator's policy, and
the consent screen states what the instance allows at the time of asking. It
is not an OAuth scope, so a token can't be narrower than the instance setting.

`ENABLE_MCP=true` gates everything: the `jwt` + `mcp` BetterAuth plugins,
`/api/mcp`, the `.well-known` discovery documents, `/mcp/*` and
Settings → AI access (each 404s otherwise). Enabling it makes the instance an
OAuth **authorization server** whose registration endpoint
(`/api/auth/oauth2/register`, RFC 7591) is unauthenticated by design, because
that is how a client bootstraps before anyone signs in.

`BETTER_AUTH_URL` must be the public URL: tokens are audience-bound to
`{BETTER_AUTH_URL}/api/mcp`, and the plugin refuses a non-https resource except
on localhost.

## Tools

`src/lib/mcp/tools.ts`.

| Read (always) | Write (`ENABLE_MCP_WRITE`) |
| --- | --- |
| `search_parts`, `get_part`, `describe_generic_part`, `list_locations`, `get_location`, `list_categories`, `list_boms`, `get_bom` | `create_part`, `create_generic_parts`, `update_part`, `adjust_stock`, `move_stock`, `import_parts`, `delete_part` |

- **Writes go through the app's own code paths.** `src/lib/part-mutations.ts`
  and `src/lib/part-import.ts` back both the server actions and the tools, so
  validation, the movement log (attributed to the token's user) and page
  revalidation are identical. Don't add a write that bypasses them.
- **The model addresses things like a person does.** Locations by code
  (`A/1/IV`), categories by name (created on first use, like the importer),
  `update_part` as a patch (unmentioned fields are kept; attributes merge by
  key; `removeAttributes` deletes). That translation is pure and unit-tested in
  `src/lib/mcp/tool-input.ts`.
- **`import_parts` reuses the spreadsheet importer.** Row objects become a
  header row + explicit mapping (attributes → `Attr: <key>` columns) and go
  through `planPartImport`, so MPN/name matching, location lookup and "empty
  never overwrites" behave exactly like `/parts/import`. Raw `csv` text works
  too (header guessing included). `dryRun` returns the preview.
- **Generic parts go through the wizard's generators.** `describe_generic_part`
  browses the "Generic part" catalogue (types, options resolved for the values
  so far, a preview); `create_generic_parts` makes one part per range value
  via `src/lib/generic-part-mutations.ts` — the same path as the dialog's
  "Create N parts" — so a model's M3 screw has the app's name, designation and
  specs, and its stored choice. `update_part`'s `generic` re-runs the wizard
  on a part like "Edit generic part" does (hand-edited fields are kept). Unlike
  the dialog, a value that isn't offered is an error listing the options, never
  a silent fallback (`src/lib/mcp/generic-input.ts`).
- **Errors the model can fix are tool results, not protocol errors**
  (`ToolError` → `isError`): unknown location (with real codes to choose from),
  not enough stock, part used in a BOM. Malformed arguments are `-32602`.
  Unexpected exceptions are logged and answered generically.
- `delete_part` is annotated `destructiveHint`, so clients ask before calling it.
- **Every tool must carry `annotations.readOnlyHint`.** It is what keeps a tool
  out of a read-only server; get it wrong on a write tool and read-only
  instances expose it.

## Transport

`src/lib/mcp/protocol.ts` is a hand-written, stateless Streamable HTTP
transport (ported from Print Vault, unit-tested in `protocol.test.ts`): POST
only with a single JSON response, `GET`/`DELETE` → 405, notifications → 202,
no `Mcp-Session-Id`. One change from the original: a JSON-RPC **batch runs
sequentially**, since batched writes may depend on each other.

## Auth

BetterAuth 1.7 dropped the built-in `mcp` plugin the reference used. This uses
`@better-auth/mcp` (on `@better-auth/oauth-provider`) plus the `jwt` plugin:

- **Access tokens are JWTs** signed with the key in `jwks`, audience-bound to
  the MCP resource. `requireMcpAuth` verifies them by signature against
  `/api/auth/jwks`; the user is `claims.sub`. They can't be revoked early, so
  they live **15 minutes** (`accessTokenExpiresIn`); the 30-day refresh token
  is the actual connection.
- **Tables** (`src/db/schema.ts`, migration `0007_mcp_oauth.sql`) were
  transcribed from the plugins' schema definitions, and BetterAuth checks the
  adapter's schema map at startup ("Drizzle schema mismatch"). **After bumping
  better-auth, diff them against the plugin schema** — and every model must be
  listed in the `schema` map in `src/lib/auth.ts`, including
  `oauthResource`/`oauthClientResource`.
- **Discovery.** The issuer is `{origin}/api/auth`, so RFC 8414 metadata lives
  at `/.well-known/oauth-authorization-server/api/auth` (plus the
  `openid-configuration` twin). Protected-resource metadata
  (`/.well-known/oauth-protected-resource/api/mcp`) is built in the mcp
  plugin's request hook, so that route forwards to `auth.handler`. The proxy
  skips `/.well-known`.

### Login and consent

- **`loginPage` = `/mcp/authorize`.** Authorize redirects there (signed query)
  when there's no session. The proxy bounces a signed-out visitor through the
  normal `/sign-in` (password or SSO) with that URL as callback; back with a
  session, the page checks the signature and re-issues the original authorize
  request minus the signature fields, `prompt=login` and `max_age`
  (`src/lib/mcp/oauth-query.ts`). This keeps the sign-in forms unaware of
  OAuth instead of installing BetterAuth's client plugin, which rewrites every
  sign-in request; the trade-off is that a forced re-login is honoured only as
  "has a session".
- **`consentPage` = `/mcp/consent`.** Shows the client's self-asserted name and,
  more usefully, where the code will be sent, then calls
  `auth.api.oauth2Consent` from a server action; the browser follows the
  returned URL client-side (CSP `form-action 'self'` would block a cross-origin
  form redirect). It is a transparency screen, not a permission boundary:
  approval grants what the user can do in the app, since the inventory has no
  finer permissions.
- **Settings → AI access** (`src/lib/mcp/clients.ts`) lists clients per user
  from consents + refresh tokens. Disconnect deletes that user's refresh
  tokens and consent for the client (the current access token runs out within
  15 min). The client registration row stays: registration isn't per-user.

## Verifying a change

Unit tests cover the transport, argument translation and the login-resume
query. The OAuth flow and tools need a running app with `ENABLE_MCP=true`,
and all of it can be driven over HTTP: `POST /api/auth/oauth2/register` →
`GET /api/auth/oauth2/authorize?…&resource=…/api/mcp` (PKCE) → `/mcp/authorize`
→ `/mcp/consent` → `POST /api/auth/oauth2/consent {accept, oauth_query}` →
`POST /api/auth/oauth2/token` → `POST /api/mcp` with the bearer token. A
script doing `fetch` gets `{redirect, url}` JSON instead of 302s from the
authorize endpoints (BetterAuth treats it as an XHR); browsers and curl get
redirects.
