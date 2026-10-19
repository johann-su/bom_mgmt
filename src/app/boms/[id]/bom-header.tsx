"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Pencil, Trash2, Upload } from "lucide-react";
import { isNextRedirectError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteBom, importBomCsv, type ImportSummary } from "../actions";
import { BomForm } from "../bom-form";

type Bom = { id: string; name: string; description: string };

export function BomHeader({ bom }: { bom: Bom }) {
  const [dialog, setDialog] = useState<"edit" | "import" | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{bom.name}</h1>
        {bom.description && (
          <p className="mt-1 max-w-2xl whitespace-pre-wrap text-muted-foreground">{bom.description}</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setDialog("import")}>
          <Upload className="size-4" />
          Import CSV
        </Button>
        <Button variant="outline" asChild>
          <a href={`/api/boms/${bom.id}/csv`} download>
            <Download className="size-4" />
            Export CSV
          </a>
        </Button>
        <Button variant="outline" onClick={() => setDialog("edit")}>
          <Pencil className="size-4" />
          Edit
        </Button>
        <ConfirmButton
          title={`Delete "${bom.name}"?`}
          description="The BOM and its lines are deleted. Parts and stock stay as they are."
          confirmLabel="Delete BOM"
          onConfirm={() =>
            startTransition(async () => {
              try {
                const result = await deleteBom({ id: bom.id });
                if (result?.error) toast.error(result.error);
              } catch (err) {
                if (!isNextRedirectError(err)) toast.error("Something went wrong");
              }
            })
          }
        >
          <Button variant="outline" disabled={pending} aria-label="Delete BOM">
            <Trash2 className="size-4" />
          </Button>
        </ConfirmButton>
      </div>

      <Dialog open={dialog === "edit"} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit BOM</DialogTitle>
          </DialogHeader>
          <BomForm bom={bom} onDone={() => setDialog(null)} />
        </DialogContent>
      </Dialog>

      {dialog === "import" && <ImportDialog bomId={bom.id} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ImportDialog({ bomId, onClose }: { bomId: string; onClose: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    const file = input.current?.files?.[0];
    if (!file) {
      toast.error("Choose a CSV file");
      return;
    }
    startTransition(async () => {
      const result = await importBomCsv({ bomId, csv: await file.text(), createMissing });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSummary(result.summary!);
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import BOM from CSV</DialogTitle>
          <DialogDescription>
            Needs a header row with a part column (Name, Part, Value or MPN); Quantity, Reference,
            Manufacturer and Notes are optional. Rows match existing parts by MPN, else by name.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="grid gap-2 text-sm">
            <p>
              {summary.added} line(s) added, {summary.updated} updated
              {summary.created > 0 && `, ${summary.created} new part(s) created`}.
            </p>
            {summary.unmatched.length > 0 && (
              <div>
                <p className="font-medium">Not imported — no matching part:</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {summary.unmatched.map((u) => (
                    <li key={u.line}>
                      Line {u.line}: {u.name || u.mpn}
                      {u.name && u.mpn && ` (${u.mpn})`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.errors.length > 0 && (
              <div>
                <p className="font-medium">Skipped:</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {summary.errors.map((e) => (
                    <li key={e.line}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            <input ref={input} type="file" accept=".csv,text/csv" className="text-sm" aria-label="CSV file" />
            <div className="flex items-center gap-2">
              <input
                id="create-missing"
                type="checkbox"
                checked={createMissing}
                onChange={(e) => setCreateMissing(e.target.checked)}
                className="size-4 accent-primary"
              />
              <Label htmlFor="create-missing" className="font-normal">
                Create parts that don&apos;t exist yet
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          {summary ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={pending}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
