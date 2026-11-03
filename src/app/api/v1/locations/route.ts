import { apiJson } from "@/lib/api/http";
import { listLocations } from "@/lib/api/queries";
import { absoluteUrl, apiRoute } from "@/lib/api/route";
import { serializeLocation } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every storage location, depth-first in the app's display order. Codes
// ("A/1/IV") are what stock bodies may address a location by.
export const GET = apiRoute("parts:read", async () =>
  apiJson({
    data: (await listLocations()).map((row) => serializeLocation(row, absoluteUrl)),
    nextCursor: null,
  }),
);
