/**
 * Tokenization utilities used by both the chunker and the BM25 index.
 *
 * PocketRAG deliberately avoids a heavyweight tokenizer dependency (e.g. a
 * BPE/tiktoken-style tokenizer). "Tokens" here means whitespace-delimited
 * word tokens, which is a simple, dependency-free, and fully deterministic
 * proxy for the sub-word tokens a neural tokenizer would produce. This is
 * documented explicitly in the README as a design tradeoff.
 */

/**
 * Split raw text into whitespace-delimited word tokens, preserving each
 * token's original text (casing, punctuation, etc.) so chunks can be
 * reconstructed losslessly via `tokens.join(" ")`.
 */
export function splitWords(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  return trimmed.split(/\s+/);
}

/**
 * Normalize a single word token into a BM25 index term: lowercase, and with
 * leading/trailing punctuation stripped. Returns an empty string if nothing
 * meaningful remains (e.g. the token was pure punctuation), which callers
 * should filter out.
 */
export function normalizeTerm(word: string): string {
  return word
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
}

/**
 * Tokenize a chunk of text into normalized BM25 index terms (lowercase,
 * punctuation-stripped, empty tokens dropped). This is intentionally more
 * aggressive than {@link splitWords} because it's used purely for matching,
 * not for reconstructing display text.
 */
export function tokenizeForIndex(text: string): string[] {
  return splitWords(text)
    .map(normalizeTerm)
    .filter((term) => term.length > 0);
}
