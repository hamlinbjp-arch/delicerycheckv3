// Settings: Idealpos CSV (auto-seeds price history), pricing rule, manual links,
// delivery log, export/restore, install hint, and danger zone. Consumes the frozen
// hooks + the approved additive useAppData setters.

import React, { useState } from "react";

import parseIdealpos from "../../lib/parseIdealpos.js";

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function Settings({ app, pricing }) {
  const [msg, setMsg] = useState(null);
  const [restoreMsg, setRestoreMsg] = useState(null);
  const [expanded, setExpanded] = useState(null); // delivery-log index expanded
  const ie = app.idealposExport;

  async function onCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = parseIdealpos(await file.text());
      app.setIdealposExport(result);
      const seed = app.prePopulatePriceHistory(); // auto-seed price history on upload
      setMsg({ ok: true, text: `Loaded ${result.stats.recordCount} products · seeded ${seed.seeded} price-history entries.` });
    } catch (err) {
      setMsg({ ok: false, text: err?.message || String(err) });
    }
  }

  function onRestore(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let obj;
      try { obj = JSON.parse(reader.result); } catch { setRestoreMsg({ ok: false, text: "Not valid JSON" }); return; }
      const r = app.restoreFromBackup(obj);
      setRestoreMsg(r.ok ? { ok: true, text: "Restored manual links, delivery log, and price history." } : { ok: false, text: r.errors.join("; ") });
    };
    reader.readAsText(file);
  }

  // Resolve a manual link to a POS description for display.
  function linkDesc(entry) {
    if (entry.snapshot) return entry.snapshot.desc;
    const row = ie?.byCode?.get(entry.key)?.[0];
    return row ? row.desc : `(key ${entry.key})`;
  }

  const isInstalled =
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  const age = ie ? daysSince(ie.uploadedAt) : null;
  const links = Object.entries(app.manualLinks);
  const marginPct = Math.round(pricing.rule.margin * 100);

  return (
    <div>
      <div className="stephead"><h1>Settings</h1></div>

      {!app.storageAvailable && (
        <div className="banner error">Storage is unavailable (private mode or full). Data won't persist this session.</div>
      )}

      {/* Idealpos export */}
      <div className="card">
        <h2>Idealpos export</h2>
        {ie ? (
          <p className="muted">
            {ie.stats.recordCount} products · {ie.stats.blankCount} blank · {ie.stats.duplicateCodeCount} duplicated ·
            {" "}uploaded {age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}
          </p>
        ) : (
          <p className="muted">No export loaded yet.</p>
        )}
        {age != null && age >= 30 && <div className="banner warn">POS data is {age} days old — re-export to keep prices current.</div>}
        <label>Upload export (.txt / .csv)</label>
        <input type="file" accept=".txt,.csv,text/csv" onChange={onCsv} />
        {msg && <p className="muted" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
      </div>

      {/* Pricing rule */}
      <div className="card">
        <h2>Pricing rule</h2>
        <p className="muted">Used to suggest a sell price when a cost changes.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label>Target margin %</label>
            <input type="number" inputMode="numeric" value={marginPct}
              onChange={(e) => { const m = Number(e.target.value) / 100; if (m >= 0 && m < 1) pricing.setRule({ margin: m }); }} />
          </div>
          <div style={{ flex: 1 }}>
            <label>Round to end in</label>
            <input type="number" inputMode="decimal" step="0.01" value={pricing.rule.rounding}
              onChange={(e) => { const r = Number(e.target.value); if (r > 0 && r < 1) pricing.setRule({ rounding: r }); }} />
          </div>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>e.g. a $10.00 cost suggests {`$${(Math.ceil(10 / (1 - pricing.rule.margin)) - (1 - pricing.rule.rounding)).toFixed(2)}`}.</p>
      </div>

      {/* Manual links */}
      <div className="card">
        <h2>Manual links ({links.length})</h2>
        {links.length === 0 ? (
          <p className="muted">No manual links yet.</p>
        ) : (
          links.map(([code, entry]) => (
            <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ fontSize: 13 }}><strong>{code}</strong> → {linkDesc(entry)}</span>
              <button className="btn-link" onClick={() => app.removeManualLink(code)}>Delete</button>
            </div>
          ))
        )}
      </div>

      {/* Delivery log */}
      <div className="card">
        <h2>Delivery log ({app.deliveryLog.length})</h2>
        {app.deliveryLog.length === 0 ? (
          <p className="muted">No deliveries logged yet.</p>
        ) : (
          app.deliveryLog.map((e, i) => {
            const shortfalls = (e.lines || []).filter((l) => l.qtyReceived < l.qty);
            return (
              <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "6px 0" }}>
                <button className="btn-link" style={{ display: "block", textAlign: "left", width: "100%" }} onClick={() => setExpanded(expanded === i ? null : i)}>
                  {e.invoiceNumber} · {e.date} · {(e.lines || []).length} lines{shortfalls.length ? ` · ${shortfalls.length} short` : ""}
                </button>
                {expanded === i && (
                  <div style={{ paddingLeft: 8 }}>
                    {(e.lines || []).map((l, j) => (
                      <div key={j} className="muted" style={{ fontSize: 12 }}>
                        {l.desc} — {l.qtyReceived}/{l.qty}{l.qtyReceived < l.qty ? " ⚠ short" : ""}{l.changed ? " · cost changed" : ""}
                      </div>
                    ))}
                    {(e.flaggedNotOnList || []).map((f, j) => <div key={`f${j}`} className="muted" style={{ fontSize: 12 }}>• not on list: {f}</div>)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Export / Restore */}
      <div className="card">
        <h2>Backup</h2>
        <button onClick={() => app.downloadBackup()}>Export data</button>
        <div style={{ marginTop: 8 }}>
          <label>Restore from backup</label>
          <input type="file" accept="application/json,.json" onChange={onRestore} />
          {restoreMsg && <p className="muted" style={{ color: restoreMsg.ok ? "var(--accent)" : "var(--danger)" }}>{restoreMsg.text}</p>}
        </div>
      </div>

      {/* Install — hide once running as an installed standalone app. */}
      {isInstalled ? (
        <div className="card">
          <h2>Installed ✓</h2>
          <p className="muted">Running as a home-screen app — your stored data is durable.</p>
        </div>
      ) : (
        <div className="card">
          <h2>Add to Home Screen</h2>
          <p className="muted">
            Install DeliveryCheck to your home screen (Share → "Add to Home Screen" on iOS;
            the install icon in the address bar on Android/desktop). Installed apps keep
            their stored data — browsers can evict a normal site's storage after about a
            week, which would wipe your links and price history.
          </p>
        </div>
      )}

      {/* Danger zone */}
      <div className="card" style={{ borderColor: "var(--danger)" }}>
        <h2 style={{ color: "var(--danger)" }}>Danger zone</h2>
        <div className="btn-row">
          <button className="btn-danger" onClick={() => { if (window.confirm("Clear all price history?")) app.setPriceHistory({}); }}>Clear price history</button>
          <button className="btn-danger" onClick={() => { if (window.confirm("Clear all manual links?")) app.setManualLinks({}); }}>Clear manual links</button>
          <button className="btn-danger" onClick={() => { if (window.confirm("Clear the delivery log?")) app.setDeliveryLog([]); }}>Clear delivery log</button>
        </div>
      </div>
    </div>
  );
}
