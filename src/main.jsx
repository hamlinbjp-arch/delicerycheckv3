import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";
import Harness from "./harness/Harness.jsx";
import "./app.css";

// Single entry. The harness stays reachable at /harness for ongoing validation; every
// other path is the delivery app. (Vite's SPA fallback serves index.html for /harness.)
const isHarness = window.location.pathname.replace(/\/+$/, "").endsWith("/harness");

createRoot(document.getElementById("root")).render(isHarness ? <Harness /> : <App />);
