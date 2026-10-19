"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Hammer, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import type { BomLineRow } from "@/lib/bom-queries";
import { buildableUnits, requirements } from "@/lib/stock";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Combobox, type ComboboxOption } from "@/components/combobox";
import { ConfirmButton } from "@/components/confirm-button";
import { addBomItem, buildBom, removeBomItem, updateBomItem } from "../actions";

type BuildRun = { at: Date; note: string; user: string | null; lines: number };

export function BomEditor({
  bomId,
  lines,
  partOptions,
  builds,
}: {
  bomId: string;
  lines: BomLineRow[];
  // Parts not yet in this BOM.
  partOptions: ComboboxOption[];
  builds: BuildRun[];
}) {
  const router = useRouter();
  const [units, setUnits] = useState("1");
  const [editing, setEditing] = useState<BomLineRow | null>(null);
  const [building, setBuilding] = useState(false);
  const [pending, startTransition] = useTransition();

  const plannedUnits = Math.max(1, Math.floor(Number(units)) || 1);
  const rows = requirements(lines, plannedUnits).map((r, i) => ({ ...lines[i], ...r }));
  const short = rows.filter((r) => r.shortfall > 0);
  const buildable = buildableUnits(lines);

  function run(action: () => Promise<{ error?: string }>, success?: string, after?: () => void) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (success) toast.success(success);
      after?.();
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-4">
          <div>
            <CardTitle className="text-base">Lines</CardTitle>
            <p className="text-sm text-muted-foreground">
              {lines.length === 0
                ? "Add parts below or import a CSV."
                : buildable > 0
                  ? `Current stock covers ${buildable} unit${buildable === 1 ? "" : "s"}.`
                  : "Current stock doesn't cover a single unit."}
            </p>
          </div>
          <div className="flex items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="units" className="text-xs">
                Plan for units
              </Label>
              <Input
                id="units"
                type="number"
                min={1}
                step={1}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="w-24"
              />
            </div>
            <Button disabled={lines.length === 0 || short.length > 0} onClick={() => setBuilding(true)}>
              <Hammer className="size-4" />
              Build {plannedUnits}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {lines.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Part</TableHead>
                  <TableHead className="hidden md:table-cell">Reference</TableHead>
                  <TableHead className="text-right">Per unit</TableHead>
                  <TableHead className="text-right">Needed</TableHead>
                  <TableHead className="text-right">In stock</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link href={`/parts/${row.partId}`} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                      {row.mpn && <div className="font-mono text-xs text-muted-foreground">{row.mpn}</div>}
                      {row.notes && <div className="text-xs text-muted-foreground">{row.notes}</div>}
                    </TableCell>
                    <TableCell className="hidden max-w-48 truncate md:table-cell text-muted-foreground">
                      {row.reference}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.perUnit}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.required}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="flex items-center justify-end gap-1.5">
                        {row.shortfall > 0 ? (
                          <TriangleAlert className="size-4 text-destructive" />
                        ) : (
                          <CheckCircle2 className="size-4 text-primary" />
                        )}
                        <span className={cn(row.shortfall > 0 && "text-destructive font-medium")}>
                          {formatQuantity(row.inStock, row.unit)}
                        </span>
                      </div>
                      {row.shortfall > 0 && (
                        <div className="text-xs text-destructive">short {row.shortfall}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button variant="ghost" size="icon" aria-label="Edit line" onClick={() => setEditing(row)}>
                          <Pencil className="size-4" />
                        </Button>
                        <ConfirmButton
                          title={`Remove ${row.name} from this BOM?`}
                          confirmLabel="Remove"
                          onConfirm={() => run(() => removeBomItem({ id: row.id }), "Line removed")}
                        >
                          <Button variant="ghost" size="icon" aria-label="Remove line">
                            <Trash2 className="size-4" />
                          </Button>
                        </ConfirmButton>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <AddLineForm bomId={bomId} partOptions={partOptions} />
        </CardContent>
      </Card>

      {short.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shopping list for {plannedUnits} unit{plannedUnits === 1 ? "" : "s"}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1 text-sm">
              {short.map((row) => (
                <li key={row.id} className="flex justify-between gap-4">
                  <span>
                    {row.name}
                    {row.mpn && <span className="font-mono text-muted-foreground"> · {row.mpn}</span>}
                  </span>
                  <span className="tabular-nums font-medium">{formatQuantity(row.shortfall, row.unit)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {builds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent builds</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {builds.map((b) => (
                <li key={`${b.at.getTime()}${b.note}`} className="flex justify-between gap-4 py-2">
                  <span>
                    {b.note}{" "}
                    <Badge variant="secondary">
                      {b.lines} bin{b.lines === 1 ? "" : "s"} drawn from
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateTime(b.at)}
                    {b.user && ` · ${b.user}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {editing && (
        <EditLineDialog
          key={editing.id}
          line={editing}
          onClose={() => setEditing(null)}
          onSave={(values) =>
            run(() => updateBomItem({ id: editing.id, ...values }), "Line updated", () => setEditing(null))
          }
          pending={pending}
        />
      )}

      <Dialog open={building} onOpenChange={setBuilding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Build {plannedUnits} unit{plannedUnits === 1 ? "" : "s"}?
            </DialogTitle>
            <DialogDescription>
              This takes {rows.length} part{rows.length === 1 ? "" : "s"} out of stock, drawing from the
              emptiest bins first, and logs every draw.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid max-h-64 gap-1 overflow-y-auto text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex justify-between gap-4">
                <span className="truncate">{r.name}</span>
                <span className="tabular-nums">−{formatQuantity(r.required, r.unit)}</span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBuilding(false)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  () => buildBom({ bomId, units: plannedUnits }),
                  `Built ${plannedUnits} unit${plannedUnits === 1 ? "" : "s"}`,
                  () => setBuilding(false),
                )
              }
            >
              <Hammer className="size-4" />
              {pending ? "Building…" : "Build"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddLineForm({ bomId, partOptions }: { bomId: string; partOptions: ComboboxOption[] }) {
  const router = useRouter();
  const [partId, setPartId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [reference, setReference] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="mt-4 grid gap-2 border-t pt-4 sm:grid-cols-[1fr_6rem_12rem_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        if (!partId) return;
        startTransition(async () => {
          const result = await addBomItem({ bomId, partId, quantity, reference });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          setPartId(null);
          setQuantity("1");
          setReference("");
          router.refresh();
        });
      }}
    >
      <Combobox
        options={partOptions}
        value={partId}
        onChange={setPartId}
        placeholder="Add a part…"
        searchPlaceholder="Search by name or MPN…"
        emptyText="No part matches — create it under Parts first."
      />
      <Input
        type="number"
        min={1}
        step={1}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        aria-label="Quantity per unit"
        required
      />
      <Input
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="Reference (R1, R2…)"
        aria-label="Reference"
      />
      <Button type="submit" variant="outline" disabled={pending || !partId}>
        <Plus className="size-4" />
        Add
      </Button>
    </form>
  );
}

function EditLineDialog({
  line,
  onClose,
  onSave,
  pending,
}: {
  line: BomLineRow;
  onClose: () => void;
  onSave: (values: { quantity: string; reference: string; notes: string }) => void;
  pending: boolean;
}) {
  const [quantity, setQuantity] = useState(String(line.perUnit));
  const [reference, setReference] = useState(line.reference);
  const [notes, setNotes] = useState(line.notes);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ quantity, reference, notes });
          }}
        >
          <DialogHeader>
            <DialogTitle>{line.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="line-qty">Per unit</Label>
              <Input
                id="line-qty"
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="line-ref">Reference</Label>
              <Input id="line-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="line-notes">Notes</Label>
            <Input id="line-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
