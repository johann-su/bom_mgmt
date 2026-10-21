import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { PartImport } from "./part-import";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Import parts" };

export default async function ImportPartsPage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-1">Import parts</h1>
      <p className="text-muted-foreground mb-6">
        From a spreadsheet or a DigiKey, Mouser or LCSC order export. Rows match existing parts by
        MPN (else by name) and update them; the rest become new parts. Empty cells never overwrite
        what&apos;s already there.
      </p>
      <PartImport />
    </div>
  );
}
