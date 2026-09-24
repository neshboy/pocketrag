import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PocketRagStore } from "../src/index/store.js";

let tempDir: string;
let dbPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pocketrag-store-test-"));
  dbPath = join(tempDir, "index.sqlite");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function seed(store: PocketRagStore): void {
  store.beginTransaction();
  store.addChunk(
    "/docs/cats.txt",
    0,
    "the cat sat on the mat",
    6,
    new Map([
      ["the", 2],
      ["cat", 1],
      ["sat", 1],
      ["on", 1],
      ["mat", 1],
    ]),
  );
  store.addChunk(
    "/docs/dogs.txt",
    0,
    "the dog sat on the log",
    6,
    new Map([
      ["the", 2],
      ["dog", 1],
      ["sat", 1],
      ["on", 1],
      ["log", 1],
    ]),
  );
  store.finalize({ k1: 1.5, b: 0.75 });
  store.commit();
}

describe("PocketRagStore persistence", () => {
  it("creates the db file and its parent directory on disk", () => {
    const store = PocketRagStore.open(dbPath);
    seed(store);
    store.close();

    expect(() => rmSync(dbPath)).not.toThrow(); // file genuinely exists on disk
  });

  it("persists chunk count, corpus stats, and BM25 params across a close/reopen cycle", () => {
    const store1 = PocketRagStore.open(dbPath);
    seed(store1);
    expect(store1.countChunks()).toBe(2);
    store1.close();

    // Reopen as an entirely new connection -- proves data survived on disk,
    // not just in the first connection's in-memory cache.
    const store2 = PocketRagStore.open(dbPath);
    expect(store2.countChunks()).toBe(2);
    expect(store2.getCorpusStats()).toEqual({ N: 2, avgdl: 6 });
    expect(store2.getBm25Params({ k1: 999, b: 999 })).toEqual({ k1: 1.5, b: 0.75 });
    store2.close();
  });

  it("persists postings and document frequencies across reopen", () => {
    const store1 = PocketRagStore.open(dbPath);
    seed(store1);
    store1.close();

    const store2 = PocketRagStore.open(dbPath);
    expect(store2.getDocumentFrequency("cat")).toBe(1);
    expect(store2.getDocumentFrequency("sat")).toBe(2);
    expect(store2.getDocumentFrequency("nope")).toBe(0);

    const matching = store2.getMatchingChunks(["cat", "sat"]);
    expect(matching.size).toBe(2); // both chunks contain "sat"; only one contains "cat" too

    store2.close();
  });

  it("persists full chunk records (source path, text, length) across reopen", () => {
    const store1 = PocketRagStore.open(dbPath);
    seed(store1);
    store1.close();

    const store2 = PocketRagStore.open(dbPath);
    const matching = store2.getMatchingChunks(["cat"]);
    const chunkIds = Array.from(matching.keys());
    const records = store2.getChunksByIds(chunkIds);

    expect(records.size).toBe(1);
    const record = Array.from(records.values())[0]!;
    expect(record.sourcePath).toBe("/docs/cats.txt");
    expect(record.text).toBe("the cat sat on the mat");
    expect(record.length).toBe(6);

    store2.close();
  });

  it("resetIndex wipes chunks, postings, terms, and meta", () => {
    const store = PocketRagStore.open(dbPath);
    seed(store);
    expect(store.countChunks()).toBe(2);

    store.resetIndex();

    expect(store.countChunks()).toBe(0);
    expect(store.getCorpusStats()).toEqual({ N: 0, avgdl: 0 });
    expect(store.getDocumentFrequency("cat")).toBe(0);
    store.close();
  });

  it("a fresh re-index (reset + reseed) fully replaces the previous index rather than appending to it", () => {
    const store = PocketRagStore.open(dbPath);
    seed(store); // 2 chunks
    expect(store.countChunks()).toBe(2);

    store.resetIndex();
    store.beginTransaction();
    store.addChunk("/docs/only.txt", 0, "just one chunk now", 4, new Map([["just", 1]]));
    store.finalize({ k1: 1.5, b: 0.75 });
    store.commit();

    expect(store.countChunks()).toBe(1);
    expect(store.getCorpusStats()).toEqual({ N: 1, avgdl: 4 });
    store.close();
  });
});
