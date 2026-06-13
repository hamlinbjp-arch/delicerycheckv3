// Delivery — Step 2: Review. Resolve the parser's unclassifiable rows before
// reconciliation. Each row is keyed in as a product (joins items, counts toward
// reconciliation), marked not-a-product (ignored), or skipped (excluded). See
// architecture §Review panel. Consumes the frozen session hook; no persistence logic.

import React, { useState } from "react";

const round2 = (n) => Math.round(n * 100) / 100;

export default function ReviewPanel({ session }) {
  const s = session.session;
  const reviewRows = s.reviewRows || [];

  // Only one row's product form is active at a time; resolving removes the row, so we
  // never hold a stale index across the list re-indexing.
  const [form, setForm] = useState(null); // { idx, qty, unitPrice } | null

  // Resolve the row at `idx`: optionally append a product, always drop it from reviewRows.
  function resolve(idx, productLine) {
    session.updateSession((prev) => ({
      ...prev,
      reviewRows: prev.reviewRows.filter((_, i) => i !== idx),
      items: productLine ? [...prev.items, productLine] : prev.items,
    }));
    setForm(null);
  }

  function addAsProduct(idx, row) {
    const qty = Number(form?.qty);
    const unitPrice = Number(form?.unitPrice);
    if (!(qty > 0) || !(unitPrice > 0)) return;
    resolve(idx, {
      invoiceCode: "",
      description: row.rawText,
      qty,
      unitPrice,
      amount: round2(qty * unitPrice),
      qtyReceived: 0,
      source: "user-added",
    });
  }

  const allResolved = reviewRows.length === 0;

  return (
    <div>
      <div className="stephead">
        <button className="btn-link" onClick={() => session.updateSession({ step: "setup" })}>‹ Back</button>
        <h1>Review</h1>
      </div>

      <div className="card">
        <p className="muted">
          {allResolved
            ? "All rows resolved. Continue to reconciliation."
            : `${reviewRows.length} row${reviewRows.length === 1 ? "" : "s"} couldn't be classified automatically. Resolve each one before reconciliation.`}
        </p>
      </div>

      {reviewRows.map((row, idx) => {
        const active = form && form.idx === idx;
        return (
          <div className="card" key={idx}>
            <p style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 13, margin: "0 0 4px", wordBreak: "break-word" }}>
              {row.rawText}
            </p>
            <p className="muted" style={{ marginTop: 0 }}>{row.reason}</p>

            {!active ? (
              <div className="btn-row">
                <button onClick={() => setForm({ idx, qty: "1", unitPrice: "" })}>Product</button>
                <button onClick={() => resolve(idx, null)}>Not a product</button>
                <button onClick={() => resolve(idx, null)}>Skip</button>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label>Qty</label>
                    <input type="number" inputMode="numeric" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Unit price</label>
                    <input type="number" inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))} placeholder="0.00" />
                  </div>
                </div>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn-primary" style={{ width: "auto", flex: 1 }} onClick={() => addAsProduct(idx, row)}>Add as product</button>
                  <button onClick={() => setForm(null)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <button
        className="btn-primary"
        disabled={!allResolved}
        onClick={() => session.updateSession({ step: "reconcile" })}
      >
        Continue to reconciliation
      </button>
    </div>
  );
}
