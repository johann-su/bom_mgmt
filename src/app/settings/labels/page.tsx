import Link from "next/link";
import { Pencil } from "lucide-react";
import { requireSession } from "@/lib/auth";
import { loadLabelTemplates } from "@/lib/label-templates";
import { loadLocationTypes } from "@/lib/locations";
import { DEFAULT_TEMPLATES, SAMPLE_VARIABLES, type LabelTemplate } from "@/lib/label-template";
import { renderLabelSvg } from "@/lib/label-render";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LabelPreview } from "@/components/label-preview";
import { DeleteTemplateButton } from "./delete-template-button";

export const dynamic = "force-dynamic";

function describe(template: LabelTemplate) {
  const size = `${template.width} × ${template.height} mm`;
  const { layout } = template;
  return layout.kind === "single"
    ? `${size} · one per page`
    : `${size} · ${layout.columns} × ${layout.rows} on ${layout.pageWidth} × ${layout.pageHeight} mm`;
}

export default async function LabelTemplatesPage() {
  await requireSession();
  const [templates, types] = await Promise.all([loadLabelTemplates(), loadLocationTypes()]);
  const usedBy = (id: string) => types.filter((t) => t.labelTemplateId === id).map((t) => t.name);

  return (
    <section className="grid gap-8">
      <div>
        <h2 className="text-lg font-semibold mb-1">Label templates</h2>
        <p className="text-sm text-muted-foreground mb-4">
          How the labels on shelves, boxes and bins are printed: a scannable code, the location
          code and any text. Each location type uses one template — pick it and edit it right on
          any location&apos;s page.
        </p>
        {templates.length === 0 ? (
          <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
            No templates yet — start from one below. The built-ins can be printed as they are.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((t) => (
              <Card key={t.id} className="gap-3 p-4">
                <LabelPreview
                  svg={renderLabelSvg(t.template, SAMPLE_VARIABLES).body}
                  className="mx-auto max-h-40 w-full max-w-xs"
                />
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{describe(t.template)}</div>
                    {usedBy(t.id).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {usedBy(t.id).map((name) => (
                          <Badge key={name} variant="secondary">
                            {name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button asChild variant="ghost" size="icon" aria-label="Edit template">
                    <Link href={`/settings/labels/${t.id}`}>
                      <Pencil className="size-4" />
                    </Link>
                  </Button>
                  <DeleteTemplateButton id={t.id} />
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="font-medium mb-3">New template from…</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {DEFAULT_TEMPLATES.map((t, index) => (
            <Link
              key={t.name}
              href={`/settings/labels/new?from=${index}`}
              className="group rounded-xl border p-3 transition-colors hover:bg-accent/50"
            >
              <LabelPreview svg={renderLabelSvg(t.template, SAMPLE_VARIABLES).body} />
              <div className="mt-2 text-sm font-medium group-hover:underline">{t.name}</div>
              <div className="text-xs text-muted-foreground">{describe(t.template)}</div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
