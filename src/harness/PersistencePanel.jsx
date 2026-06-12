// src/harness/PersistencePanel.jsx
//
// Harness-only verification panel for the persistence layer (useAppData +
// useDeliverySession). Not delivery-workflow UI — its sole purpose is to let me
// exercise the stores, the resumable-session reload flow, backup downloads, and
// restore by hand in the browser. See the Persistence tab in Harness.jsx.

import React, { useState } from "react";

import parseIdealpos from "../lib/parseIdealpos.js";
import { suggestedSellPrice, detectPriceChange } from "../lib/utils.js";
import { useAppData } from "../hooks/useAppData.js";
import { useDeliverySession } from "../hooks/useDeliverySession.js";

const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const S = {
  card: { border: "1px solid #ddd", borderRadius: 6, padding: 12, marginBottom: 12 },
  h: { margin: "0 0 8px", fontSize: 14 },
  pre: { fontFamily: mono, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", background: "#f6f6f6", padding: 8, borderRadius: 4, margin: "6px 0 0", maxHeight: 160, overflow: "auto" },
  btn: { fontFamily: "inherit", fontSize: 12, padding: "5px 10px", marginRight: 6, marginTop: 4, cursor: "pointer" },
  input: { fontFamily: mono, fontSize: 12, padding: "4px 6px", marginRight: 6, width: 130 },
  pill: (ok) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontFamily: mono, fontSize: 11, color: "#fff", background: ok ? "#1a7f37" : "#cf222e" }),
  note: { color: "#666", fontSize: 12, margin: "4px 0 0" },
};

function pretty(v) {
  return JSON.stringify(v, null, 2);
}

// Everything that touches the hooks lives here. Remounting this (via key) simulates a
// full app reload: both hooks re-read localStorage from scratch.
function PersistInner() {
  const app = useAppData();
  const sess = useDeliverySession();

  const [linkCode, setLinkCode] = useState("210241");
  const [linkKey, setLinkKey] = useState("216915");
  const [restoreMsg, setRestoreMsg] = useState(null);
  const [ppResult, setPpResult] = useState(null);
  const [dpcCode, setDpcCode] = useState("216915");
  const [dpcCost, setDpcCost] = useState("14.96");
  const [dpcResult, setDpcResult] = useState(null);

  async function onUploadPos(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = parseIdealpos(text);
    app.setIdealposExport(result);
  }

  function onRestore(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try {
        obj = JSON.parse(reader.result);
      } catch {
        setRestoreMsg({ ok: false, errors: ["not valid JSON"] });
        return;
      }
      setRestoreMsg(app.restoreFromBackup(obj));
    };
    reader.readAsText(file);
  }

  const ie = app.idealposExport;

  return (
    <div>
      {/* storage availability */}
      <div style={S.card}>
        <span style={S.pill(app.storageAvailable)}>
          localStorage {app.storageAvailable ? "available" : "UNAVAILABLE"}
        </span>
        {!app.storageAvailable && (
          <p style={S.note}>Private mode / quota — writes are no-ops and data won't persist.</p>
        )}
      </div>

      {/* idealposExport */}
      <div style={S.card}>
        <h3 style={S.h}>idealposExport store</h3>
        <input type="file" accept=".txt,.csv" onChange={onUploadPos} />
        <p style={S.note}>Upload the POS export → parseIdealpos → setIdealposExport. Read-back proves the byCode/duplicateCodes rebuild survives a reload.</p>
        {ie ? (
          <pre style={S.pre}>
            {pretty({
              rows: ie.rows.length,
              "byCode.size": ie.byCode?.size,
              "duplicateCodes.size": ie.duplicateCodes?.size,
              blankCount: ie.blankCount,
              stats: ie.stats,
              uploadedAt: ie.uploadedAt,
            })}
          </pre>
        ) : (
          <p style={S.note}>— empty —</p>
        )}
      </div>

      {/* manualLinks */}
      <div style={S.card}>
        <h3 style={S.h}>manualLinks store (backup on every write)</h3>
        <input style={S.input} value={linkCode} onChange={(e) => setLinkCode(e.target.value)} placeholder="invoiceCode" />
        <input style={S.input} value={linkKey} onChange={(e) => setLinkKey(e.target.value)} placeholder="key (SUPPCODE)" />
        <button style={S.btn} onClick={() => app.setManualLink(linkCode, { key: linkKey })}>
          Add clean link
        </button>
        <button
          style={S.btn}
          onClick={() => app.setManualLink(linkCode, { key: `lnk_${linkCode}`, snapshot: { suppcode: "", desc: "Adult Misc", price: 0 } })}
        >
          Add keyless (snapshot) link
        </button>
        <button style={S.btn} onClick={() => app.removeManualLink(linkCode)}>
          Remove
        </button>
        <pre style={S.pre}>{pretty(app.manualLinks)}</pre>
        <p style={S.note}>
          last backup: {app.lastBackup ? `${app.lastBackup.filename} @ ${app.lastBackup.at}` : "(none yet)"}
        </p>
      </div>

      {/* deliveryLog */}
      <div style={S.card}>
        <h3 style={S.h}>deliveryLog store (read-only this phase)</h3>
        <pre style={S.pre}>{pretty(app.deliveryLog)}</pre>
      </div>

      {/* price history */}
      <div style={S.card}>
        <h3 style={S.h}>price_history store (pre-pop + detection)</h3>
        <button
          style={S.btn}
          disabled={!ie}
          onClick={() => setPpResult(app.prePopulatePriceHistory())}
        >
          Trigger pre-population from loaded export
        </button>
        {!ie && <span style={S.note}>(load the Idealpos export above first)</span>}
        {ppResult && (
          <p style={S.note}>
            seeded <strong>{ppResult.seeded}</strong>, skipped <strong>{ppResult.skipped}</strong>{" "}
            {ppResult.breakdown && `(blank ${ppResult.breakdown.blank} · lstcst=0 ${ppResult.breakdown.lstcstZero} · dup ${ppResult.breakdown.duplicated} · already ${ppResult.breakdown.alreadyPresent})`}
          </p>
        )}
        <p style={S.note}>
          entries: {Object.keys(app.priceHistory).length} · sample 216915:{" "}
          {app.priceHistory["216915"] ? pretty(app.priceHistory["216915"]) : "(not seeded)"}
        </p>

        <div style={{ marginTop: 8 }}>
          <strong style={{ fontSize: 12 }}>detectPriceChange</strong>{" "}
          <input style={S.input} value={dpcCode} onChange={(e) => setDpcCode(e.target.value)} placeholder="invoiceCode" />
          <input style={S.input} value={dpcCost} onChange={(e) => setDpcCost(e.target.value)} placeholder="new cost" />
          <button
            style={S.btn}
            disabled={!ie}
            onClick={() =>
              setDpcResult(
                detectPriceChange(dpcCode, Number(dpcCost), app.priceHistory, app.manualLinks, ie.byCode, ie.duplicateCodes)
              )
            }
          >
            Run
          </button>
          {dpcResult && <pre style={S.pre}>{pretty(dpcResult)}</pre>}
          <p style={S.note}>
            Tip: pre-populate, then run 216915 with cost 14.96 → changed:true, suggested 37.99; with 57.19 → changed:false.
          </p>
        </div>

        <p style={{ ...S.note, marginTop: 8 }}>
          suggestedSellPrice(14.96, 0.60, 0.99) ={" "}
          <strong>{String(suggestedSellPrice(14.96, 0.6, 0.99))}</strong>{" "}
          <span style={S.pill(suggestedSellPrice(14.96, 0.6, 0.99) === 37.99)}>
            {suggestedSellPrice(14.96, 0.6, 0.99) === 37.99 ? "= 37.99 ✓" : "✗"}
          </span>
        </p>
      </div>

      {/* session */}
      <div style={S.card}>
        <h3 style={S.h}>active_session (resumable, 500ms throttle)</h3>
        {sess.resumable && (
          <div style={{ padding: 8, background: "#fff8e6", border: "1px solid #e2c200", borderRadius: 4, marginBottom: 8 }}>
            <strong>Resume offered:</strong> {sess.resumable.invoiceMeta?.invoiceNumber ?? "(session)"}{" "}
            <button style={S.btn} onClick={sess.resume}>Resume</button>
            <button style={S.btn} onClick={sess.discard}>Discard</button>
          </div>
        )}
        <button
          style={S.btn}
          onClick={() =>
            sess.startSession({
              invoiceMeta: { invoiceNumber: "INV-17875", date: "2026-06-02" },
              items: [{ invoiceCode: "216915", description: "Satisfyer Pro 2 Plus", qty: 1, qtyReceived: 0 }],
              step: "checklist",
            })
          }
        >
          Start sample session
        </button>
        <button
          style={S.btn}
          disabled={!sess.session}
          onClick={() =>
            sess.updateSession((prev) => ({
              ...prev,
              items: prev.items.map((it, i) => (i === 0 ? { ...it, qtyReceived: it.qtyReceived + 1 } : it)),
            }))
          }
        >
          +1 qtyReceived
        </button>
        <button style={S.btn} disabled={!sess.session} onClick={() => sess.confirm(() => app.downloadBackup())}>
          Confirm (backup + clear)
        </button>
        <button style={S.btn} disabled={!sess.session} onClick={sess.discard}>
          Discard
        </button>
        <pre style={S.pre}>{sess.session ? pretty(sess.session) : "— no active session —"}</pre>
      </div>

      {/* backup + restore */}
      <div style={S.card}>
        <h3 style={S.h}>Backup / Restore (manualLinks + deliveryLog only)</h3>
        <button style={S.btn} onClick={() => app.downloadBackup()}>Download backup now</button>
        <div style={{ marginTop: 8 }}>
          <label style={{ fontSize: 12 }}>Restore from backup: </label>
          <input type="file" accept="application/json,.json" onChange={onRestore} />
        </div>
        {restoreMsg && (
          <p style={{ ...S.note, color: restoreMsg.ok ? "#1a7f37" : "#cf222e" }}>
            {restoreMsg.ok ? "Restored manualLinks + deliveryLog (idealposExport untouched)." : `Rejected: ${restoreMsg.errors.join("; ")}`}
          </p>
        )}
      </div>
    </div>
  );
}

export default function PersistencePanel() {
  // Bumping reloadKey remounts PersistInner -> both hooks re-read localStorage,
  // simulating a fresh app load (session Resume detection + store durability).
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div>
      <div style={{ ...S.card, background: "#f0f6ff" }}>
        <button style={S.btn} onClick={() => setReloadKey((k) => k + 1)}>
          ⟳ Simulate reload (remount — re-reads localStorage)
        </button>
        <span style={S.note}>
          Reload #{reloadKey}. Use after starting a session to see Resume offered, and to confirm stores survive.
        </span>
      </div>
      <PersistInner key={reloadKey} />
    </div>
  );
}
