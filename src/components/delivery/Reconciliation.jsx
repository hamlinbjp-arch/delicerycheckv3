// Delivery — Step 3: Reconciliation. The safety check. Printed vs computed totals,
// the completeness gap, and the add-missing-line recovery path; Start is gated on a
// pass (or an explicit override). See architecture §Validation & Reconciliation.

import React, { useState } from "react";

import { reconcile } from "../../lib/utils.js";

const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const round2 = (n) => Math.round(n * 100) / 100;

export default function Reconciliation({ app, session }) {
  const s = session.session;
  const meta = s.invoiceMeta || {};
  const baseline = meta.reconciliation || {};
  const nonProductLines = meta.nonProductLines || {};

  const [form, setForm] = useState({ invoiceCode: "", description: "", qty: "1", unitCost: "" });

  const rec = reconcile(s.items, nonProductLines, meta.printedSubtotal);
  const pass = rec.status === "pass";
  const userAdded = s.items.filter((it) => it.source === "user-added");

  function addLine() {
    const qty = Number(form.qty);
    const unitCost = Number(form.unitCost);
    if (!(qty > 0) || !(unitCost > 0)) return;
    const line = {
      invoiceCode: form.invoiceCode.trim() || "(manual)",
      description: form.description.trim() || "(manually keyed line)",
      qty,
      unitPrice: unitCost,
      amount: round2(qty * unitCost),
      qtyReceived: 0,
      source: "user-added",
    };
    session.updateSession((prev) => ({ ...prev, items: [...prev.items, line] }));
    setForm({ invoiceCode: "", description: "", qty: "1", unitCost: "" });
  }

  function removeLine(idx) {
    session.updateSession((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  }

  function back() {
    session.updateSession({ step: s.reviewRows?.length ? "review" : "setup" });
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div>
      <div className="stephead">
        <button className="btn-link" onClick={back}>‹ Back</button>
        <h1>Reconcile</h1>
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Completeness</h2>
          <span className={`badge ${pass ? "pass" : "fail"}`}>{pass ? "PASS" : "GAP"}</span>
        </div>
        <table className="totals">
          <tbody>
            <tr><td>Products ({s.items.length})</td><td>{money(rec.productSum)}</td></tr>
            <tr><td>Shipping</td><td>{money(rec.shipping)}</td></tr>
            <tr><td>Store credit</td><td>−{money(rec.storeCredit)}</td></tr>
            <tr><td>Computed subtotal</td><td>{money(rec.computedSubtotal)}</td></tr>
            <tr><td>Printed subtotal</td><td>{money(rec.printedSubtotal)}</td></tr>
            <tr><td><strong>Gap</strong> (tolerance {money(rec.tolerance)})</td><td><strong>{money(rec.gap)}</strong></td></tr>
          </tbody>
        </table>
        {!pass && (
          <div className="banner warn" style={{ marginTop: 10 }}>
            Parsed lines don't add up to the printed subtotal. Key in the missing line(s)
            from the paper invoice below until the gap closes.
          </div>
        )}
      </div>

      <div className="card">
        <h2>Invoice totals</h2>
        <table className="totals">
          <tbody>
            <tr><td>Subtotal</td><td>{money(meta.printedSubtotal)}</td></tr>
            <tr><td>GST</td><td>{money(meta.printedGST)}</td></tr>
            <tr><td>Total</td><td>{money(meta.printedTotal)}</td></tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 8 }}>
          Subtotal + GST = Total: {fmtCheck(baseline.totalsCheck?.subtotalPlusGstEqualsTotal)} ·
          {" "}Amount due = Total: {fmtCheck(baseline.totalsCheck?.amountDueEqualsTotal)}
        </p>
        {baseline.perLineFailures?.length > 0 && (
          <div className="banner warn" style={{ marginTop: 8 }}>
            {baseline.perLineFailures.length} line(s) where qty × unit ≠ amount — check the invoice.
          </div>
        )}
      </div>

      <div className="card">
        <h2>Add a missing line</h2>
        <label>Code (optional)</label>
        <input type="text" value={form.invoiceCode} onChange={set("invoiceCode")} placeholder="e.g. 95431" />
        <label>Description</label>
        <input type="text" value={form.description} onChange={set("description")} />
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label>Qty</label>
            <input type="number" inputMode="numeric" value={form.qty} onChange={set("qty")} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Unit cost</label>
            <input type="number" inputMode="decimal" value={form.unitCost} onChange={set("unitCost")} placeholder="0.00" />
          </div>
        </div>
        <button style={{ marginTop: 10, width: "100%" }} onClick={addLine}>Add line</button>

        {userAdded.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p className="muted">Manually added:</p>
            {s.items.map((it, i) =>
              it.source === "user-added" ? (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderTop: "1px solid var(--line)" }}>
                  <span style={{ fontSize: 13 }}>{it.invoiceCode} · {it.description} · {it.qty}×{money(it.unitPrice)} = {money(it.amount)}</span>
                  <button className="btn-link" onClick={() => removeLine(i)}>Remove</button>
                </div>
              ) : null
            )}
          </div>
        )}
      </div>

      <button
        className="btn-primary"
        disabled={!pass}
        onClick={() => session.updateSession({ step: "match" })}
      >
        Start delivery
      </button>
      {!pass && (
        <button
          className="btn-danger"
          style={{ width: "100%", marginTop: 8 }}
          onClick={() => {
            if (window.confirm("Reconciliation hasn't passed. Start anyway? The parsed list may be incomplete.")) {
              session.updateSession({ step: "match" });
            }
          }}
        >
          Override and start anyway
        </button>
      )}
    </div>
  );
}

function fmtCheck(v) {
  return v === true ? "✓" : v === false ? "✗" : "—";
}
