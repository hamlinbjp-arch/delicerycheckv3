// Single-page parser test harness. Upload ONE invoice PDF, run parsePDF, and render
// the full output + debug in collapsible sections for eyeball validation.
//
// CLAUDE.md (parser-only phase): this is the ONLY allowed UI — no workflow, no
// routing, no other components. It reads from the parser and never changes it.

import React, { useState } from "react";

// Override the pdfjs worker for the browser. The parser sets workerSrc to a Node
// path at import time (harmless under the node:url alias); we reassign it on the
// same GlobalWorkerOptions singleton to the Vite-bundled worker asset.
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import parsePDF from "../lib/parsePDF.js";

GlobalWorkerOptions.workerSrc = workerUrl;

// --- styling (inline; no external UI library per CLAUDE.md) --------------------
const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const S = {
  page: { fontFamily: "system-ui, sans-serif", margin: 0, padding: "16px", color: "#111", maxWidth: 1100 },
  pre: { fontFamily: mono, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f6f6f6", padding: 8, borderRadius: 4, margin: 0 },
  table: { borderCollapse: "collapse", width: "100%", fontFamily: mono, fontSize: 12 },
  th: { textAlign: "left", borderBottom: "2px solid #ccc", padding: "4px 8px", position: "sticky", top: 0, background: "#fff" },
  td: { borderBottom: "1px solid #eee", padding: "4px 8px", verticalAlign: "top" },
  details: { border: "1px solid #ddd", borderRadius: 6, marginBottom: 8 },
  summary: { cursor: "pointer", padding: "8px 12px", fontWeight: 600, userSelect: "none" },
  body: { padding: "8px 12px", overflowX: "auto" },
};

// Per-class colors for the classifications table, so the eye can scan outcomes.
const CLASS_COLOR = {
  product: "#1a7f37",
  notSupplied: "#9a6700",
  shipping: "#0969da",
  storeCredit: "#8250df",
  total: "#57606a",
  pageHeader: "#57606a",
  naMarker: "#57606a",
  chrome: "#aaa",
  review: "#cf222e",
};

function Section({ title, count, children, open = false }) {
  return (
    <details style={S.details} open={open}>
      <summary style={S.summary}>
        {title}
        {count != null && <span style={{ color: "#666", fontWeight: 400 }}> ({count})</span>}
      </summary>
      <div style={S.body}>{children}</div>
    </details>
  );
}

function Table({ columns, rows, empty = "none" }) {
  if (!rows || rows.length === 0) return <em style={{ color: "#666" }}>{empty}</em>;
  return (
    <table style={S.table}>
      <thead>
        <tr>{columns.map((c) => <th key={c.key} style={S.th}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {columns.map((c) => <td key={c.key} style={S.td}>{c.render ? c.render(r, i) : r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Render a value plainly without reformatting numbers (so nothing is masked).
const show = (v) => (v == null ? <span style={{ color: "#999" }}>null</span> : String(v));
const checkmark = (v) => (v === true ? "✓" : v === false ? "✗" : "—");

export default function Harness() {
  const [fileName, setFileName] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const out = await parsePDF(bytes);
      setResult(out);
    } catch (err) {
      // Hard stops (ParserError: NO_TEXT_LAYER / MISSING_SUBTOTAL / ZERO_PRODUCTS)
      // and any unexpected error surface here, nothing else rendered.
      setError({ code: err?.code || err?.name || "Error", message: err?.message || String(err) });
    } finally {
      setBusy(false);
    }
  }

  const meta = result?.meta;
  const rec = result?.reconciliation;
  const np = result?.nonProductLines;
  const debug = result?.debug;

  return (
    <div style={S.page}>
      <h1 style={{ fontSize: 18, margin: "0 0 12px" }}>DeliveryCheck — Parser Harness</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Upload one WSS invoice PDF to eyeball its parse. Reads from the parser output and
        <code> debug</code>; does not change the parser.
      </p>

      <input type="file" accept="application/pdf" onChange={onFile} />
      {fileName && <span style={{ marginLeft: 8, fontFamily: mono, fontSize: 12 }}>{fileName}</span>}
      {busy && <p>Parsing…</p>}

      {error && (
        <div style={{ marginTop: 16, padding: 12, border: "2px solid #cf222e", borderRadius: 6, background: "#fff5f5" }}>
          <strong style={{ color: "#cf222e" }}>Hard stop — {error.code}</strong>
          <div style={{ fontFamily: mono, fontSize: 13, marginTop: 4 }}>{error.message}</div>
        </div>
      )}

      {result && (
        <>
          {/* Top banner: meta + plain PASS/FAIL reconciliation badge */}
          <div style={{ marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontFamily: mono, fontSize: 13 }}>
              <strong>{show(meta.invoiceNumber)}</strong> · {show(meta.date)} · {show(meta.reference)} · {show(meta.supplier)}
            </div>
            <div
              style={{
                padding: "8px 16px", borderRadius: 6, fontWeight: 700, fontFamily: mono,
                color: "#fff", background: rec.status === "pass" ? "#1a7f37" : "#cf222e",
              }}
            >
              RECONCILE: {rec.status.toUpperCase()} · gap ${rec.gap.toFixed(2)} (tol ${rec.tolerance.toFixed(2)})
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            {/* 1. Extracted text per page */}
            <Section title="Extracted text (per page)" count={debug.rawTextByPage.length}>
              {debug.rawTextByPage.map((text, i) => (
                <details key={i} style={{ ...S.details, marginBottom: 6 }}>
                  <summary style={S.summary}>Page {i + 1}</summary>
                  <div style={S.body}><pre style={S.pre}>{text}</pre></div>
                </details>
              ))}
            </Section>

            {/* 2. Reconstructed rows */}
            <Section title="Reconstructed rows" count={debug.reconstructedRows.length}>
              <pre style={S.pre}>
                {debug.reconstructedRows.map((r, i) => `${String(i + 1).padStart(3, " ")}  ${r}`).join("\n")}
              </pre>
            </Section>

            {/* 3. Classifications */}
            <Section title="Classifications" count={debug.classifications.length}>
              <Table
                columns={[
                  { key: "n", label: "#", render: (_r, i) => i + 1 },
                  { key: "rawText", label: "raw text" },
                  {
                    key: "class", label: "class",
                    render: (r) => <span style={{ color: CLASS_COLOR[r.class] || "#111", fontWeight: 600 }}>{r.class}</span>,
                  },
                  { key: "reason", label: "reason", render: (r) => r.reason || "" },
                ]}
                rows={debug.classifications}
              />
            </Section>

            {/* 4. Parsed products */}
            <Section title="Parsed products (items)" count={result.items.length} open>
              <Table
                columns={[
                  { key: "invoiceCode", label: "code" },
                  { key: "description", label: "description" },
                  { key: "qty", label: "qty" },
                  { key: "unitPrice", label: "unitPrice" },
                  { key: "amount", label: "amount" },
                ]}
                rows={result.items}
              />
            </Section>

            {/* 5. Non-product lines */}
            <Section
              title="Non-product lines"
              count={np.shipping.length + np.storeCredit.length + np.notSupplied.length}
            >
              <h4 style={{ margin: "4px 0" }}>Shipping ({np.shipping.length})</h4>
              <Table columns={[{ key: "amount", label: "amount" }]} rows={np.shipping} />
              <h4 style={{ margin: "12px 0 4px" }}>Store credit ({np.storeCredit.length})</h4>
              <Table columns={[{ key: "amount", label: "amount (signed)" }]} rows={np.storeCredit} />
              <h4 style={{ margin: "12px 0 4px" }}>Not supplied ({np.notSupplied.length})</h4>
              <Table
                columns={[
                  { key: "invoiceCode", label: "code" },
                  { key: "name", label: "name" },
                  { key: "qty", label: "qty" },
                ]}
                rows={np.notSupplied}
              />
            </Section>

            {/* 6. Review rows */}
            <Section title="Review rows" count={result.reviewRows.length} open={result.reviewRows.length > 0}>
              <Table
                columns={[{ key: "rawText", label: "raw text" }, { key: "reason", label: "reason" }]}
                rows={result.reviewRows}
                empty="none — every row classified"
              />
            </Section>

            {/* 7. Reconciliation */}
            <Section title="Reconciliation" count={null} open>
              <table style={{ ...S.table, width: "auto" }}>
                <tbody>
                  {[
                    ["productSum", `$${rec.productSum.toFixed(2)}`],
                    ["shipping", `$${rec.shipping.toFixed(2)}`],
                    ["storeCredit (subtracted)", `$${rec.storeCredit.toFixed(2)}`],
                    ["computedSubtotal", `$${rec.computedSubtotal.toFixed(2)}`],
                    ["printedSubtotal", `$${rec.printedSubtotal.toFixed(2)}`],
                    ["gap", `$${rec.gap.toFixed(2)}`],
                    ["tolerance", `$${rec.tolerance.toFixed(2)}`],
                    ["status", rec.status],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{k}</td>
                      <td style={{ ...S.td, color: k === "status" ? (rec.status === "pass" ? "#1a7f37" : "#cf222e") : "#111", fontWeight: k === "status" || k === "gap" ? 700 : 400 }}>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h4 style={{ margin: "12px 0 4px" }}>Totals check</h4>
              <div style={{ fontFamily: mono, fontSize: 12 }}>
                Subtotal + GST = Total: {checkmark(rec.totalsCheck.subtotalPlusGstEqualsTotal)} &nbsp;·&nbsp;
                Amount Due = Total: {checkmark(rec.totalsCheck.amountDueEqualsTotal)}
                <div style={{ marginTop: 4, color: "#666" }}>
                  printed: subtotal {show(meta.printedSubtotal)} · GST {show(meta.printedGST)} · total {show(meta.printedTotal)} · amountDue {show(meta.amountDue)}
                </div>
              </div>

              <h4 style={{ margin: "12px 0 4px" }}>Per-line failures ({rec.perLineFailures.length})</h4>
              <Table
                columns={[
                  { key: "invoiceCode", label: "code", render: (r) => show(r.invoiceCode) },
                  { key: "qty", label: "qty" },
                  { key: "unitPrice", label: "unitPrice" },
                  { key: "amount", label: "amount" },
                  { key: "expected", label: "expected (qty×unit)" },
                ]}
                rows={rec.perLineFailures}
                empty="none — every line's qty × unit = amount"
              />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
