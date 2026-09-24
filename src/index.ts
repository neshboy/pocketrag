/** PocketRAG public library API (also used internally by the CLI). */

export { chunkText } from "./chunker.js";
export { extractDocument, extractDocuments, findDocumentPaths } from "./extract/index.js";
export type { ExtractedDocument } from "./extract/index.js";
export { extractPdfFile } from "./extract/pdf.js";
export { extractTextFile } from "./extract/text.js";
export * as bm25 from "./index/bm25.js";
export { PocketRagStore } from "./index/store.js";
export type { StoredChunk } from "./index/store.js";
export { indexFolder } from "./indexer.js";
export type { IndexOptions, IndexResult } from "./indexer.js";
export { queryIndex } from "./query.js";
export { normalizeTerm, splitWords, tokenizeForIndex } from "./tokenize.js";
export * from "./types.js";
