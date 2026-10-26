// The generic-part families the "Generic part" wizard offers, in tab order.
// Kept apart from src/lib/generic-parts.ts, whose helpers the families import.

import { CONNECTOR_FAMILY } from "@/lib/connectors";
import { FASTENER_FAMILY } from "@/lib/fasteners";
import type { GenericFamily, GenericType } from "@/lib/generic-parts";

export const GENERIC_FAMILIES: GenericFamily[] = [FASTENER_FAMILY, CONNECTOR_FAMILY];

export function genericType(familyId: string, typeId: string): GenericType | undefined {
  return GENERIC_FAMILIES.find((f) => f.id === familyId)?.types.find((t) => t.id === typeId);
}
