import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { appUrl } from "@/lib/app-url";
import { hasLocationTypes } from "@/lib/locations";
import { SetupWizard } from "./setup-wizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set up" };

// First-run wizard: shown while the database has no location types (the
// dashboard and /locations redirect here), gone for good once it's done.
export default async function SetupPage() {
  await requireSession();
  if (await hasLocationTypes()) redirect("/locations");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-1">Welcome to Bin Vault</h1>
        <p className="text-muted-foreground">
          Add the kinds of storage you use, from the outside in, and how each is labeled.
          Everything can be changed later under Settings.
        </p>
      </div>
      <SetupWizard sampleUrl={appUrl("/locations/sample").toString()} />
    </div>
  );
}
