"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { isAdmin, parseUserRole } from "@/lib/roles";

// Changes another user's role (Settings → Users). Admin-only.
export async function setUserRole(input: {
  userId: string;
  role: string;
}): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  if (!isAdmin(session.user.role)) return { error: "Only admins can change roles" };

  const role = parseUserRole(input.role);
  if (!role) return { error: "Unknown role" };

  // Admins can't touch their own role, so there is always someone left who
  // can undo a mistake.
  if (input.userId === session.user.id) return { error: "You can't change your own role" };

  const updated = await db
    .update(user)
    .set({ role, updatedAt: new Date() })
    .where(eq(user.id, input.userId))
    .returning({ id: user.id });
  if (updated.length === 0) return { error: "User not found" };

  revalidatePath("/settings/users");
  return {};
}

// Deletes an account. Sessions and linked logins cascade; the parts, BOMs and
// stock history they created stay (their creator reference is nulled) —
// inventory is shared, not owned.
export async function deleteUser(input: { userId: string }): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: "You must be signed in" };
  if (!isAdmin(session.user.role)) return { error: "Only admins can delete users" };
  if (input.userId === session.user.id) return { error: "You can't delete your own account" };

  const deleted = await db
    .delete(user)
    .where(eq(user.id, input.userId))
    .returning({ id: user.id });
  if (deleted.length === 0) return { error: "User not found" };

  revalidatePath("/settings/users");
  return {};
}
