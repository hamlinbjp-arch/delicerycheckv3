// src/App.jsx — top-level app: tab router (Delivery / Settings), holds the durable
// stores and the resumable session, offers Resume on launch. Consumes the frozen
// hooks exactly as built. See docs/DeliveryCheck_Architecture_v3.md §Component
// Structure / §Views.

import React, { useState } from "react";

import { useAppData } from "./hooks/useAppData.js";
import { useDeliverySession } from "./hooks/useDeliverySession.js";
import BottomTabBar from "./components/BottomTabBar.jsx";
import ResumePrompt from "./components/ResumePrompt.jsx";
import Setup from "./components/delivery/Setup.jsx";
import Reconciliation from "./components/delivery/Reconciliation.jsx";
import Settings from "./components/settings/Settings.jsx";

// Placeholder for delivery steps not built in this slice (Review / Match / Checklist /
// End). Keeps the router total without crashing while those land in later turns.
function StepPlaceholder({ title, session }) {
  return (
    <div>
      <div className="stephead"><h1>{title}</h1></div>
      <div className="card">
        <p className="muted">This step isn't built yet — coming in the next slice.</p>
        <button onClick={() => session.discard()}>Discard delivery</button>
      </div>
    </div>
  );
}

export default function App() {
  const app = useAppData();
  const session = useDeliverySession();
  const [tab, setTab] = useState("delivery");

  function renderDelivery() {
    const s = session.session;
    const step = s ? s.step : "setup";

    if (!s || step === "setup") {
      return <Setup app={app} session={session} goSettings={() => setTab("settings")} />;
    }
    switch (step) {
      case "reconcile":
        return <Reconciliation app={app} session={session} />;
      case "review":
        return <StepPlaceholder title="Review unclassified rows" session={session} />;
      case "match":
        return <StepPlaceholder title="Match & link" session={session} />;
      case "checklist":
        return <StepPlaceholder title="Checklist" session={session} />;
      case "end":
        return <StepPlaceholder title="End of delivery" session={session} />;
      default:
        return <Setup app={app} session={session} goSettings={() => setTab("settings")} />;
    }
  }

  return (
    <div className="app">
      {session.resumable && <ResumePrompt session={session} />}
      <main className="app__main">
        {tab === "delivery" ? renderDelivery() : <Settings app={app} />}
      </main>
      <BottomTabBar tab={tab} onTab={setTab} />
    </div>
  );
}
