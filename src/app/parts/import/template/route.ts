import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { PART_CSV_TEMPLATE } from "@/lib/part-csv";
import { buildXlsx } from "@/lib/xlsx";

export const runtime = "nodejs";

// A spreadsheet with the importer's columns and two example rows, to fill in
// and upload to /parts/import.
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const xlsx = buildXlsx(
    [
      PART_CSV_TEMPLATE.map((c) => c.header),
      PART_CSV_TEMPLATE.map((c) => c.examples[0]),
      PART_CSV_TEMPLATE.map((c) => c.examples[1]),
    ],
    { sheetName: "Parts", widths: PART_CSV_TEMPLATE.map((c) => (c.field === "description" ? 32 : 16)) },
  );
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="parts-import-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
