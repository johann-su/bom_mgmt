import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiKeyFromHeaders,
  hasScope,
  parseScopes,
  permissionsToScopes,
  scopesToPermissions,
} from "@/lib/api/scopes";

// The plugin stores { resource: actions[] }; the API speaks "resource:action".
// The two spellings must round-trip exactly or a key silently loses access.
test("scopes round-trip through the plugin's permission map", () => {
  const scopes = parseScopes(["boms:read", "stock:write", "parts:read"]);
  assert.ok(Array.isArray(scopes));
  assert.deepEqual(scopesToPermissions(scopes), {
    parts: ["read"],
    stock: ["write"],
    boms: ["read"],
  });
  assert.deepEqual(permissionsToScopes(scopesToPermissions(scopes)), ["parts:read", "stock:write", "boms:read"]);
});

// A key must never gain a scope the API doesn't know how to enforce — e.g. a
// permission written by hand or by a future plugin version.
test("unknown permissions are dropped, not trusted", () => {
  assert.deepEqual(
    permissionsToScopes({ parts: ["read", "admin"], stock: ["read"], users: ["write"], boms: "read" }),
    ["parts:read"],
  );
  // A key created straight through /api/auth/api-key/create has none at all.
  assert.deepEqual(permissionsToScopes(null), []);
});

test("parseScopes rejects unknown scopes and empty selections", () => {
  assert.ok("error" in (parseScopes(["parts:read", "parts:delete"]) as object));
  assert.ok("error" in (parseScopes([]) as object));
  assert.ok("error" in (parseScopes("parts:read") as object));
});

// Every write answers with what it changed, so it implies the read scope
// that shows it — and nothing more.
test("a write scope implies the matching read scope only", () => {
  assert.equal(hasScope(["parts:write"], "parts:read"), true);
  assert.equal(hasScope(["boms:write"], "boms:read"), true);
  assert.equal(hasScope(["parts:read"], "parts:write"), false);
  assert.equal(hasScope(["boms:write"], "parts:read"), false);
});

// Stock has no read scope of its own — it is read on parts — and booking it
// must not let a scanner-station key edit or delete parts.
test("stock:write reads parts but can't edit them", () => {
  assert.equal(hasScope(["stock:write"], "parts:read"), true);
  assert.equal(hasScope(["stock:write"], "parts:write"), false);
  assert.equal(hasScope(["parts:write"], "stock:write"), false);
});

test("the key is read from a Bearer header or x-api-key", () => {
  const key = "bv_abc123";
  assert.equal(apiKeyFromHeaders(new Headers({ authorization: `Bearer ${key}` })), key);
  assert.equal(apiKeyFromHeaders(new Headers({ authorization: `bearer ${key}` })), key);
  assert.equal(apiKeyFromHeaders(new Headers({ "x-api-key": key })), key);
  assert.equal(apiKeyFromHeaders(new Headers()), null);
});

// An MCP access token (a JWT) sent to /api/v1 by mistake must read as "no
// key", not cost a hashed DB lookup.
test("a bearer token without our prefix is not taken for an API key", () => {
  assert.equal(apiKeyFromHeaders(new Headers({ authorization: "Bearer eyJhbGciOiJFZERTQSJ9.x.y" })), null);
});
