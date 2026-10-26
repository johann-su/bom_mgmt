import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { categories } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { loadLocationOptions } from "@/lib/locations";
import { PartForm } from "../part-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New part" };

type SearchParams = Promise<{
  name?: string;
  mpn?: string;
  manufacturer?: string;
  orderUrl?: string;
  qty?: string;
  lookup?: string;
}>;

// Query parameters prefill the form — the scan-label dialog links here for a
// part that doesn't exist yet, with lookup=1 to read the shop page right away.
export default async function NewPartPage({ searchParams }: { searchParams: SearchParams }) {
  await requireSession();
  const { name, mpn, manufacturer, orderUrl, qty, lookup } = await searchParams;
  const prefill = {
    name: name ?? mpn ?? "",
    mpn: mpn ?? "",
    manufacturer: manufacturer ?? "",
    orderUrls: orderUrl ? [orderUrl] : [],
    initialQuantity: qty && /^\d+$/.test(qty) ? Number(qty) : undefined,
  };
  const [cats, locations] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name)),
    loadLocationOptions(),
  ]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-6">New part</h1>
      <PartForm
        prefill={prefill}
        autoLookup={lookup === "1" && prefill.orderUrls.length > 0}
        categories={cats}
        locations={locations}
      />
    </div>
  );
}
