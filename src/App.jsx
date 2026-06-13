// src/App.jsx — top-level app: tab router (Delivery / Settings), holds the durable
// stores, the resumable session, and the pricing rule; offers Resume on launch and a
// 30s Undo after a confirm. Consumes the frozen hooks exactly as built. See
// docs/DeliveryCheck_Architecture_v3.md §Component Structure / §Views.

import React, { useEffect, useRef, useState } from "react";

import { useAppData } from "./hooks/useAppData.js";
import { useDeliverySession } from "./hooks/useDeliverySession.js";
import { usePricingRule } from "./hooks/usePricingRule.js";
import BottomTabBar from "./components/BottomTabBar.jsx";
import ResumePrompt from "./components/ResumePrompt.jsx";
import Setup from "./components/delivery/Setup.jsx";
import ReviewPanel from "./components/delivery/ReviewPanel.jsx";
import Reconciliation from "./components/delivery/Reconciliation.jsx";
import MatchAndLink from "./components/delivery/MatchAndLink.jsx";
import DeliveryChecklist from "./components/delivery/DeliveryChecklist.jsx";
import EndOfDelivery from "./components/delivery/EndOfDelivery.jsx";
import Settings from "./components/settings/Settings.jsx";

const UNDO_MS = 30000;

export default function App() {
  const app = useAppData();
  const session = useDeliverySession();
  const pricing = usePricingRule();
  const [tab, setTab] = useState("delivery");

  // Undo-last-confirm lives here because EndOfDelivery unmounts when confirm clears the
  // session. Holds the pre-confirm snapshot for 30s.
  const [undo, setUndo] = useState(null); // { snapshot, secs }
  const undoTimer = useRef(null);

  useEffect(() => () => clearInterval(undoTimer.current), []);

  function onConfirmed(snapshot) {
    clearInterval(undoTimer.current);
    setUndo({ snapshot, secs: Math.round(UNDO_MS / 1000) });
    const startedAt = Date.now();
    undoTimer.current = setInterval(() => {
      const left = Math.round((UNDO_MS - (Date.now() - startedAt)) / 1000);
      if (left <= 0) { clearInterval(undoTimer.current); setUndo(null); }
      else setUndo((u) => (u ? { ...u, secs: left } : u));
    }, 1000);
  }

  function doUndo() {
    clearInterval(undoTimer.current);
    const { snapshot } = undo;
    app.setPriceHistory(snapshot.priceHistory);
    app.setDeliveryLog(snapshot.deliveryLog);
    session.startSession(snapshot.session); // restores at step "end"
    setUndo(null);
    setTab("delivery");
  }

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
        return <ReviewPanel app={app} session={session} />;
      case "match":
        return <MatchAndLink app={app} session={session} />;
      case "checklist":
        return <DeliveryChecklist app={app} session={session} pricing={pricing} />;
      case "end":
        return <EndOfDelivery app={app} session={session} pricing={pricing} onConfirmed={onConfirmed} />;
      default:
        return <Setup app={app} session={session} goSettings={() => setTab("settings")} />;
    }
  }

  return (
    <div className="app">
      {session.resumable && <ResumePrompt session={session} />}
      {undo && (
        <div className="undobar">
          <span>Delivery confirmed.</span>
          <button onClick={doUndo}>Undo ({undo.secs}s)</button>
        </div>
      )}
      <main className="app__main">
        {tab === "delivery" ? renderDelivery() : <Settings app={app} pricing={pricing} />}
      </main>
      <BottomTabBar tab={tab} onTab={setTab} />
    </div>
  );
}
