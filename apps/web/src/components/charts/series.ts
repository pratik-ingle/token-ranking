import { CATEGORIES, SOURCES, type Category } from "@tokenrank/shared";

/**
 * Colour follows the entity: each source / category owns a fixed colour,
 * regardless of rank or filters.
 */
export function seriesVar(slot: number): string {
  return `var(--series-${Math.min(8, Math.max(1, slot))})`;
}

export function slotFor(dimension: "source" | "category", key: string): number {
  const list: readonly string[] = dimension === "source" ? SOURCES : CATEGORIES;
  const i = list.indexOf(key);
  return i === -1 ? 8 : i + 1;
}

/**
 * Fixed order for anything that stacks categories (mix bars). Chosen with the
 * palette validator so adjacent segments stay distinguishable under
 * colour-vision deficiency.
 */
export const CATEGORY_ORDER: readonly Category[] = ["coding", "chat", "image_generation", "agents", "audio", "embeddings", "other"];

/** The one place a category gets its colour (chips, mix bars, breakdowns, heatmap). */
export function categoryColor(key: string): string {
  return (CATEGORIES as readonly string[]).includes(key) ? `var(--cat-${key})` : "var(--cat-other)";
}

export function categoryIndex(key: string): number {
  const i = CATEGORY_ORDER.indexOf(key as Category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}
