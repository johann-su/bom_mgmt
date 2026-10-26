import { test } from "node:test";
import assert from "node:assert/strict";
import {
  configuredOAuthProviders,
  envFlag,
  mcpAccess,
  oidcDiscoveryUrl,
  passwordLoginEnabled,
} from "@/lib/auth-config";

// Operators write these by hand in a compose file or a PaaS env editor, so
// the usual spellings of "on" all have to land the same way.
test("envFlag accepts true/1 in any casing or padding", () => {
  for (const raw of ["true", "TRUE", " True ", "1"]) {
    assert.equal(envFlag(raw), true, raw);
  }
});

test("envFlag treats anything else — including unset — as off", () => {
  for (const raw of [undefined, "", "false", "0", "yes", "no"]) {
    assert.equal(envFlag(raw), false, String(raw));
  }
});

test("password login is on unless explicitly disabled", () => {
  assert.equal(passwordLoginEnabled(undefined, true), true);
  assert.equal(passwordLoginEnabled("false", true), true);
});

test("DISABLE_PASSWORD_LOGIN makes the IdP the only way in", () => {
  assert.equal(passwordLoginEnabled("true", true), false);
});

// The safety valve: without an IdP configured, honouring the flag would leave
// nobody able to sign in, so it is ignored rather than locking the operator out.
test("DISABLE_PASSWORD_LOGIN is ignored when no OAuth provider is configured", () => {
  assert.equal(passwordLoginEnabled("true", false), true);
});

test("OAuth providers are offered only when fully configured", () => {
  assert.deepEqual(
    configuredOAuthProviders({
      OIDC_ISSUER: "https://auth.example.com/application/o/bom/",
      OIDC_CLIENT_ID: "id",
      OIDC_CLIENT_SECRET: "secret",
      OIDC_PROVIDER_NAME: "Authentik",
      GITHUB_CLIENT_ID: "gh",
      // GitHub without a secret would be a button that can only fail.
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
    }),
    [
      { id: "oidc", name: "Authentik" },
      { id: "google", name: "Google" },
    ],
  );
  assert.deepEqual(configuredOAuthProviders({}), []);
});

test("OIDC_ISSUER may be the issuer or the full discovery URL", () => {
  const discovery = "https://idp.example.com/.well-known/openid-configuration";
  assert.equal(oidcDiscoveryUrl("https://idp.example.com/"), discovery);
  assert.equal(oidcDiscoveryUrl(discovery), discovery);
});

// MCP is two opt-ins: the server itself, then write access on top. Writes
// must never come on by themselves — ENABLE_MCP_WRITE alone keeps it off.
test("mcpAccess is off by default, read-only with ENABLE_MCP, writable only with both", () => {
  assert.equal(mcpAccess({}), "off");
  assert.equal(mcpAccess({ ENABLE_MCP_WRITE: "true" }), "off");
  assert.equal(mcpAccess({ ENABLE_MCP: "true" }), "read");
  assert.equal(mcpAccess({ ENABLE_MCP: "true", ENABLE_MCP_WRITE: "false" }), "read");
  assert.equal(mcpAccess({ ENABLE_MCP: "1", ENABLE_MCP_WRITE: "TRUE" }), "write");
});
