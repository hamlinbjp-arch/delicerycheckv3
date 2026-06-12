// tools/checkReconcile.js — THROWAWAY validator for utils.reconcile().
//
// Confirms the UI-side reconcile() reproduces the parser's completeness numbers on
// the parsed inputs (so add-missing-line recompute agrees with parsePDF), and that
// adding/removing a line flips the gap/status. Exits non-zero on any mismatch.
//
// Run: `node tools/checkReconcile.js`

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import parsePDF from "../src/lib/parsePDF.js";
import { reconcile } from "../src/lib/utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "..", "fixtures");

const checks = [];
const ok = (name, pass, detail = "") => checks.push({ name, pass, detail });
const eqC = (name, a, b) => ok(name, Math.round(a * 100) === Math.round(b * 100), `${a} vs ${b}`);

const files = readdirSync(FIX).filter((f) => f.endsWith(".pdf")).sort((a, b) => parseInt(a) - parseInt(b));

for (const f of files) {
  const r = await parsePDF(new Uint8Array(readFileSync(join(FIX, f))));
  const inv = r.meta.invoiceNumber;
  const got = reconcile(r.items, r.nonProductLines, r.meta.printedSubtotal);
  const want = r.reconciliation;

  // reconcile() reproduces the parser's completeness fields exactly.
  eqC(`${inv} computedSubtotal`, got.computedSubtotal, want.computedSubtotal);
  eqC(`${inv} gap`, got.gap, want.gap);
  ok(`${inv} status==pass`, got.status === "pass" && want.status === "pass", `${got.status}/${want.status}`);
  eqC(`${inv} productSum`, got.productSum, want.productSum);
  eqC(`${inv} shipping`, got.shipping, want.shipping);
  eqC(`${inv} storeCredit`, got.storeCredit, want.storeCredit);
}

// Add-missing-line behaviour on one invoice (INV-17663 = 6.pdf).
{
  const r = await parsePDF(new Uint8Array(readFileSync(join(FIX, "6.pdf"))));
  const base = reconcile(r.items, r.nonProductLines, r.meta.printedSubtotal);
  ok("baseline pass", base.status === "pass", base.status);

  const withExtra = [...r.items, { invoiceCode: "X", description: "bogus", qty: 1, unitPrice: 5, amount: 5, source: "user-added" }];
  const over = reconcile(withExtra, r.nonProductLines, r.meta.printedSubtotal);
  ok("added $5 line -> fail", over.status === "fail", over.status);
  eqC("added $5 line -> gap ~5.00", over.gap, 5.0);

  const removed = reconcile(r.items, r.nonProductLines, r.meta.printedSubtotal);
  ok("removed -> pass again", removed.status === "pass", removed.status);
}

console.log("reconcile() checks\n");
const fails = checks.filter((c) => !c.pass);
for (const c of fails) console.log(`  ✗ ${c.name.padEnd(28)} ${c.detail}`);
console.log(`${checks.length - fails.length}/${checks.length} passed.`);
console.log(fails.length === 0 ? "\nRESULT: all checks pass." : `\nRESULT: ${fails.length} FAILED.`);
process.exit(fails.length === 0 ? 0 : 1);
