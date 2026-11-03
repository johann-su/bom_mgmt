import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiEnabled, requireSession } from "@/lib/auth";
import { appUrl } from "@/lib/app-url";
import { listApiKeys } from "@/lib/api/keys";
import { API_SCOPE_DESCRIPTIONS, API_SCOPES } from "@/lib/api/scopes";
import { ApiKeys } from "./api-keys";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysSettingsPage() {
  const session = await requireSession();
  // Not configured on this instance — the nav entry hides too, but a
  // bookmarked URL must not render a page for a feature that isn't there.
  if (!apiEnabled) notFound();

  const keys = await listApiKeys(session.user.id);
  const now = new Date();

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">API keys</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Personal keys for scripts and integrations — a barcode scanner station, a KiCad plugin,
        Home Assistant, n8n — to use the inventory&apos;s REST API as you. A key can do only what
        its scopes allow, and never more than you can.
      </p>
      <ApiKeys
        apiBase={appUrl("/api/v1").toString()}
        scopes={API_SCOPES.map((scope) => ({ scope, description: API_SCOPE_DESCRIPTIONS[scope] }))}
        keys={keys.map((key) => ({
          ...key,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
          expiresAt: key.expiresAt?.toISOString() ?? null,
          expired: key.expiresAt !== null && key.expiresAt < now,
        }))}
      />
    </section>
  );
}
