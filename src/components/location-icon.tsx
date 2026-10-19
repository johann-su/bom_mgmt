import { createElement } from "react";
import { locationIcon } from "@/lib/location-icons";

// Renders a location type's icon by its stored name. createElement keeps the
// lookup from reading as "a component created during render".
export function LocationIcon({ name, className }: { name: string; className?: string }) {
  return createElement(locationIcon(name), { className });
}
