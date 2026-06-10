import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// Minimal config for the single-page parser test harness (CLAUDE.md: the only
// allowed UI in the parser-only phase). The `node:url` alias lets the Node-first
// parser (src/lib/parsePDF.js) bundle for the browser without editing it — see
// src/harness/node-url-shim.js.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "node:url": fileURLToPath(
        new URL("./src/harness/node-url-shim.js", import.meta.url)
      ),
    },
  },
});
