// Response conventions of /api/v1, in one place: JSON bodies, the error
// envelope `{ error, code }` (schemas.ts › Error), and how the mutation
// core's outcomes map onto status codes. Pure — plain `Response`, no Next.js —
// so the mapping is unit-tested.

import type { ZodError } from "zod";
import type { MutationResult } from "@/lib/part-mutations";

export type ApiErrorCode =
  | "unauthorized"
  | "insufficient_scope"
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "payload_too_large"
  | "unavailable"
  | "internal";

// Every API answer is per-key, private data: never cache it anywhere.
const BASE_HEADERS = { "Cache-Control": "no-store" };

export function apiJson(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return Response.json(data, {
    status: init.status ?? 200,
    headers: { ...BASE_HEADERS, ...init.headers },
  });
}

export function apiError(
  status: number,
  code: ApiErrorCode,
  error: string,
  extra: { headers?: Record<string, string>; body?: Record<string, unknown> } = {},
): Response {
  return apiJson({ error, code, ...extra.body }, { status, headers: extra.headers });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: BASE_HEADERS });
}

export const notFound = (what: string) => apiError(404, "not_found", `${what} not found`);

// `stock.quantity` style paths, so a client can point at the offending field.
export function zodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

export function invalidRequest(error: ZodError | string): Response {
  return typeof error === "string"
    ? apiError(400, "invalid_request", error)
    : apiError(400, "invalid_request", "The request is invalid", {
        body: { issues: zodIssues(error) },
      });
}

// A failed write from the mutation core: its code decides the status, and an
// error without one is input the core refused.
export function mutationError(result: MutationResult & { error: string }): Response {
  switch (result.code) {
    case "not_found":
      return apiError(404, "not_found", result.error);
    case "conflict":
      return apiError(409, "conflict", result.error);
    default:
      return apiError(400, "invalid_request", result.error);
  }
}

/** Narrows a mutation outcome to its failure, for `if (failed(result)) return mutationError(result)`. */
export function failed<T extends MutationResult>(result: T): result is T & { error: string } {
  return typeof result.error === "string";
}
