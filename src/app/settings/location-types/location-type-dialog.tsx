"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { PATTERN_PRESETS, describePattern, nextLabels, parsePattern } from "@/lib/label-pattern";
import { LOCATION_ICONS } from "@/lib/location-icons";
import {
  describeAmbiguity,
  findAmbiguity,
  patternProblem,
  SELF_TYPE,
  suggestPatterns,
  type GrammarType,
} from "@/lib/code-grammar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createLocationType, setTypeChildren, updateLocationType } from "./actions";

export type LocationTypeRow = {
  id: string;
  name: string;
  labelPattern: string;
  icon: string;
  usage: number;
  // Child types it may hold; null = any.
  childTypeIds: string[] | null;
  // Saved spot on the canvas; null = laid out automatically.
  canvasX: number | null;
  canvasY: number | null;
  // Labels in use — a suggested pattern must still fit them all.
  labels: string[];
};

// A link drawn on the canvas, waiting for this dialog: `parentId` would get
// `childTypeIds` (the dialog's type among them) once it's saved. For a type
// not created yet, SELF_TYPE stands for it on either end; `at` is where on
// the canvas the link was dropped, so the new type appears there.
export type PendingLink = {
  parentId: string;
  childTypeIds: string[] | null;
  at?: { x: number; y: number };
};

export function preview(pattern: string): { labels: string[]; description: string } | { error: string } {
  const parsed = parsePattern(pattern);
  if ("error" in parsed) return parsed;
  return { labels: nextLabels(parsed, [], 8), description: describePattern(parsed) };
}

export function LocationTypeDialog({
  type,
  types,
  separator,
  link,
  onClose,
}: {
  type: LocationTypeRow | null;
  types: LocationTypeRow[];
  separator: string;
  // Set when opened by drawing a link to this type: saving also adds the link.
  link?: PendingLink;
  onClose: () => void;
}) {
  const [name, setName] = useState(type?.name ?? "");
  const [pattern, setPattern] = useState(type?.labelPattern ?? "{N}");
  const [icon, setIcon] = useState(type?.icon ?? "box");
  // "Can hold": any type, nothing (a container for parts only), or a picked
  // list. Without a separator, codes rely on the type grammar, so a new type
  // starts as holding nothing rather than anything.
  // The type itself, by id once it has one — so "Box in Box" can be allowed.
  const selfId = type?.id ?? SELF_TYPE;
  // A link from the type itself (to itself, or from a new type to the node it
  // was dragged out of) is just its own "can hold" list.
  const selfLink = link?.parentId === selfId;
  const initialChildren = selfLink
    ? link.childTypeIds
    : type
      ? type.childTypeIds
      : separator === ""
        ? []
        : null;
  const [holds, setHolds] = useState<"any" | "none" | "some">(
    initialChildren === null ? "any" : initialChildren.length === 0 ? "none" : "some",
  );
  // Kept while switching modes so the picks aren't lost on a misclick.
  const [picked, setPicked] = useState<string[]>(initialChildren ?? []);
  const children = holds === "any" ? null : holds === "none" ? [] : picked;
  const childOptions = [
    ...types.filter((t) => t.id !== type?.id).map((t) => ({ id: t.id, name: t.name })),
    { id: selfId, name: `${name.trim() || "This type"} (itself)` },
  ];
  const [pending, startTransition] = useTransition();
  const shown = preview(pattern);

  // Checked live against every type as it would be after saving (with the
  // pending link): the shortest code that would read two ways, if any.
  const parent = link && !selfLink ? types.find((t) => t.id === link.parentId) : undefined;
  const grammar: GrammarType[] = [
    ...types
      .filter((t) => t.id !== type?.id)
      .map((t) => (t.id === parent?.id ? { ...t, childTypeIds: link!.childTypeIds } : t)),
    { id: selfId, name: name.trim() || "This type", labelPattern: pattern, childTypeIds: children },
  ];
  const clash = "error" in shown ? null : findAmbiguity(grammar, separator);
  // Why each preset couldn't be saved here (null = it can). Independent of
  // the pattern being typed, so only recomputed when the grammar around it
  // changes.
  const childKey = JSON.stringify(children);
  const presetProblems = useMemo(
    () =>
      PATTERN_PRESETS.map((preset) =>
        patternProblem(grammar, separator, selfId, preset.pattern, type?.labels ?? []),
      ),
    // `grammar` is rebuilt every render; these are what it's built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [types, separator, link, childKey, selfId, type],
  );
  const suggestions = clash ? suggestPatterns(grammar, separator, selfId, type?.labels ?? []) : [];

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const input = { name, labelPattern: pattern, icon, childTypeIds: children };
      // Opened just to confirm a link and left as is: only the link is saved.
      const unchanged =
        type !== null &&
        !selfLink &&
        name === type.name &&
        pattern === type.labelPattern &&
        icon === type.icon &&
        JSON.stringify(children) === JSON.stringify(type.childTypeIds);
      let id = type?.id;
      if (!unchanged) {
        const saved: { error?: string; id?: string } = type
          ? await updateLocationType({ id: type.id, ...input })
          : await createLocationType({ ...input, at: link?.at });
        if (saved.error) {
          toast.error(saved.error);
          return;
        }
        id ??= saved.id;
      }
      if (parent && id) {
        const childTypeIds = link!.childTypeIds?.map((c) => (c === SELF_TYPE ? id : c)) ?? null;
        const linked = await setTypeChildren({ id: parent.id, childTypeIds });
        if (linked.error) {
          toast.error(linked.error);
          return;
        }
        toast.success(`${parent.name} can now hold ${name.trim()}`);
      } else {
        toast.success(type ? "Location type updated" : "Location type added");
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-lg"
        // Opened for a link, the label pattern is what's being checked.
        onOpenAutoFocus={(e) => {
          // A new type needs its name first.
          if (!parent || !type) return;
          e.preventDefault();
          document.getElementById("type-pattern")?.focus();
        }}
      >
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {parent && type
                ? `Put ${type.name} into ${parent.name}`
                : parent
                  ? `New type inside ${parent.name}`
                  : type
                    ? "Edit location type"
                    : "New location type"}
            </DialogTitle>
            <DialogDescription>
              {parent
                ? `Inside a ${parent.name}, a ${name.trim() || "new type"}'s label follows the ${parent.name}'s in every code — check that they still read unambiguously, then save to link them.`
                : "The label pattern decides how locations of this type are named and suggested."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-[1fr_10rem] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="type-name">Name</Label>
              <Input
                id="type-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Shelf, Box, Drawer…"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label>Icon</Label>
              <Select value={icon} onValueChange={setIcon}>
                <SelectTrigger className="w-full">
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
          </div>

          <div className="grid gap-2">
            <Label htmlFor="type-pattern">Label pattern</Label>
            <Input
              id="type-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              className="font-mono"
              spellCheck={false}
              aria-invalid={"error" in shown || clash !== null}
              aria-describedby={clash ? "type-pattern-clash" : undefined}
              required
            />
            <div className="flex flex-wrap gap-1">
              {PATTERN_PRESETS.map((preset, i) => (
                // Disabled buttons take no pointer events, so the reason
                // lives on a wrapper to still show on hover.
                <span key={preset.pattern} title={presetProblems[i] ?? preset.pattern}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={presetProblems[i] !== null}
                    onClick={() => setPattern(preset.pattern)}
                  >
                    {preset.label}
                  </Button>
                </span>
              ))}
            </div>
            {"error" in shown ? (
              <p className="text-sm text-destructive">{shown.error}</p>
            ) : (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <div className="mb-1.5 text-xs text-muted-foreground">
                  {shown.description} — first labels:
                </div>
                <div className="flex flex-wrap gap-1">
                  {shown.labels.map((label) => (
                    <Badge key={label} variant="secondary" className="font-mono">
                      {label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {clash && (
              <div id="type-pattern-clash" className="grid gap-1.5 text-sm text-destructive">
                <p>
                  With this pattern, codes would be ambiguous: {describeAmbiguity(clash)}.
                  {separator === "" &&
                    " Without a separator, a label has to look different from the one around it."}
                </p>
                {suggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs">Patterns that would work:</span>
                    {suggestions.map((suggestion) => (
                      <Button
                        key={suggestion}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="font-mono"
                        onClick={() => setPattern(suggestion)}
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">Pattern syntax</summary>
              <ul className="mt-2 grid gap-1 pl-1">
                <li>
                  <code className="font-mono">{"{A}"}</code> /{" "}
                  <code className="font-mono">{"{a}"}</code> letters: A … Z, AA, AB …
                </li>
                <li>
                  <code className="font-mono">{"{N}"}</code> numbers;{" "}
                  <code className="font-mono">{"{NN}"}</code> zero-padded to two digits
                </li>
                <li>
                  <code className="font-mono">{"{R}"}</code> /{" "}
                  <code className="font-mono">{"{r}"}</code> roman numerals: I, II, III …
                </li>
                <li>
                  Ranges: <code className="font-mono">{"{N:0-9}"}</code>,{" "}
                  <code className="font-mono">{"{A:A-F}"}</code> — bounded counters roll over,
                  so <code className="font-mono">{"{A}{N:1-6}"}</code> gives A1 … A6, B1 …
                </li>
                <li>
                  Anything else is literal text, e.g.{" "}
                  <code className="font-mono">{"S-{NN}"}</code>; write{" "}
                  <code className="font-mono">{"{{"}</code> for a brace.
                </li>
              </ul>
            </details>
          </div>

          <div className="grid gap-2">
            <Label>Can hold</Label>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["any", "Any type"],
                  ["none", "Nothing"],
                  ["some", "Only these…"],
                ] as const
              ).map(([mode, text]) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={holds === mode ? "secondary" : "outline"}
                  aria-pressed={holds === mode}
                  onClick={() => setHolds(mode)}
                >
                  {text}
                </Button>
              ))}
            </div>
            {holds === "none" && (
              <p className="text-xs text-muted-foreground">
                A container for parts only — nothing can be put inside it.
              </p>
            )}
            {holds === "some" && (
              <div className="flex flex-wrap gap-1">
                {childOptions.map((option) => {
                  const on = picked.includes(option.id);
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      size="sm"
                      variant={on ? "secondary" : "outline"}
                      aria-pressed={on}
                      onClick={() =>
                        setPicked(on ? picked.filter((id) => id !== option.id) : [...picked, option.id])
                      }
                    >
                      {option.name}
                    </Button>
                  );
                })}
                {picked.length === 0 && (
                  <span className="self-center text-xs text-muted-foreground">
                    Pick at least one type, or choose Nothing.
                  </span>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {separator === ""
                ? "Codes have no separator, so this is what keeps them readable: saving checks that no code could be read two ways (like 1›11 vs 11›1)."
                : "Optional — restrict it to keep the tree tidy. Codes stay unambiguous either way thanks to the separator."}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                pending ||
                "error" in shown ||
                clash !== null ||
                (holds === "some" && picked.length === 0)
              }
            >
              {pending ? "Saving…" : parent ? "Save & link" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
