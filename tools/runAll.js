// tools/runAll.js — THROWAWAY batch validator.
//
// Runs src/lib/parsePDF.js (unchanged) over every PDF in ./fixtures/ and prints one
// table row per invoice plus a class distribution, for automated validation.
//
// Two independent notions of "correct" are kept separate:
//   1. Internal consistency — computed Subtotal vs the Subtotal the parser itself
//      extracted (the reconciliation gap). Proves the math is consistent.
//   2. Independent ground truth — extracted Subtotal/GST/Total cross-checked against
//      the analysis appendix totals table (a source the parser never sees). A
//      disagreement here means the HEADER parse is wrong.
// Product COUNT has no ground truth (no printed line-count) and is NOT validated.
//
// Run: `node tools/runAll.js`  (exits non-zero if anything looks off.)

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import parsePDF from "../src/lib/parsePDF.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "..", "fixtures");

// Independent ground truth: the printed totals from the analysis appendix
// (docs/WSS_Invoice_Parsing_Analysis.md §Appendix). The parser never reads this.
// [Subtotal, GST, Total]
const APPENDIX = {
  "INV-16814": [2571.33, 389.32, 2960.65],
  "INV-17237": [3872.74, 581.04, 4453.78],
  "INV-17405": [3091.01, 463.68, 3554.69],
  "INV-17457": [4213.11, 632.09, 4845.20],
  "INV-17663": [2832.02, 426.28, 3258.30],
  "INV-17708": [1717.80, 257.67, 1975.47],
  "INV-17764": [2774.70, 416.25, 3190.95],
  "INV-17770": [2477.28, 371.68, 2848.96],
  "INV-17874": [1662.97, 249.43, 1912.40],
  "INV-17875": [3094.46, 464.29, 3558.75],
};

const cents = (n) => (n == null ? null : Math.round(n * 100));
const eqMoney = (a, b) => a != null && b != null && cents(a) === cents(b);
const mark = (ok) => (ok ? "✓" : "✗");

function numericPdfSort(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  return Number.isNaN(na) || Number.isNaN(nb) ? a.localeCompare(b) : na - nb;
}

function pad(s, n) { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }

const CLASSES = [
  "product", "notSupplied", "shipping", "storeCredit",
  "review", "chrome", "total", "pageHeader", "naMarker",
];

async function main() {
  const files = readdirSync(FIXTURES)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort(numericPdfSort);

  // Header row.
  console.log(
    pad("file", 8) + pad("invoice", 11) + padL("prod", 5) + padL("rev", 4) +
    padL("computed", 11) + padL("printed", 11) + padL("gap", 7) + "  " +
    pad("recon", 6) + padL("perLn", 6) + "  appendix(S/G/T)"
  );
  console.log("-".repeat(86));

  const distRows = [];
  let problems = 0;

  for (const file of files) {
    const data = new Uint8Array(readFileSync(join(FIXTURES, file)));
    try {
      const r = await parsePDF(data);
      const m = r.meta, rc = r.reconciliation;
      const exp = APPENDIX[m.invoiceNumber];

      // Independent cross-check vs appendix (header parse correctness).
      const subOk = exp ? eqMoney(m.printedSubtotal, exp[0]) : null;
      const gstOk = exp ? eqMoney(m.printedGST, exp[1]) : null;
      const totOk = exp ? eqMoney(m.printedTotal, exp[2]) : null;
      const appStr = exp ? `${mark(subOk)} ${mark(gstOk)} ${mark(totOk)}` : "(no appendix entry)";

      const reconBad = rc.status !== "pass";
      const reviewBad = r.reviewRows.length > 0;
      const perLnBad = rc.perLineFailures.length > 0;
      const appendixBad = exp && !(subOk && gstOk && totOk);
      if (reconBad || reviewBad || perLnBad || appendixBad) problems++;

      console.log(
        pad(file, 8) + pad(m.invoiceNumber, 11) +
        padL(r.items.length, 5) + padL(r.reviewRows.length, 4) +
        padL(rc.computedSubtotal.toFixed(2), 11) +
        padL(rc.printedSubtotal.toFixed(2), 11) +
        padL(rc.gap.toFixed(2), 7) + "  " +
        pad(rc.status, 6) + padL(rc.perLineFailures.length, 6) + "  " + appStr
      );

      // Class distribution from debug.classifications.
      const dist = Object.fromEntries(CLASSES.map((c) => [c, 0]));
      for (const c of r.debug.classifications) {
        if (dist[c.class] != null) dist[c.class] += 1;
      }
      distRows.push({ file, invoice: m.invoiceNumber, dist, r });
    } catch (err) {
      problems++;
      console.log(pad(file, 8) + `HARD STOP  ${err.code || err.name}: ${err.message}`);
    }
  }

  // Class distribution block.
  console.log("\nClass distribution per invoice:");
  console.log(
    pad("invoice", 11) + CLASSES.map((c) => padL(c.slice(0, 8), 9)).join("")
  );
  console.log("-".repeat(11 + CLASSES.length * 9));
  for (const { invoice, dist } of distRows) {
    console.log(pad(invoice, 11) + CLASSES.map((c) => padL(dist[c], 9)).join(""));
  }

  // Surface any review rows verbatim (should be none).
  const withReview = distRows.filter((d) => d.r.reviewRows.length > 0);
  if (withReview.length) {
    console.log("\nReview rows (need attention):");
    for (const { invoice, r } of withReview) {
      for (const rr of r.reviewRows) console.log(`  ${invoice}: [${rr.reason}] ${rr.rawText}`);
    }
  } else {
    console.log("\nReview rows: none across all invoices.");
  }

  console.log(
    problems === 0
      ? "\nRESULT: all invoices reconcile, no review rows, no per-line failures, totals match appendix."
      : `\nRESULT: ${problems} invoice(s) with a problem — see rows above.`
  );
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
