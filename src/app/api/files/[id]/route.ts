import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { isUuid } from "@/lib/utils";
import { files } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { serveFile } from "@/lib/serve-file";

export const runtime = "nodejs";


// Serves a part's image or document to signed-in users (see serveFile for
// content types and byte ranges).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const file = await db.query.files.findFirst({ where: eq(files.id, id) });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Ids are immutable (a replaced file gets a new id); private because the
  // response is cookie-authenticated.
  return serveFile(req, file, { cacheControl: "private, max-age=86400" });
}
