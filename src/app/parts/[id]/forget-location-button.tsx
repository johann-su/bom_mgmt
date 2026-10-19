"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { forgetStockLocation } from "../stock-actions";

// Removes an empty location from the part's list of homes.
export function ForgetLocationButton({ partId, locationId }: { partId: string; locationId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Remove empty location"
      title="Remove empty location"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await forgetStockLocation({ partId, locationId });
          if (result.error) toast.error(result.error);
        })
      }
    >
      <X className="size-4" />
    </Button>
  );
}
