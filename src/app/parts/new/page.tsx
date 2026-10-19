import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { loadLocationOptions } from "@/lib/locations";
import { PartForm } from "../part-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New part" };

export default async function NewPartPage() {
  await requireSession();
  const [cats, locations] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    loadLocationOptions(),
  ]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-6">New part</h1>
      <PartForm categories={cats} locations={locations} />
    </div>
  );
}
