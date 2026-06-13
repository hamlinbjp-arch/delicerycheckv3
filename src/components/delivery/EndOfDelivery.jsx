// Delivery — Step 6: End of delivery. Summary of what arrived, an "item not on list"
// note, and Confirm (writes price_history once per key + appends delivery_log +
// downloads a backup, then clears the session). Undo lives in App (this unmounts on
// confirm). Consumes the frozen hooks + suggestedSellPrice; the only store writes go
// through the approved additive useAppData setters.

import React, { useState } from "react";

import { suggestedSellPrice } from "../../lib/utils.js";

const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);

function statusOf(it) {
  if (it.qtyReceived <= 0) return "unchecked";
  if (it.qtyReceived >= it.qty) return "checked";
  return "partial";
}

export default function EndOfDelivery({ app, session, pricing, onConfirmed }) {
  const s = session.session;
  const meta = s.invoiceMeta || {};
  const items = s.items;
  const [note, setNote] = useState("");

  const fullyReceived = items.filter((it) => it.qty > 0 && it.qtyReceived >= it.qty);
  const partial = items.filter((it) => it.qtyReceived > 0 && it.qtyReceived < it.qty);
  const unchecked = items.filter((it) => it.qtyReceived <= 0);
  const notInPos = items.filter((it) => !it.match || it.match.status !== "matched");
  const priceChanges = items.filter((it) => it.priceChange && it.match && it.match.status === "matched" && it.qtyReceived > 0);
  const flagged = s.flaggedNotOnList || [];

  function addNote() {
    const text = note.trim();
    if (!text) return;
    session.updateSession((prev) => ({ ...prev, flaggedNotOnList: [...(prev.flaggedNotOnList || []), text] }));
    setNote("");
  }

  function confirmDelivery() {
    const invoiceNumber = meta.invoiceNumber;
    if (app.deliveryLog.some((e) => e.invoiceNumber === invoiceNumber)) {
      if (!window.confirm(`${invoiceNumber} is already in the delivery log. Confirm again anyway?`)) return;
    }

    // price_history: one entry per tracking key, matched items with qtyReceived > 0.
    // If a key repeats (duplicate codes), the line with the largest amount wins.
    const byKey = new Map();
    for (const it of items) {
      if (!it.match || it.match.status !== "matched" || !(it.qtyReceived > 0)) continue;
      const prev = byKey.get(it.match.key);
      if (!prev || (it.amount || 0) > (prev.amount || 0)) byKey.set(it.match.key, it);
    }
    const merged = { ...app.priceHistory };
    const date = meta.date || new Date().toISOString().slice(0, 10);
    for (const [key, it] of byKey) {
      merged[key] = { lastCost: it.unitPrice, lastSellPrice: it.match.sellPrice, lastInvoice: invoiceNumber, lastDate: date };
    }

    const logEntry = {
      invoiceNumber,
      date,
      confirmedAt: new Date().toISOString(),
      lines: items.map((it) => ({
        invoiceCode: it.invoiceCode,
        desc: it.description,
        qty: it.qty,
        qtyReceived: it.qtyReceived,
        cost: it.unitPrice,
        changed: !!it.priceChange,
      })),
      flaggedNotOnList: flagged,
    };
    const nextLog = [...app.deliveryLog, logEntry];

    // Snapshot for Undo (App owns the 30s window since this component unmounts).
    const snapshot = { session: s, priceHistory: app.priceHistory, deliveryLog: app.deliveryLog };

    app.setPriceHistory(merged);
    app.setDeliveryLog(nextLog);
    app.downloadBackup({ priceHistory: merged, deliveryLog: nextLog, manualLinks: app.manualLinks });
    onConfirmed(snapshot);
    session.confirm(); // clears active_session → App returns to Setup
  }

  function discard() {
    if (window.confirm("Discard this delivery without saving?")) session.discard();
  }

  const sell = (cost) => suggestedSellPrice(cost, pricing.rule.margin, pricing.rule.rounding);

  return (
    <div>
      <div className="stephead">
        <button className="btn-link" onClick={() => session.updateSession({ step: "checklist" })}>‹ Back</button>
        <h1>End of delivery</h1>
      </div>

      <div className="card">
        <h2>{meta.invoiceNumber} · {meta.date}</h2>
        <table className="totals">
          <tbody>
            <tr><td>Fully received</td><td>{fullyReceived.length} / {items.length}</td></tr>
            <tr><td>Partial</td><td>{partial.length}</td></tr>
            <tr><td>Unchecked</td><td>{unchecked.length}</td></tr>
            <tr><td>Price changes</td><td>{priceChanges.length}</td></tr>
            <tr><td>Not in Idealpos</td><td>{notInPos.length}</td></tr>
          </tbody>
        </table>
      </div>

      {partial.length > 0 && (
        <div className="card">
          <h2>Partial ({partial.length})</h2>
          {partial.map((it, i) => <div key={i} className="muted">{it.description} — {it.qtyReceived} / {it.qty}</div>)}
        </div>
      )}

      {unchecked.length > 0 && (
        <div className="card">
          <h2>Unchecked ({unchecked.length})</h2>
          {unchecked.map((it, i) => <div key={i} className="muted">{it.description}</div>)}
        </div>
      )}

      {priceChanges.length > 0 && (
        <div className="card">
          <h2>Price changes applied ({priceChanges.length})</h2>
          {priceChanges.map((it, i) => (
            <div key={i} className="muted" style={{ marginBottom: 4 }}>
              {it.description}: cost {money(it.priceChange.previousCost)} → {money(it.unitPrice)} · suggest sell <strong>{money(sell(it.unitPrice))}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>Item not on list</h2>
        <p className="muted">Record something in the box that isn't on the invoice (a receiving note — it doesn't affect reconciliation).</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. extra carton of …" style={{ flex: 1 }} />
          <button onClick={addNote}>Add</button>
        </div>
        {flagged.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {flagged.map((f, i) => <div key={i} className="muted">• {f}</div>)}
          </div>
        )}
      </div>

      <button className="btn-primary" onClick={confirmDelivery}>Confirm delivery</button>
      <button className="btn-danger" style={{ width: "100%", marginTop: 8 }} onClick={discard}>Discard</button>
    </div>
  );
}
