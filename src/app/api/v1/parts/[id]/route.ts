import { deletePart, updatePart } from "@/lib/part-mutations";
import { apiJson, failed, invalidRequest, mutationError, noContent, notFound } from "@/lib/api/http";
import { isUuid } from "@/lib/api/params";
import { getPartDetail, getStoredPart } from "@/lib/api/queries";
import { resolveCategory } from "@/lib/api/resolve";
import { absoluteUrl, apiRoute, readBody } from "@/lib/api/route";
import { UpdatePartBody } from "@/lib/api/schemas";
import { serializePartDetail } from "@/lib/api/serialize";
import { updatePartValues } from "@/lib/api/translate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { id: string };

export const GET = apiRoute<Params>("parts:read", async ({ params }) => {
  const part = isUuid(params.id) ? await getPartDetail(params.id) : null;
  return part ? apiJson(serializePartDetail(part, absoluteUrl)) : notFound("Part");
});

// Partial update: only the fields sent change (orderUrls and attributes, when
// sent, replace the whole list). Stock is changed through /stock, not here.
export const PATCH = apiRoute<Params>("parts:write", async ({ request, params }) => {
  if (!isUuid(params.id)) return notFound("Part");
  const patch = await readBody(request, UpdatePartBody);
  const current = await getStoredPart(params.id);
  if (!current) return notFound("Part");

  const category = await resolveCategory(patch);
  if ("error" in category) return invalidRequest(category.error);

  const result = await updatePart(params.id, updatePartValues(current, patch, category.categoryId));
  if (failed(result)) return mutationError(result);

  const part = await getPartDetail(params.id);
  return part ? apiJson(serializePartDetail(part, absoluteUrl)) : notFound("Part");
});

// Deletes the part with its stock, history and files, for good. Refused (409)
// while a BOM still lists it, like in the app.
export const DELETE = apiRoute<Params>("parts:write", async ({ params }) => {
  if (!isUuid(params.id)) return notFound("Part");
  const result = await deletePart(params.id);
  return failed(result) ? mutationError(result) : noContent();
});
