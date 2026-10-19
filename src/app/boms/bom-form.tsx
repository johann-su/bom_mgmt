"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { isNextRedirectError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createBom, updateBom } from "./actions";

export function BomForm({
  bom,
  onDone,
}: {
  bom?: { id: string; name: string; description: string };
  onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const values = {
          name: String(form.get("name") ?? ""),
          description: String(form.get("description") ?? ""),
        };
        startTransition(async () => {
          try {
            const result = bom ? await updateBom({ id: bom.id, ...values }) : await createBom(values);
            if (result?.error) {
              toast.error(result.error);
              return;
            }
            if (bom) {
              toast.success("BOM saved");
              onDone?.();
              router.refresh();
            }
          } catch (err) {
            // createBom redirects to the new BOM on success.
            if (!isNextRedirectError(err)) toast.error("Something went wrong");
          }
        });
      }}
    >
      <Card>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="bom-name">Name</Label>
            <Input
              id="bom-name"
              name="name"
              defaultValue={bom?.name}
              placeholder="Keyboard v2, Filament dryer…"
              required
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bom-description">Description</Label>
            <Textarea id="bom-description" name="description" defaultValue={bom?.description} rows={3} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => (onDone ? onDone() : router.back())}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : bom ? "Save" : "Create BOM"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
