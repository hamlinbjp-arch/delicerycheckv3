// Offered on launch when a non-empty active_session exists in storage. Resume adopts
// it; Discard clears it. The frozen useDeliverySession exposes `resumable`.
import React from "react";

export default function ResumePrompt({ session }) {
  const r = session.resumable;
  const inv = r?.invoiceMeta?.invoiceNumber ?? "in-progress delivery";
  return (
    <div className="overlay">
      <div className="card">
        <h2>Resume delivery?</h2>
        <p className="muted">
          An in-progress delivery for <strong>{inv}</strong> was found. Resume where you left
          off, or discard it.
        </p>
        <div className="btn-row">
          <button className="btn-primary" onClick={() => session.resume()}>Resume</button>
          <button className="btn-danger" onClick={() => session.discard()}>Discard</button>
        </div>
      </div>
    </div>
  );
}
