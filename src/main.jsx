import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import Harness from "./harness/Harness.jsx";
import "./app.css";

// Single entry. The harness stays reachable at /harness for ongoing validation; every
// other path is the delivery app. (Vite's SPA fallback serves index.html for /harness.)
const isHarness = window.location.pathname.replace(/\/+$/, "").endsWith("/harness");

createRoot(document.getElementById("root")).render(isHarness ? <Harness /> : <App />);

// Register the service worker in production builds only (a SW caching dev assets fights
// Vite's HMR). Home-screen install + offline shell rely on this; see public/sw.js.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("SW registration failed", err));
  });
}
