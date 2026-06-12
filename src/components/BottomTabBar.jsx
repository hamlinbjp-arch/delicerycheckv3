// Persistent bottom tab bar. Switching tabs never clears the session.
import React from "react";

export default function BottomTabBar({ tab, onTab }) {
  return (
    <nav className="tabbar">
      <button className={tab === "delivery" ? "active" : ""} onClick={() => onTab("delivery")}>
        <span className="ico" aria-hidden>📦</span>
        Delivery
      </button>
      <button className={tab === "settings" ? "active" : ""} onClick={() => onTab("settings")}>
        <span className="ico" aria-hidden>⚙️</span>
        Settings
      </button>
    </nav>
  );
}
