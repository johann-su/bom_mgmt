"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  ICON_PACKS,
  groupIcons,
  iconPack,
  loadIcons,
  searchIcons,
  type IconPack,
  type LabelIcon,
} from "@/lib/label-icons";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const ALL = "All";

/**
 * The built-in icon library, searchable and filtered in two steps: a pack
 * (components, connectors, screws, motion), then one of its categories. Clicking an icon adds it and closes; Shift-click
 * adds it and stays open, for building a label from several marks.
 */
export function IconPickerDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (icon: LabelIcon) => void;
}) {
  const [icons, setIcons] = useState<LabelIcon[] | null>(null);
  const [query, setQuery] = useState("");
  const [pack, setPack] = useState<IconPack | typeof ALL>(ALL);
  const [category, setCategory] = useState(ALL);

  // The catalogue is loaded the first time the picker opens.
  useEffect(() => {
    if (!open || icons) return;
    let cancelled = false;
    loadIcons().then((list) => !cancelled && setIcons(list));
    return () => {
      cancelled = true;
    };
  }, [open, icons]);

  const inPack = useMemo(
    () => (icons && pack !== ALL ? icons.filter((i) => iconPack(i) === pack) : (icons ?? [])),
    [icons, pack],
  );
  const categories = useMemo(() => groupIcons(inPack).map((g) => g.category), [inPack]);
  const groups = useMemo(() => {
    const inCategory = category === ALL ? inPack : inPack.filter((i) => i.category === category);
    return groupIcons(searchIcons(inCategory, query));
  }, [inPack, category, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Icon library</DialogTitle>
          <DialogDescription>
            Click an icon to add it to the label, or Shift-click to add several.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search — e.g. JST, M3 nut, torx, ISO 4762"
            className="pl-8"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {([ALL, ...Object.keys(ICON_PACKS)] as (IconPack | typeof ALL)[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setPack(p);
                setCategory(ALL);
              }}
              className={cn(
                "rounded-md px-2.5 py-1 text-sm",
                p === pack ? "bg-secondary font-medium" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {p === ALL ? "All" : ICON_PACKS[p]}
            </button>
          ))}
        </div>
        {pack !== ALL && (
          <div className="flex flex-wrap gap-1.5">
            {[ALL, ...categories].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs",
                  c === category ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                )}
              >
                {/* "Connectors — RF" reads as just "RF" once the pack is picked. */}
                {c === ALL ? "All" : c.replace(/^[^—]+— /, "")}
              </button>
            ))}
          </div>
        )}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {!icons ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading icons…</p>
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No icons match “{query}”{pack !== ALL && ` in ${ICON_PACKS[pack]}`}.
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.category} className="mb-4">
                <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {group.category}
                </h3>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                  {group.icons.map((icon) => (
                    <button
                      key={icon.id}
                      type="button"
                      title={[`${icon.name}${icon.detail ? ` — ${icon.detail}` : ""}`, icon.note]
                        .filter(Boolean)
                        .join("\n")}
                      onClick={(e) => {
                        onPick(icon);
                        if (!e.shiftKey) onOpenChange(false);
                      }}
                      className="grid justify-items-center gap-1 rounded-md border p-2 text-center hover:border-primary hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {/* Labels are white stock, so icons preview black on white in either theme. */}
                      <span className="grid size-12 place-items-center rounded bg-white p-1 text-black">
                        <svg
                          viewBox={icon.viewBox.join(" ")}
                          className="size-full"
                          aria-hidden
                          // Sanitised at import (scripts/import-label-icons.ts).
                          dangerouslySetInnerHTML={{ __html: icon.markup }}
                        />
                      </span>
                      <span className="line-clamp-2 text-xs leading-tight">{icon.name}</span>
                      {icon.detail && (
                        <span className="truncate text-[0.65rem] leading-none text-muted-foreground">
                          {icon.detail}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
