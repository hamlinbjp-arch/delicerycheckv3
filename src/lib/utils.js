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
