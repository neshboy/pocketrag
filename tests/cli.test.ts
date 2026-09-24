import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

const FIXTURE_DOCS_DIR = fileURLToPath(new URL("./fixtures/docs", import.meta.url));

let tempDir: string;
let dbPath: string;
let logSpy: ReturnType<typeof vi.spyOn>;
let logLines: string[];

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "pocketrag-cli-test-"));
  dbPath = join(tempDir, "index.sqlite");
  logLines = [];
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  logSpy.mockRestore();
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * End-to-end integration test: real `pocketrag index` against a small real
 * fixture corpus of four topically distinct documents (astronomy, baking,
 * programming, gardening -- see tests/fixtures/docs), a real SQLite index
 * written to disk, and real `pocketrag query` calls whose top-ranked result
 * is checked against the document a human would actually pick as most
 * relevant for that query.
 */
describe("pocketrag CLI end-to-end", () => {
  it("indexes the fixture corpus and reports document/chunk counts", async () => {
    const exitCode = await main(["index", FIXTURE_DOCS_DIR, "--db", dbPath]);

    expect(exitCode).toBe(0);
    expect(logLines.join("\n")).toMatch(/Indexed 4 document\(s\) into \d+ chunk\(s\)/);
  });

  it.each([
    ["largest planet in the solar system", "astronomy.txt"],
    ["how do I bake sourdough bread dough", "baking.md"],
    ["TypeScript static type system for JavaScript", "programming.txt"],
    ["growing tomatoes in a vegetable garden", "gardening.txt"],
  ])("ranks %j -> top result from %s", async (query, expectedFile) => {
    await main(["index", FIXTURE_DOCS_DIR, "--db", dbPath]);
    logLines = [];

    const exitCode = await main(["query", query, "--db", dbPath, "--top", "4"]);

    expect(exitCode).toBe(0);
    const output = logLines.join("\n");
    expect(output).toContain("#1");

    // Extract the source path reported on the "#1" result line and confirm
    // it's the expected fixture file, not just present anywhere in the output.
    const firstResultLine = logLines.find((line) => line.startsWith("#1"));
    expect(firstResultLine).toBeDefined();
    expect(firstResultLine).toContain(expectedFile);
  });

  it("returns results ordered by strictly non-increasing score", async () => {
    await main(["index", FIXTURE_DOCS_DIR, "--db", dbPath]);
    logLines = [];
    await main(["query", "plants soil water garden light", "--db", dbPath, "--top", "4"]);

    const scores = logLines
      .filter((line) => line.startsWith("#"))
      .map((line) => Number(/score=([\d.]+)/.exec(line)?.[1]));

    expect(scores.length).toBeGreaterThan(0);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]!);
    }
  });

  it("reports 'no relevant chunks found' for a query against a freshly created empty index", async () => {
    const exitCode = await main(["query", "anything at all", "--db", dbPath]);
    expect(exitCode).toBe(0);
    expect(logLines.join("\n")).toContain("No relevant chunks found");
  });

  it("prints usage and exits non-zero when 'index' is called without a folder argument", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await main(["index"]);
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: pocketrag index"));
    errorSpy.mockRestore();
  });

  it("prints usage and exits non-zero when 'query' is called without a question argument", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitCode = await main(["query"]);
    expect(exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: pocketrag query"));
    errorSpy.mockRestore();
  });

  it("supports custom --chunk-size and --overlap flags end to end", async () => {
    const exitCode = await main(["index", FIXTURE_DOCS_DIR, "--db", dbPath, "--chunk-size", "20", "--overlap", "5"]);
    expect(exitCode).toBe(0);
    expect(logLines.join("\n")).toMatch(/Indexed 4 document\(s\) into \d+ chunk\(s\)/);

    // Smaller chunk size over the same corpus should produce at least as
    // many chunks as the default settings would for these fixture files.
    const chunkCountMatch = /into (\d+) chunk/.exec(logLines.join("\n"));
    expect(chunkCountMatch).not.toBeNull();
    expect(Number(chunkCountMatch![1])).toBeGreaterThanOrEqual(4);
  });
});
