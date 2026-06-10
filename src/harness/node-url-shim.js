// Browser shim for Node's `node:url`, aliased in vite.config.js.
//
// parsePDF.js (kept Node-first and unchanged) imports `fileURLToPath` at module top
// to compute a Node worker path. In the browser that path is meaningless and is
// overridden in Harness.jsx by reassigning GlobalWorkerOptions.workerSrc to the
// Vite-bundled worker URL. This shim only needs to resolve and not throw at import
// time; its return value is never used.
export function fileURLToPath(u) {
  return typeof u === "string" ? u : (u && u.href) || String(u);
}

export default { fileURLToPath };
