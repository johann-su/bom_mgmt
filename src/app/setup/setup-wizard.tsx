"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { PATTERN_PRESETS, describePattern, nextLabels, parsePattern } from "@/lib/label-pattern";
import { LOCATION_ICONS } from "@/lib/location-icons";
import { CODE_SEPARATOR, MAX_SEPARATOR_LENGTH, SEPARATOR_PRESETS } from "@/lib/location-tree";
import { DEFAULT_TEMPLATES } from "@/lib/label-template";
import { renderLabelSvg } from "@/lib/label-render";
import {
  EXAMPLE_STRUCTURE,
  MAX_LEVELS,
  MAX_PER_PARENT,
  levelTotals,
  prepareSetup,
  sampleVariables,
  type SetupLevel,
} from "@/lib/setup-plan";
import { cn } from "@/lib/utils";
import { LabelPreview } from "@/components/label-preview";
import { LocationIcon } from "@/components/location-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { completeSetup } from "./actions";

// A level plus a stable React key, so reordering keeps inputs' focus/state.
type DraftLevel = SetupLevel & { key: number };

const STEPS = ["Locations", "Labels"] as const;
const BLANK: SetupLevel = { name: "", icon: "box", labelPattern: "{N}", template: 0, count: 0 };

function patternPreview(pattern: string, count = 5) {
  const parsed = parsePattern(pattern);
  if ("error" in parsed) return parsed;
  return { labels: nextLabels(parsed, [], count), description: describePattern(parsed) };
}

export function SetupWizard({ sampleUrl }: { sampleUrl: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // Keys start at 0 on both server and client so ids rendered from them
  // hydrate cleanly; later levels draw from the counter.
  const nextKey = useRef(1);
  const [levels, setLevels] = useState<DraftLevel[]>([{ ...BLANK, key: 0 }]);
  const [separator, setSeparator] = useState(CODE_SEPARATOR);
  const [attempted, setAttempted] = useState(false);
  const [pending, startTransition] = useTransition();

  const validation = useMemo(() => prepareSetup(levels, separator), [levels, separator]);
  const error = "error" in validation ? validation.error : null;
  // Don't greet a blank form with "a name is required".
  const showError = error && (attempted || levels.some((l) => l.name.trim()));
  const totals = levelTotals(levels);
  const total = totals.reduce((sum, n) => sum + n, 0);

  const withKeys = (added: SetupLevel[]): DraftLevel[] =>
    added.map((l) => ({ ...l, key: nextKey.current++ }));

  function update(index: number, patch: Partial<SetupLevel>) {
    setLevels((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function move(index: number, direction: -1 | 1) {
    setLevels((prev) => {
      const next = [...prev];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  }

  function next() {
    setAttempted(true);
    if (!error) setStep(1);
  }

  function finish() {
    startTransition(async () => {
      // validateSetup rebuilds each level, so the React keys are dropped there.
      const result = await completeSetup({ levels, separator });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(total > 0 ? `Created ${total} locations` : "Location types created");
      router.push("/locations");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-6">
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {STEPS.map((name, i) => (
          <li key={name} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-border" aria-hidden />}
            <button
              type="button"
              disabled={i > 0 && error !== null}
              onClick={() => setStep(i)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1 transition-colors disabled:opacity-50",
                i === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
              aria-current={i === step ? "step" : undefined}
            >
              <span className="tabular-nums">{i < step ? <Check className="size-3.5" /> : i + 1}</span>
              {name}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="grid gap-4">
          <details className="group rounded-xl border bg-muted/30 p-4 text-sm">
            <summary className="flex cursor-pointer select-none list-none items-center gap-2 font-medium">
              <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
              How does this work? See an example structure
            </summary>
            <div className="mt-3 grid gap-3 text-muted-foreground">
              <p>
                Each level is a kind of storage that sits inside the one above it. Its label
                pattern names the locations of that kind, and a location&apos;s code joins the
                labels from the outside in — bin IV in box 1 on shelf A is{" "}
                <code className="font-mono text-foreground">A/1/IV</code>.
              </p>
              <ul className="grid gap-1.5 rounded-lg border bg-background p-3">
                {EXAMPLE_STRUCTURE.map((level, depth) => {
                  const shown = patternPreview(level.labelPattern, 3);
                  return (
                    <li
                      key={level.name}
                      className="flex items-center gap-2"
                      style={{ paddingLeft: `${depth * 1.25}rem` }}
                    >
                      <LocationIcon name={level.icon} className="size-4" />
                      <span className="font-medium text-foreground">{level.name}</span>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {level.labelPattern}
                      </code>
                      {"labels" in shown && <span>{shown.labels.join(", ")}, …</span>}
                      <span className="ml-auto text-xs">
                        {depth === 0 ? `${level.count}` : `${level.count} in each`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p>
                The count creates that many in every parent (2 shelves × 4 boxes × 6 bins); leave
                it at 0 to add locations later. Types don&apos;t restrict nesting, so a shelf can
                still hold a loose drawer.
              </p>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLevels(withKeys(EXAMPLE_STRUCTURE))}
                >
                  Use this example
                </Button>
              </div>
            </div>
          </details>

          {levels.map((level, index) => {
            const shown = patternPreview(level.labelPattern);
            const parent = index > 0 ? levels[index - 1] : null;
            return (
              <Card
                key={level.key}
                className="gap-3 p-4"
                style={{ marginLeft: `${index * 1.25}rem` }}
              >
                <div className="flex flex-wrap items-end gap-3">
                  <div className="grid gap-2">
                    <Label>Icon</Label>
                    <Select value={level.icon} onValueChange={(icon) => update(index, { icon })}>
                      <SelectTrigger className="w-32" aria-label="Icon">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(LOCATION_ICONS).map(([key, Icon]) => (
                          <SelectItem key={key} value={key}>
                            <Icon className="size-4" />
                            <span className="capitalize">{key}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid min-w-36 flex-1 gap-2">
                    <Label htmlFor={`level-name-${level.key}`}>Name</Label>
                    <Input
                      id={`level-name-${level.key}`}
                      value={level.name}
                      onChange={(e) => update(index, { name: e.target.value })}
                      placeholder="Shelf, Box, Drawer…"
                    />
                  </div>
                  <div className="grid min-w-40 flex-1 gap-2">
                    <Label htmlFor={`level-pattern-${level.key}`}>Label pattern</Label>
                    <div className="flex gap-1">
                      <Input
                        id={`level-pattern-${level.key}`}
                        value={level.labelPattern}
                        onChange={(e) => update(index, { labelPattern: e.target.value })}
                        className="font-mono"
                        spellCheck={false}
                        aria-invalid={"error" in shown}
                      />
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="icon" aria-label="Pattern presets">
                            <ChevronDown className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {PATTERN_PRESETS.map((preset) => (
                            <DropdownMenuItem
                              key={preset.pattern}
                              onSelect={() => update(index, { labelPattern: preset.pattern })}
                            >
                              {preset.label}
                              <code className="ml-auto font-mono text-xs text-muted-foreground">
                                {preset.pattern}
                              </code>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor={`level-count-${level.key}`}>
                      {parent ? `Per ${parent.name.trim().toLowerCase() || "parent"}` : "Create"}
                    </Label>
                    <Input
                      id={`level-count-${level.key}`}
                      type="number"
                      min={0}
                      max={MAX_PER_PARENT}
                      value={level.count}
                      // Nothing to nest in when the level above creates none.
                      disabled={index > 0 && totals[index - 1] === 0}
                      onChange={(e) =>
                        update(index, {
                          count: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        })
                      }
                      className="w-20"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Move down"
                      disabled={index === levels.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove level"
                      disabled={levels.length === 1}
                      onClick={() => setLevels((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                {"error" in shown ? (
                  <p className="text-sm text-destructive">{shown.error}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <span className="mr-1">{shown.description}:</span>
                    {shown.labels.map((label) => (
                      <Badge key={label} variant="secondary" className="font-mono">
                        {label}
                      </Badge>
                    ))}
                    <span>…</span>
                    {totals[index] > 0 && (
                      <span className="ml-auto">{totals[index]} to create</span>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          <div>
            <Button
              variant="outline"
              onClick={() => setLevels((prev) => [...prev, ...withKeys([BLANK])])}
              disabled={levels.length >= MAX_LEVELS}
            >
              <Plus className="size-4" />
              Add level
            </Button>
          </div>

          <div className="grid gap-2 rounded-xl border p-4">
            <Label htmlFor="code-separator">Code separator</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="code-separator"
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                maxLength={MAX_SEPARATOR_LENGTH}
                placeholder="none"
                className="w-20 font-mono"
                spellCheck={false}
              />
              {SEPARATOR_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant={separator === preset.value ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setSeparator(preset.value)}
                >
                  {preset.label}
                  {preset.value && <code className="font-mono">{preset.value}</code>}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Joins the labels into a location&apos;s code. With none, box A&apos;s bin 1 is
              just <code className="font-mono">A1</code> — alternate letters and numbers between
              levels so codes stay unambiguous.
            </p>
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="grid gap-4">
          <div>
            <h2 className="text-lg font-semibold mb-1">How should each level be labeled?</h2>
            <p className="text-sm text-muted-foreground">
              Pick the printable label for every location of a type. Each becomes its own template
              you can redesign under Settings → Labels or from any location&apos;s page.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {levels.map((level, index) => (
              <Card key={level.key} className="gap-3 p-4">
                <div className="flex items-center gap-2 font-medium">
                  <LocationIcon name={level.icon} className="size-4 text-muted-foreground" />
                  {level.name}
                </div>
                <Select
                  value={String(level.template)}
                  onValueChange={(value) => update(index, { template: Number(value) })}
                >
                  <SelectTrigger className="w-full" aria-label={`${level.name} label`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFAULT_TEMPLATES.map((t, i) => (
                      <SelectItem key={t.name} value={String(i)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <LabelPreview
                  svg={
                    renderLabelSvg(
                      DEFAULT_TEMPLATES[level.template].template,
                      sampleVariables(levels, index, sampleUrl, separator),
                    ).body
                  }
                  className="mx-auto max-h-40 w-full max-w-xs"
                />
              </Card>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm">
        {showError ? (
          <p className="text-destructive">{error}</p>
        ) : (
          <p className="text-muted-foreground">
            {levels.length} location type{levels.length === 1 ? "" : "s"}
            {total > 0 ? `, ${total} location${total === 1 ? "" : "s"}` : ", no locations yet"}
            {!error && (
              <>
                {" "}· e.g.{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono">
                  {sampleVariables(levels, levels.length - 1, sampleUrl, separator).code}
                </code>
              </>
            )}
          </p>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" asChild>
            <Link href="/settings/location-types">Skip</Link>
          </Button>
          {step === 0 ? (
            <Button onClick={next}>Next</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(0)} disabled={pending}>
                Back
              </Button>
              <Button onClick={finish} disabled={pending || error !== null}>
                {pending ? "Adding…" : "Add locations"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
