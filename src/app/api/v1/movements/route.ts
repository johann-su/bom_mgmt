import { apiJson, invalidRequest } from "@/lib/api/http";
import { parseMovementListQuery } from "@/lib/api/params";
import { listMovements } from "@/lib/api/queries";
import { apiRoute } from "@/lib/api/route";
import { serializeMovement } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The append-only stock log, newest first by default — every add, remove,
// count, move, level change and build, for one part, one BOM's builds, or
// everything. Polling it (sort=created_asc&since=…) is how an integration
// notices stock changes: they don't move a part's updatedAt.
export const GET = apiRoute("parts:read", async ({ request }) => {
  const query = parseMovementListQuery(request.nextUrl.searchParams);
  if ("error" in query) return invalidRequest(query.error);
  const { rows, nextCursor } = await listMovements(query);
  return apiJson({ data: rows.map(serializeMovement), nextCursor });
});
