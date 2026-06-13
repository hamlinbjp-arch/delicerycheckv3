// One checklist row. Self-updates the item at `index` in the session. Shows the sell
// price / "Not in Idealpos", a qty counter with ✓/✗/Receive-all/tap-to-type, a
// price-change alert, an inline link search for unmatched items, and inline edit of the
// parsed line. Consumes frozen detectPriceChange/trackingKey via shared helpers.

import React, { useState } from "react";

import { detectPriceChange } from "../../lib/utils.js";
import { searchRows, linkItem } from "./linking.js";

const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const round2 = (n) => Math.round(n * 100) / 100;

function statusOf(item) {
  if (item.qtyReceived <= 0) return "unchecked";
  if (item.qtyReceived >= item.qty) return "checked";
  return "partial";
}

export default function ItemRow({ item, index, app, session, ie }) {
  const [typing, setTyping] = useState(false); // qty number entry
  const [qtyDraft, setQtyDraft] = useState("");
  const [linking, setLinking] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);

  const matched = item.match && item.match.status === "matched";
  const status = statusOf(item);

  function patch(p) {
    session.updateSession((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, ...p } : it)),
    }));
  }

  const inc = () => patch({ qtyReceived: Math.min(item.qty, item.qtyReceived + 1) });
  const dec = () => patch({ qtyReceived: Math.max(0, item.qtyReceived - 1) });
  const receiveAll = () => patch({ qtyReceived: item.qty });

  function commitQty() {
    const n = Math.max(0, Math.min(item.qty, Math.round(Number(qtyDraft))));
    if (Number.isFinite(n)) patch({ qtyReceived: n });
    setTyping(false);
  }

  const results = linking ? searchRows(ie.rows, query) : [];

  function startEdit() {
    setEdit({ qty: String(item.qty), unitPrice: String(item.unitPrice), description: item.description });
    setEditing(true);
  }
  function saveEdit() {
    const qty = Number(edit.qty);
    const unitPrice = Number(edit.unitPrice);
    if (!(qty > 0) || !(unitPrice >= 0)) return;
    // Recompute the price-change alert against the edited cost.
    const r = detectPriceChange(item.invoiceCode, unitPrice, app.priceHistory, app.manualLinks, ie.byCode, ie.duplicateCodes);
    const priceChange = r.changed
      ? { previousCost: r.previousCost, previousSellPrice: r.previousSellPrice, suggestedSellPrice: r.suggestedSellPrice }
      : null;
    patch({
      qty,
      unitPrice,
      description: edit.description,
      amount: round2(qty * unitPrice),
      qtyReceived: Math.min(item.qtyReceived, qty),
      priceChange,
    });
    setEditing(false);
  }

  return (
    <div className={`itemrow itemrow--${status}`}>
      <div className="itemrow__top">
        <div className="itemrow__desc">{item.description}</div>
        <div className="itemrow__price">
          {matched ? <span className="sell">{money(item.match.sellPrice)}</span> : <span className="badge-np">Not in Idealpos</span>}
        </div>
      </div>

      {item.priceChange && (
        <div className="itemrow__alert">
          ⚠ Cost {money(item.priceChange.previousCost)} → {money(item.unitPrice)} · suggest sell{" "}
          <strong>{money(item.priceChange.suggestedSellPrice)}</strong>
          {matched && <> (now {money(item.match.sellPrice)})</>}
        </div>
      )}

      <div className="itemrow__controls">
        <button className="qtybtn" onClick={dec} aria-label="remove one">✗</button>
        {typing ? (
          <input
            className="qtyinput"
            type="number"
            inputMode="numeric"
            autoFocus
            value={qtyDraft}
            onChange={(e) => setQtyDraft(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => { if (e.key === "Enter") commitQty(); }}
          />
        ) : (
          <button className="qtycount" onClick={() => { setQtyDraft(String(item.qtyReceived)); setTyping(true); }}>
            {item.qtyReceived} / {item.qty}
          </button>
        )}
        <button className="qtybtn" onClick={inc} aria-label="add one">✓</button>
        <button className="recvall" onClick={receiveAll}>Receive all</button>
        {!matched && <button className="btn-link" onClick={() => { setLinking((v) => !v); setQuery(""); }}>Link</button>}
        <button className="btn-link" onClick={editing ? () => setEditing(false) : startEdit} aria-label="edit line">✎</button>
      </div>

      {linking && !matched && (
        <div className="itemrow__link">
          <input type="text" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Idealpos…" />
          {query.trim().length < 2 && <p className="muted">Type at least 2 characters.</p>}
          {results.map((row, i) => (
            <button key={i} className="result" onClick={() => { linkItem(app, session, ie, item.invoiceCode, row, "link"); setLinking(false); setQuery(""); }}>
              {row.desc} · {money(row.price)} <span className="muted">[{row.suppcode || "no code"}]</span>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <div className="itemrow__edit">
          <label>Description</label>
          <input type="text" value={edit.description} onChange={(e) => setEdit((d) => ({ ...d, description: e.target.value }))} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Qty</label>
              <input type="number" inputMode="numeric" value={edit.qty} onChange={(e) => setEdit((d) => ({ ...d, qty: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Unit cost</label>
              <input type="number" inputMode="decimal" value={edit.unitPrice} onChange={(e) => setEdit((d) => ({ ...d, unitPrice: e.target.value }))} />
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn-primary" style={{ width: "auto", flex: 1 }} onClick={saveEdit}>Save</button>
            <button onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
