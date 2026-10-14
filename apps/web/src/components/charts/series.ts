import { CATEGORIES, SOURCES } from "@tokenrank/shared";

/**
 * Colour follows the entity: each source / category owns a fixed slot of the
 * validated categorical palette, regardless of rank or filters. Stacks are
 * drawn in slot order so adjacent segments are always CVD-checked neighbours.
 */
export function seriesVar(slot: number): string {
  return `var(--series-${Math.min(8, Math.max(1, slot))})`;
}

export function slotFor(dimension: "source" | "category", key: string): number {
  const list: readonly string[] = dimension === "source" ? SOURCES : CATEGORIES;
  const i = list.indexOf(key);
  return i === -1 ? 8 : i + 1;
}
