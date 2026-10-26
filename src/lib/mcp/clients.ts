// The user-facing side of the OAuth tables: which LLM clients a user has
// approved, and how to cut one off again. The OAuth flow can only ever grant,
// so without this an approval would be permanent short of editing the DB.
//
// The tables belong to the BetterAuth plugins — this module only reads and
// deletes rows. Grouping is by client, not by token: every refresh adds a row,
// and a person thinks "Claude is connected", not in tokens.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthAccessToken, oauthConsent, oauthRefreshToken } from "@/db/schema";

export type McpClientConnection = {
  clientId: string;
  /** As the client registered itself; may be missing. */
  name: string | null;
  /** When this client was approved. */
  connectedAt: Date;
  /** Newest token issued to it — a refresh moves this, so it reads as activity. */
  lastActiveAt: Date;
  /** A refresh token still in date; false = it must ask again. */
  active: boolean;
};

export async function listMcpClients(userId: string): Promise<McpClientConnection[]> {
  const [consents, tokens] = await Promise.all([
    db.query.oauthConsent.findMany({
      where: eq(oauthConsent.userId, userId),
      columns: { clientId: true, createdAt: true },
      with: { client: { columns: { name: true } } },
    }),
    db.query.oauthRefreshToken.findMany({
      where: eq(oauthRefreshToken.userId, userId),
      columns: { clientId: true, createdAt: true, expiresAt: true, revoked: true },
      with: { client: { columns: { name: true } } },
    }),
  ]);

  const now = new Date();
  const byClient = new Map<string, McpClientConnection>();
  const entry = (clientId: string, name: string | null | undefined, at: Date) => {
    let found = byClient.get(clientId);
    if (!found) {
      found = { clientId, name: name ?? null, connectedAt: at, lastActiveAt: at, active: false };
      byClient.set(clientId, found);
    }
    if (at < found.connectedAt) found.connectedAt = at;
    if (at > found.lastActiveAt) found.lastActiveAt = at;
    return found;
  };
  for (const c of consents) entry(c.clientId, c.client?.name, c.createdAt ?? now);
  for (const t of tokens) {
    const found = entry(t.clientId, t.client?.name, t.createdAt ?? now);
    found.active ||= !t.revoked && (t.expiresAt ?? now) > now;
  }
  return [...byClient.values()].sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
}

/**
 * Revokes one client's access for one user: its refresh tokens go (so it
 * can't get new access tokens), and so does the consent, so reconnecting asks
 * again. An access token already issued is a self-contained JWT and keeps
 * working until it expires — at most accessTokenExpiresIn (15 min, see
 * src/lib/auth.ts).
 *
 * The client's registration row is left alone: dynamic registration isn't
 * per-user, so another user may still be connected through it.
 */
export async function revokeMcpClient(userId: string, clientId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const forUser = <T extends typeof oauthAccessToken | typeof oauthRefreshToken | typeof oauthConsent>(t: T) =>
      and(eq(t.userId, userId), eq(t.clientId, clientId));
    await tx.delete(oauthAccessToken).where(forUser(oauthAccessToken));
    await tx.delete(oauthRefreshToken).where(forUser(oauthRefreshToken));
    await tx.delete(oauthConsent).where(forUser(oauthConsent));
  });
}
