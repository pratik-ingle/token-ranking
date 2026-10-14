import { MAX_MODEL_LENGTH } from "./constants";

/**
 * Normalise a provider model name into the strict model charset:
 * lowercase, no whitespace, only a-z 0-9 . _ : / @ + -, max 64 chars.
 * "Claude Sonnet 4.5 (thinking)" → "claude-sonnet-4.5-thinking".
 */
export function normalizeModel(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  let m = raw
    .toLowerCase()
    .trim()
    .replace(/[\s()[\]{},;'"`|\\]+/g, "-")
    .replace(/[^a-z0-9._:/@+-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "");
  if (m.length > MAX_MODEL_LENGTH) m = m.slice(0, MAX_MODEL_LENGTH).replace(/[^a-z0-9]+$/, "");
  return m || "unknown";
}
