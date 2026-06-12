// src/lib/parseIdealpos.js
//
// Idealpos POS export ingest. Step 1 of the post-parser build: parse + normalise +
// compute the identity sets (blank / duplicated SUPPCODE) the rest of the app keys
// off. See docs/DeliveryCheck_Architecture_v3.md §"Idealpos Export" and
// §"Tracking key". Matching (utils.js) and price-history pre-population consume what
// this produces; this module does NOT match, generate linkIds, or touch persistence.
//
// Discipline mirrors src/lib/parsePDF.js: normalise once, surface problems as
// structured data, never silently drop a row.
//
// Environment-agnostic: takes the CSV text as a string (Node reads the file; the
// browser reads a File via FileReader), so there's no worker/shim setup.
//
// Output shape (to FREEZE after validation, like the parser):
//   { rows, byCode, duplicateCodes, blankCount, stats, errors }

import Papa from "papaparse";

const EXPECTED_COLUMNS = ["SUPPCODE", "DESC", "PRICE1", "LSTCST"];

// Parse a quoted 2dp money string to a Number. The export has no commas/parens
// (unlike the invoice side), so this is simple; null if unparseable (surfaced, not
// silently coerced to 0 — 0 is a real value here).
function parseNum(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number.parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

export default function parseIdealpos(csvText) {
  const parsed = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const errors = [];

  // Surface papaparse's own errors (malformed rows etc.) — never swallow them.
  for (const e of parsed.errors) {
    errors.push({ row: e.row, reason: `papaparse: ${e.code} ${e.message}` });
  }

  // Fail loud on export-format drift rather than mis-mapping columns.
  const cols = parsed.meta.fields ?? [];
  const headerOk =
    cols.length === EXPECTED_COLUMNS.length &&
    EXPECTED_COLUMNS.every((c, i) => cols[i] === c);
  if (!headerOk) {
    errors.push({
      row: 0,
      reason: `unexpected header columns: got [${cols.join(", ")}], expected [${EXPECTED_COLUMNS.join(", ")}]`,
    });
  }

  const rows = [];
  const byCode = new Map(); // trimmed non-blank suppcode -> row[]
  let blankCount = 0;

  parsed.data.forEach((raw, i) => {
    // Normalise: trim suppcode (it is left-space-padded in the export) and desc.
    const suppcode = (raw.SUPPCODE ?? "").trim();
    const desc = (raw.DESC ?? "").trim();
    const price = parseNum(raw.PRICE1);
    const lstcst = parseNum(raw.LSTCST);

    if (price == null) errors.push({ row: i + 2, reason: `unparseable PRICE1: ${JSON.stringify(raw.PRICE1)}` });
    if (lstcst == null) errors.push({ row: i + 2, reason: `unparseable LSTCST: ${JSON.stringify(raw.LSTCST)}` });

    const row = { suppcode, desc, price, lstcst };
    rows.push(row);

    if (suppcode === "") {
      blankCount += 1;
    } else {
      const bucket = byCode.get(suppcode);
      if (bucket) bucket.push(row);
      else byCode.set(suppcode, [row]);
    }
  });

  // Identity sets. A code is "keyless" if blank (handled above) or duplicated; a
  // duplicated code is one whose trimmed value maps to >1 row. utils.js uses these
  // so the clean/keyless tracking-key decision is O(1) per item.
  const duplicateCodes = new Set();
  let numericCodeRows = 0;
  for (const [code, bucket] of byCode) {
    if (bucket.length > 1) duplicateCodes.add(code);
    if (/^\d+$/.test(code)) numericCodeRows += bucket.length;
  }

  const stats = {
    recordCount: rows.length,
    blankCount,
    distinctCodeCount: byCode.size,
    duplicateCodeCount: duplicateCodes.size,
    numericCodeRows,
  };

  return { rows, byCode, duplicateCodes, blankCount, stats, errors };
}
