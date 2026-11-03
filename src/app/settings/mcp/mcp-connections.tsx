"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bot, Unplug } from "lucide-react";
import { disconnectMcpClient } from "./actions";
import { formatDate } from "@/lib/format";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// Dates cross the server/client boundary as ISO strings.
export type McpClientView = {
  clientId: string;
  name: string | null;
  connectedAt: string;
  lastActiveAt: string;
  active: boolean;
};

export function McpConnections({
  endpoint,
  writable,
  clients,
}: {
  endpoint: string;
  // ENABLE_MCP_WRITE: whether assistants can change the inventory.
  writable: boolean;
  clients: McpClientView[];
}) {
  const router = useRouter();
  const [busyClientId, setBusyClientId] = useState<string | null>(null);

  async function handleDisconnect(client: McpClientView) {
    setBusyClientId(client.clientId);
    const res = await disconnectMcpClient(client.clientId);
    setBusyClientId(null);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    toast.success(`${client.name ?? "Client"} disconnected`);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="text-sm font-semibold mb-2">Connecting an assistant</h3>
        <Card>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">
                Add this server URL in your assistant — in Claude under Settings → Connectors →
                Add custom connector, in ChatGPT as a custom connector.
              </div>
              <CopyField label="Server URL" value={endpoint} />
            </div>
            <div className="grid gap-2">
              <div className="text-xs text-muted-foreground">Or, in Claude Code:</div>
              <CopyField label="Command" value={`claude mcp add --transport http bin-vault ${endpoint}`} />
            </div>
            <p className="text-xs text-muted-foreground">
              Your assistant then sends you here to sign in and approve it.{" "}
              {writable
                ? "An approved assistant acts as you: it can read the whole inventory and create, edit, import and delete parts and change stock, logged under your name."
                : "An approved assistant can read the whole inventory — every part, location, stock count and BOM — but cannot change anything."}{" "}
              Only approve a connection you just started yourself.
            </p>
          </CardContent>
        </Card>
      </section>

      <section>
        <h3 className="text-sm font-semibold mb-2">Connected assistants</h3>
        {clients.length === 0 ? (
          <Card>
            <CardContent className="text-center text-sm text-muted-foreground">Nothing connected yet.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {clients.map((client) => (
              <Card key={client.clientId}>
                <CardContent className="flex items-center gap-3">
                  <Bot className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{client.name ?? "Unnamed client"}</span>
                      {!client.active && <Badge variant="outline">Expired</Badge>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      Connected {formatDate(new Date(client.connectedAt))} · last active{" "}
                      {formatDate(new Date(client.lastActiveAt))}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={busyClientId === client.clientId}
                    onClick={() => handleDisconnect(client)}
                  >
                    <Unplug className="size-4" />
                    Disconnect
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
