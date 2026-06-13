// Delivery — Step 4: Match & Link. Computes each session item's match (frozen
// matchItem) on entry, then lets the user link the unmatched ones (search Idealpos by
// description) and resolve ambiguous ones (pick a candidate). Linking is optional —
// "Start delivery" is always enabled; the rest can be linked at the box.
//
// Two contracts:
//   1. Every link fires app.setManualLink(...) (which triggers the backup download).
//   2. The linked item's match is written into the session immediately, so the
//      checklist reads match state from the session and never re-runs matching.
//
// Consumes the frozen utils (matchItem, trackingKey) and the frozen hooks; no
// persistence logic of its own.

import React, { useEffect, useMemo, useState } from "react";

import { matchItem, trackingKey } from "../../lib/utils.js";

const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);

// Map a matchItem() result into the compact match object stored on a session item.
function toMatch(r) {
  if (r.status === "matched") {
    return { status: "matched", via: r.via, key: r.key, desc: r.row.desc, sellPrice: r.row.price };
  }
  return { status: r.status }; // "unmatched" | "ambiguous"
}

export default function MatchAndLink({ app, session }) {
  const s = session.session;
  const ie = app.idealposExport;
  const [activeCode, setActiveCode] = useState(null); // unmatched group expanded for search
  const [query, setQuery] = useState("");
  const [linkedCount, setLinkedCount] = useState(0);

  // On entry (once the export is loaded), compute a match for every item that doesn't
  // have one yet, honouring any existing manual links. The guard makes this a no-op on
  // re-render and on resume (items already carry match state).
  useEffect(() => {
    if (!s || !ie) return;
    if (s.items.every((it) => it.match !== undefined)) return;
    const items = s.items.map((it) =>
      it.match !== undefined
        ? it
        : { ...it, match: toMatch(matchItem(it.invoiceCode, ie.rows, ie.byCode, ie.duplicateCodes, app.manualLinks)) }
    );
    session.updateSession({ items });
  }, [ie, s, app.manualLinks, session]);

  // Live search results for the active unmatched group. Substring over desc (or code);
  // capped at 30 so a 7k-row export stays instant at the box.
  const results = useMemo(() => {
    if (!activeCode || !ie || query.trim().length < 2) return [];
    const q = query.trim().toUpperCase();
    const out = [];
    for (const r of ie.rows) {
      if (r.desc.toUpperCase().includes(q) || r.suppcode.includes(query.trim())) {
        out.push(r);
        if (out.length >= 30) break;
      }
    }
    return out;
  }, [activeCode, query, ie]);

  if (!ie) {
    return <div className="card"><p className="muted">No Idealpos export loaded.</p></div>;
  }

  const ready = s.items.every((it) => it.match !== undefined);

  // Group items needing attention by invoiceCode (link once per code resolves all its
  // lines). Auto-matched items are not shown.
  const groups = [];
  const byCodeGroup = new Map();
  for (const it of s.items) {
    if (!it.match || it.match.status === "matched") continue;
    const code = it.invoiceCode || "";
    if (!byCodeGroup.has(code)) {
      const g = { code, status: it.match.status, description: it.description, count: 0 };
      byCodeGroup.set(code, g);
      groups.push(g);
    }
    byCodeGroup.get(code).count += 1;
  }
  const unmatchedItemCount = s.items.filter((it) => it.match && it.match.status !== "matched").length;

  function linkItemTo(code, row, via) {
    const clean = row.suppcode !== "" && !ie.duplicateCodes.has(row.suppcode);
    const key = trackingKey(row, ie.duplicateCodes); // clean -> suppcode; else a linkId
    const entry = clean ? { key } : { key, snapshot: { suppcode: row.suppcode, desc: row.desc, price: row.price } };
    app.setManualLink(code, entry); // persists + triggers backup
    const match = { status: "matched", via, key, desc: row.desc, sellPrice: row.price };
    session.updateSession((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.invoiceCode === code ? { ...it, match } : it)),
    }));
    setLinkedCount((c) => c + 1);
    setActiveCode(null);
    setQuery("");
  }

  return (
    <div>
      <div className="stephead">
        <button className="btn-link" onClick={() => session.updateSession({ step: "reconcile" })}>‹ Back</button>
        <h1>Match &amp; link</h1>
      </div>

      <div className="card">
        <p className="muted">
          <strong>{unmatchedItemCount}</strong> unmatched · <strong>{linkedCount}</strong> linked this session
        </p>
        <p className="muted" style={{ marginTop: 4 }}>
          Linking is optional — you can link the rest at the box. A high unmatched count is normal.
        </p>
      </div>

      {!ready && <div className="card"><p className="muted">Preparing matches…</p></div>}

      {ready && groups.length === 0 && (
        <div className="card"><p className="muted">Nothing to link — every item matched.</p></div>
      )}

      {ready && groups.map((g) => {
        if (g.status === "ambiguous") {
          const candidates = ie.byCode.get(g.code) || [];
          return (
            <div className="card" key={g.code || "(nocode)"}>
              <p style={{ margin: "0 0 4px" }}><strong>{g.code}</strong> · {g.description}{g.count > 1 ? ` (×${g.count})` : ""}</p>
              <p className="muted" style={{ marginTop: 0 }}>Duplicate code — pick the right product:</p>
              {candidates.map((row, i) => (
                <button key={i} style={{ width: "100%", textAlign: "left", marginTop: 6 }} onClick={() => linkItemTo(g.code, row, "ambiguous-resolved")}>
                  {row.desc} · {money(row.price)} <span className="muted">(cost {money(row.lstcst)})</span>
                </button>
              ))}
            </div>
          );
        }

        // Unmatched. Empty-code (manually-added) lines can't be keyed for a manual link.
        const linkable = g.code !== "";
        const active = activeCode === g.code;
        return (
          <div className="card" key={g.code || "(nocode)"}>
            <p style={{ margin: "0 0 4px" }}>
              <strong>{g.code || "(no code)"}</strong> · {g.description}{g.count > 1 ? ` (×${g.count})` : ""}
            </p>
            {!linkable ? (
              <p className="muted" style={{ marginTop: 0 }}>Manually-added line — no supplier code to link.</p>
            ) : !active ? (
              <button onClick={() => { setActiveCode(g.code); setQuery(""); }}>Link to Idealpos…</button>
            ) : (
              <div>
                <input
                  type="text"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search Idealpos by description or code"
                />
                <div style={{ marginTop: 6 }}>
                  {query.trim().length < 2 && <p className="muted">Type at least 2 characters.</p>}
                  {query.trim().length >= 2 && results.length === 0 && <p className="muted">No matches.</p>}
                  {results.map((row, i) => (
                    <button key={i} style={{ width: "100%", textAlign: "left", marginTop: 6 }} onClick={() => linkItemTo(g.code, row, "link")}>
                      {row.desc} · {money(row.price)} <span className="muted">[{row.suppcode || "no code"}]</span>
                    </button>
                  ))}
                </div>
                <button className="btn-link" style={{ marginTop: 6 }} onClick={() => { setActiveCode(null); setQuery(""); }}>Cancel</button>
              </div>
            )}
          </div>
        );
      })}

      <button className="btn-primary" onClick={() => session.updateSession({ step: "checklist" })}>
        Start delivery
      </button>
    </div>
  );
}
