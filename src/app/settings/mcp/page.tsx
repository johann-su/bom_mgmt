import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { mcpEnabled, mcpResource, mcpWriteEnabled, requireSession } from "@/lib/auth";
import { listMcpClients } from "@/lib/mcp/clients";
import { McpConnections } from "./mcp-connections";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "AI access" };

export default async function McpSettingsPage() {
  const session = await requireSession();
  // Not configured on this instance — the nav entry hides too, but a
  // bookmarked URL must not render a page for a feature that isn't there.
  if (!mcpEnabled) notFound();

  const clients = await listMcpClients(session.user.id);

  return (
    <section>
      <h2 className="text-lg font-semibold mb-1">AI assistant access (MCP)</h2>
      <p className="text-sm text-muted-foreground mb-6">
        Connect an AI assistant — Claude, ChatGPT or anything else that speaks the Model
        Context Protocol — so it can look up parts and stock and check what a BOM is short of
        {mcpWriteEnabled
          ? ", and add, edit or import parts and book stock for you"
          : ". Access is read-only on this instance"}
        . Connecting starts in the assistant, not here.
      </p>
      <McpConnections
        endpoint={mcpResource()}
        writable={mcpWriteEnabled}
        clients={clients.map((client) => ({
          ...client,
          connectedAt: client.connectedAt.toISOString(),
          lastActiveAt: client.lastActiveAt.toISOString(),
        }))}
      />
    </section>
  );
}
