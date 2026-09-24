import { splitWords } from "./tokenize.js";
import type { ChunkOptions, TextChunk } from "./types.js";

/**
 * Split `text` into overlapping chunks using a sliding window over word
 * tokens (see {@link splitWords}).
 *
 * Given `chunkSize` tokens per window and `overlap` tokens shared between
 * consecutive windows, the window start advances by
 * `step = chunkSize - overlap` tokens each iteration:
 *
 *   window 0: tokens [0, chunkSize)
 *   window 1: tokens [step, step + chunkSize)
 *   window 2: tokens [2*step, 2*step + chunkSize)
 *   ...
 *
 * The final window is clamped to the end of the token stream and may
 * therefore be shorter than `chunkSize` (this is expected and correct — it's
 * the tail of the document, not a bug). Chunk text is reconstructed by
 * re-joining the token slice with single spaces, so original inter-token
 * whitespace (multiple spaces, tabs, newlines) is normalized, but token
 * order and content are preserved exactly.
 *
 * @throws {RangeError} if chunkSize is not a positive integer, if overlap is
 *   negative, or if overlap >= chunkSize (which would either stall or reverse
 *   window progress).
 */
export function chunkText(text: string, options: ChunkOptions): TextChunk[] {
  const { chunkSize, overlap } = options;

  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError(`chunkSize must be a positive integer, got ${chunkSize}`);
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new RangeError(`overlap must be a non-negative integer, got ${overlap}`);
  }
  if (overlap >= chunkSize) {
    throw new RangeError(
      `overlap (${overlap}) must be smaller than chunkSize (${chunkSize}), or the sliding window never advances`,
    );
  }

  const tokens = splitWords(text);
  if (tokens.length === 0) {
    return [];
  }

  const step = chunkSize - overlap;
  const chunks: TextChunk[] = [];

  let start = 0;
  let chunkIndex = 0;
  for (;;) {
    const end = Math.min(start + chunkSize, tokens.length);
    chunks.push({
      chunkIndex,
      text: tokens.slice(start, end).join(" "),
      startToken: start,
      endToken: end,
    });
    chunkIndex += 1;
    if (end >= tokens.length) {
      break;
    }
    start += step;
  }

  return chunks;
}
