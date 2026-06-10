// tools/checkIdealpos.js — THROWAWAY ground-truth validator for parseIdealpos.js.
//
// Runs the ingest over the real export (fixtures/POS7_6_26.txt) and asserts the
// counts confirmed against docs/WSS_Invoice_Parsing_Analysis.md §6/§9 and verified
// directly from the file. Exits non-zero on any mismatch, so it doubles as a
// regression gate. Mirrors tools/runAll.js.
//
// Run: `node tools/checkIdealpos.js`

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import parseIdealpos from "../src/lib/parseIdealpos.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "..", "fixtures", "POS7_6_26.txt");

// Ground truth (analysis appendix + verified from the file this turn).
const EXPECT = {
  recordCount: 7276,
  blankCount: 912,
  distinctCodeCount: 6348,
  duplicateCodeCount: 13,
  numericCodeRows: 3770,
};

const checks = [];
const ok = (name, got, want) => {
  const pass = got === want;
  checks.push({ name, got, want, pass });
  return pass;
};

const text = readFileSync(FIXTURE, "utf8");
const r = parseIdealpos(text);

// --- structural ground-truth ---
ok("recordCount", r.stats.recordCount, EXPECT.recordCount);
ok("blankCount", r.stats.blankCount, EXPECT.blankCount);
ok("distinctCodeCount", r.stats.distinctCodeCount, EXPECT.distinctCodeCount);
ok("duplicateCodeCount", r.stats.duplicateCodeCount, EXPECT.duplicateCodeCount);
ok("duplicateCodes.size", r.duplicateCodes.size, EXPECT.duplicateCodeCount);
ok("numericCodeRows", r.stats.numericCodeRows, EXPECT.numericCodeRows);
ok("errors", r.errors.length, 0);

// --- normalisation spot-checks ---
const c35116 = r.byCode.get("35116"); // proves leading padding was trimmed
ok("code 35116 present (trim)", c35116 ? c35116.length : 0, 1);
if (c35116) {
  ok("35116 desc", c35116[0].desc, "SS TS SPICED WHISKEY LIQ 50ML");
  ok("35116 price", c35116[0].price, 12.99);
  ok("35116 lstcst", c35116[0].lstcst, 7.49);
}
ok("dup code 3030 -> 2 rows", r.byCode.get("3030")?.length ?? 0, 2);
ok("blank rows have suppcode ''", r.rows.filter((x) => x.suppcode === "").length, EXPECT.blankCount);

// --- report ---
console.log("parseIdealpos ground-truth check\n");
for (const c of checks) {
  console.log(`  ${c.pass ? "✓" : "✗"} ${c.name.padEnd(26)} got ${JSON.stringify(c.got)}${c.pass ? "" : `  want ${JSON.stringify(c.want)}`}`);
}

console.log("\nDuplicated codes (13):", [...r.duplicateCodes].sort().join(", "));
const numeric = [...r.byCode.keys()].filter((c) => /^\d+$/.test(c)).length;
const alpha = r.byCode.size - numeric;
console.log(`Code breakdown: ${numeric} distinct numeric, ${alpha} distinct alphanumeric, ${r.blankCount} blank rows.`);
console.log(`Rows with LSTCST = 0 (pre-pop will skip later): ${r.rows.filter((x) => x.lstcst === 0).length}`);

const failed = checks.filter((c) => !c.pass);
console.log(failed.length === 0 ? "\nRESULT: all checks pass." : `\nRESULT: ${failed.length} check(s) FAILED.`);
process.exit(failed.length === 0 ? 0 : 1);
