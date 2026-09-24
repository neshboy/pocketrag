#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { indexFolder } from "./indexer.js";
import { queryIndex } from "./query.js";
import { DEFAULT_BM25_PARAMS, DEFAULT_CHUNK_OPTIONS } from "./types.js";

const DEFAULT_DB_PATH = path.join(process.cwd(), ".pocketrag", "index.sqlite");

function readVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  console.log(`PocketRAG - offline BM25 retrieval over your local documents

Usage:
  pocketrag index <folder> [--db <path>] [--chunk-size <n>] [--overlap <n>]
  pocketrag query "<question>" [--db <path>] [--top <n>]
  pocketrag --help
  pocketrag --version

Options:
  --db <path>          Path to the SQLite index file (default: ./.pocketrag/index.sqlite)
  --chunk-size <n>      Tokens per chunk when indexing (default: ${DEFAULT_CHUNK_OPTIONS.chunkSize})
  --overlap <n>         Overlapping tokens between consecutive chunks (default: ${DEFAULT_CHUNK_OPTIONS.overlap})
  --k1 <n>              BM25 k1 parameter (default: ${DEFAULT_BM25_PARAMS.k1})
  --b <n>               BM25 b parameter (default: ${DEFAULT_BM25_PARAMS.b})
  --top <n>             Number of results to return for a query (default: 5)
`);
}

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string>;
}

/** Minimal, dependency-free CLI flag parser: `--name value` or boolean `--name`. */
export function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(name, next);
        i++;
      } else {
        flags.set(name, "true");
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags };
}

function numberFlag(flags: Map<string, string>, name: string, fallback: number): number {
  const raw = flags.get(name);
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be a number, got "${raw}"`);
  }
  return parsed;
}

/**
 * CLI entry point logic, factored out from process.argv/process.exit so it
 * can be exercised directly (with real file I/O and a real SQLite index) in
 * integration tests without spawning a subprocess.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return command === undefined ? 1 : 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(readVersion());
    return 0;
  }

  const { positionals, flags } = parseArgs(rest);
  const dbPath = flags.get("db") ?? DEFAULT_DB_PATH;

  if (command === "index") {
    const folder = positionals[0];
    if (!folder) {
      console.error("Usage: pocketrag index <folder> [--db <path>] [--chunk-size <n>] [--overlap <n>]");
      return 1;
    }

    const chunkOptions = {
      chunkSize: numberFlag(flags, "chunk-size", DEFAULT_CHUNK_OPTIONS.chunkSize),
      overlap: numberFlag(flags, "overlap", DEFAULT_CHUNK_OPTIONS.overlap),
    };
    const bm25Params = {
      k1: numberFlag(flags, "k1", DEFAULT_BM25_PARAMS.k1),
      b: numberFlag(flags, "b", DEFAULT_BM25_PARAMS.b),
    };

    const result = await indexFolder(folder, dbPath, { chunkOptions, bm25Params });
    console.log(`Indexed ${result.documentsIndexed} document(s) into ${result.chunksIndexed} chunk(s).`);
    console.log(`Index stored at ${result.dbPath}`);
    if (result.errors.length > 0) {
      console.warn(`${result.errors.length} file(s) failed to extract:`);
      for (const e of result.errors) {
        console.warn(`  ${e.path}: ${e.error.message}`);
      }
    }
    return 0;
  }

  if (command === "query") {
    const question = positionals[0];
    if (!question) {
      console.error('Usage: pocketrag query "<question>" [--db <path>] [--top <n>]');
      return 1;
    }

    const topK = numberFlag(flags, "top", 5);
    const results = queryIndex(dbPath, question, topK);

    if (results.length === 0) {
      console.log("No relevant chunks found. Have you run `pocketrag index <folder>` yet?");
      return 0;
    }

    results.forEach((result, i) => {
      console.log(`#${i + 1}  score=${result.score.toFixed(4)}  ${result.sourcePath} [chunk ${result.chunkIndex}]`);
      const preview = result.text.length > 300 ? `${result.text.slice(0, 300)}...` : result.text;
      console.log(`    ${preview}`);
      console.log("");
    });
    return 0;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
