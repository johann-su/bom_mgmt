"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

type Sibling = { id: string; title: string };

// Steps through the location's same-type siblings (the bins in a box),
// wrapping at the ends. ← / → do the same unless focus is in a field or an
// open dialog/menu, where the arrows belong to that control.
export function SiblingNav({
  prev,
  next,
  index,
  total,
  typeName,
}: {
  prev: Sibling;
  next: Sibling;
  index: number;
  total: number;
  typeName: string;
}) {
  const router = useRouter();

  useEffect(() => {
    router.prefetch(`/locations/${prev.id}`);
    router.prefetch(`/locations/${next.id}`);
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        e.shiftKey ||
        e.defaultPrevented
      )
        return;
      const target = e.target as HTMLElement | null;
      if (
        target?.closest?.(
          "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='listbox'], [role='menu'], [role='slider'], [role='tablist']",
        ) ||
        document.querySelector("[role='dialog'], [role='alertdialog']")
      ) {
        return;
      }
      e.preventDefault();
      router.push(`/locations/${e.key === "ArrowLeft" ? prev.id : next.id}`);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, prev.id, next.id]);

  return (
    <div className="flex items-center gap-1">
      <Button asChild size="icon" variant="ghost" className="size-7">
        <Link
          href={`/locations/${prev.id}`}
          title={`${prev.title} (←)`}
          aria-label={`Previous: ${prev.title}`}
        >
          <ChevronLeft className="size-4" />
        </Link>
      </Button>
      <span className="text-sm tabular-nums text-muted-foreground">
        {typeName} {index + 1} / {total}
      </span>
      <Button asChild size="icon" variant="ghost" className="size-7">
        <Link
          href={`/locations/${next.id}`}
          title={`${next.title} (→)`}
          aria-label={`Next: ${next.title}`}
        >
          <ChevronRight className="size-4" />
        </Link>
      </Button>
    </div>
  );
}
