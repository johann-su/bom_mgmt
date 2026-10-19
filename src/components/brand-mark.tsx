import { Grid2x2 } from "lucide-react";

export const APP_NAME = "Bin Vault";

export function BrandMark() {
  return (
    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <Grid2x2 className="size-5" />
    </div>
  );
}
