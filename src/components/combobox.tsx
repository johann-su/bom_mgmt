"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ComboboxOption = {
  value: string;
  label: string;
  // Second line under the label (a location path, an MPN).
  detail?: string;
  // Extra text the search matches on besides label and detail.
  keywords?: string[];
  // Heading of the section the option is listed under; consecutive options
  // with the same group share one section.
  group?: string;
};

function sections(options: ComboboxOption[]) {
  const out: { heading?: string; options: ComboboxOption[] }[] = [];
  for (const option of options) {
    const last = out.at(-1);
    if (last && last.heading === option.group) last.options.push(option);
    else out.push({ heading: option.group, options: [option] });
  }
  return out;
}

// Searchable single-select for lists too long for a <Select>: locations and
// parts. cmdk filters on label + detail + keywords.
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing found.",
  className,
  disabled,
  id,
}: {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {sections(options).map((section, i) => [
              i > 0 && <CommandSeparator key={`sep-${i}`} />,
              <CommandGroup key={`group-${i}`} heading={section.heading}>
                {section.options.map((option) => (
                  <CommandItem
                    key={option.value}
                    // cmdk matches on `value`; make it unique and searchable.
                    value={`${option.label} ${option.detail ?? ""} ${(option.keywords ?? []).join(" ")} ${option.value}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn("size-4", option.value === value ? "opacity-100" : "opacity-0")}
                    />
                    <div className="min-w-0">
                      <div className="truncate">{option.label}</div>
                      {option.detail && (
                        <div className="truncate text-xs text-muted-foreground">
                          {option.detail}
                        </div>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>,
            ])}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
