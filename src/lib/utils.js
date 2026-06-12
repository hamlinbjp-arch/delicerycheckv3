// src/lib/utils.js
//
// Matching core — the pure join between the parsed invoice and the Idealpos export.
// Step 2 of the post-parser build. See docs/DeliveryCheck_Architecture_v3.md
// §"Matching Logic" and §"Tracking key".
//
// Pure functions, no I/O, no module-level state, environment-agnostic. Manual links
// are PASSED IN (this module consumes them; persistence stores them later). This file
// will later also hold suggestedSellPrice / detectPriceChange / reconcile — out of
// scope for this turn.

// Portable short id, works in Node and the browser.
function newLinkId() {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  return `lnk_${uuid.replace(/-/g, "").slice(0, 8)}`;
}

// trackingKey(row, duplicateCodes) -> stable key for a POS row.
//   - Clean row  (suppcode non-blank AND not duplicated) -> trimmed suppcode.
//   - Keyless row (blank or duplicated suppcode)          -> a generated linkId.
//
// NOTE: the keyless branch is nondeterministic by design. A linkId is meant to be
// generated ONCE, at link time (a user action), and then stored; the caller persists
// it. Don't call this repeatedly for the same keyless row expecting a stable value.
export function trackingKey(row, duplicateCodes) {
  const code = row.suppcode;
  if (code !== "" && !duplicateCodes.has(code)) return code;
  return newLinkId();
}

// Resolve a manual link to the POS row(s) it points at. Returns an array so callers
// can require "exactly one". Never guesses.
//   - keyless link (has a snapshot) -> re-find the row by snapshot (suppcode/desc/price).
//   - clean link (key is a SUPPCODE) -> look up byCode.
function resolveLink(link, rows, byCode) {
  if (!link || typeof link !== "object" || link.key == null) return [];
  if (link.snapshot) {
    const s = link.snapshot;
    return rows.filter(
      (r) =>
        r.suppcode === (s.suppcode ?? "") &&
        r.desc === s.desc &&
        r.price === s.price
    );
  }
  return byCode.get(link.key) ?? [];
}

// matchItem(invoiceCode, rows, byCode, duplicateCodes, manualLinks) -> result
//
// Result is exactly one of:
//   { status: "matched",   via: "link" | "auto", key, row }
//   { status: "ambiguous", invoiceCode, candidates: row[] }
//   { status: "unmatched", invoiceCode, reason? }
export function matchItem(invoiceCode, rows, byCode, duplicateCodes, manualLinks = {}) {
  const code = String(invoiceCode).trim();

  // 1) Manual link first — remembered choices (incl. ambiguous resolutions and
  //    cross-supplier links) always win.
  const link = manualLinks[code];
  if (link) {
    const resolved = resolveLink(link, rows, byCode);
    if (resolved.length === 1) {
      // The link carries the tracking key; don't re-derive it.
      return { status: "matched", via: "link", key: link.key, row: resolved[0] };
    }
    // Link present but no longer resolves to exactly one row -> "Not in Idealpos"
    // silently. A deliberate user link is never silently re-pointed at a different
    // row via auto-match, so we do NOT fall through here.
    return { status: "unmatched", invoiceCode: code, reason: "manual link no longer resolves" };
  }

  // 2) Auto-match on the trimmed invoice code against trimmed POS SUPPCODE.
  const bucket = byCode.get(code);
  if (!bucket || bucket.length === 0) {
    return { status: "unmatched", invoiceCode: code };
  }
  if (bucket.length === 1) {
    const row = bucket[0];
    // For a unique match trackingKey returns the code itself (clean row).
    return { status: "matched", via: "auto", key: trackingKey(row, duplicateCodes), row };
  }
  // Duplicated SUPPCODE -> ambiguous. The user picks once (later), which is then
  // stored as a manual link; we never auto-resolve or mint a key here.
  return { status: "ambiguous", invoiceCode: code, candidates: bucket };
}

// ===========================================================================
// Price history (step 4). Pure functions; the price_history store lives in
// useAppData. See docs/DeliveryCheck_Architecture_v3.md §price_history,
// §Price Change Detection, §Suggested Sell Price. matchItem/trackingKey above
// are frozen and unchanged.
// ===========================================================================

const cents = (n) => Math.round(n * 100);

// suggestedSellPrice(unitCost, marginPct, rounding) -> advisory sell price, or null.
//   marginPct 0.60 => cost is 40% of sell => sell = unitCost / (1 - margin).
//   rounding 0.99 => price ends in .99 (round the dollars up, then back off to .99).
// Integer-cents throughout so results land exactly (e.g. 14.96 -> 37.99, not
// 37.989999…). Guards: unitCost must be > 0, margin in [0, 1).
//   14.96 -> 37.99 · 10.61 -> 26.99 · 9.30 -> 23.99 · 6.25 -> 15.99
export function suggestedSellPrice(unitCost, marginPct = 0.6, rounding = 0.99) {
  if (!(unitCost > 0)) return null;
  if (!(marginPct >= 0 && marginPct < 1)) return null;
  const dollars = Math.ceil(unitCost / (1 - marginPct)); // round up to whole dollar
  const endingCents = Math.round(rounding * 100); // e.g. 99
  return (dollars * 100 - (100 - endingCents)) / 100; // dollars-1 + .ending
}

// Derive the tracking key for an invoice code without needing `rows`: a manual link
// carries its key directly; a clean auto-match's key is the code itself. Unmatched or
// ambiguous codes have no stable key. Mirrors matchItem's precedence (link first).
function keyForCode(invoiceCode, manualLinks, byCode, duplicateCodes) {
  const code = String(invoiceCode).trim();
  const link = manualLinks?.[code];
  if (link && link.key != null) return link.key;
  const bucket = byCode.get(code);
  if (bucket && bucket.length === 1) return trackingKey(bucket[0], duplicateCodes);
  return null; // unmatched or ambiguous -> no stable key
}

// detectPriceChange(...) -> { changed:false } or
//   { changed:true, previousCost, previousSellPrice, suggestedSellPrice }.
// Compares the invoice's unit cost against the last recorded cost for this item's
// tracking key. No key, no history entry, or an equal cost -> no change (architecture:
// unmatched/first-seen/unchanged items raise no alert).
export function detectPriceChange(invoiceCode, costPrice, priceHistory, manualLinks, byCode, duplicateCodes) {
  const key = keyForCode(invoiceCode, manualLinks, byCode, duplicateCodes);
  if (key == null) return { changed: false };
  const entry = priceHistory?.[key];
  if (!entry) return { changed: false }; // first time seen
  if (cents(entry.lastCost) === cents(costPrice)) return { changed: false };
  return {
    changed: true,
    previousCost: entry.lastCost,
    previousSellPrice: entry.lastSellPrice,
    suggestedSellPrice: suggestedSellPrice(costPrice),
  };
}

// prePopulatePriceHistory(rows, duplicateCodes, existing) -> { history, seeded,
// skipped, breakdown }. Seeds a baseline cost from the Idealpos export: for each row
// with LSTCST > 0 under a STABLE key, create an entry if none exists. Never overwrites.
//
// "Stable key" = a clean row (suppcode non-blank AND not duplicated); its key is the
// suppcode. Blank and duplicated codes are skipped — they have no stable key (linking
// mints one later), so seeding them would create unreachable junk entries.
export function prePopulatePriceHistory(rows, duplicateCodes, existing = {}) {
  const history = { ...existing };
  const breakdown = { blank: 0, lstcstZero: 0, duplicated: 0, alreadyPresent: 0 };
  let seeded = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const r of rows) {
    if (r.suppcode === "") { breakdown.blank += 1; continue; }
    if (duplicateCodes.has(r.suppcode)) { breakdown.duplicated += 1; continue; }
    if (!(r.lstcst > 0)) { breakdown.lstcstZero += 1; continue; }
    const key = r.suppcode; // clean row: tracking key is the suppcode
    if (key in history) { breakdown.alreadyPresent += 1; continue; }
    history[key] = {
      lastCost: r.lstcst,
      lastSellPrice: r.price,
      lastInvoice: "idealpos-import",
      lastDate: today,
    };
    seeded += 1;
  }

  const skipped = breakdown.blank + breakdown.lstcstZero + breakdown.duplicated + breakdown.alreadyPresent;
  return { history, seeded, skipped, breakdown };
}

// reconcile(items, nonProductLines, printedSubtotal) -> completeness check.
// The UI uses this to recompute the gap after the user keys in a missing line; it
// reproduces the parser's completeness arithmetic (integer cents) so it agrees with
// parsePDF on the parsed inputs. See docs/DeliveryCheck_Architecture_v3.md
// §Validation & Reconciliation.
//   computedSubtotal = Σ item.amount + Σ shipping.amount - Σ |storeCredit.amount|
//   tolerance (cents) = min(10, max(2, ceil(items.length / 20)))  [matches the parser]
//   status = |gap| <= tolerance ? "pass" : "fail"
export function reconcile(items, nonProductLines, printedSubtotal) {
  const np = nonProductLines || {};
  const shippingArr = np.shipping || [];
  const creditArr = np.storeCredit || [];

  const productSumC = (items || []).reduce((a, it) => a + cents(it.amount), 0);
  const shippingC = shippingArr.reduce((a, s) => a + cents(s.amount), 0);
  const storeCreditC = creditArr.reduce((a, sc) => a - cents(sc.amount), 0); // magnitude
  const computedC = productSumC + shippingC - storeCreditC;
  const printedC = cents(printedSubtotal);
  const gapC = computedC - printedC;

  const tolC = Math.min(10, Math.max(2, Math.ceil((items?.length || 0) / 20)));
  const status = Math.abs(gapC) <= tolC ? "pass" : "fail";

  return {
    productSum: productSumC / 100,
    shipping: shippingC / 100,
    storeCredit: storeCreditC / 100,
    computedSubtotal: computedC / 100,
    printedSubtotal,
    gap: gapC / 100,
    tolerance: tolC / 100,
    status,
  };
}
