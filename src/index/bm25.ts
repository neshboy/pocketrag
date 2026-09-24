import type { Bm25Params } from "../types.js";

/**
 * Okapi BM25 ranking function.
 *
 * score(D, Q) = sum over query terms t of:
 *   IDF(t) * ( f(t,D) * (k1 + 1) ) / ( f(t,D) + k1 * (1 - b + b * |D| / avgdl) )
 *
 * IDF(t) = ln( (N - n(t) + 0.5) / (n(t) + 0.5) + 1 )
 *
 * where:
 *   N      = total number of chunks in the corpus
 *   n(t)   = number of chunks containing term t (document frequency)
 *   f(t,D) = number of times term t occurs in chunk D (term frequency)
 *   |D|    = length of chunk D in tokens
 *   avgdl  = average chunk length in tokens across the corpus
 *
 * This is the Lucene/Robertson-Sparck-Jones "+1 inside the log" variant,
 * which guarantees IDF(t) >= 0 for every t (rather than going slightly
 * negative for terms that appear in more than half the corpus, as the
 * original 1994 Okapi formula can). k1 and b are the standard tunable
 * parameters; sensible defaults (k1=1.5, b=0.75) live in
 * {@link DEFAULT_BM25_PARAMS} in `types.ts`.
 *
 * See https://en.wikipedia.org/wiki/Okapi_BM25
 */

/** Corpus-wide statistics needed by the BM25 formula. */
export interface CorpusStats {
  /** Total number of chunks ("documents" in classic IR terminology). */
  readonly N: number;
  /** Average chunk length in tokens across the whole corpus. */
  readonly avgdl: number;
}

/** Inverse document frequency for a term with document frequency `df` in a corpus of size `N`. */
export function idf(df: number, N: number): number {
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

/**
 * BM25 contribution of a single query term to a single chunk's score.
 * Returns 0 if the term doesn't occur in the chunk (tf === 0), matching the
 * behavior of real search engines that don't reward absence of a term.
 */
export function termScore(
  tf: number,
  df: number,
  docLength: number,
  corpus: CorpusStats,
  params: Bm25Params,
): number {
  if (tf <= 0) {
    return 0;
  }
  const idfValue = idf(df, corpus.N);
  const numerator = tf * (params.k1 + 1);
  const denominator = tf + params.k1 * (1 - params.b + params.b * (docLength / corpus.avgdl));
  return idfValue * (numerator / denominator);
}

/**
 * Sum BM25 term scores for every query term against one chunk, given that
 * chunk's term-frequency map and the corpus-wide document-frequency map.
 */
export function scoreChunk(
  queryTerms: readonly string[],
  chunkTermFrequencies: ReadonlyMap<string, number>,
  documentFrequencies: ReadonlyMap<string, number>,
  chunkLength: number,
  corpus: CorpusStats,
  params: Bm25Params,
): number {
  let total = 0;
  for (const term of queryTerms) {
    const tf = chunkTermFrequencies.get(term) ?? 0;
    if (tf === 0) {
      continue;
    }
    const df = documentFrequencies.get(term) ?? 0;
    total += termScore(tf, df, chunkLength, corpus, params);
  }
  return total;
}

/** A minimal, storage-agnostic representation of one indexed chunk, for pure in-memory ranking. */
export interface RankableChunk {
  readonly id: string;
  readonly termFrequencies: ReadonlyMap<string, number>;
  readonly length: number;
}

/** Compute corpus-wide stats (N, avgdl) from a set of chunks. */
export function computeCorpusStats(chunks: readonly RankableChunk[]): CorpusStats {
  const N = chunks.length;
  if (N === 0) {
    return { N: 0, avgdl: 0 };
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  return { N, avgdl: totalLength / N };
}

/** Compute document frequency (number of chunks containing each term) across a set of chunks. */
export function computeDocumentFrequencies(chunks: readonly RankableChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    for (const term of chunk.termFrequencies.keys()) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  return df;
}

/**
 * Rank an in-memory set of chunks against a query using BM25. Chunks with a
 * score of 0 (no query term present) are excluded from the results, and
 * results are sorted by descending score. Ties are broken by chunk id for
 * deterministic output.
 */
export function rankChunks(
  chunks: readonly RankableChunk[],
  queryTerms: readonly string[],
  params: Bm25Params,
): Array<{ id: string; score: number }> {
  const corpus = computeCorpusStats(chunks);
  const df = computeDocumentFrequencies(chunks);

  const results = chunks
    .map((chunk) => ({
      id: chunk.id,
      score: scoreChunk(queryTerms, chunk.termFrequencies, df, chunk.length, corpus, params),
    }))
    .filter((r) => r.score > 0);

  results.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)));
  return results;
}
