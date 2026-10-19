"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteLabelTemplate } from "./actions";

export function DeleteTemplateButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <ConfirmButton
      title="Delete this template?"
      confirmLabel="Delete"
      onConfirm={() =>
        startTransition(async () => {
          const { error } = await deleteLabelTemplate({ id });
          if (error) toast.error(error);
          else toast.success("Template deleted");
        })
      }
    >
      <Button variant="ghost" size="icon" disabled={pending} aria-label="Delete template">
        <Trash2 className="size-4" />
      </Button>
    </ConfirmButton>
  );
}
