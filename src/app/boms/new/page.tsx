import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { BomForm } from "../bom-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New BOM" };

export default async function NewBomPage() {
  await requireSession();
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight mb-6">New BOM</h1>
      <BomForm />
    </div>
  );
}
