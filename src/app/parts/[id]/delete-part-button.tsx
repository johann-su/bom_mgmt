"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { deletePart } from "../actions";

export function DeletePartButton({ partId }: { partId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <ConfirmButton
      title="Delete this part?"
      description="Its stock records, history and files are deleted too. Parts used in a BOM can't be deleted."
      confirmLabel="Delete part"
      onConfirm={() =>
        startTransition(async () => {
          const result = await deletePart({ id: partId });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Part deleted");
          router.push("/parts");
        })
      }
    >
      <Button variant="outline" disabled={pending} aria-label="Delete part">
        <Trash2 className="size-4" />
      </Button>
    </ConfirmButton>
  );
}
