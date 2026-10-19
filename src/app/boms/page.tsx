import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, ListPlus } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { listBoms } from "@/lib/bom-queries";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "BOMs" };

export default async function BomsPage() {
  await requireSession();
  const all = await listBoms();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Bills of materials</h1>
          <p className="text-muted-foreground">
            What your projects are made of, and how many you can build from stock.
          </p>
        </div>
        <Button asChild>
          <Link href="/boms/new">
            <ListPlus className="size-4" />
            New BOM
          </Link>
        </Button>
      </div>

      {all.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <ClipboardList className="size-10 mx-auto mb-3 opacity-50" />
          <p>
            No BOMs yet.{" "}
            <Link href="/boms/new" className="underline">
              Create one
            </Link>{" "}
            or import a CSV from your EDA tool.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {all.map((bom) => (
            <Link key={bom.id} href={`/boms/${bom.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-primary/50">
                <CardHeader>
                  <CardTitle className="text-base">{bom.name}</CardTitle>
                  {bom.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{bom.description}</p>
                  )}
                </CardHeader>
                <CardContent className="mt-auto flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="secondary">
                    {bom.lineCount} line{bom.lineCount === 1 ? "" : "s"}
                  </Badge>
                  {bom.lineCount > 0 &&
                    (bom.buildable > 0 ? (
                      <Badge>Can build {bom.buildable}</Badge>
                    ) : (
                      <Badge variant="destructive">Missing parts</Badge>
                    ))}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(bom.updatedAt)}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
