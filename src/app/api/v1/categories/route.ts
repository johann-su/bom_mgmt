import { apiJson } from "@/lib/api/http";
import { listCategories } from "@/lib/api/queries";
import { apiRoute } from "@/lib/api/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every category by name, with how many parts it has — the ids parts take as
// categoryId.
export const GET = apiRoute("parts:read", async () =>
  apiJson({ data: await listCategories(), nextCursor: null }),
);
