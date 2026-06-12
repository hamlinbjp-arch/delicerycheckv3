// tools/checkMatch.js — THROWAWAY validator for the matching core (src/lib/utils.js).
//
// Parses the real POS export + a fixture invoice and exercises matchItem/trackingKey
// across the required cases, asserting against verified ground truth. Exits non-zero
// on any mismatch. Mirrors tools/checkIdealpos.js / tools/runAll.js.
//
// Run: `node tools/checkMatch.js`

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import parseIdealpos from "../src/lib/parseIdealpos.js";
import parsePDF from "../src/lib/parsePDF.js";
import { matchItem, trackingKey } from "../src/lib/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POS = join(__dirname, "..", "fixtures", "POS7_6_26.txt");
const INVOICE = join(__dirname, "..", "fixtures", "2.pdf"); // INV-17875

const checks = [];
function ok(name, pass, detail = "") {
  checks.push({ name, pass, detail });
}
const eq = (name, got, want) =>
  ok(name, got === want, `got ${JSON.stringify(got)}${got === want ? "" : ` want ${JSON.stringify(want)}`}`);

const { rows, byCode, duplicateCodes } = parseIdealpos(readFileSync(POS, "utf8"));

// 1) Clean auto-match + WSS->POS cost cross-check.
{
  const m = matchItem("216915", rows, byCode, duplicateCodes, {});
  eq("auto: 216915 status", m.status, "matched");
  eq("auto: 216915 via", m.via, "auto");
  eq("auto: 216915 key", m.key, "216915");
  eq("auto: 216915 lstcst", m.row?.lstcst, 57.19);
}

// 2) Duplicate code -> ambiguous with 2 candidates.
{
  const m = matchItem("3030", rows, byCode, duplicateCodes, {});
  eq("dup: 3030 status", m.status, "ambiguous");
  eq("dup: 3030 candidates", m.candidates?.length, 2);
}

// 3) Manual link (clean) wins: link an otherwise-unmatched cross-supplier code.
{
  const m = matchItem("210241", rows, byCode, duplicateCodes, { "210241": { key: "216915" } });
  eq("link: 210241->216915 status", m.status, "matched");
  eq("link: 210241->216915 via", m.via, "link");
  eq("link: 210241->216915 key", m.key, "216915");
  eq("link: 210241->216915 desc", m.row?.desc, "SATISFYER PRO 2+");

  // Link takes precedence over a code that WOULD auto-match to its own row.
  const m2 = matchItem("204270", rows, byCode, duplicateCodes, { "204270": { key: "216915" } });
  eq("link beats auto: key", m2.key, "216915");
  eq("link beats auto: via", m2.via, "link");
}

// 4) Manual link (keyless / snapshot) resolves a blank-SUPPCODE row by snapshot.
{
  const links = { "20193": { key: "lnk_test", snapshot: { suppcode: "", desc: "Adult Misc", price: 0 } } };
  const m = matchItem("20193", rows, byCode, duplicateCodes, links);
  eq("snapshot: status", m.status, "matched");
  eq("snapshot: via", m.via, "link");
  eq("snapshot: key", m.key, "lnk_test");
  eq("snapshot: row desc", m.row?.desc, "Adult Misc");
  eq("snapshot: row suppcode", m.row?.suppcode, "");
}

// 5) Unmatched + stale link.
{
  eq("unmatched: 210241", matchItem("210241", rows, byCode, duplicateCodes, {}).status, "unmatched");
  eq("unmatched: 999999", matchItem("999999", rows, byCode, duplicateCodes, {}).status, "unmatched");
  const stale = matchItem("5", rows, byCode, duplicateCodes, { "5": { key: "NO_SUCH_CODE" } });
  eq("stale link: status", stale.status, "unmatched");
  ok("stale link: has reason", typeof stale.reason === "string", stale.reason || "");
}

// 6) trackingKey directly.
{
  eq("trackingKey clean (216915)", trackingKey(byCode.get("216915")[0], duplicateCodes), "216915");
  ok("trackingKey dup (3030) -> lnk_", trackingKey(byCode.get("3030")[0], duplicateCodes).startsWith("lnk_"));
  const blank = rows.find((r) => r.suppcode === "");
  ok("trackingKey blank -> lnk_", trackingKey(blank, duplicateCodes).startsWith("lnk_"));
}

// --- report ---
console.log("matching core checks\n");
for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name.padEnd(30)} ${c.detail}`);

// Whole-invoice sanity: matched / ambiguous / unmatched over INV-17875's products.
const inv = await parsePDF(new Uint8Array(readFileSync(INVOICE)));
const tally = { matched: 0, ambiguous: 0, unmatched: 0 };
for (const it of inv.items) tally[matchItem(it.invoiceCode, rows, byCode, duplicateCodes, {}).status]++;
console.log(
  `\n${inv.meta.invoiceNumber}: ${inv.items.length} products -> ` +
  `${tally.matched} matched, ${tally.ambiguous} ambiguous, ${tally.unmatched} unmatched ` +
  `(a non-trivial unmatched share is expected/normal — cross-supplier codes).`
);

const failed = checks.filter((c) => !c.pass);
console.log(failed.length === 0 ? "\nRESULT: all checks pass." : `\nRESULT: ${failed.length} check(s) FAILED.`);
process.exit(failed.length === 0 ? 0 : 1);
