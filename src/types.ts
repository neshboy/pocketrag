/**
 * Shared types for PocketRAG's chunking, indexing, and retrieval pipeline.
 */

/** A window of text produced by the chunker, before it has been persisted. */
export interface TextChunk {
  /** Zero-based index of this chunk within its source document. */
  readonly chunkIndex: number;
  /** The chunk's text content (tokens re-joined with single spaces). */
  readonly text: string;
  /** Index of the first token (inclusive) this chunk covers in the source document's token stream. */
  readonly startToken: number;
  /** Index of the last token (exclusive) this chunk covers in the source document's token stream. */
  readonly endToken: number;
}

/** Options controlling the sliding-window chunking strategy. */
export interface ChunkOptions {
  /** Number of whitespace-delimited word tokens per chunk. Must be a positive integer. */
  chunkSize: number;
  /** Number of tokens of overlap between consecutive chunks. Must be >= 0 and < chunkSize. */
  overlap: number;
}

/** A chunk as retrieved from persistent storage, with its source metadata and rank score. */
export interface RetrievedChunk {
  readonly chunkId: number;
  readonly sourcePath: string;
  readonly chunkIndex: number;
  readonly text: string;
  readonly score: number;
}

/** BM25 ranking parameters. See https://en.wikipedia.org/wiki/Okapi_BM25 */
export interface Bm25Params {
  /** Term-frequency saturation parameter. Typical default: 1.5. */
  k1: number;
  /** Document-length normalization parameter, in [0, 1]. Typical default: 0.75. */
  b: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  chunkSize: 200,
  overlap: 40,
};

export const DEFAULT_BM25_PARAMS: Bm25Params = {
  k1: 1.5,
  b: 0.75,
};

/** File extensions PocketRAG knows how to extract text from. */
export const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".pdf"]);
