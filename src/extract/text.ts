import { readFile } from "node:fs/promises";

/**
 * Read a plain-text or Markdown file as UTF-8 text. This is intentionally a
 * thin wrapper (no Markdown-specific parsing/stripping) — PocketRAG indexes
 * Markdown as plain text, which is a reasonable default since headings,
 * lists, etc. still carry useful retrieval signal as words.
 */
export async function extractTextFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf-8");
}
