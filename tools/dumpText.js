// tools/dumpText.js — THROWAWAY diagnostic.
//
// Purpose: dump the RAW pdfjs-dist text-layer token order for every fixture PDF,
// page-delimited, exactly as pdfjs linearises it (no x/y re-sorting). This is the
// "just look" step before designing the parser — see
// docs/WSS_Invoice_Parsing_Analysis.md and CLAUDE.md (PARSER ONLY phase).
//
// The real parser will reuse this headless-Node pdfjs setup (legacy build, worker
// disabled). Run: `node tools/dumpText.js`. Output: tools/_dump/<file>.txt
//
// NOTE: items are joined in pdfjs's native return order. We insert a newline when a
// token reports `hasEOL`, otherwise a space — so the dump shows pdfjs's own notion
// of line breaks without us imposing any geometric reconstruction.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

// Legacy build is the one that runs under Node.
import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";

// Headless Node: pdfjs v4 still insists on a worker source. Point it at the
// bundled legacy worker file (resolved as a filesystem path) so everything runs in
// a single Node process without a browser/Web Worker.
GlobalWorkerOptions.workerSrc = fileURLToPath(
  new URL(
    "../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url
  )
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures");
const OUT = join(__dirname, "_dump");

// Numeric sort so 2.pdf precedes 10.pdf (lexical would not).
function numericPdfSort(a, b) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b);
  return na - nb;
}

async function dumpOne(file) {
  const path = join(FIXTURES, file);
  const data = new Uint8Array(readFileSync(path));

  const doc = await getDocument({
    data,
    // Belt-and-braces flags for headless Node use.
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Join in pdfjs's native order. hasEOL -> newline, else space.
    let text = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue; // skip marked-content markers
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
    pages.push(text);
  }
  await doc.cleanup();

  // Surface the invoice number cheaply so prose maps back to the appendix table.
  const joined = pages.join("\n");
  const inv = joined.match(/INV-\d+/)?.[0] ?? "INV-?????";

  let out = `### SOURCE: ${file}   INVOICE: ${inv}   PAGES: ${doc.numPages}\n`;
  pages.forEach((text, i) => {
    out += `\n===== PAGE ${i + 1} / ${doc.numPages} =====\n`;
    out += text;
    if (!text.endsWith("\n")) out += "\n";
  });

  const outName = basename(file, ".pdf") + ".txt";
  writeFileSync(join(OUT, outName), out, "utf8");
  return { file, inv, pages: doc.numPages, bytes: out.length };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(FIXTURES)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort(numericPdfSort);

  if (files.length === 0) {
    console.error(`No PDFs found in ${FIXTURES}`);
    process.exit(1);
  }

  console.log(`Dumping ${files.length} PDF(s) -> ${OUT}\n`);
  for (const file of files) {
    const r = await dumpOne(file);
    console.log(
      `  ${r.file.padEnd(8)} ${r.inv.padEnd(10)} ${String(r.pages).padStart(2)}p  ${r.bytes} chars`
    );
  }
  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
