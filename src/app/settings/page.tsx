import { eq } from "drizzle-orm";
import { db } from "@/db";
import { account } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const PROVIDER_NAMES: Record<string, string> = {
  credential: "Password",
  oidc: process.env.OIDC_PROVIDER_NAME?.trim() || "SSO",
  github: "GitHub",
  google: "Google",
};

export default async function AccountSettingsPage() {
  const session = await requireSession();
  const linked = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, session.user.id));

  return (
    <section>
      <h2 className="text-lg font-semibold mb-3">Account</h2>
      <Card>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Name</div>
            <div className="text-sm font-medium">{session.user.name}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Email</div>
            <div className="text-sm font-medium">{session.user.email}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Role</div>
            <div className="text-sm font-medium capitalize">{session.user.role ?? "user"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Sign-in methods</div>
            <div className="flex flex-wrap gap-1">
              {linked.map((a) => (
                <Badge key={a.providerId} variant="secondary">
                  {PROVIDER_NAMES[a.providerId] ?? a.providerId}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
