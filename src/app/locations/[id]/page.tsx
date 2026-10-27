import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowRightLeft, ChevronRight, PackagePlus, Plus } from "lucide-react";
import { db } from "@/db";
import { isUuid } from "@/lib/utils";
import { parts, stock } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { loadLocations, loadLocationTypes } from "@/lib/locations";
import { ancestry, buildTree, describeAll, locationCode, subtreeIds } from "@/lib/location-tree";
import { partCountsByLocation } from "@/lib/location-stats";
import { siblingCycle, siblingLabels } from "@/lib/location-siblings";
import { loadPartOptions } from "@/lib/part-options";
import { firstImages } from "@/lib/part-images";
import { formatStock } from "@/lib/stock";
import { appUrl } from "@/lib/app-url";
import { loadTemplateOptions } from "@/lib/label-templates";
import { getCodeSeparator } from "@/lib/settings";
import { locationVariables, templateForType } from "@/lib/label-template";
import { storedSlots } from "@/lib/label-slots";
import { NO_CONTENTS } from "@/lib/label-contents";
import { loadLabelContents } from "@/lib/label-contents-queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StockDialog } from "@/components/stock-dialog";
import { PartThumb } from "@/components/part-thumb";
import { LocationIcon } from "@/components/location-icon";
import { AddLocationDialog } from "../add-location-dialog";
import { LocationTree } from "../location-tree";
import { LocationActions } from "./location-actions";
import { LocationLabel } from "./location-label";
import { SiblingNav } from "./sibling-nav";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };


export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return {};
  const [all, separator] = await Promise.all([loadLocations(), getCodeSeparator()]);
  const byId = new Map(all.map((l) => [l.id, l]));
  return byId.has(id) ? { title: locationCode(ancestry(byId, id), separator) } : {};
}

export default async function LocationPage({ params }: Params) {
  await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [all, types, counts, partOptions, templateOptions] = await Promise.all([
    loadLocations(),
    loadLocationTypes(),
    partCountsByLocation(),
    loadPartOptions(),
    loadTemplateOptions(),
  ]);
  const byId = new Map(all.map((l) => [l.id, l]));
  const location = byId.get(id);
  if (!location) notFound();

  const details = await db.query.locations.findFirst({
    where: (l, { eq }) => eq(l.id, id),
    columns: { description: true, labelSlots: true },
  });
  const chain = ancestry(byId, id);
  const separator = await getCodeSeparator();
  const code = locationCode(chain, separator);
  const options = describeAll(all, separator);
  const descendants = subtreeIds(all, id);
  // Without the location itself in the list, buildTree treats its children
  // as roots, so the nested tree starts at depth 0.
  const cycle = siblingCycle(all, id);
  const childTree = buildTree(all.filter((l) => l.id !== id && descendants.has(l.id)));

  // The label: this type's template, filled with this location's data.
  const labelTemplateIdOf = new Map(types.map((t) => [t.id, t.labelTemplateId]));
  const label = templateForType(templateOptions, labelTemplateIdOf.get(location.type.id) ?? null);
  const sharedWith = label.builtIn
    ? []
    : types.filter((t) => t.id !== location.type.id && t.labelTemplateId === label.key).map((t) => t.name);
  const insideByType = types.flatMap((t) => {
    const count = all.filter((l) => l.id !== id && descendants.has(l.id) && l.type.id === t.id).length;
    return count > 0 ? [{ typeId: t.id, typeName: t.name, count }] : [];
  });

  const contents = await db
    .select({
      partId: parts.id,
      name: parts.name,
      mpn: parts.mpn,
      icon: parts.icon,
      unit: parts.unit,
      tracking: parts.tracking,
      quantity: stock.quantity,
    })
    .from(stock)
    .innerJoin(parts, eq(parts.id, stock.partId))
    .where(eq(stock.locationId, id))
    .orderBy(asc(parts.name));

  const [thumbs, labelContents] = await Promise.all([
    firstImages(contents.map((c) => c.partId)),
    loadLabelContents([id]),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
          <Link href="/locations" className="hover:text-foreground">
            Locations
          </Link>
          {chain.map((l) => (
            <span key={l.id} className="flex items-center gap-1">
              <ChevronRight className="size-3.5" />
              {l.id === id ? (
                <span className="text-foreground">
                  {l.type.name} {l.label}
                </span>
              ) : (
                <Link href={`/locations/${l.id}`} className="hover:text-foreground">
                  {l.type.name} {l.label}
                </Link>
              )}
            </span>
          ))}
        </nav>
        {cycle && (
          <SiblingNav
            prev={{ id: cycle.prev.id, title: siblingTitle(cycle.prev) }}
            next={{ id: cycle.next.id, title: siblingTitle(cycle.next) }}
            index={cycle.index}
            total={cycle.total}
            typeName={location.type.name}
          />
        )}
      </div>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LocationIcon name={location.type.icon} className="size-7" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {location.type.name} <span className="font-mono">{location.label}</span>
            </h1>
            <p className="text-muted-foreground">
              <span className="font-mono">{code}</span>
              {location.name && <> · {location.name}</>}
            </p>
          </div>
        </div>
        <LocationActions
          location={{
            id,
            label: location.label,
            name: location.name,
            description: details?.description ?? "",
            parentId: location.parentId,
            labelPattern: location.type.labelPattern,
          }}
          locations={options}
          descendants={[...descendants]}
        />
      </div>

      <LocationLabel
        locationId={id}
        vars={locationVariables(chain, {
          url: appUrl(`/locations/${id}`).toString(),
          description: details?.description ?? "",
          separator,
        })}
        slots={storedSlots(details?.labelSlots)}
        contents={labelContents.get(id) ?? NO_CONTENTS}
        type={{ id: location.type.id, name: location.type.name }}
        current={label}
        options={templateOptions}
        sharedWith={sharedWith}
        inside={insideByType}
      />

      {details?.description && (
        <p className="mb-8 whitespace-pre-wrap text-sm">{details.description}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Inside</CardTitle>
            <AddLocationDialog
              parentId={id}
              parentLabel={`${location.type.name} ${location.label}`}
              types={types}
              siblingLabels={siblingLabels(all, id)}
              defaultTypeId={nextTypeId(types, location.type.id)}
              trigger={
                <Button size="sm" variant="outline">
                  <Plus className="size-4" />
                  Add
                </Button>
              }
            />
          </CardHeader>
          <CardContent>
            {childTree.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No locations inside.
              </p>
            ) : (
              <LocationTree tree={childTree} partCounts={Object.fromEntries(counts)} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Parts stored here</CardTitle>
            <StockDialog
              part={null}
              partOptions={partOptions}
              locationId={id}
              locations={options}
              modes={["add"]}
              trigger={
                <Button size="sm" variant="outline">
                  <PackagePlus className="size-4" />
                  Put a part here
                </Button>
              }
            />
          </CardHeader>
          <CardContent>
            {contents.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing stored here.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Part</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contents.map((c) => (
                    <TableRow key={c.partId}>
                      <TableCell>
                        <Link href={`/parts/${c.partId}`} className="flex items-center gap-2 hover:underline">
                          <PartThumb fileId={thumbs.get(c.partId) ?? null} icon={c.icon} className="size-8" />
                          <div className="min-w-0">
                            <div className="truncate font-medium">{c.name}</div>
                            {c.mpn && <div className="truncate text-xs text-muted-foreground">{c.mpn}</div>}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatStock(c.tracking, c.quantity, c.unit)}
                      </TableCell>
                      <TableCell>
                        <StockDialog
                          part={{ id: c.partId, name: c.name, unit: c.unit, tracking: c.tracking }}
                          locationId={id}
                          locations={options}
                          stockByLocation={{ [id]: c.quantity }}
                          initialMode={c.tracking === "none" ? "move" : "remove"}
                          trigger={
                            <Button variant="ghost" size="icon" aria-label="Change stock">
                              <ArrowRightLeft className="size-4" />
                            </Button>
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// The type that usually goes inside this one: the next in the configured
// order (Shelf → Box → Bin), else the same type.
function nextTypeId(types: { id: string }[], currentTypeId: string): string | undefined {
  const index = types.findIndex((t) => t.id === currentTypeId);
  return types[index + 1]?.id ?? types[index]?.id;
}

function siblingTitle(l: { label: string; name: string; type: { name: string } }) {
  return `${l.type.name} ${l.label}${l.name ? ` · ${l.name}` : ""}`;
}
