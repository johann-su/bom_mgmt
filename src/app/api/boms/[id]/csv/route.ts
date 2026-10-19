import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boms } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { loadBomLines } from "@/lib/bom-queries";
import { BOM_CSV_HEADER, toCsv } from "@/lib/bom-csv";
import { isUuid } from "@/lib/utils";

export const runtime = "nodejs";

// Downloads a BOM as CSV in the same column layout the importer reads, so an
// export can be edited in a spreadsheet and imported back.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bom = await db.query.boms.findFirst({ where: eq(boms.id, id), columns: { name: true } });
  if (!bom) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const lines = await loadBomLines(id);
  const csv = toCsv([
    BOM_CSV_HEADER,
    ...lines.map((l) => [l.name, l.mpn, l.manufacturer, l.perUnit, l.reference, l.notes]),
  ]);
  const filename = `${bom.name.replace(/[^\w.-]+/g, "_") || "bom"}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
