// Pure env logic for the auth setup. Kept out of `@/lib/auth` because that
// module opens a DB pool at import time, so a unit test can't import it (see
// AGENTS.md → Testing).

/** `true`/`1`, case- and whitespace-insensitive. Anything else is false. */
export function envFlag(raw: string | undefined): boolean {
  return ["true", "1"].includes(raw?.trim().toLowerCase() ?? "");
}

/**
 * Whether email/password sign-in stays available.
 *
 * `DISABLE_PASSWORD_LOGIN` makes the identity provider the only way in, which
 * is what an internet-facing instance behind an SSO provider wants: a local
 * password is a second door with no MFA and only BetterAuth's rate limit in
 * front of it.
 *
 * It is deliberately **ignored unless an OAuth provider is configured** —
 * honouring it without one would leave nobody able to sign in at all, and locking
 * the operator out of their own inventory is worse than the door it closes.
 */
export function passwordLoginEnabled(
  rawDisableFlag: string | undefined,
  oauthEnabled: boolean,
): boolean {
  return !(envFlag(rawDisableFlag) && oauthEnabled);
}

export type OAuthProvider = { id: string; name: string };

/**
 * The OAuth2 sign-in options configured in `env`: generic OIDC (any
 * standards-compliant IdP) plus GitHub and Google. Each needs its full set of
 * credentials — a half-configured provider is skipped rather than offered as
 * a button that can only fail.
 */
export function configuredOAuthProviders(
  env: Record<string, string | undefined> = process.env,
): OAuthProvider[] {
  const has = (...keys: string[]) => keys.every((k) => env[k]?.trim());
  const providers: OAuthProvider[] = [];
  if (has("OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET")) {
    providers.push({ id: "oidc", name: env.OIDC_PROVIDER_NAME?.trim() || "SSO" });
  }
  if (has("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET")) providers.push({ id: "github", name: "GitHub" });
  if (has("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET")) providers.push({ id: "google", name: "Google" });
  return providers;
}

/**
 * OIDC_ISSUER accepts either the issuer base URL or a full discovery URL.
 */
export function oidcDiscoveryUrl(issuer: string): string {
  return issuer.includes("/.well-known/")
    ? issuer
    : `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

/**
 * How much of the inventory the MCP server (/api/mcp) exposes:
 *
 * - `off`   — the default. No MCP server, no OAuth provider endpoints.
 * - `read`  — `ENABLE_MCP=true`: assistants can search and read parts,
 *   locations, stock and BOMs, but change nothing.
 * - `write` — `ENABLE_MCP=true` *and* `ENABLE_MCP_WRITE=true`: also create,
 *   edit, import and delete parts and book stock.
 *
 * Write access is a second opt-in because it is the bigger decision: an
 * approved assistant then changes the inventory on a user's behalf. On its own
 * `ENABLE_MCP_WRITE` does nothing — it can't switch the server on.
 */
export type McpAccess = "off" | "read" | "write";

export function mcpAccess(env: Record<string, string | undefined> = process.env): McpAccess {
  if (!envFlag(env.ENABLE_MCP)) return "off";
  return envFlag(env.ENABLE_MCP_WRITE) ? "write" : "read";
}
