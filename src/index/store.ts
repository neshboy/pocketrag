import { DatabaseSync, type StatementSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Bm25Params } from "../types.js";
import type { CorpusStats } from "./bm25.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  length INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS postings (
  term TEXT NOT NULL,
  chunk_id INTEGER NOT NULL,
  tf INTEGER NOT NULL,
  PRIMARY KEY (term, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_postings_term ON postings(term);
CREATE INDEX IF NOT EXISTS idx_postings_chunk ON postings(chunk_id);

CREATE TABLE IF NOT EXISTS terms (
  term TEXT PRIMARY KEY,
  df INTEGER NOT NULL
);
`;

export interface StoredChunk {
  id: number;
  sourcePath: string;
  chunkIndex: number;
  text: string;
  length: number;
}

/**
 * A real, on-disk SQLite-backed index of chunks + BM25 postings, using
 * Node's built-in `node:sqlite` module (no native/native-addon dependency
 * required — it ships with Node itself from v22.5+).
 *
 * Layout: one row per chunk in `chunks`, one row per (term, chunk) pair with
 * its raw term frequency in `postings`, one row per term with its
 * corpus-wide document frequency in `terms`, and corpus-wide scalars
 * (N, totalLength, BM25 k1/b) in `meta`. This is enough to recompute BM25
 * scores for a query without re-reading or re-tokenizing the source corpus.
 */
export class PocketRagStore {
  private readonly db: DatabaseSync;
  private insertChunkStmt: StatementSync | undefined;
  private insertPostingStmt: StatementSync | undefined;

  private constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(SCHEMA);
  }

  static open(dbPath: string): PocketRagStore {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    const db = new DatabaseSync(dbPath);
    return new PocketRagStore(db);
  }

  /** Wipe all indexed data (used before a fresh `pocketrag index` run). */
  resetIndex(): void {
    this.db.exec("DELETE FROM chunks; DELETE FROM postings; DELETE FROM terms; DELETE FROM meta;");
  }

  /** Begin a transaction. Call {@link commit} when done inserting. */
  beginTransaction(): void {
    this.db.exec("BEGIN TRANSACTION");
  }

  commit(): void {
    this.db.exec("COMMIT");
  }

  rollback(): void {
    this.db.exec("ROLLBACK");
  }

  /** Insert one chunk and its term-frequency postings. Returns the new chunk id. */
  addChunk(
    sourcePath: string,
    chunkIndex: number,
    text: string,
    length: number,
    termFrequencies: ReadonlyMap<string, number>,
  ): number {
    this.insertChunkStmt ??= this.db.prepare(
      "INSERT INTO chunks (source_path, chunk_index, text, length) VALUES (?, ?, ?, ?)",
    );
    this.insertPostingStmt ??= this.db.prepare(
      "INSERT INTO postings (term, chunk_id, tf) VALUES (?, ?, ?)",
    );

    this.insertChunkStmt.run(sourcePath, chunkIndex, text, length);
    const chunkId = Number(this.db.prepare("SELECT last_insert_rowid() AS id").get()?.id);

    for (const [term, tf] of termFrequencies) {
      this.insertPostingStmt.run(term, chunkId, tf);
    }

    return chunkId;
  }

  /**
   * Recompute corpus-wide document frequencies and scalar stats from the
   * chunks/postings just inserted, and persist the BM25 params used for
   * this index. Must be called once after all `addChunk` calls for a fresh
   * index (and before commit, though it also works outside a transaction).
   */
  finalize(params: Bm25Params): void {
    this.db.exec("DELETE FROM terms");
    this.db.exec("INSERT INTO terms (term, df) SELECT term, COUNT(*) FROM postings GROUP BY term");

    const row = this.db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(length), 0) AS total FROM chunks").get() as
      | { n: number; total: number }
      | undefined;
    const n = row?.n ?? 0;
    const total = row?.total ?? 0;

    this.setMeta("N", String(n));
    this.setMeta("totalLength", String(total));
    this.setMeta("k1", String(params.k1));
    this.setMeta("b", String(params.b));
    this.setMeta("indexedAt", new Date().toISOString());
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  /** Corpus-wide stats (N, avgdl) needed by the BM25 formula. Returns N=0 if the index is empty. */
  getCorpusStats(): CorpusStats {
    const n = Number(this.getMeta("N") ?? "0");
    const total = Number(this.getMeta("totalLength") ?? "0");
    return { N: n, avgdl: n > 0 ? total / n : 0 };
  }

  /** BM25 params (k1, b) recorded at index time, falling back to the given defaults if unset. */
  getBm25Params(defaults: Bm25Params): Bm25Params {
    const k1 = this.getMeta("k1");
    const b = this.getMeta("b");
    return {
      k1: k1 !== undefined ? Number(k1) : defaults.k1,
      b: b !== undefined ? Number(b) : defaults.b,
    };
  }

  /** Document frequency for a single term (0 if the term was never indexed). */
  getDocumentFrequency(term: string): number {
    const row = this.db.prepare("SELECT df FROM terms WHERE term = ?").get(term) as { df: number } | undefined;
    return row?.df ?? 0;
  }

  /**
   * For a set of query terms, return every chunk id that contains at least
   * one of them, along with that chunk's term-frequency map restricted to
   * the query terms. This avoids scanning the full corpus at query time —
   * only chunks that share vocabulary with the query are considered, which
   * is both correct (BM25 scores 0 for non-matching chunks anyway) and how
   * real inverted-index search engines operate.
   */
  getMatchingChunks(queryTerms: readonly string[]): Map<number, Map<string, number>> {
    const result = new Map<number, Map<string, number>>();
    if (queryTerms.length === 0) {
      return result;
    }

    const placeholders = queryTerms.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT term, chunk_id, tf FROM postings WHERE term IN (${placeholders})`)
      .all(...queryTerms) as Array<{ term: string; chunk_id: number; tf: number }>;

    for (const row of rows) {
      let byTerm = result.get(row.chunk_id);
      if (!byTerm) {
        byTerm = new Map<string, number>();
        result.set(row.chunk_id, byTerm);
      }
      byTerm.set(row.term, row.tf);
    }

    return result;
  }

  /** Fetch full chunk records (source path, text, length) for a set of chunk ids. */
  getChunksByIds(ids: readonly number[]): Map<number, StoredChunk> {
    const result = new Map<number, StoredChunk>();
    if (ids.length === 0) {
      return result;
    }
    const placeholders = ids.map(() => "?").join(", ");
    const rows = this.db
      .prepare(`SELECT id, source_path, chunk_index, text, length FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids) as Array<{ id: number; source_path: string; chunk_index: number; text: string; length: number }>;

    for (const row of rows) {
      result.set(row.id, {
        id: row.id,
        sourcePath: row.source_path,
        chunkIndex: row.chunk_index,
        text: row.text,
        length: row.length,
      });
    }
    return result;
  }

  /** Total number of chunks currently persisted (regardless of `meta.N`, useful for sanity checks/tests). */
  countChunks(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number } | undefined;
    return row?.n ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
