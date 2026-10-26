import { Package } from "lucide-react";
import { iconUrl } from "@/lib/label-icons";
import { cn } from "@/lib/utils";

// A part's thumbnail: its first image, else its catalogue icon (parts.icon),
// else a neutral placeholder. Plain <img>: files are served from our own
// session-guarded route, so next/image's optimizer (which can't send cookies)
// is not involved.
export function PartThumb({
  fileId,
  icon,
  className,
}: {
  fileId: string | null;
  icon?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted",
        !fileId && icon && "bg-white",
        className,
      )}
    >
      {fileId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/${fileId}`} alt="" className="size-full object-cover" loading="lazy" />
      ) : icon ? (
        // Black on white in either theme, as the icon prints on a label.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl(icon)} alt="" className="size-full object-contain p-[15%]" loading="lazy" />
      ) : (
        <Package className="size-1/2 text-muted-foreground/60" />
      )}
    </div>
  );
}
