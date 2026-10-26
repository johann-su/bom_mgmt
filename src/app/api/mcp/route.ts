import { NextResponse } from "next/server";
import { requireMcpAuth } from "@better-auth/mcp";
import { auth, mcpEnabled, mcpResource, mcpWriteEnabled } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { handleMcpPayload, parseErrorResponse } from "@/lib/mcp/protocol";
import { inventoryInstructions, inventoryTools } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The MCP endpoint: inventory tools for LLM clients — read-only, or read and
// write when the operator also sets ENABLE_MCP_WRITE (src/lib/auth-config.ts).
//
// Authentication is an OAuth bearer token (a JWT signed by the jwt plugin and
// audience-bound to this URL), not a session cookie. requireMcpAuth verifies
// it against our JWKS and answers 401 with the `WWW-Authenticate:
// resource_metadata=…` header a client needs to discover where to get one. A
// token acts as its user (`sub`): stock changes it books are logged under
// their name, exactly as if they had used the app.
//
// Transport shape and why it is hand-rolled: see src/lib/mcp/protocol.ts.

const serverInfo = {
  name: "bom-mgmt",
  title: "Parts inventory",
  // Set when started through npm; the Docker image runs server.js directly.
  version: process.env.npm_package_version ?? "0.1.0",
};

const handler = requireMcpAuth(
  auth,
  async (req, claims) => {
    const userId = claims.sub;
    if (!userId) {
      return NextResponse.json({ error: "Token has no subject" }, { status: 401 });
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json(parseErrorResponse(), { status: 400 });
    }

    const response = await handleMcpPayload(payload, {
      tools: inventoryTools({ userId, allowWrites: mcpWriteEnabled }),
      serverInfo,
      instructions: inventoryInstructions({ allowWrites: mcpWriteEnabled }),
      onError: (message, err) => logger.error({ err }, message),
    });

    logger.debug({ userId, clientId: claims.azp }, "[mcp] request handled");

    // A body of notifications only has nothing to answer.
    return response === null
      ? new Response(null, { status: 202 })
      : NextResponse.json(response);
  },
  { resource: mcpResource() },
);

export async function POST(req: Request) {
  if (!mcpEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return handler(req);
}

// This server never initiates messages, so it offers no event stream to open
// (the spec's answer for that is 405, not 404 — the endpoint exists).
export async function GET() {
  return NextResponse.json(
    { error: "Method not allowed" },
    { status: 405, headers: { Allow: "POST" } },
  );
}

// Stateless: there is no session for a client to end.
export const DELETE = GET;
