import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  configuredOAuthProviders,
  envFlag,
  mcpAccess,
  oidcDiscoveryUrl,
  passwordLoginEnabled,
} from "@/lib/auth-config";
import { CALLBACK_PATH_HEADER, signInPath } from "@/lib/callback-url";
import { initialRole } from "@/lib/admin";
import { appUrl } from "@/lib/app-url";

// OAuth2 sign-in options shown on /sign-in, from env (see .env.example):
// generic OIDC for self-hosted IdPs, plus GitHub and Google. Redirect URIs
// are {BETTER_AUTH_URL}/api/auth/callback/<id> for all of them.
export const oauthProviders = configuredOAuthProviders();
const oauthEnabled = oauthProviders.length > 0;
const hasProvider = (id: string) => oauthProviders.some((p) => p.id === id);

// Reverse-proxy hops to strip from X-Forwarded-For, so sign-in rate limiting
// keys on the real client IP. Leave unset when the proxy sends a
// single-valued header (BetterAuth trusts that as-is).
const trustedProxyCidrs =
  process.env.TRUSTED_PROXY_CIDRS?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean) ?? [];

// Self-registration is on by default and can be switched off with
// DISABLE_SIGNUP=true once the accounts exist. This gates email/password
// sign-up only — OAuth keeps provisioning users on first login, since who may
// authenticate is the provider's decision.
export const signupDisabled = envFlag(process.env.DISABLE_SIGNUP);

// DISABLE_PASSWORD_LOGIN=true leaves OAuth as the only way in. Ignored (with a
// warning) when no OAuth provider is configured, so it can't lock everyone out.
export const passwordLoginDisabled = !passwordLoginEnabled(
  process.env.DISABLE_PASSWORD_LOGIN,
  oauthEnabled,
);

if (
  envFlag(process.env.DISABLE_PASSWORD_LOGIN) &&
  !oauthEnabled &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  logger.warn(
    "[auth] DISABLE_PASSWORD_LOGIN is set but no OAuth provider is configured — " +
      "ignoring it, since that would leave no way to sign in.",
  );
}

// MCP server (/api/mcp): opt-in, because enabling it turns the instance into
// an OAuth authorization server whose client-registration endpoint
// (/api/auth/oauth2/register, RFC 7591) is unauthenticated by design — that is
// how an LLM client bootstraps itself, but it is a write surface an instance
// that doesn't want the feature shouldn't expose. Everything MCP is gated on
// this: the plugins, /api/mcp, the discovery documents and the MCP pages.
// Write tools are a second opt-in (ENABLE_MCP_WRITE) — see mcpAccess in
// src/lib/auth-config.ts and docs/mcp.md.
export const mcpAccessLevel = mcpAccess();
export const mcpEnabled = mcpAccessLevel !== "off";
export const mcpWriteEnabled = mcpAccessLevel === "write";

if (
  envFlag(process.env.ENABLE_MCP_WRITE) &&
  !mcpEnabled &&
  process.env.NEXT_PHASE !== "phase-production-build"
) {
  logger.warn("[auth] ENABLE_MCP_WRITE is set but ENABLE_MCP is not — the MCP server stays off.");
}

// The MCP endpoint, and the OAuth resource identifier tokens are bound to
// (their `aud`). Discovery, token issuance and verification must all agree on
// this string, so it is defined once.
export const MCP_ENDPOINT_PATH = "/api/mcp";
export const mcpResource = () => appUrl(MCP_ENDPOINT_PATH).toString();

// Where the OAuth flow sends the browser for sign-in and for approval. Both
// are our pages rather than /sign-in directly — see src/app/mcp/.
export const MCP_LOGIN_PATH = "/mcp/authorize";
export const MCP_CONSENT_PATH = "/mcp/consent";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      // Written by the jwt/mcp plugins only; harmless while MCP is off.
      jwks: schema.jwks,
      oauthClient: schema.oauthClient,
      oauthResource: schema.oauthResource,
      oauthClientResource: schema.oauthClientResource,
      oauthAccessToken: schema.oauthAccessToken,
      oauthRefreshToken: schema.oauthRefreshToken,
      oauthConsent: schema.oauthConsent,
      oauthClientAssertion: schema.oauthClientAssertion,
    },
  }),
  emailAndPassword: {
    enabled: !passwordLoginDisabled,
    // Enforced server-side by BetterAuth; the /sign-up page also hides.
    disableSignUp: signupDisabled,
  },
  user: {
    // Expose the role column on session.user; input: false keeps sign-up
    // payloads from self-assigning a role.
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "user", input: false },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // First admin: INITIAL_ADMIN_EMAIL, or the very first account.
        before: async (user) => ({
          data: { ...user, role: await initialRole(user.email) },
        }),
      },
    },
  },
  socialProviders: {
    ...(hasProvider("github")
      ? {
          github: {
            clientId: process.env.GITHUB_CLIENT_ID!.trim(),
            clientSecret: process.env.GITHUB_CLIENT_SECRET!.trim(),
          },
        }
      : {}),
    ...(hasProvider("google")
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
          },
        }
      : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      // Let an OAuth login attach to an existing email/password account with
      // the same email instead of failing with account_not_linked. Only
      // providers that verify emails belong here.
      trustedProviders: ["oidc", "github", "google"],
      // Local accounts are never email-verified (we send no mail), so don't
      // require that for linking; the provider asserts the email.
      requireLocalEmailVerified: false,
    },
  },
  advanced: {
    ipAddress: { trustedProxies: trustedProxyCidrs },
  },
  plugins: [
    ...(hasProvider("oidc")
      ? [
          genericOAuth({
            config: [
              {
                providerId: "oidc",
                clientId: process.env.OIDC_CLIENT_ID!.trim(),
                clientSecret: process.env.OIDC_CLIENT_SECRET!.trim(),
                discoveryUrl: oidcDiscoveryUrl(process.env.OIDC_ISSUER!.trim()),
                scopes: ["openid", "profile", "email"],
                mapProfileToUser: (profile) => {
                  const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
                  const email = pick(profile.email);
                  return {
                    name:
                      pick(profile.name) ??
                      pick(profile.preferred_username) ??
                      (email ? email.split("@")[0] : "User"),
                  };
                },
              },
            ],
          }),
        ]
      : []),
    ...(mcpEnabled
      ? [
          // Signs the access tokens (JWTs, audience-bound to the MCP
          // resource) and serves the JWKS /api/mcp verifies them against.
          jwt(),
          mcp({
            loginPage: MCP_LOGIN_PATH,
            consentPage: MCP_CONSENT_PATH,
            resource: mcpResource(),
            // Claude, ChatGPT and Cursor register themselves (RFC 7591)
            // before anyone has signed in; that is the only way they connect.
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            // Custom-scheme redirect URIs (desktop apps) register as native.
            clientRegistrationDefaultApplicationType: "infer",
            // Access tokens are JWTs, checked by signature alone, so they
            // can't be revoked early — disconnecting a client (Settings → AI
            // access) only takes hold once the current one expires. These
            // tokens can write, so keep that window short; the refresh token
            // carries the 30-day connection.
            accessTokenExpiresIn: 15 * 60,
          }),
        ]
      : []),
  ],
});

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

// Where a page should send a signed-out visitor: /sign-in, carrying the
// page's own path (proxy-set header, validated) so login returns them here.
// For use in `if (!session) redirect(await signInRedirect())` guards.
export async function signInRedirect() {
  return signInPath((await headers()).get(CALLBACK_PATH_HEADER));
}

// For pages: the session, or a redirect to sign-in.
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect(await signInRedirect());
  return session;
}
