"use server";

import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { COLLAPSED_COOKIE, parseCollapsed, serializeCollapsed } from "@/lib/parts-list-view";

// Collapses or expands category sections of the parts list. The choice is a
// per-browser view preference, so it's a cookie rather than a DB row; setting
// it re-renders the page with those sections folded.
export async function setCategoriesCollapsed(ids: string[], collapsed: boolean): Promise<void> {
  if (!(await getSession())) return;
  const store = await cookies();
  const current = parseCollapsed(store.get(COLLAPSED_COOKIE)?.value);
  for (const id of ids) {
    if (collapsed) current.add(id);
    else current.delete(id);
  }
  store.set(COLLAPSED_COOKIE, serializeCollapsed(current), {
    path: "/parts",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: true,
  });
}
