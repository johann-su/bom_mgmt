import { Download } from "lucide-react";
import { toCsv } from "@/lib/csv";
import { PART_CSV_ATTRIBUTE_EXAMPLE, PART_CSV_TEMPLATE } from "@/lib/part-csv";
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

// How to build an import file by hand: the columns the importer recognizes
// and a template to start from.
export function CsvFormat() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">File format</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="outline" size="sm">
            <a href="/parts/import/template" download>
              <Download />
              Download template (.xlsx)
            </a>
          </Button>
          <span className="text-muted-foreground">
            Fill it in, delete the example rows and upload it as is — .xlsx and CSV both work.
          </span>
        </div>
        <details className="group">
          <summary className="cursor-pointer font-medium">How the file must look</summary>
          <div className="mt-3 grid gap-3">
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>
                The first row holds the column names; every further row is one part (or one part at
                one location). Column order doesn&apos;t matter and unknown columns are ignored.
              </li>
              <li>
                Excel workbooks (<code>.xlsx</code>) are read from their first sheet; formulas
                import their current value.
              </li>
              <li>
                In a CSV, columns are separated by <code>,</code> or <code>;</code> — both work, as
                saved by Excel, Numbers or LibreOffice. Save as UTF-8 so umlauts and µ survive.
              </li>
              <li>
                Only <strong>Name</strong> or <strong>MPN</strong> is required. Empty cells never
                overwrite existing data, so a file with just MPN and Quantity is fine.
              </li>
              <li>
                Attributes (Thread, Package, Resistance…) are columns too: name them{" "}
                <code>Attr: Thread</code> to have them picked up automatically, or tick any other
                column after picking the file. Imported attributes are merged into a part&apos;s
                existing ones.
              </li>
              <li>
                To stock one part in several bins, repeat it on several rows with different
                locations.
              </li>
              <li>
                Other common spellings (e.g. &quot;Qty&quot;, &quot;Manufacturer Part
                Number&quot;) are recognized too, and you can reassign columns after picking the
                file.
              </li>
            </ul>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Column</TableHead>
                  <TableHead>Content</TableHead>
                  <TableHead className="hidden sm:table-cell">Example</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PART_CSV_TEMPLATE.map((c) => (
                  <TableRow key={c.field}>
                    <TableCell className="font-mono text-xs">{c.header}</TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{c.help}</TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">{c.examples[0]}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-mono text-xs">{PART_CSV_ATTRIBUTE_EXAMPLE.header}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">
                    {PART_CSV_ATTRIBUTE_EXAMPLE.help}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {PART_CSV_ATTRIBUTE_EXAMPLE.examples[0]}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
              {toCsv([
                [...PART_CSV_TEMPLATE.map((c) => c.header), PART_CSV_ATTRIBUTE_EXAMPLE.header],
                ...[0, 1].map((i) => [
                  ...PART_CSV_TEMPLATE.map((c) => c.examples[i]),
                  PART_CSV_ATTRIBUTE_EXAMPLE.examples[i],
                ]),
              ]).trimEnd()}
            </pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
