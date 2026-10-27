// The generic-part families the "Generic part" wizard offers, in tab order.
// Kept apart from src/lib/generic-parts.ts, whose helpers the families import.

import { CONNECTOR_FAMILY } from "@/lib/connectors";
import { FASTENER_FAMILY } from "@/lib/fasteners";
import {
  rangeParam,
  resolveValues,
  type GenericFamily,
  type GenericSpec,
  type GenericType,
  type GenericValues,
} from "@/lib/generic-parts";

export const GENERIC_FAMILIES: GenericFamily[] = [FASTENER_FAMILY, CONNECTOR_FAMILY];

export function genericType(familyId: string, typeId: string): GenericType | undefined {
  return GENERIC_FAMILIES.find((f) => f.id === familyId)?.types.find((t) => t.id === typeId);
}

/**
 * A stored spec's type and values, or null if the wizard can no longer offer
 * exactly that choice — a type or option was renamed or dropped. A stale spec
 * mustn't be resolved anyway: resolveValues would quietly swap in defaults
 * (another material) and a refill would write them over the part.
 */
export function resolveSpec(spec: GenericSpec): { type: GenericType; values: GenericValues } | null {
  const type = genericType(spec.family, spec.type);
  if (!type) return null;
  const { values, params } = resolveValues(type, spec.values);
  const range = rangeParam(params);
  if (Object.keys(spec.values).length !== params.length) return null;
  for (const param of params) {
    const value = spec.values[param.id];
    if (value === undefined) return null;
    if (param === range ? range.parse(value) !== value : values[param.id] !== value) return null;
  }
  return { type, values: spec.values };
}
