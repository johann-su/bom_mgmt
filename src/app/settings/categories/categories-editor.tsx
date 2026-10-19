"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteCategory, saveCategory } from "./actions";

type Category = { id: string; name: string; usage: number };

export function CategoriesEditor({ categories }: { categories: Category[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const { error } = await action();
      if (error) toast.error(error);
      else onSuccess?.();
    });
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveCategory({ name: newName }), () => setNewName(""));
        }}
      >
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New category"
          aria-label="New category name"
        />
        <Button type="submit" disabled={pending || !newName.trim()}>
          <Plus className="size-4" />
          Add
        </Button>
      </form>

      {categories.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No categories yet.</p>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2">
              {editingId === c.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => saveCategory({ id: c.id, name: draft }), () => setEditingId(null));
                  }}
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                    aria-label="Category name"
                  />
                  <Button type="submit" variant="ghost" size="icon" aria-label="Save" disabled={pending}>
                    <Check className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Cancel"
                    onClick={() => setEditingId(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.usage} part{c.usage === 1 ? "" : "s"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Rename"
                    onClick={() => {
                      setEditingId(c.id);
                      setDraft(c.name);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <ConfirmButton
                    title={`Delete "${c.name}"?`}
                    description={
                      c.usage > 0 ? `Its ${c.usage} part(s) become uncategorized.` : undefined
                    }
                    confirmLabel="Delete"
                    onConfirm={() => run(() => deleteCategory({ id: c.id }))}
                  >
                    <Button variant="ghost" size="icon" aria-label="Delete">
                      <Trash2 className="size-4" />
                    </Button>
                  </ConfirmButton>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
