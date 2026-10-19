import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { isUuid } from "@/lib/utils";
import { loadLabelTemplates } from "@/lib/label-templates";
import { DEFAULT_TEMPLATES } from "@/lib/label-template";
import { LabelDesigner } from "@/components/label-designer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Label designer" };

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

// `/settings/labels/new?from=<built-in index>` starts a new template from a
// built-in; `/settings/labels/<uuid>` edits a saved one.
export default async function LabelDesignerPage({ params, searchParams }: Props) {
  await requireSession();
  const { id } = await params;
  const { from } = await searchParams;

  let initial;
  if (id === "new") {
    const preset = DEFAULT_TEMPLATES[Number(from)] ?? DEFAULT_TEMPLATES[0];
    initial = { id: null, name: `${preset.name} (copy)`, template: preset.template };
  } else {
    if (!isUuid(id)) notFound();
    const saved = (await loadLabelTemplates()).find((t) => t.id === id);
    if (!saved) notFound();
    initial = saved;
  }

  return (
    <section>
      <Link
        href="/settings/labels"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Label templates
      </Link>
      <LabelDesigner initial={initial} />
    </section>
  );
}
