"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { locationCode, MAX_SEPARATOR_LENGTH, SEPARATOR_PRESETS } from "@/lib/location-tree";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const sample = locationCode(sampleLabels.map((label) => ({ label })), separator);

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const { error } = await updateCodeSeparator({ separator });
      if (error) toast.error(error);
      else toast.success("Code separator saved");
    });
  }

  return (
    <Card className="gap-3 p-4">
      <form onSubmit={save} className="grid gap-2">
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
          <code className="font-mono">A1</code> — alternate letters and numbers between levels so
          codes stay unambiguous. Labels already printed keep the old code.
        </p>
      </form>
    </Card>
  );
}
