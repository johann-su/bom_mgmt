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
