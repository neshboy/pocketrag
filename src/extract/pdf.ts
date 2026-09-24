import { readFile } from "node:fs/promises";
// pdf-parse is a CommonJS module; its default export is the parse function.
import pdfParse from "pdf-parse";

/**
 * Extract plain text from a PDF file using `pdf-parse` (a real,
 * well-established wrapper around Mozilla's pdf.js text-extraction engine).
 *
 * We pin the pre-2.x `pdf-parse` line specifically because it has no native
 * dependency (no `canvas`/`@napi-rs/canvas`), keeping PocketRAG's install
 * footprint small and avoiding native-binding portability issues (see the
 * README's "Why classical retrieval, not neural embeddings" section for a
 * concrete example of that class of problem).
 */
export async function extractPdfFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  const result = await pdfParse(buffer);
  return result.text;
}
