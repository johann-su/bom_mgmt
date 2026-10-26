import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { Plug, ShieldAlert, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { oauthClient } from "@/db/schema";
import { auth, mcpEnabled, mcpWriteEnabled, requireSession } from "@/lib/auth";
import { toSearchParams } from "@/lib/mcp/oauth-query";
import { APP_NAME } from "@/components/brand-mark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { McpProblem } from "../problem";
import { ConsentButtons } from "./consent-buttons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connect assistant" };

// The OAuth `consentPage`: BetterAuth redirects here, with a signed query
// naming the client, once the user is signed in and hasn't approved that
// client yet. It shows who is asking and what they get. Approving grants the
// client what the user can do in the app (read-only unless the operator set
// ENABLE_MCP_WRITE) — the inventory is a shared
// workspace without finer permissions (src/lib/roles.ts), so there is nothing
// narrower to offer. It is a transparency screen; the real control is that
// the whole MCP surface is off unless the operator sets ENABLE_MCP.
export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!mcpEnabled) notFound();
  const session = await requireSession();

  const params = toSearchParams(await searchParams);
  const oauthQuery = params.toString();
  const { secret } = await auth.$context;
  const clientId = params.get("client_id");
  const client =
    clientId && (await verifyOAuthQueryParams(oauthQuery, secret))
      ? await db.query.oauthClient.findFirst({ where: eq(oauthClient.clientId, clientId) })
      : undefined;
  if (!client || client.disabled) {
    return (
      <McpProblem
        title="This connection request is invalid or has expired"
        detail="Start connecting again from your AI assistant."
      />
    );
  }

  const name = client.name || "An MCP client";
  // Registration is self-asserted (anyone can call the register endpoint), so
  // the name proves nothing; where the code goes is the part worth showing.
  const destinations = [...new Set(client.redirectUris.map((uri) => URL.parse(uri)?.origin ?? uri))];

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-5" />
            Connect {name}
          </CardTitle>
          <CardDescription>
            {name} wants to use your {APP_NAME} inventory as {session.user.name}.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            {/* Follows ENABLE_MCP_WRITE at the time of asking. The operator can
                change it later; it then applies to this connection too. */}
            {mcpWriteEnabled ? (
              <p className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  It can read all parts, locations, stock and BOMs, and it can create, edit,
                  import and delete parts and change stock — logged under your name. Only
                  approve a connection you just started yourself.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                <span>
                  It can read all parts, locations, stock and BOMs — the same things you can see
                  when signed in. It cannot create, edit or delete anything.
                </span>
              </p>
            )}
            <p className="mt-2 break-all">
              Responses go to <span className="font-mono">{destinations.join(", ")}</span>
            </p>
          </div>
          <ConsentButtons oauthQuery={oauthQuery} />
        </CardContent>
      </Card>
    </div>
  );
}
