import { describe, expect, it } from "vitest";
import { chunkText } from "../src/chunker.js";
import { splitWords } from "../src/tokenize.js";

const MULTI_PARAGRAPH_TEXT = `
PocketRAG is a small, self-contained retrieval library that runs entirely on
your own machine. It never phones home, never uploads your documents, and
never requires an API key. You point it at a folder, and it builds a local
index you can query offline.

Under the hood it walks the folder for text, Markdown, and PDF files,
extracts their raw text, and splits every document into overlapping windows
of words. Each window becomes a retrievable chunk, tagged with the file it
came from and its position within that file, so a search result always
tells you exactly where the matching text lives.

Ranking is handled by Okapi BM25, a classical information-retrieval
algorithm that scores how well a chunk matches a query based on term
frequency, document frequency, and chunk length, without needing any
neural network or external service to run.
`;

describe("chunkText", () => {
  it("produces exact, hand-computed boundaries for a synthetic token stream", () => {
    // 50 distinct, easily verifiable tokens: word0..word49
    const tokens = Array.from({ length: 50 }, (_, i) => `word${i}`);
    const text = tokens.join(" ");

    const chunks = chunkText(text, { chunkSize: 10, overlap: 3 });

    // step = chunkSize - overlap = 7
    // Hand-computed windows: [0,10) [7,17) [14,24) [21,31) [28,38) [35,45) [42,50)
    const expectedRanges = [
      [0, 10],
      [7, 17],
      [14, 24],
      [21, 31],
      [28, 38],
      [35, 45],
      [42, 50],
    ];

    expect(chunks).toHaveLength(expectedRanges.length);

    chunks.forEach((chunk, i) => {
      const [start, end] = expectedRanges[i]!;
      expect(chunk.startToken).toBe(start);
      expect(chunk.endToken).toBe(end);
      expect(chunk.chunkIndex).toBe(i);
      expect(chunk.text).toBe(tokens.slice(start, end).join(" "));
    });

    // Final chunk is the tail: shorter than chunkSize (8 tokens: word42..word49), not a bug.
    const last = chunks[chunks.length - 1]!;
    expect(last.endToken - last.startToken).toBe(8);
  });

  it("keeps consecutive windows exactly `overlap` tokens apart and reproduces identical overlapping text", () => {
    const tokens = Array.from({ length: 33 }, (_, i) => `t${i}`);
    const text = tokens.join(" ");
    const chunkSize = 8;
    const overlap = 3;
    const step = chunkSize - overlap;

    const chunks = chunkText(text, { chunkSize, overlap });

    for (let i = 0; i < chunks.length - 1; i++) {
      const current = chunks[i]!;
      const next = chunks[i + 1]!;

      // The window start must advance by exactly `step` tokens...
      expect(next.startToken - current.startToken).toBe(step);

      // ...which means the last `overlap` tokens of the current chunk equal
      // the first `overlap` tokens of the next chunk, verbatim.
      const currentWords = splitWords(current.text);
      const nextWords = splitWords(next.text);
      expect(currentWords.slice(-overlap)).toEqual(nextWords.slice(0, overlap));
    }
  });

  it("chunks real multi-paragraph prose with no gaps and correct overlap", () => {
    const chunkSize = 40;
    const overlap = 10;
    const step = chunkSize - overlap;
    const allTokens = splitWords(MULTI_PARAGRAPH_TEXT);

    const chunks = chunkText(MULTI_PARAGRAPH_TEXT, { chunkSize, overlap });

    expect(chunks.length).toBeGreaterThan(1); // the fixture is long enough to actually need multiple windows
    expect(chunks[0]!.startToken).toBe(0);
    expect(chunks[chunks.length - 1]!.endToken).toBe(allTokens.length);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      // Every chunk's text must equal the corresponding token slice, verbatim.
      expect(chunk.text).toBe(allTokens.slice(chunk.startToken, chunk.endToken).join(" "));

      if (i < chunks.length - 1) {
        expect(chunks[i + 1]!.startToken - chunk.startToken).toBe(step);
        // No gap: the next window starts at or before this window's end.
        expect(chunks[i + 1]!.startToken).toBeLessThanOrEqual(chunk.endToken);
      } else {
        // Tail chunk is clamped to the end of the document.
        expect(chunk.endToken).toBe(allTokens.length);
      }
    }
  });

  it("returns a single chunk covering everything when text is shorter than chunkSize", () => {
    const chunks = chunkText("just a few words here", { chunkSize: 100, overlap: 10 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, startToken: 0, endToken: 5, text: "just a few words here" });
  });

  it("returns no chunks for empty or whitespace-only text", () => {
    expect(chunkText("", { chunkSize: 10, overlap: 2 })).toEqual([]);
    expect(chunkText("   \n\t  ", { chunkSize: 10, overlap: 2 })).toEqual([]);
  });

  it("rejects a non-positive chunkSize", () => {
    expect(() => chunkText("a b c", { chunkSize: 0, overlap: 0 })).toThrow(RangeError);
    expect(() => chunkText("a b c", { chunkSize: -5, overlap: 0 })).toThrow(RangeError);
  });

  it("rejects a negative overlap", () => {
    expect(() => chunkText("a b c", { chunkSize: 10, overlap: -1 })).toThrow(RangeError);
  });

  it("rejects overlap >= chunkSize (window would never advance)", () => {
    expect(() => chunkText("a b c", { chunkSize: 10, overlap: 10 })).toThrow(RangeError);
    expect(() => chunkText("a b c", { chunkSize: 10, overlap: 15 })).toThrow(RangeError);
  });
});
