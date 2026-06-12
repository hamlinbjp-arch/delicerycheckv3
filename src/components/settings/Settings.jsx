// Settings. This slice implements the Idealpos CSV upload only (the rest — pricing
// rule, manual links, delivery log, export/restore, install, danger zone — lands in a
// later turn). See architecture §Views (Settings).

import React, { useState } from "react";

import parseIdealpos from "../../lib/parseIdealpos.js";

function daysSince(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function Settings({ app }) {
  const [msg, setMsg] = useState(null);
  const ie = app.idealposExport;

  async function onCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const result = parseIdealpos(await file.text());
      app.setIdealposExport(result);
      setMsg({ ok: true, text: `Loaded ${result.stats.recordCount} products.` });
    } catch (err) {
      setMsg({ ok: false, text: err?.message || String(err) });
    }
  }

  const age = ie ? daysSince(ie.uploadedAt) : null;

  return (
    <div>
      <div className="stephead"><h1>Settings</h1></div>

      {!app.storageAvailable && (
        <div className="banner error">
          Storage is unavailable (private mode or full). Data won't persist this session.
        </div>
      )}

      <div className="card">
        <h2>Idealpos export</h2>
        {ie ? (
          <p className="muted">
            {ie.stats.recordCount} products · {ie.stats.blankCount} blank codes ·
            {" "}{ie.stats.duplicateCodeCount} duplicated · uploaded{" "}
            {age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}
          </p>
        ) : (
          <p className="muted">No export loaded yet.</p>
        )}
        {age != null && age >= 30 && (
          <div className="banner warn">POS data is {age} days old — re-export to keep prices current.</div>
        )}
        <label>Upload export (.txt / .csv)</label>
        <input type="file" accept=".txt,.csv,text/csv" onChange={onCsv} />
        {msg && <p className="muted" style={{ color: msg.ok ? "var(--accent)" : "var(--danger)" }}>{msg.text}</p>}
      </div>

      <div className="card">
        <h2>More settings</h2>
        <p className="muted">
          Pricing rule, manual links, delivery log, export/restore, install, and danger
          zone are coming in a later slice.
        </p>
      </div>
    </div>
  );
}
