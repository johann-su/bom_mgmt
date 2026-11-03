"use server";

import { revalidatePath } from "next/cache";
import { apiEnabled, auth, getSession } from "@/lib/auth";
import { revokeApiKey } from "@/lib/api/keys";
import { parseScopes, scopesToPermissions } from "@/lib/api/scopes";
import { logger } from "@/lib/logger";

// Offered lifetimes, in days; null = never expires.
const EXPIRY_DAYS = [30, 90, 365, null] as const;

// Creates a key for the signed-in user and returns the secret — the only time
// it is ever readable; only its hash is stored. Called server-side without
// request headers on purpose: that is what lets us set `permissions`, which
// the plugin refuses to accept from a client request.
export async function createApiKey(input: {
  name: string;
  scopes: unknown;
  expiresInDays: number | null;
}): Promise<{ key: string } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  if (!apiEnabled) return { error: "The API is disabled on this instance" };

  const name = String(input.name ?? "").trim();
  if (!name || name.length > 64) return { error: "Name the key (at most 64 characters)" };
  const scopes = parseScopes(input.scopes);
  if ("error" in scopes) return scopes;
  if (!(EXPIRY_DAYS as readonly (number | null)[]).includes(input.expiresInDays)) {
    return { error: "Pick an expiry" };
  }

  try {
    const created = await auth.api.createApiKey({
      body: {
        name,
        userId: session.user.id,
        permissions: scopesToPermissions(scopes),
        expiresIn: input.expiresInDays === null ? null : input.expiresInDays * 86_400,
      },
    });
    revalidatePath("/settings/api-keys");
    return { key: created.key };
  } catch (err) {
    logger.error({ err }, "API key creation failed");
    return { error: "Couldn't create the key" };
  }
}

// Revokes one of the caller's keys. The id comes from the browser, so it
// selects *which* of your keys to revoke and can never reach another user's.
export async function deleteApiKey(keyId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  if (!keyId) return { error: "Missing key" };
  if (!(await revokeApiKey(session.user.id, keyId))) return { error: "Key not found" };
  revalidatePath("/settings/api-keys");
  return {};
}
