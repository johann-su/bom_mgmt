import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { ArrowRightLeft, ClipboardList, Inbox, PackagePlus, Pencil, ShoppingCart } from "lucide-react";
import { db } from "@/db";
import { bomItems, boms, files, parts, stock } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { loadLocationOptions } from "@/lib/locations";
import { recentMovements } from "@/lib/movement-queries";
import { formatQuantity } from "@/lib/format";
import { supplierName } from "@/lib/part-input";
import { formatStock, isLowStock, toPickerValue, totalStock, TRACKING_INFO } from "@/lib/stock";
import { isUuid } from "@/lib/utils";
import { iconUrl, isIconId, loadIcons } from "@/lib/label-icons";
import { isIconAttribute } from "@/lib/part-attributes";
import { Badge } from "@/components/ui/badge";
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
import { Markdown } from "@/components/markdown";
import { MovementList } from "@/components/movement-list";
import { PartThumb } from "@/components/part-thumb";
import { StockDialog } from "@/components/stock-dialog";
import { DeletePartButton } from "./delete-part-button";
import { ForgetLocationButton } from "./forget-location-button";
import { PartFiles } from "./part-files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  if (!isUuid(id)) return {};
  const part = await db.query.parts.findFirst({ where: eq(parts.id, id), columns: { name: true } });
  return part ? { title: part.name } : {};
}

export default async function PartPage({ params }: Params) {
  await requireSession();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const part = await db.query.parts.findFirst({
    where: eq(parts.id, id),
    with: { category: { columns: { name: true } } },
  });
  if (!part) notFound();

  // Picture attributes (icon-1: a catalogue id) show as the icon and its name.
  const iconNames = part.attributes.some((a) => isIconAttribute(a.key))
    ? new Map((await loadIcons()).map((i) => [i.id, i.name]))
    : new Map<string, string>();

  const [stockRows, locations, partFiles, usedIn, movements] = await Promise.all([
    db
      .select({ locationId: stock.locationId, quantity: stock.quantity })
      .from(stock)
      .where(eq(stock.partId, id)),
    loadLocationOptions(),
    db
      .select({ id: files.id, filename: files.filename, kind: files.kind, size: files.size })
      .from(files)
      .where(eq(files.partId, id))
      .orderBy(asc(files.position), asc(files.createdAt)),
    db
      .select({ bomId: boms.id, name: boms.name, quantity: bomItems.quantity })
      .from(bomItems)
      .innerJoin(boms, eq(boms.id, bomItems.bomId))
      .where(eq(bomItems.partId, id))
      .orderBy(asc(boms.name)),
    recentMovements({ partId: id, limit: 30 }),
  ]);

  const byLocation = new Map(locations.map((l) => [l.id, l]));
  const placed = stockRows
    .flatMap((s) => {
      const location = s.locationId ? byLocation.get(s.locationId) : undefined;
      return location ? [{ ...s, locationId: location.id, location }] : [];
    })
    .sort((a, b) => a.location.code.localeCompare(b.location.code, undefined, { numeric: true }));
  // The pile not put away yet; an emptied one is just not shown.
  const unsorted = stockRows.find((s) => s.locationId === null)?.quantity ?? 0;
  const tracking = part.tracking;
  const counted = tracking === "exact";
  const total = totalStock(tracking, stockRows.map((s) => s.quantity));
  const low = isLowStock(total, part.minStock, tracking);
  const stockByLocation = Object.fromEntries(
    stockRows.map((s) => [toPickerValue(s.locationId), s.quantity]),
  );
  // Where the part lives, if that's a single place — the obvious target for
  // the header's stock button.
  const places = [
    ...(unsorted > 0 ? [toPickerValue(null)] : []),
    ...placed.map((s) => s.locationId),
  ];
  const onlyPlace = places.length === 1 ? places[0] : undefined;
  const cover = partFiles.find((f) => f.kind === "image");
  const stockPart = { id, name: part.name, unit: part.unit, tracking };
  const show = (quantity: number) => formatStock(tracking, quantity, part.unit);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <PartThumb fileId={cover?.id ?? null} icon={part.icon} className="size-20 rounded-xl" />
          <div>
            <div className="mb-1 flex flex-wrap gap-1">
              {part.category && <Badge variant="secondary">{part.category.name}</Badge>}
              {low && <Badge variant="destructive">Low stock</Badge>}
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{part.name}</h1>
            {(part.manufacturer || part.mpn) && (
              <p className="text-muted-foreground">
                {part.manufacturer}
                {part.manufacturer && part.mpn && " · "}
                {part.mpn && <span className="font-mono">{part.mpn}</span>}
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {part.orderUrls[0] && (
            // Out of stock or below minimum → the primary action is reordering,
            // from the preferred (first) supplier; the others are listed below.
            <Button variant={low || (counted && total === 0) ? "default" : "outline"} asChild>
              <a
                href={part.orderUrls[0]}
                target="_blank"
                rel="noopener noreferrer"
                title={`Order from ${supplierName(part.orderUrls[0])}`}
              >
                <ShoppingCart className="size-4" />
                Order
              </a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link href={`/parts/${id}/edit`}>
              <Pencil className="size-4" />
              Edit
            </Link>
          </Button>
          <DeletePartButton partId={id} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-6 content-start">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Stock</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {counted ? (
                    <>
                      <span className={low ? "font-medium text-destructive" : undefined}>
                        {formatQuantity(total, part.unit)}
                      </span>{" "}
                      in total
                      {part.minStock !== null && <> · minimum {formatQuantity(part.minStock, part.unit)}</>}
                    </>
                  ) : tracking === "none" ? (
                    "Not tracked — only where it lives"
                  ) : (
                    <>
                      <span className={low ? "font-medium text-destructive" : undefined}>{show(total)}</span>
                      {" · "}tracked by {TRACKING_INFO[tracking].label.toLowerCase()}
                    </>
                  )}
                </p>
              </div>
              <StockDialog
                part={stockPart}
                locations={locations}
                stockByLocation={stockByLocation}
                defaultLocationId={onlyPlace}
                modes={["add"]}
                trigger={
                  <Button size="sm">
                    <PackagePlus className="size-4" />
                    {counted ? "Add stock" : tracking === "none" ? "Store somewhere" : "Set level"}
                  </Button>
                }
              />
            </CardHeader>
            <CardContent>
              {placed.length === 0 && unsorted === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Not stored anywhere yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">{counted ? "Quantity" : tracking === "none" ? "" : "Level"}</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unsorted > 0 && (
                      <TableRow>
                        <TableCell>
                          <span className="flex items-center gap-1.5 font-medium">
                            <Inbox className="size-4 text-muted-foreground" />
                            Unsorted
                          </span>
                          <div className="text-xs text-muted-foreground">Not put away yet</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {show(unsorted)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <StockDialog
                              part={stockPart}
                              locationId={toPickerValue(null)}
                              locations={locations}
                              stockByLocation={stockByLocation}
                              initialMode="move"
                              trigger={
                                <Button variant="ghost" size="icon" aria-label="Put away">
                                  <ArrowRightLeft className="size-4" />
                                </Button>
                              }
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {placed.map((s) => (
                      <TableRow key={s.locationId}>
                        <TableCell>
                          <Link href={`/locations/${s.locationId}`} className="hover:underline">
                            <span className="font-mono font-medium">{s.location.code}</span>
                            {s.location.name && (
                              <span className="text-muted-foreground"> · {s.location.name}</span>
                            )}
                          </Link>
                          <div className="text-xs text-muted-foreground">{s.location.path}</div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {tracking !== "none" && show(s.quantity)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <StockDialog
                              part={stockPart}
                              locationId={s.locationId}
                              locations={locations}
                              stockByLocation={stockByLocation}
                              initialMode={tracking === "none" ? "move" : "remove"}
                              trigger={
                                <Button variant="ghost" size="icon" aria-label="Change stock">
                                  <ArrowRightLeft className="size-4" />
                                </Button>
                              }
                            />
                            {s.quantity === 0 && (
                              <ForgetLocationButton partId={id} locationId={s.locationId} />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Files</CardTitle>
            </CardHeader>
            <CardContent>
              <PartFiles partId={id} files={partFiles} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">History</CardTitle>
            </CardHeader>
            <CardContent>
              <MovementList movements={movements} />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 content-start">
          {(part.description || part.attributes.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                {part.description && <Markdown>{part.description}</Markdown>}
                {part.attributes.length > 0 && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {part.attributes.map((a) => (
                      <div key={a.key} className="contents">
                        <dt className="text-muted-foreground">{a.key}</dt>
                        <dd className="font-medium">
                          {isIconAttribute(a.key) && isIconId(a.value) && iconNames.has(a.value) ? (
                            <span className="flex items-center gap-2" title={a.value}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={iconUrl(a.value)}
                                alt=""
                                className="size-6 rounded-sm bg-white p-0.5 ring-1 ring-border"
                              />
                              {iconNames.get(a.value)}
                            </span>
                          ) : (
                            a.value
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardContent>
            </Card>
          )}

          {part.orderUrls.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Suppliers</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-1.5 text-sm">
                  {part.orderUrls.map((url, index) => (
                    <li key={url} className="flex items-center gap-2">
                      <ShoppingCart className="size-4 shrink-0 text-muted-foreground" />
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={url}
                        className="flex-1 truncate hover:underline"
                      >
                        {supplierName(url)}
                      </a>
                      {index === 0 && part.orderUrls.length > 1 && (
                        <Badge variant="secondary">Preferred</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Used in</CardTitle>
            </CardHeader>
            <CardContent>
              {usedIn.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not part of any BOM.</p>
              ) : (
                <ul className="grid gap-1.5 text-sm">
                  {usedIn.map((b) => (
                    <li key={b.bomId} className="flex items-center gap-2">
                      <ClipboardList className="size-4 text-muted-foreground" />
                      <Link href={`/boms/${b.bomId}`} className="flex-1 hover:underline">
                        {b.name}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">× {b.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {part.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm">{part.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
