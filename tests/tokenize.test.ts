import { describe, expect, it } from "vitest";
import { normalizeTerm, splitWords, tokenizeForIndex } from "../src/tokenize.js";

describe("splitWords", () => {
  it("splits on any whitespace and preserves original token text", () => {
    expect(splitWords("The Quick,  Brown\tFox\njumps!")).toEqual(["The", "Quick,", "Brown", "Fox", "jumps!"]);
  });

  it("returns an empty array for empty or whitespace-only input", () => {
    expect(splitWords("")).toEqual([]);
    expect(splitWords("   \n\t  ")).toEqual([]);
  });
});

describe("normalizeTerm", () => {
  it("lowercases and strips leading/trailing punctuation", () => {
    expect(normalizeTerm("Cats,")).toBe("cats");
    expect(normalizeTerm("\"quoted\"")).toBe("quoted");
    expect(normalizeTerm("(parenthetical)")).toBe("parenthetical");
    expect(normalizeTerm("well-established")).toBe("well-established"); // internal punctuation kept
  });

  it("returns an empty string for pure punctuation", () => {
    expect(normalizeTerm("---")).toBe("");
    expect(normalizeTerm("...")).toBe("");
  });
});

describe("tokenizeForIndex", () => {
  it("normalizes and drops empty tokens produced by pure punctuation", () => {
    expect(tokenizeForIndex("The cat sat -- on the mat.")).toEqual([
      "the",
      "cat",
      "sat",
      "on",
      "the",
      "mat",
    ]);
  });

  it("is case-insensitive for matching purposes", () => {
    expect(tokenizeForIndex("Jupiter JUPITER jupiter")).toEqual(["jupiter", "jupiter", "jupiter"]);
  });
});
