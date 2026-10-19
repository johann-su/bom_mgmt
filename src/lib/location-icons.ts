import {
  Archive,
  Box,
  Boxes,
  Container,
  Grid3x3,
  Inbox,
  Layers,
  Package,
  PanelsTopLeft,
  Warehouse,
  type LucideIcon,
} from "lucide-react";

// Icons a location type can pick, keyed by the name stored in
// location_types.icon. Unknown names fall back to a box.
export const LOCATION_ICONS: Record<string, LucideIcon> = {
  warehouse: Warehouse,
  shelf: Layers,
  cabinet: PanelsTopLeft,
  box: Box,
  boxes: Boxes,
  container: Container,
  drawer: Inbox,
  bin: Package,
  grid: Grid3x3,
  archive: Archive,
};

export function locationIcon(name: string): LucideIcon {
  return LOCATION_ICONS[name] ?? Box;
}
