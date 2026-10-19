import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/db";
import { locations } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { appUrl } from "@/lib/app-url";
import { isUuid } from "@/lib/utils";
import { loadLocations, loadLocationTypes } from "@/lib/locations";
import { ancestry, buildTree, locationCode, subtreeIds, type LocationNode } from "@/lib/location-tree";
import { loadTemplateOptions } from "@/lib/label-templates";
import { locationVariables, templateForType } from "@/lib/label-template";
import { LabelPrinter, type PrintItem } from "./label-printer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Print labels" };

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

// `/locations/labels?root=<id>` prints labels for a location and everything
// inside it; without `root` the whole tree is offered. The location page's
// buttons preselect: `only=self` just the root, `type=<typeId>` everything of
// that type inside it — each with that type's label template.
export default async function PrintLabelsPage({ searchParams }: Props) {
  await requireSession();
  const { root, only, type } = await searchParams;
  const rootId = typeof root === "string" && isUuid(root) ? root : null;

  const [all, descriptions, templates, types] = await Promise.all([
    loadLocations(),
    db.select({ id: locations.id, description: locations.description }).from(locations),
    loadTemplateOptions(),
    loadLocationTypes(),
  ]);
  const byId = new Map(all.map((l) => [l.id, l]));
  if (rootId && !byId.has(rootId)) notFound();
  const descriptionOf = new Map(descriptions.map((d) => [d.id, d.description]));

  const inScope = rootId ? subtreeIds(all, rootId) : null;
  const items: PrintItem[] = [];
  const walk = (nodes: LocationNode[]) => {
    for (const node of nodes) {
      const chain = ancestry(byId, node.id);
      items.push({
        id: node.id,
        depth: node.depth,
        typeId: node.type.id,
        typeName: node.type.name,
        icon: node.type.icon,
        vars: locationVariables(chain, {
          url: appUrl(`/locations/${node.id}`).toString(),
          description: descriptionOf.get(node.id) ?? "",
        }),
      });
      walk(node.children);
    }
  };
  // Without the root's own parent in the list, buildTree makes the root a
  // top-level node, so depths start at 0 either way.
  walk(buildTree(inScope ? all.filter((l) => inScope.has(l.id)) : all));

  const typeId =
    typeof type === "string" && types.some((t) => t.id === type)
      ? type
      : only === "self" && rootId
        ? byId.get(rootId)!.type.id
        : null;
  const selected = typeId
    ? items.filter((i) => i.typeId === typeId && (only !== "self" || i.id === rootId)).map((i) => i.id)
    : items.map((i) => i.id);
  const initialTemplate = typeId
    ? templateForType(templates, types.find((t) => t.id === typeId)?.labelTemplateId ?? null).key
    : templates[0].key;
  const rootCode = rootId ? locationCode(ancestry(byId, rootId)) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link
        href={rootId ? `/locations/${rootId}` : "/locations"}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {rootCode ? <span className="font-mono">{rootCode}</span> : "Locations"}
      </Link>
      <h1 className="text-3xl font-bold tracking-tight mb-1">Print labels</h1>
      <p className="text-muted-foreground mb-6">
        Pick the locations and a template; download as PDF to print, or as SVG/PNG for other
        tools. Design templates under{" "}
        <Link href="/settings/labels" className="underline underline-offset-2">
          Settings → Label templates
        </Link>
        .
      </p>
      <LabelPrinter
        items={items}
        templates={templates}
        initialSelected={selected}
        initialTemplate={initialTemplate}
        filename={`labels-${(rootCode ?? "all").replace(/[^\w-]+/g, "-")}`}
      />
    </div>
  );
}
