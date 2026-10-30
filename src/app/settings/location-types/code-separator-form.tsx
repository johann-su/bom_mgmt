"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { locationCode, MAX_SEPARATOR_LENGTH, SEPARATOR_PRESETS } from "@/lib/location-tree";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { updateCodeSeparator } from "./actions";

// `sampleLabels` is one label per type, outermost first — enough to show
// what a code looks like with the separator being edited.
export function CodeSeparatorForm({
  separator: saved,
  sampleLabels,
}: {
  separator: string;
  sampleLabels: string[];
}) {
  const [separator, setSeparator] = useState(saved);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const sample = locationCode(sampleLabels.map((label) => ({ label })), separator);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    // Dropping the separator changes how types may nest, so say so first.
    if (separator === "" && saved !== "") setConfirming(true);
    else save();
  }

  function save() {
    setConfirming(false);
    startTransition(async () => {
      const { error } = await updateCodeSeparator({ separator });
      if (error) toast.error(error);
      else toast.success("Code separator saved");
    });
  }

  return (
    <Card className="gap-3 p-4">
      <form onSubmit={submit} className="grid gap-2">
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
              type="button"
              variant={separator === preset.value ? "secondary" : "outline"}
              size="sm"
              onClick={() => setSeparator(preset.value)}
            >
              {preset.label}
              {preset.value && <code className="font-mono">{preset.value}</code>}
            </Button>
          ))}
          {sample && (
            <span className="text-sm text-muted-foreground">
              e.g. <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{sample}</code>
            </span>
          )}
          <Button type="submit" className="ml-auto" disabled={pending || separator === saved}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Joins the labels into a location&apos;s code. With none, box A&apos;s bin 1 is just{" "}
          <code className="font-mono">A1</code>, and which types may hold which becomes a rule
          that keeps codes unambiguous. Labels already printed keep the old code.
        </p>
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Turn off the code separator?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid gap-2">
                <p>
                  Without a separator, a code is just the labels run together, so it can only be
                  read back if each level looks different from the one inside it. Shelf 1 holding
                  box 11 and shelf 11 holding box 1 would both be{" "}
                  <code className="font-mono">111</code>.
                </p>
                <p>
                  So types stop holding &ldquo;any type&rdquo;: each type that isn&apos;t
                  restricted yet will only be allowed to hold the types it holds today. Adding a
                  new kind of child later means allowing it under its parent&apos;s type, and
                  every such change is checked so that no code can be read two ways.
                </p>
                <p>
                  If your current types can&apos;t guarantee that — say, numbers inside numbers
                  — the change is refused with an example of a clashing code. Alternating
                  numbers and letters between levels (<code className="font-mono">1A3</code>) or
                  fixed-width numbers (<code className="font-mono">{"{NN}"}</code>) avoid it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={save}>Turn off separator</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
