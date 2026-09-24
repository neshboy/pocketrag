import { readFile } from "node:fs/promises";
// pdfjs-dist's "legacy" build runs in Node without a DOM/worker/canvas.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";

/**
 * Extract plain text from a PDF file using `pdfjs-dist` (Mozilla's own
 * PDF.js, published standalone) in text-only mode: no canvas, no rendering,
 * no native addon — just the real text-content extraction pdf.js performs
 * for its own "select all / copy text" feature.
 *
 * We initially tried `pdf-parse@1.1.4` (a thin, unmaintained wrapper around
 * a several-years-old bundled copy of pdf.js) but its bundled decoder
 * failed on real, valid PDFs produced by `pdf-lib`
 * (`FormatError: Unknown compression method in flate stream`), which is a
 * bug in that stale vendored copy, not in our fixture. Depending on pdf.js
 * directly avoids that: it's actively maintained, has no dependencies of
 * its own, and correctly decodes the same fixture (see
 * `tests/pdf.test.ts`).
 */
export async function extractPdfFile(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  const loadingTask = getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: VerbosityLevel.ERRORS,
  });

  try {
    const doc = await loadingTask.promise;
    const pageTexts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
      pageTexts.push(pageText);
    }
    return pageTexts.join("\n");
  } finally {
    await loadingTask.destroy();
  }
}
