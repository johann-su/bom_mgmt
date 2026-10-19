import { Package } from "lucide-react";
import { cn } from "@/lib/utils";

// A part's thumbnail, or a neutral placeholder. Plain <img>: files are
// served from our own session-guarded route, so next/image's optimizer (which
// can't send cookies) is not involved.
export function PartThumb({ fileId, className }: { fileId: string | null; className?: string }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted",
        className,
      )}
    >
      {fileId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/${fileId}`} alt="" className="size-full object-cover" loading="lazy" />
      ) : (
        <Package className="size-1/2 text-muted-foreground/60" />
      )}
    </div>
  );
}
