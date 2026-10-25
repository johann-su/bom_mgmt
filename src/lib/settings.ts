import { cache } from "react";
import { db, type Tx } from "@/db";
import { appSettings } from "@/db/schema";
import { CODE_SEPARATOR } from "@/lib/location-tree";

// Instance-wide settings (the single app_settings row). The row only exists
// once something was saved, so every reader falls back to the default.

/** The separator joining labels into codes — once per request. */
export const getCodeSeparator = cache(async (): Promise<string> => {
  const row = await db.query.appSettings.findFirst({ columns: { codeSeparator: true } });
  return row?.codeSeparator ?? CODE_SEPARATOR;
});

/** Saves an already-validated separator, creating the row on first use. */
export async function saveCodeSeparator(separator: string, tx: Tx | typeof db = db) {
  await tx
    .insert(appSettings)
    .values({ id: 1, codeSeparator: separator })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: { codeSeparator: separator, updatedAt: new Date() },
    });
}
