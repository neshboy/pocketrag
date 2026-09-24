import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { SUPPORTED_EXTENSIONS } from "../types.js";
import { extractPdfFile } from "./pdf.js";
import { extractTextFile } from "./text.js";

export interface ExtractedDocument {
  /** Absolute (or caller-provided-relative) path to the source file. */
  path: string;
  /** Full extracted text content of the file. */
  text: string;
}

/**
 * Recursively walk `rootDir` and return the paths of every file whose
 * extension PocketRAG knows how to extract text from (see
 * {@link SUPPORTED_EXTENSIONS}), skipping dotfiles/dot-directories (e.g.
 * `.git`, `.pocketrag`).
 */
export async function findDocumentPaths(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  results.sort();
  return results;
}

/** Extract text from a single file, dispatching by extension. */
export async function extractDocument(filePath: string): Promise<ExtractedDocument> {
  const ext = extname(filePath).toLowerCase();
  const text = ext === ".pdf" ? await extractPdfFile(filePath) : await extractTextFile(filePath);
  return { path: filePath, text };
}

/**
 * Recursively find and extract every supported document under `rootDir`.
 * Extraction failures for an individual file are collected rather than
 * aborting the whole run, so one corrupt PDF doesn't block indexing the rest
 * of the corpus.
 */
export async function extractDocuments(
  rootDir: string,
): Promise<{ documents: ExtractedDocument[]; errors: Array<{ path: string; error: Error }> }> {
  const paths = await findDocumentPaths(rootDir);
  const documents: ExtractedDocument[] = [];
  const errors: Array<{ path: string; error: Error }> = [];

  for (const path of paths) {
    try {
      documents.push(await extractDocument(path));
    } catch (err) {
      errors.push({ path, error: err instanceof Error ? err : new Error(String(err)) });
    }
  }

  return { documents, errors };
}
