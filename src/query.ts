import { scoreChunk } from "./index/bm25.js";
import { PocketRagStore } from "./index/store.js";
import { tokenizeForIndex } from "./tokenize.js";
import { DEFAULT_BM25_PARAMS, type RetrievedChunk } from "./types.js";

/**
 * Run a BM25 query against a previously built index. Only chunks sharing at
 * least one term with the query are considered (chunks scoring 0 are
 * excluded), matching real inverted-index search behavior. Returns the top
 * `topK` chunks sorted by descending score.
 */
export function queryIndex(dbPath: string, queryText: string, topK: number): RetrievedChunk[] {
  const store = PocketRagStore.open(dbPath);
  try {
    const corpus = store.getCorpusStats();
    if (corpus.N === 0) {
      return [];
    }

    const params = store.getBm25Params(DEFAULT_BM25_PARAMS);
    const queryTerms = Array.from(new Set(tokenizeForIndex(queryText)));
    if (queryTerms.length === 0) {
      return [];
    }

    const matching = store.getMatchingChunks(queryTerms);
    if (matching.size === 0) {
      return [];
    }

    const chunkRecords = store.getChunksByIds(Array.from(matching.keys()));
    const documentFrequencies = new Map<string, number>();
    for (const term of queryTerms) {
      documentFrequencies.set(term, store.getDocumentFrequency(term));
    }

    const results: RetrievedChunk[] = [];
    for (const [chunkId, chunkTermFrequencies] of matching) {
      const record = chunkRecords.get(chunkId);
      if (!record) {
        continue;
      }
      const score = scoreChunk(
        queryTerms,
        chunkTermFrequencies,
        documentFrequencies,
        record.length,
        corpus,
        params,
      );
      if (score > 0) {
        results.push({
          chunkId,
          sourcePath: record.sourcePath,
          chunkIndex: record.chunkIndex,
          text: record.text,
          score,
        });
      }
    }

    results.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.chunkId - b.chunkId));
    return results.slice(0, topK);
  } finally {
    store.close();
  }
}
