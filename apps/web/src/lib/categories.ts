import type { Category, LeaderboardWindow } from "@tokenrank/shared";

/** Short category names for chips, mix labels and captions. */
export const CATEGORY_SHORT: Record<Category, string> = {
  coding: "Coding",
  chat: "Chat",
  agents: "Agents",
  image_generation: "Images",
  audio: "Audio",
  embeddings: "Embeddings",
  other: "Other",
};

/** Chips shown directly; the rest live behind "More". */
export const PRIMARY_CATEGORIES: readonly Category[] = ["coding", "chat", "agents", "image_generation"];
export const MORE_CATEGORIES: readonly Category[] = ["audio", "embeddings", "other"];

export const WINDOW_PHRASE: Record<LeaderboardWindow, string> = {
  today: "today",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  year: "this year",
  all: "all time",
};
