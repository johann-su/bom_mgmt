import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { boms } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { loadBomLines } from "@/lib/bom-queries";
import { loadPartOptions } from "@/lib/part-options";
import { recentMovements } from "@/lib/movement-queries";
import { isUuid } from "@/lib/utils";
import { BomHeader } from "./bom-header";
import { BomEditor } from "./bom-editor";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return {};
  const bom = await db.query.boms.findFirst({ where: eq(boms.id, id), columns: { name: true } });
  return bom ? { title: bom.name } : {};
}

export default async function BomPage({ params }: Params) {
  await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const bom = await db.query.boms.findFirst({ where: eq(boms.id, id) });
  if (!bom) notFound();

  const [lines, partOptions, builds] = await Promise.all([
    loadBomLines(id),
    loadPartOptions(),
    recentMovements({ bomId: id, limit: 200 }),
  ]);

  // One entry per build run: a build's movements are written in one
  // transaction, so they share its timestamp (now() is the transaction start).
  const buildRuns = new Map<string, { at: Date; note: string; user: string | null; lines: number }>();
  for (const m of builds) {
    const key = `${m.createdAt.getTime()}|${m.note}`;
    const run = buildRuns.get(key);
    if (run) run.lines += 1;
    else buildRuns.set(key, { at: m.createdAt, note: m.note, user: m.userName, lines: 1 });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <BomHeader bom={{ id, name: bom.name, description: bom.description }} />
      <BomEditor
        bomId={id}
        lines={lines}
        partOptions={partOptions.filter((p) => !lines.some((l) => l.partId === p.value))}
        builds={[...buildRuns.values()].slice(0, 10)}
      />
    </div>
  );
}
