// tools/checkPriceHistory.js — THROWAWAY validator for the price-history functions
// (src/lib/utils.js: suggestedSellPrice, detectPriceChange, prePopulatePriceHistory).
//
// Asserts against the analysis doc's worked examples and the real export. Exits
// non-zero on any mismatch. Mirrors tools/checkMatch.js.
//
// Run: `node tools/checkPriceHistory.js`

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import parseIdealpos from "../src/lib/parseIdealpos.js";
import { suggestedSellPrice, detectPriceChange, prePopulatePriceHistory } from "../src/lib/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POS = join(__dirname, "..", "fixtures", "POS7_6_26.txt");

const checks = [];
function ok(name, pass, detail = "") {
  checks.push({ name, pass, detail });
}
const eq = (name, got, want) =>
  ok(name, got === want, `got ${JSON.stringify(got)}${got === want ? "" : ` want ${JSON.stringify(want)}`}`);

// --- suggestedSellPrice: architecture's worked examples + guards ---
eq("ssp 14.96", suggestedSellPrice(14.96), 37.99);
eq("ssp 10.61", suggestedSellPrice(10.61), 26.99);
eq("ssp 9.30", suggestedSellPrice(9.3), 23.99);
eq("ssp 6.25", suggestedSellPrice(6.25), 15.99);
eq("ssp explicit args 14.96,0.60,0.99", suggestedSellPrice(14.96, 0.6, 0.99), 37.99);
eq("ssp guard 0", suggestedSellPrice(0), null);
eq("ssp guard -5", suggestedSellPrice(-5), null);

const { rows, byCode, duplicateCodes } = parseIdealpos(readFileSync(POS, "utf8"));

// --- detectPriceChange against a controlled history ---
const ph = { "216915": { lastCost: 10.0, lastSellPrice: 99.0, lastInvoice: "x", lastDate: "2026-01-01" } };
{
  // cost differs (14.96 vs 10.0) -> changed, suggested 37.99
  const r = detectPriceChange("216915", 14.96, ph, {}, byCode, duplicateCodes);
  eq("dpc changed", r.changed, true);
  eq("dpc previousCost", r.previousCost, 10.0);
  eq("dpc previousSellPrice", r.previousSellPrice, 99.0);
  eq("dpc suggested", r.suggestedSellPrice, 37.99);
}
{
  // same cost in cents -> unchanged
  const r = detectPriceChange("216915", 10.0, ph, {}, byCode, duplicateCodes);
  eq("dpc same cost -> unchanged", r.changed, false);
}
{
  // manual link key path: 210241 (absent from POS) linked to 216915's key
  const r = detectPriceChange("210241", 14.96, ph, { "210241": { key: "216915" } }, byCode, duplicateCodes);
  eq("dpc via link key", r.changed, true);
  eq("dpc via link suggested", r.suggestedSellPrice, 37.99);
}
{
  // unmatched code -> no key -> unchanged
  eq("dpc unmatched -> unchanged", detectPriceChange("999999", 50, ph, {}, byCode, duplicateCodes).changed, false);
}
{
  // matched but no history entry (95206 is clean, not in ph) -> first-seen, unchanged
  eq("dpc first-seen -> unchanged", detectPriceChange("95206", 6.16, ph, {}, byCode, duplicateCodes).changed, false);
}

// --- prePopulatePriceHistory against the real export ---
{
  const r = prePopulatePriceHistory(rows, duplicateCodes);
  eq("prepop seeded", r.seeded, 6295);
  eq("prepop seeded+skipped == rows", r.seeded + r.skipped, rows.length);
  eq("prepop 216915 lastCost", r.history["216915"]?.lastCost, 57.19);
  eq("prepop 216915 lastSellPrice", r.history["216915"]?.lastSellPrice, 174.99);
  eq("prepop 216915 lastInvoice", r.history["216915"]?.lastInvoice, "idealpos-import");
  ok("prepop skips blank suppcode", !("" in r.history), `keys include ""? ${"" in r.history}`);
  // idempotent: re-running with the seeded history adds nothing
  const r2 = prePopulatePriceHistory(rows, duplicateCodes, r.history);
  eq("prepop idempotent (0 new)", r2.seeded, 0);
}

// --- report ---
console.log("price-history checks\n");
for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name.padEnd(34)} ${c.detail}`);
const failed = checks.filter((c) => !c.pass);
console.log(failed.length === 0 ? "\nRESULT: all checks pass." : `\nRESULT: ${failed.length} check(s) FAILED.`);
process.exit(failed.length === 0 ? 0 : 1);
