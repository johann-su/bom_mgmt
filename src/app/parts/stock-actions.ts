"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { stock } from "@/db/schema";
import { getSession } from "@/lib/auth";
import * as mutations from "@/lib/part-mutations";

type Result = { error?: string };

// Stock changes live in src/lib/part-mutations.ts (shared with the MCP
// tools); these actions add the session check.

export async function changeStock(input: Parameters<typeof mutations.changeStock>[1]): Promise<Result> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  return mutations.changeStock(session.user.id, input);
}

export async function moveStock(input: Parameters<typeof mutations.moveStock>[1]): Promise<Result> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  return mutations.moveStock(session.user.id, input);
}

// Forgets an empty location as a home of the part. Only rows at zero — stock
// has to be removed or moved first, so it's always accounted for.
export async function forgetStockLocation(input: {
  partId: string;
  locationId: string;
}): Promise<Result> {
  if (!(await getSession())) return { error: "You must be signed in" };
  const deleted = await db
    .delete(stock)
    .where(
      and(
        eq(stock.partId, input.partId),
        eq(stock.locationId, input.locationId),
        eq(stock.quantity, 0),
      ),
    )
    .returning({ id: stock.id });
  if (deleted.length === 0) return { error: "Only empty locations can be removed" };
  mutations.revalidateInventory(input.partId);
  return {};
}
