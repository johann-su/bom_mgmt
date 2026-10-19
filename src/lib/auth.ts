import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { logger } from "@/lib/logger";
import {
  configuredOAuthProviders,
  envFlag,
  oidcDiscoveryUrl,
  passwordLoginEnabled,
} from "@/lib/auth-config";
import { CALLBACK_PATH_HEADER, signInPath } from "@/lib/callback-url";
import { initialRole } from "@/lib/admin";

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

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
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
  plugins: hasProvider("oidc")
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
    : [],
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
