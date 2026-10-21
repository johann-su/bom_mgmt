"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  guessPartMapping,
  PART_CSV_FIELD_LABELS,
  PART_CSV_FIELDS,
  readPartCsv,
  type PartCsvField,
  type PartCsvMapping,
} from "@/lib/part-csv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { importParts, type PartImportResult, type StockImportMode } from "./actions";

const UNMAPPED = "none";

// Pick a file → adjust the guessed column mapping while a dry run previews
// what would happen → import. The server re-parses the CSV with the mapping;
// the client parse only feeds the header dropdowns.
export function PartImport() {
  const router = useRouter();
  const [csv, setCsv] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<PartCsvMapping>({});
  const [stockMode, setStockMode] = useState<StockImportMode>("add");
  const [preview, setPreview] = useState<PartImportResult | null>(null);
  const [done, setDone] = useState<PartImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  async function pickFile(file: File | undefined) {
    setPreview(null);
    setDone(null);
    if (!file) return setCsv(null);
    const text = await file.text();
    const table = readPartCsv(text);
    if (table.headers.length === 0) {
      toast.error("The file is empty");
      return setCsv(null);
    }
    setCsv(text);
    setHeaders(table.headers);
    setMapping(guessPartMapping(table.headers));
  }

  // Re-run the dry run whenever the input changes; a stale response from an
  // older mapping is dropped.
  useEffect(() => {
    if (csv === null) return;
    let current = true;
    importParts({ csv, mapping, stockMode, dryRun: true }).then((result) => {
      if (current) setPreview(result);
    });
    return () => {
      current = false;
    };
  }, [csv, mapping, stockMode]);

  function setField(field: PartCsvField, value: string) {
    setMapping((prev) => {
      const next = { ...prev };
      delete next[field];
      if (value !== UNMAPPED) {
        const index = Number(value);
        // A column feeds one field: taking it here frees it elsewhere.
        for (const f of PART_CSV_FIELDS) if (next[f] === index) delete next[f];
        next[field] = index;
      }
      return next;
    });
  }

  function runImport() {
    if (csv === null) return;
    startTransition(async () => {
      const result = await importParts({ csv, mapping, stockMode, dryRun: false });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setDone(result);
      router.refresh();
    });
  }

  if (done?.summary) {
    const s = done.summary;
    return (
      <Card>
        <CardContent className="grid gap-3 text-sm">
          <p>
            {s.created} part(s) created, {s.updated} updated
            {s.stock > 0 && `, stock booked on ${s.stock} row(s)`}.
          </p>
          <ErrorList errors={done.errors ?? []} />
          <div className="flex gap-2">
            <Button asChild>
              <Link href="/parts">Go to parts</Link>
            </Button>
            <Button variant="outline" onClick={() => pickFile(undefined)}>
              Import another file
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const s = preview?.summary;
  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">File</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            type="file"
            accept=".csv,text/csv"
            className="text-sm"
            aria-label="CSV file"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
        </CardContent>
      </Card>

      {csv !== null && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Columns</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            {PART_CSV_FIELDS.map((field) => (
              <div key={field} className="grid gap-2">
                <Label>{PART_CSV_FIELD_LABELS[field]}</Label>
                <Select
                  value={mapping[field] === undefined ? UNMAPPED : String(mapping[field])}
                  onValueChange={(v) => setField(field, v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNMAPPED}>— not imported —</SelectItem>
                    {headers.map((h, i) => (
                      <SelectItem key={i} value={String(i)}>
                        {h || `Column ${i + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {mapping.location !== undefined && (
              <div className="grid gap-2 sm:col-span-3">
                <Label>Quantities</Label>
                <Select value={stockMode} onValueChange={(v) => setStockMode(v as StockImportMode)}>
                  <SelectTrigger className="w-full sm:w-96">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">Add to the stock already there (goods received)</SelectItem>
                    <SelectItem value="set">Set the location&apos;s count (stock-take)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}

      {s && preview?.preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Preview — {s.created} new, {s.updated} updated
              {s.stock > 0 && `, ${s.stock} stock row(s)`}
              {s.errors > 0 && `, ${s.errors} skipped`}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ErrorList errors={preview.errors ?? []} />
            {preview.preview.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Line</TableHead>
                    <TableHead>Part</TableHead>
                    <TableHead>MPN</TableHead>
                    <TableHead />
                    <TableHead>Location</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.preview.map((row) => (
                    <TableRow key={row.line}>
                      <TableCell className="text-muted-foreground">{row.line}</TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.mpn}</TableCell>
                      <TableCell>
                        <Badge variant={row.action === "create" ? "default" : "secondary"}>
                          {row.action === "create" ? "new" : "update"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.location}</TableCell>
                      <TableCell className="text-right">{row.quantity ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="flex justify-end">
              <Button onClick={runImport} disabled={pending || s.created + s.updated === 0}>
                {pending ? "Importing…" : "Import"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ErrorList({ errors }: { errors: { line: number; message: string }[] }) {
  if (errors.length === 0) return null;
  return (
    <div className="text-sm">
      <p className="font-medium">Skipped:</p>
      <ul className="list-disc pl-5 text-muted-foreground">
        {errors.slice(0, 50).map((e) => (
          <li key={e.line}>
            Line {e.line}: {e.message}
          </li>
        ))}
        {errors.length > 50 && <li>…and {errors.length - 50} more</li>}
      </ul>
    </div>
  );
}
