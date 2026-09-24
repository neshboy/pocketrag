import { chunkText } from "./chunker.js";
import { extractDocuments } from "./extract/index.js";
import { PocketRagStore } from "./index/store.js";
import { tokenizeForIndex } from "./tokenize.js";
import type { Bm25Params, ChunkOptions } from "./types.js";

export interface IndexOptions {
  chunkOptions: ChunkOptions;
  bm25Params: Bm25Params;
}

export interface IndexResult {
  dbPath: string;
  documentsIndexed: number;
  chunksIndexed: number;
  errors: Array<{ path: string; error: Error }>;
}

/**
 * Full indexing pipeline: walk `folderPath` for supported documents, extract
 * their text, chunk each document with a sliding window, tokenize each
 * chunk into BM25 terms, and persist everything to the SQLite store at
 * `dbPath`. Re-running this on the same `dbPath` replaces the previous
 * index from scratch (no incremental/delta indexing in v1 — see README
 * Limitations).
 */
export async function indexFolder(
  folderPath: string,
  dbPath: string,
  options: IndexOptions,
): Promise<IndexResult> {
  const { documents, errors } = await extractDocuments(folderPath);

  const store = PocketRagStore.open(dbPath);
  let chunksIndexed = 0;
  try {
    store.resetIndex();
    store.beginTransaction();

    for (const doc of documents) {
      const chunks = chunkText(doc.text, options.chunkOptions);
      for (const chunk of chunks) {
        const termFrequencies = new Map<string, number>();
        for (const term of tokenizeForIndex(chunk.text)) {
          termFrequencies.set(term, (termFrequencies.get(term) ?? 0) + 1);
        }
        const length = chunk.endToken - chunk.startToken;
        store.addChunk(doc.path, chunk.chunkIndex, chunk.text, length, termFrequencies);
        chunksIndexed += 1;
      }
    }

    store.finalize(options.bm25Params);
    store.commit();
  } catch (err) {
    store.rollback();
    throw err;
  } finally {
    store.close();
  }

  return { dbPath, documentsIndexed: documents.length, chunksIndexed, errors };
}
