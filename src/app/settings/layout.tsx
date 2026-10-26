import { mcpEnabled, requireSession } from "@/lib/auth";
import { ensureInitialAdmin } from "@/lib/admin";
import { isAdmin } from "@/lib/roles";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // First-admin bootstrap: runs before the session read so a fresh promotion
  // already shows the Users entry on this very load.
  await ensureInitialAdmin();
  const session = await requireSession();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      <div className="grid gap-8 sm:grid-cols-[12rem_1fr]">
        <aside className="sm:sticky sm:top-20 sm:self-start">
          <SettingsNav showUsers={isAdmin(session.user.role)} showMcp={mcpEnabled} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
