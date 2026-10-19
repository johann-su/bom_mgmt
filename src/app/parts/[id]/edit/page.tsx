import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, parts } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/utils";
import { PartForm } from "../../part-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit part" };

export default async function EditPartPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const [part, cats] = await Promise.all([
    db.query.parts.findFirst({ where: eq(parts.id, id) }),
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
  ]);
  if (!part) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Edit {part.name}</h1>
      <PartForm part={part} categories={cats} locations={[]} />
    </div>
  );
}
