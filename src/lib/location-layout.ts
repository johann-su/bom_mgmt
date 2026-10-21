// The storage *layout* at a glance: the location tree with every set of
// same-typed nodes at the same type path folded into one entry. Twelve boxes
// of twelve bins on four shelves read as "Shelf ×4 › Box ×12 › Bin ×144",
// while a branch built differently (Shelf › Spool) shows up as its own arm.

import { compareLabels, parsePattern } from "@/lib/label-pattern";
import { buildTree, type FlatLocation, type LocationNode } from "@/lib/location-tree";

export type LayoutNode = {
  // Type ids from the root down to this entry — unique per entry, so a key.
  key: string;
  type: FlatLocation["type"];
  count: number;
  // Lowest and highest label in the group, in the type's natural order.
  first: string;
  last: string;
  children: LayoutNode[];
};

export function buildLayout(locations: FlatLocation[]): LayoutNode[] {
  return fold(buildTree(locations), "");
}

function fold(nodes: LocationNode[], parentKey: string): LayoutNode[] {
  // Group by type, keeping the first-seen order — buildTree already sorts
  // siblings by type position, so the layout follows the configured order.
  const groups = new Map<string, LocationNode[]>();
  for (const node of nodes) groups.set(node.type.id, [...(groups.get(node.type.id) ?? []), node]);

  return [...groups.values()].map((group) => {
    const type = group[0].type;
    const parsed = parsePattern(type.labelPattern);
    const pattern = "error" in parsed ? null : parsed;
    const labels = group.map((n) => n.label).sort((a, b) => compareLabels(pattern, a, b));
    const key = parentKey ? `${parentKey}/${type.id}` : type.id;
    return {
      key,
      type,
      count: group.length,
      first: labels[0],
      last: labels[labels.length - 1],
      children: fold(group.flatMap((n) => n.children), key),
    };
  });
}
