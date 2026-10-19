// Instance-wide user roles. The inventory is a shared workspace — every
// signed-in user can add parts, move stock and edit BOMs — so roles only gate
// user management: admins see Settings → Users and can change roles or delete
// accounts. The first admin comes from INITIAL_ADMIN_EMAIL, or failing that is
// the first account created — see src/lib/admin.ts.

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function parseUserRole(raw: unknown): UserRole | null {
  return USER_ROLES.includes(raw as UserRole) ? (raw as UserRole) : null;
}

// Takes the raw session value: unknown role strings (or a missing value)
// degrade to plain "user" instead of granting anything.
export function isAdmin(role: string | null | undefined): boolean {
  return role === "admin";
}
