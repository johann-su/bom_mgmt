import Link from "next/link";
import { count } from "drizzle-orm";
import { ClipboardList, MapPin, Package, ShoppingCart, TriangleAlert } from "lucide-react";
import { db } from "@/db";
import { boms, locations, parts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { listParts } from "@/lib/part-queries";
import { recentMovements } from "@/lib/movement-queries";
import { formatQuantity } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MovementList } from "@/components/movement-list";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const [[partCount], [locationCount], [bomCount], low, movements] = await Promise.all([
    db.select({ value: count() }).from(parts),
    db.select({ value: count() }).from(locations),
    db.select({ value: count() }).from(boms),
    listParts({ lowStock: true, limit: 20 }),
    recentMovements({ limit: 15 }),
  ]);

  const stats = [
    { label: "Parts", value: partCount.value, icon: Package, href: "/parts" },
    { label: "Locations", value: locationCount.value, icon: MapPin, href: "/locations" },
    { label: "BOMs", value: bomCount.value, icon: ClipboardList, href: "/boms" },
    { label: "Low stock", value: low.length, icon: TriangleAlert, href: "/parts?low=1" },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-1">
          Hi {session.user.name.split(" ")[0]}
        </h1>
        <p className="text-muted-foreground">Here&apos;s what&apos;s in the bins.</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="group">
            <Card className="transition-colors group-hover:border-primary/50">
              <CardContent className="flex items-center gap-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <s.icon className="size-5" />
                </div>
                <div>
                  <div className="text-2xl font-semibold tabular-nums">{s.value}</div>
                  <div className="text-sm text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card className="content-start">
          <CardHeader>
            <CardTitle className="text-base">Running low</CardTitle>
          </CardHeader>
          <CardContent>
            {low.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing below its minimum. Set a minimum stock on a part to track it here.
              </p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {low.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <Link href={`/parts/${p.id}`} className="truncate hover:underline">
                      {p.name}
                    </Link>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums text-destructive">
                        {formatQuantity(p.total, p.unit)}
                        <span className="text-muted-foreground"> / {p.minStock}</span>
                      </span>
                      {p.orderUrl && (
                        <a
                          href={p.orderUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Order ${p.name}`}
                          title="Order"
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <ShoppingCart className="size-4" />
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent activity</CardTitle>
            <Link href="/activity" className="text-sm text-muted-foreground hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            <MovementList movements={movements} showPart />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
