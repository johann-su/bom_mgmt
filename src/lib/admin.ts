import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/schema";
import type { UserRole } from "@/lib/roles";

// First-admin bootstrap. The account with INITIAL_ADMIN_EMAIL becomes admin;
// without that variable the very first account created does, so a fresh
// instance is never left without someone who can manage users.
const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase() || null;

// Role for a user about to be created (BetterAuth's user-create hook).
export async function initialRole(email: string): Promise<UserRole> {
  if (initialAdminEmail) {
    return email.toLowerCase() === initialAdminEmail ? "admin" : "user";
  }
  const existing = await db.query.user.findFirst({ columns: { id: true } });
  return existing ? "user" : "admin";
}

// Lazy half of the bootstrap: while the database has no admin at all (e.g.
// INITIAL_ADMIN_EMAIL was set after that account signed up), promote that
// account on the next settings page load. Inert once any admin exists.
export async function ensureInitialAdmin(): Promise<void> {
  if (!initialAdminEmail) return;
  const admin = await db.query.user.findFirst({
    where: eq(user.role, "admin"),
    columns: { id: true },
  });
  if (admin) return;
  await db
    .update(user)
    .set({ role: "admin", updatedAt: new Date() })
    .where(sql`lower(${user.email}) = ${initialAdminEmail}`);
}
