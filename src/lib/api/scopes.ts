// Scopes for the REST API (/api/v1, docs/api.md) and how they map onto the
// api-key plugin's storage. Pure — no DB or auth imports — so the rules are
// unit-tested and src/lib/auth.ts can import the prefix.
//
// The plugin stores a key's grants as BetterAuth "permissions", a
// `{ resource: actions[] }` map (`{ parts: ["read", "write"] }`). The API and
// its docs speak in OAuth-style scope strings ("parts:write") instead; this
// module is the only place the two spellings meet.

// Every key starts with this ("Bin Vault"), so a leaked one is recognisable
// (secret scanners, logs) and can't be mistaken for another app's token.
export const API_KEY_PREFIX = "bv_";

export const API_SCOPES = [
  "parts:read",
  "parts:write",
  "stock:write",
  "boms:read",
  "boms:write",
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

// Shown on Settings → API keys and in the OpenAPI document. Booking stock is
// its own scope so a scanner station or build kiosk can count parts in and
// out without being able to edit or delete them.
export const API_SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  "parts:read": "Read parts with their stock, locations, categories, files and stock history",
  "parts:write": "Create, edit and delete parts; upload and delete their files",
  "stock:write": "Book stock — add, remove, count, move — and build BOMs",
  "boms:read": "Read BOMs with what current stock can build",
  "boms:write": "Create, edit and delete BOMs and their lines",
};

// Presets for the key dialog — the combinations people actually want.
export const READ_ONLY_SCOPES: ApiScope[] = ["parts:read", "boms:read"];
export const ALL_SCOPES: ApiScope[] = [...API_SCOPES];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === "string" && (API_SCOPES as readonly string[]).includes(value);
}

// Untrusted input (a form submission) → a deduped, ordered scope list, or an
// error. An empty list is rejected: a key that can do nothing is a mistake,
// not a configuration.
export function parseScopes(input: unknown): ApiScope[] | { error: string } {
  if (!Array.isArray(input)) return { error: "Scopes must be a list" };
  const unknown = input.filter((s) => !isApiScope(s));
  if (unknown.length > 0) return { error: `Unknown scope: ${String(unknown[0])}` };
  const set = new Set(input as ApiScope[]);
  if (set.size === 0) return { error: "Pick at least one scope" };
  return API_SCOPES.filter((s) => set.has(s));
}

export function scopesToPermissions(scopes: readonly ApiScope[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const scope of scopes) {
    const [resource, action] = scope.split(":");
    (out[resource] ??= []).push(action);
  }
  return out;
}

// The plugin hands permissions back parsed (or null for a key created without
// any, e.g. straight through /api/auth/api-key/create). Anything not in our
// vocabulary is dropped rather than trusted — a key can't gain a scope we
// don't know how to enforce.
export function permissionsToScopes(permissions: unknown): ApiScope[] {
  if (!permissions || typeof permissions !== "object") return [];
  const granted = new Set<string>();
  for (const [resource, actions] of Object.entries(permissions)) {
    if (!Array.isArray(actions)) continue;
    for (const action of actions) granted.add(`${resource}:${action}`);
  }
  return API_SCOPES.filter((s) => granted.has(s));
}

// Every write answers with what it changed, so a write scope implies the read
// scope that shows it. Stock has no read scope of its own: it is read on the
// part, so booking stock implies reading parts.
const IMPLIED: Partial<Record<ApiScope, ApiScope[]>> = {
  "parts:write": ["parts:read"],
  "stock:write": ["parts:read"],
  "boms:write": ["boms:read"],
};

export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  return granted.some((scope) => scope === required || IMPLIED[scope]?.includes(required));
}

// The key a request presents: `Authorization: Bearer bv_…` (what HTTP
// clients and n8n's "Header Auth" send) or the plugin's own `x-api-key`
// header. Only our prefix is accepted from the Authorization header, so an
// unrelated bearer token (an MCP JWT sent to the wrong endpoint) fails as "no
// key" instead of costing a hashed DB lookup.
export function apiKeyFromHeaders(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(\S+)$/i);
    if (match && match[1].startsWith(API_KEY_PREFIX)) return match[1];
  }
  const header = headers.get("x-api-key")?.trim();
  return header ? header : null;
}
