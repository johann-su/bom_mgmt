import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { recentMovements } from "@/lib/movement-queries";
import { Card, CardContent } from "@/components/ui/card";
import { MovementList } from "@/components/movement-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage() {
  await requireSession();
  const movements = await recentMovements({ limit: 300 });
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-1">Activity</h1>
      <p className="text-muted-foreground mb-6">Every stock change, newest first.</p>
      <Card>
        <CardContent>
          <MovementList movements={movements} showPart />
        </CardContent>
      </Card>
    </div>
  );
}
