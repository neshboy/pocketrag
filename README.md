# PocketRAG

A single-command, embedded retrieval-augmented-generation (RAG) pipeline for
your local documents. Point it at a folder of `.txt`, `.md`, and `.pdf`
files; it chunks them, ranks them, and stores the index in one SQLite file
on disk — no external vector database service, no API key, no network
calls required.

## The problem

Most "build a RAG pipeline" tutorials start with "first, sign up for a
vector database and an embeddings API." That's a reasonable choice for a
production service, but it's a lot of moving parts for searching a folder
of your own notes, docs, or PDFs on your own machine. PocketRAG is the
opposite bet: `npm install`, run one `index` command, run one `query`
command, and you have relevant chunks with their source file and a score —
entirely local, entirely offline, backed by a single file you can delete,
copy, or `git ignore` like any other build artifact.

## What actually ships: classical BM25, not neural embeddings — and why

**PocketRAG v1 ships Okapi BM25** (a real, well-established classical
information-retrieval ranking algorithm — the same family of scoring
function Elasticsearch and Lucene use by default), **not neural sentence
embeddings.** This section explains why, honestly, rather than papering
over it.

The "Pocket" pitch requires working fully offline with no API key, which
means any embeddings would have to run via a *local* model. We genuinely
tried this: we installed `@xenova/transformers` and attempted to run
`Xenova/all-MiniLM-L6-v2` (a small, real, commonly-used local embedding
model) directly in this project's development environment. It did not
work:

- The default Node execution path loads a native `onnxruntime-node`
  addon. Loading it failed with `ERR_DLOPEN_FAILED` /
  `The specified module could not be found` on
  `onnxruntime_binding.node` — a real, environment-level failure (most
  likely a missing Visual C++ runtime dependency on this Windows machine),
  not a bug in our code.
- We then tried forcing a WASM execution device instead of the native
  addon (`pipeline(..., { device: "wasm" })`). That *also* failed with the
  exact same `ERR_DLOPEN_FAILED`, because this version of
  `@xenova/transformers` unconditionally `require()`s the native
  `onnxruntime-node` binding as part of its Node-environment detection at
  *import* time, before it ever looks at the requested device.

So: no neural embeddings actually run in this codebase, and we are not
claiming otherwise. What we shipped instead — Okapi BM25 over an inverted
index — is a completely legitimate, real, decades-old, well-understood
retrieval technique, correctly implemented (see `src/index/bm25.ts` and the
hand-verified test case in `tests/bm25.test.ts`), not a placeholder or a
mock. It scores each chunk against a query based on term frequency,
inverse document frequency, and chunk-length normalization, with no
external calls and no native/binary dependency at all.

**Neural embeddings are a natural v2 extension point**, not a dead end:
the storage layer already separates "how a chunk is retrieved" from "how
it's chunked and persisted," so a v2 could add a `vector BLOB` column
alongside the existing BM25 postings, populate it with a *verified-working*
local embedding backend (e.g. `@xenova/transformers` once a working native
or WASM ONNX runtime is confirmed on the target platform, or an
alternative pure-JS/WASM embedding runtime), and rank via cosine similarity
or a hybrid BM25+vector score — without touching the CLI surface or the
chunking logic.

## Install / quick start

```bash
git clone https://github.com/neshboy/pocketrag.git
cd pocketrag
npm install
npm run build

# Index a folder of .txt / .md / .pdf files
node dist/cli.js index ./my-notes

# Ask a question; get back ranked, sourced chunks
node dist/cli.js query "what did the Q3 report say about churn?"
```

To use the `pocketrag` command directly instead of `node dist/cli.js`:

```bash
npm link   # or: npm install -g .
pocketrag index ./my-notes
pocketrag query "what did the Q3 report say about churn?"
```

Example output:

```
$ pocketrag query "largest planet in the solar system"
#1  score=2.1043  ./my-notes/astronomy.txt [chunk 0]
    Jupiter is the largest planet in the solar system, a gas giant so massive
    that its mass is roughly two and a half times that of all the other...

#2  score=0.3120  ./my-notes/gardening.txt [chunk 1]
    ...
```

## How it works

1. **Walk** the target folder recursively for `.txt`, `.md`/`.markdown`,
   and `.pdf` files (dotfiles/dot-directories are skipped).
2. **Extract** text: plain UTF-8 read for text/Markdown; real PDF text
   extraction via `pdfjs-dist` (Mozilla's PDF.js, used in text-only mode —
   no canvas, no rendering, no native addon) for PDFs.
3. **Chunk** each document with a sliding window over whitespace-delimited
   word tokens: `chunkSize` tokens per chunk, `overlap` tokens shared
   between consecutive chunks, advancing by `chunkSize - overlap` tokens
   each step. The final chunk of a document is clamped to its end and may
   be shorter than `chunkSize` — that's expected, not a bug. See
   `src/chunker.ts` and `tests/chunker.test.ts` for exact, hand-checked
   boundary math.
4. **Tokenize** each chunk into normalized terms (lowercased,
   punctuation-stripped) for indexing.
5. **Persist** chunks, per-term postings (term frequency per chunk),
   per-term document frequencies, and corpus-wide stats (chunk count,
   average chunk length, BM25 parameters) to a single SQLite file via
   Node's **built-in** `node:sqlite` module — no native addon, no separate
   database process, no `better-sqlite3`/`sqlite3` npm dependency at all.
6. **Query**: tokenize the query the same way, look up every chunk sharing
   at least one term via the inverted index, score each with BM25, and
   return the top-K by score, descending.

Because the index is a real file on disk, `pocketrag query` never
re-reads, re-extracts, or re-chunks your source documents — it only reads
from the already-built SQLite index.

## CLI reference

```
pocketrag index <folder> [--db <path>] [--chunk-size <n>] [--overlap <n>] [--k1 <n>] [--b <n>]
pocketrag query "<question>" [--db <path>] [--top <n>]
pocketrag --help
pocketrag --version
```

| Flag           | Applies to | Default                       | Meaning                                  |
| -------------- | ---------- | ------------------------------ | ----------------------------------------- |
| `--db`         | both       | `./.pocketrag/index.sqlite`   | Path to the SQLite index file             |
| `--chunk-size` | `index`    | `200`                          | Word tokens per chunk                     |
| `--overlap`    | `index`    | `40`                           | Overlapping tokens between chunks         |
| `--k1`         | `index`    | `1.5`                          | BM25 term-frequency saturation parameter  |
| `--b`          | `index`    | `0.75`                         | BM25 document-length normalization        |
| `--top`        | `query`    | `5`                            | Number of ranked results to return        |

Re-running `pocketrag index` on the same `--db` path fully replaces that
index (see Limitations — there's no incremental/delta indexing in v1).

## Requirements

- Node.js **22.5+** (for the built-in `node:sqlite` module). Verified
  working with no extra flags on Node **24.19.0**. Some earlier Node 22.x
  builds gated `node:sqlite` behind an explicit `--experimental-sqlite`
  flag before it became enabled by default — pass that flag if you hit a
  "Cannot find module 'node:sqlite'" error on an older Node 22 release.
- No other runtime services, databases, or API keys.

## Development

```bash
npm install
npm run build         # compile TypeScript -> dist/
npm test              # run the real vitest suite
npm run typecheck      # strict TS check of src/
npm run typecheck:tests # strict TS check of src/ + tests/
```

Regenerating the PDF test fixture (only needed if you change the expected
fixture text in `scripts/generate-pdf-fixture.mjs`):

```bash
node scripts/generate-pdf-fixture.mjs
```

## Limitations

Being upfront about what v1 does *not* do:

- **No semantic/synonym matching.** BM25 matches on shared vocabulary. A
  query for "feline" will not match a chunk that only says "cat" unless
  both words happen to co-occur elsewhere. This is the fundamental
  trade-off of classical lexical IR vs. neural embeddings (see above).
- **"Tokens" are whitespace-delimited words**, not sub-word tokens from a
  real tokenizer (no BPE/WordPiece/tiktoken). `--chunk-size 200` means
  "200 words," not "200 model tokens" — close enough for local retrieval,
  but not an exact LLM context-budget count.
- **No incremental indexing.** `pocketrag index` rebuilds the whole index
  for the given `--db` path from scratch every time; there's no per-file
  diffing, change detection, or delete-on-removal.
- **PDF extraction is text-only — no OCR.** Scanned/image-only PDFs with
  no embedded text layer will extract empty or near-empty text.
- **No stemming, lemmatization, or stopword removal.** "running" and "run"
  are different terms to the index; very common words (English "the",
  "and", etc.) are indexed like any other term, which BM25's IDF weighting
  naturally discounts but doesn't eliminate.
- **Single embedded file, not a multi-user database.** No concurrent
  writers, no network protocol, no sharding — this is intentionally
  "pocket"-sized for a personal folder of documents, not a production
  search cluster.
- **Neural embeddings are not implemented in v1** (see above) — only
  documented as a natural v2 extension point.

## License

MIT — see [LICENSE](./LICENSE).
