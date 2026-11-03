// The wrapper every /api/v1 route goes through: the ENABLE_API gate, API-key
// authentication, the scope check, and error handling. A route handler only
// ever sees an authenticated principal that holds the scope it declared.
//
// Keys are verified through the api-key plugin (hashed lookup, expiry,
// per-key rate limit) and then re-attached to their user, whose id the
// mutation core logs stock movements under. A deleted user's keys are gone
// by FK cascade, and the row lookup would refuse them anyway.

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { ZodError, type output, type ZodType } from "zod";
import { db } from "@/db";
import { user } from "@/db/schema";
import { apiEnabled, auth } from "@/lib/auth";
import { appUrl } from "@/lib/app-url";
import { logger } from "@/lib/logger";
import { apiError, invalidRequest } from "./http";
import { apiKeyFromHeaders, hasScope, permissionsToScopes, type ApiScope } from "./scopes";

export type ApiPrincipal = {
  user: { id: string; name: string; role: string };
  scopes: ApiScope[];
  key: { id: string; name: string | null; expiresAt: Date | null };
};

const CHALLENGE = { "WWW-Authenticate": 'Bearer realm="bin-vault"' };

/** An absolute URL on the app's public origin, for links in responses (serialize.ts › UrlFor). */
export const absoluteUrl = (path: string) => appUrl(path).toString();

const invalidKey = () =>
  apiError(401, "unauthorized", "The API key is invalid, expired or revoked", { headers: CHALLENGE });

async function authenticate(request: Request): Promise<ApiPrincipal | Response> {
  const presented = apiKeyFromHeaders(request.headers);
  if (!presented) {
    return apiError(
      401,
      "unauthorized",
      "Send an API key as `Authorization: Bearer bv_…` (create one under Settings → API keys)",
      { headers: CHALLENGE },
    );
  }

  const result = await auth.api.verifyApiKey({ body: { key: presented } });
  if (!result.valid || !result.key) {
    if (result.error?.code === "RATE_LIMITED") {
      const ms = Number((result.error as { details?: { tryAgainIn?: number } }).details?.tryAgainIn);
      return apiError(429, "rate_limited", "Too many requests for this API key", {
        headers: Number.isFinite(ms) ? { "Retry-After": String(Math.ceil(ms / 1000)) } : {},
      });
    }
    return invalidKey();
  }

  const owner = await db.query.user.findFirst({
    where: eq(user.id, result.key.referenceId),
    columns: { id: true, name: true, role: true },
  });
  if (!owner) return invalidKey();

  return {
    user: owner,
    scopes: permissionsToScopes(result.key.permissions),
    key: {
      id: result.key.id,
      name: result.key.name ?? null,
      expiresAt: result.key.expiresAt ? new Date(result.key.expiresAt) : null,
    },
  };
}

type Handler<P> = (ctx: {
  request: NextRequest;
  principal: ApiPrincipal;
  params: P;
}) => Promise<Response>;

// `scope: null` only requires a valid key (GET /me answers "what can this key
// do", so it must work for every key).
export function apiRoute<P = Record<string, never>>(scope: ApiScope | null, handler: Handler<P>) {
  return async (request: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    if (!apiEnabled) return apiError(404, "not_found", "Not found");

    const principal = await authenticate(request);
    if (principal instanceof Response) return principal;
    if (scope && !hasScope(principal.scopes, scope)) {
      return apiError(403, "insufficient_scope", `This API key lacks the ${scope} scope`, {
        headers: {
          "WWW-Authenticate": `Bearer realm="bin-vault", error="insufficient_scope", scope="${scope}"`,
        },
      });
    }

    try {
      return await handler({ request, principal, params: await context.params });
    } catch (err) {
      if (err instanceof ZodError) return invalidRequest(err);
      logger.error({ err, path: request.nextUrl.pathname }, "API request failed");
      return apiError(500, "internal", "Something went wrong");
    }
  };
}

// The JSON body validated against `schema`; a non-JSON body fails like an
// invalid one (a ZodError the wrapper turns into a 400).
export async function readBody<T extends ZodType>(request: Request, schema: T): Promise<output<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ZodError([{ code: "custom", path: [], message: "The body must be JSON", input: undefined }]);
  }
  return schema.parse(body);
}

/**
 * The raw body as bytes, or null when it is larger than `max` — checked
 * against Content-Length up front and again while reading, since the header
 * is the client's claim.
 */
export async function readBytes(request: Request, max: number): Promise<Uint8Array | null> {
  const claimed = Number(request.headers.get("content-length"));
  if (Number.isFinite(claimed) && claimed > max) return null;
  if (!request.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
