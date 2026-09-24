// Generates the real PDF used by tests/pdf.test.ts. Run with:
//   node scripts/generate-pdf-fixture.mjs
// Regenerate this whenever the expected fixture text below changes.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const outPath = fileURLToPath(new URL("../tests/fixtures/sample.pdf", import.meta.url));

const lines = [
  "PocketRAG Fixture Document",
  "",
  "PocketRAG is a local retrieval augmented generation pipeline.",
  "It indexes plain text, Markdown, and PDF files entirely offline.",
  "The quick brown fox jumps over the lazy dog near the riverbank.",
  "Retrieval uses Okapi BM25 ranking over a SQLite-backed inverted index.",
];

const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([612, 792]);
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

let y = 720;
for (const line of lines) {
  page.drawText(line, { x: 50, y, size: 14, font });
  y -= 24;
}

const bytes = await pdfDoc.save();
await writeFile(outPath, bytes);
console.log(`Wrote ${bytes.length} bytes to ${path.relative(process.cwd(), outPath)}`);
