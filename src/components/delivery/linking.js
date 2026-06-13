// Shared linking helpers for MatchAndLink and ItemRow, so the two link the same way
// (and can't drift). Consumes the frozen trackingKey; no persistence logic of its own
// beyond calling app.setManualLink (which fires the backup) and session.updateSession.

import { trackingKey } from "../../lib/utils.js";

// Live Idealpos search: substring over description or supplier code, capped. Fast on
// the 7,276-row export. Returns [] until the query is meaningful (≥2 chars).
export function searchRows(rows, query, limit = 30) {
  const q = (query || "").trim();
  if (q.length < 2) return [];
  const U = q.toUpperCase();
  const out = [];
  for (const r of rows) {
    if (r.desc.toUpperCase().includes(U) || r.suppcode.includes(q)) {
      out.push(r);
      if (out.length >= limit) break;
    }
  }
  return out;
}

// Link invoice `code` to POS `row`: persist the manual link (fires backup) and update
// `match` on every session item sharing that code, immediately. via is "link" (search)
// or "ambiguous-resolved" (candidate pick).
export function linkItem(app, session, ie, code, row, via = "link") {
  const clean = row.suppcode !== "" && !ie.duplicateCodes.has(row.suppcode);
  const key = trackingKey(row, ie.duplicateCodes); // clean -> suppcode; else a linkId
  const entry = clean ? { key } : { key, snapshot: { suppcode: row.suppcode, desc: row.desc, price: row.price } };
  app.setManualLink(code, entry); // persists + triggers backup
  const match = { status: "matched", via, key, desc: row.desc, sellPrice: row.price };
  session.updateSession((prev) => ({
    ...prev,
    items: prev.items.map((it) => (it.invoiceCode === code ? { ...it, match } : it)),
  }));
}
