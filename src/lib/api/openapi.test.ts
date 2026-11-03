import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { buildOpenApiDocument, OPERATIONS } from "@/lib/api/openapi";
import { isApiScope } from "@/lib/api/scopes";

const doc = buildOpenApiDocument("https://bins.example/api/v1");
const ROUTES_DIR = path.join(process.cwd(), "src/app/api/v1");

function refsIn(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => refsIn(v, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "$ref" && typeof v === "string") out.push(v);
      else refsIn(v, out);
    }
  }
  return out;
}

// A dangling $ref breaks every client generator that reads the document.
test("every $ref in the document resolves", () => {
  const components = doc.components as Record<string, Record<string, unknown>>;
  for (const ref of refsIn(doc)) {
    const [, , section, name] = ref.split("/");
    assert.ok(components[section]?.[name], `unresolved ${ref}`);
  }
});

// The scope is part of each endpoint's contract: a client needs to know which
// key it needs, and the document is where it looks.
test("every operation names a real scope (or none) and a unique id", () => {
  const ids = new Set<string>();
  for (const ops of Object.values(OPERATIONS)) {
    for (const op of Object.values(ops)) {
      assert.ok(op.scope === null || isApiScope(op.scope), `${op.operationId}: ${op.scope}`);
      assert.ok(!ids.has(op.operationId), `duplicate ${op.operationId}`);
      ids.add(op.operationId);
    }
  }
});

function routeFiles(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full, `${prefix}/${entry}`);
    return entry === "route.ts" ? [prefix] : [];
  });
}

const toRouteDir = (apiPath: string) => apiPath.replace(/\{(\w+)\}/g, "[$1]");
const exportedMethods = (source: string) =>
  [...source.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) =>
    m[1].toLowerCase(),
  );
// The scope a route passes to apiRoute(…), per exported method.
const routeScopes = (source: string) =>
  Object.fromEntries(
    [...source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = apiRoute(?:<[^>]+>)?\((null|"[\w:]+")/g)].map(
      (m) => [m[1].toLowerCase(), m[2] === "null" ? null : m[2].slice(1, -1)],
    ),
  );

// The path table is hand-written, so it can drift from the routes; this keeps
// the two in lockstep — an endpoint added without documentation (or
// documentation for one that doesn't exist) fails here.
test("the documented operations are exactly the routes under src/app/api/v1", () => {
  const documented = Object.keys(OPERATIONS).map(toRouteDir).sort();
  const routes = routeFiles(ROUTES_DIR)
    .filter((r) => r !== "/openapi.json")
    .sort();
  assert.deepEqual(documented, routes);
  for (const [apiPath, ops] of Object.entries(OPERATIONS)) {
    const source = readFileSync(path.join(ROUTES_DIR, toRouteDir(apiPath), "route.ts"), "utf8");
    assert.deepEqual(exportedMethods(source).sort(), Object.keys(ops).sort(), `methods of ${apiPath}`);
  }
});

// The documented scope must be the one the route enforces, or a client
// configures a key that gets 403s. (Routes declare handlers as
// `export const METHOD = apiRoute(scope, …)` so this can read the scope.)
test("each operation documents the scope its route enforces", () => {
  for (const [apiPath, ops] of Object.entries(OPERATIONS)) {
    const enforced = routeScopes(readFileSync(path.join(ROUTES_DIR, toRouteDir(apiPath), "route.ts"), "utf8"));
    for (const [method, op] of Object.entries(ops)) {
      const where = `${method.toUpperCase()} ${apiPath}`;
      assert.ok(method in enforced, `${where} isn't declared with apiRoute(scope, …)`);
      assert.equal(op.scope, enforced[method], where);
    }
  }
});

// Request schemas are rendered in input mode: fields with a server default
// or left optional are not required of the client.
test("only the truly required request fields are marked required", () => {
  const schemas = doc.components.schemas as Record<string, { required?: string[] }>;
  assert.deepEqual(schemas.CreatePart.required, ["name"]);
  assert.deepEqual(schemas.UpdatePart.required ?? [], []);
  assert.deepEqual(schemas.SetBomLine.required, ["quantity"]);
});
