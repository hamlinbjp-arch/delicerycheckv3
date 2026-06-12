// Delivery — Step 1: Setup. Checks the Idealpos export is present, uploads the invoice
// PDF, runs the frozen parser, and starts a resumable session. See architecture
// §Views (Delivery — Step 1).

import React, { useState } from "react";

import parsePDF, { ParserError } from "../../lib/parsePDF.js";

function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86400000);
}

export default function Setup({ app, session, goSettings }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const ie = app.idealposExport;
  const s = session.session;

  async function onPdf(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = await parsePDF(new Uint8Array(await file.arrayBuffer()));
      session.startSession({
        invoiceMeta: {
          ...parsed.meta,
          // Carried in invoiceMeta (stored as-is by the frozen session hook) so
          // reconciliation can recompute and resume after a reload.
          nonProductLines: parsed.nonProductLines,
          reconciliation: parsed.reconciliation,
        },
        items: parsed.items.map((it) => ({ ...it, qtyReceived: 0 })),
        reviewRows: parsed.reviewRows,
        flaggedNotOnList: [],
        step: parsed.reviewRows.length ? "review" : "reconcile",
      });
    } catch (err) {
      const code = err instanceof ParserError ? err.code : err?.name || "Error";
      setError({ code, message: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  }

  // No POS data yet -> send the user to Settings to upload the CSV.
  if (!ie) {
    return (
      <div>
        <div className="stephead"><h1>Setup</h1></div>
        <div className="card">
          <h2>Upload your Idealpos export first</h2>
          <p className="muted">
            DeliveryCheck needs your Idealpos product export (CSV) before it can price a
            delivery. Add it in Settings, then come back here to upload the invoice.
          </p>
          <button className="btn-primary" onClick={goSettings}>Go to Settings</button>
        </div>
      </div>
    );
  }

  // A session already exists (e.g. came Back from Reconciliation) — show its summary.
  if (s) {
    const m = s.invoiceMeta || {};
    return (
      <div>
        <div className="stephead"><h1>Setup</h1></div>
        <div className="card">
          <h2>Invoice loaded</h2>
          <p className="muted">{m.invoiceNumber} · {m.date} · {s.items.length} products</p>
          <div className="btn-row">
            <button
              className="btn-primary"
              onClick={() => session.updateSession({ step: s.reviewRows?.length ? "review" : "reconcile" })}
            >
              Continue
            </button>
            <button className="btn-danger" onClick={() => session.discard()}>Discard</button>
          </div>
        </div>
      </div>
    );
  }

  const age = daysSince(ie.uploadedAt);
  return (
    <div>
      <div className="stephead"><h1>Setup</h1></div>

      <div className="card">
        <h2>Idealpos data</h2>
        <p className="muted">
          {ie.stats?.recordCount ?? ie.rows.length} products
          {age != null && ` · ${age} day${age === 1 ? "" : "s"} old`}
        </p>
        {age != null && age >= 30 && (
          <div className="banner warn">POS data is {age} days old — re-export soon to keep prices current.</div>
        )}
      </div>

      <div className="card">
        <h2>Upload invoice PDF</h2>
        <p className="muted">Choose the Wholesale Solutions invoice for this delivery.</p>
        <input type="file" accept="application/pdf" onChange={onPdf} disabled={busy} />
        {busy && <p className="muted">Parsing…</p>}
        {error && (
          <div className="banner error">
            <strong>{error.code}</strong>
            <div>{error.message}</div>
          </div>
        )}
      </div>
    </div>
  );
}
