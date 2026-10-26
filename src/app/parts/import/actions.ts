"use server";

import { getSession } from "@/lib/auth";
import { runPartImport, type PartImportResult, type StockImportMode } from "@/lib/part-import";

export type { PartImportPreviewRow, PartImportResult, StockImportMode } from "@/lib/part-import";

/**
 * Imports parts from a spreadsheet's rows (CSV or .xlsx, parsed in the
 * browser) with a column mapping chosen in the UI; see runPartImport in
 * src/lib/part-import.ts, which the MCP import_parts tool shares.
 */
export async function importParts(input: {
  rows: unknown;
  mapping: unknown;
  stockMode: StockImportMode;
  dryRun: boolean;
}): Promise<PartImportResult> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  return runPartImport(session.user.id, input);
}
