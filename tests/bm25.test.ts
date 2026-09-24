import { describe, expect, it } from "vitest";
import {
  computeCorpusStats,
  computeDocumentFrequencies,
  idf,
  rankChunks,
  termScore,
  type RankableChunk,
} from "../src/index/bm25.js";
import type { Bm25Params } from "../src/types.js";

const PARAMS: Bm25Params = { k1: 1.5, b: 0.75 };

/**
 * Hand-verified BM25 test case.
 *
 * Corpus (each "document" is one chunk, 6 tokens each, so avgdl = 6, N = 3):
 *   D1: "the cat sat on the mat"    -> tf: the=2, cat=1, sat=1, on=1, mat=1
 *   D2: "the dog sat on the log"    -> tf: the=2, dog=1, sat=1, on=1, log=1
 *   D3: "cats and dogs are great pets" -> tf: cats=1, and=1, dogs=1, are=1, great=1, pets=1
 *
 * Query: "cat sat"
 *   df(cat) = 1 (only D1 contains it)
 *   df(sat) = 2 (D1 and D2 contain it)
 *
 * BM25 with k1=1.5, b=0.75:
 *   IDF(t) = ln( (N - df + 0.5) / (df + 0.5) + 1 )
 *   IDF(cat) = ln( (3 - 1 + 0.5) / (1 + 0.5) + 1 ) = ln( 2.5/1.5 + 1 ) = ln(8/3)     ~= 0.98082925301
 *   IDF(sat) = ln( (3 - 2 + 0.5) / (2 + 0.5) + 1 ) = ln( 1.5/2.5 + 1 ) = ln(1.6)     ~= 0.47000362925
 *
 * For D1 and D2, |D| == avgdl == 6, so for any term with tf=1:
 *   denom = tf + k1*(1 - b + b*(|D|/avgdl)) = 1 + 1.5*(0.25 + 0.75*1) = 1 + 1.5 = 2.5
 *   numer = tf*(k1+1) = 1*2.5 = 2.5
 *   term contribution = IDF(t) * (numer/denom) = IDF(t) * 1 = IDF(t)
 *
 * So, computed independently on paper:
 *   score(D1) = IDF(cat) + IDF(sat) = ln(8/3) + ln(1.6) ~= 1.45083288226
 *   score(D2) =            IDF(sat) =           ln(1.6) ~= 0.47000362925
 *   score(D3) = 0 (contains neither query term)
 *
 * Expected ranking: D1 > D2 > D3 (D3 excluded, score 0).
 */
const HAND_COMPUTED = {
  idfCat: Math.log(8 / 3), // ln(8/3), independently reduced from (2.5/1.5 + 1) by hand
  idfSat: Math.log(1.6),
  scoreD1: Math.log(8 / 3) + Math.log(1.6),
  scoreD2: Math.log(1.6),
};

const CHUNKS: RankableChunk[] = [
  {
    id: "D1",
    length: 6,
    termFrequencies: new Map([
      ["the", 2],
      ["cat", 1],
      ["sat", 1],
      ["on", 1],
      ["mat", 1],
    ]),
  },
  {
    id: "D2",
    length: 6,
    termFrequencies: new Map([
      ["the", 2],
      ["dog", 1],
      ["sat", 1],
      ["on", 1],
      ["log", 1],
    ]),
  },
  {
    id: "D3",
    length: 6,
    termFrequencies: new Map([
      ["cats", 1],
      ["and", 1],
      ["dogs", 1],
      ["are", 1],
      ["great", 1],
      ["pets", 1],
    ]),
  },
];

describe("BM25 hand-verified ranking math", () => {
  it("computes IDF exactly as derived on paper (sanity: 0.98082925301, 0.47000362925)", () => {
    const corpus = computeCorpusStats(CHUNKS);
    const df = computeDocumentFrequencies(CHUNKS);

    expect(corpus).toEqual({ N: 3, avgdl: 6 });
    expect(df.get("cat")).toBe(1);
    expect(df.get("sat")).toBe(2);

    expect(idf(1, 3)).toBeCloseTo(0.98082925301, 10);
    expect(idf(2, 3)).toBeCloseTo(0.47000362925, 10);
    expect(idf(1, 3)).toBeCloseTo(HAND_COMPUTED.idfCat, 12);
    expect(idf(2, 3)).toBeCloseTo(HAND_COMPUTED.idfSat, 12);
  });

  it("scores D1 and D2 for query 'cat sat' matching the independently hand-derived values exactly", () => {
    const corpus = computeCorpusStats(CHUNKS); // { N: 3, avgdl: 6 }
    const df = computeDocumentFrequencies(CHUNKS);

    const d1 = CHUNKS[0]!;
    const d2 = CHUNKS[1]!;
    const d3 = CHUNKS[2]!;

    const scoreD1 =
      termScore(d1.termFrequencies.get("cat") ?? 0, df.get("cat") ?? 0, d1.length, corpus, PARAMS) +
      termScore(d1.termFrequencies.get("sat") ?? 0, df.get("sat") ?? 0, d1.length, corpus, PARAMS);
    const scoreD2 =
      termScore(d2.termFrequencies.get("cat") ?? 0, df.get("cat") ?? 0, d2.length, corpus, PARAMS) +
      termScore(d2.termFrequencies.get("sat") ?? 0, df.get("sat") ?? 0, d2.length, corpus, PARAMS);
    const scoreD3 =
      termScore(d3.termFrequencies.get("cat") ?? 0, df.get("cat") ?? 0, d3.length, corpus, PARAMS) +
      termScore(d3.termFrequencies.get("sat") ?? 0, df.get("sat") ?? 0, d3.length, corpus, PARAMS);

    // These are hand-derived on paper (see comment above), not just re-derived from the code under test.
    expect(scoreD1).toBeCloseTo(1.45083288226, 8);
    expect(scoreD2).toBeCloseTo(0.47000362925, 8);
    expect(scoreD3).toBe(0);

    expect(scoreD1).toBeCloseTo(HAND_COMPUTED.scoreD1, 12);
    expect(scoreD2).toBeCloseTo(HAND_COMPUTED.scoreD2, 12);
  });

  it("rankChunks ranks D1 > D2 > D3 (D3 excluded, zero matching terms) for query 'cat sat'", () => {
    const results = rankChunks(CHUNKS, ["cat", "sat"], PARAMS);

    expect(results.map((r) => r.id)).toEqual(["D1", "D2"]);
    expect(results[0]!.score).toBeCloseTo(1.45083288226, 8);
    expect(results[1]!.score).toBeCloseTo(0.47000362925, 8);
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("terms absent from the corpus contribute nothing and never crash (df=0 handled)", () => {
    const results = rankChunks(CHUNKS, ["nonexistentterm"], PARAMS);
    expect(results).toEqual([]);
  });

  it("a chunk with zero term frequency for a query term scores exactly 0 for that term", () => {
    expect(termScore(0, 5, 100, { N: 10, avgdl: 50 }, PARAMS)).toBe(0);
  });
});
