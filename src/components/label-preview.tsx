import { cn } from "@/lib/utils";

// Shows a rendered label/page SVG (src/lib/label-render.ts) scaled to the
// container width. The markup is built by our own renderer with every
// user-supplied string XML-escaped, so injecting it is safe.
export function LabelPreview({ svg, className }: { svg: string; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-border [&>svg]:block [&>svg]:h-auto [&>svg]:w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
