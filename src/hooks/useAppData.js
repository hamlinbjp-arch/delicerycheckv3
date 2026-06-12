// src/hooks/useAppData.js
//
// Durable localStorage stores for DeliveryCheck (step 3, persistence phase). Manages
// three stores; price_history is explicitly out of scope this phase. See
// docs/DeliveryCheck_Architecture_v3.md §Persistence.
//
//   dc.idealposExport — the parsed POS export (replaced entirely on re-upload)
//   dc.manualLinks    — invoiceCode -> link entry (backup on every write)
//   dc.deliveryLog    — append-only array (read/init only this phase)
//
// Backups (manualLinks + deliveryLog) download on every manualLinks write and on
// confirm. Restore replaces manualLinks + deliveryLog only, after validating shape.

import { useCallback, useEffect, useRef, useState } from "react";

const KEYS = {
  idealpos: "dc.idealposExport",
  links: "dc.manualLinks",
  log: "dc.deliveryLog",
};

// --- storage helpers ---------------------------------------------------------
function probeStorage() {
  try {
    const k = "__dc_probe__";
    localStorage.setItem(k, "1");
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}
function readJSON(key, fallback) {
  try {
    const s = localStorage.getItem(key);
    return s == null ? fallback : JSON.parse(s);
  } catch {
    return fallback;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn(`useAppData: write failed for ${key}`, e);
    return false;
  }
}

// Rebuild the byCode index (Map) and duplicateCodes (Set) from rows. byCode/Set are
// not JSON-serializable and persisting them would duplicate every row (~2x), so we
// store only rows + metadata and reconstruct here on read. Mirrors the indexing in
// the (frozen) src/lib/parseIdealpos.js without importing/altering it.
function indexRows(rows) {
  const byCode = new Map();
  for (const r of rows) {
    if (r.suppcode === "") continue;
    const bucket = byCode.get(r.suppcode);
    if (bucket) bucket.push(r);
    else byCode.set(r.suppcode, [r]);
  }
  const duplicateCodes = new Set();
  for (const [code, bucket] of byCode) if (bucket.length > 1) duplicateCodes.add(code);
  return { byCode, duplicateCodes };
}

// --- backup ------------------------------------------------------------------
function pad2(n) {
  return String(n).padStart(2, "0");
}
function backupFilename(d = new Date()) {
  return `deliverycheck-backup-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`;
}
function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function useAppData() {
  const [storageAvailable] = useState(probeStorage);
  const [idealposExport, setIdealposExportState] = useState(null);
  const [manualLinks, setManualLinksState] = useState({});
  const [deliveryLog, setDeliveryLogState] = useState([]);
  const [lastBackup, setLastBackup] = useState(null);

  // Latest-value refs so a backup triggered elsewhere (e.g. session confirm) never
  // reads a stale closure.
  const linksRef = useRef(manualLinks);
  const logRef = useRef(deliveryLog);
  useEffect(() => { linksRef.current = manualLinks; }, [manualLinks]);
  useEffect(() => { logRef.current = deliveryLog; }, [deliveryLog]);

  // Load all stores on mount.
  useEffect(() => {
    if (!storageAvailable) return;
    const stored = readJSON(KEYS.idealpos, null);
    if (stored && Array.isArray(stored.rows)) {
      const { byCode, duplicateCodes } = indexRows(stored.rows);
      setIdealposExportState({ ...stored, byCode, duplicateCodes });
    }
    setManualLinksState(readJSON(KEYS.links, {}));
    setDeliveryLogState(readJSON(KEYS.log, []));
  }, [storageAvailable]);

  // Build + download a backup of links + log (price_history excluded this phase).
  const writeBackup = useCallback((links, log) => {
    const payload = {
      type: "deliverycheck-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      manualLinks: links,
      deliveryLog: log,
    };
    const filename = backupFilename();
    triggerDownload(filename, JSON.stringify(payload, null, 2));
    setLastBackup({ filename, at: payload.createdAt });
    return { filename, payload };
  }, []);

  const downloadBackup = useCallback(
    () => writeBackup(linksRef.current, logRef.current),
    [writeBackup]
  );

  // idealposExport: persist rows + metadata only; rebuild index on read. Replaces the
  // store entirely and never touches links/log.
  const setIdealposExport = useCallback((parseResult) => {
    const stored = {
      rows: parseResult.rows,
      blankCount: parseResult.blankCount,
      stats: parseResult.stats,
      uploadedAt: new Date().toISOString(),
    };
    writeJSON(KEYS.idealpos, stored);
    setIdealposExportState({
      ...stored,
      byCode: parseResult.byCode,
      duplicateCodes: parseResult.duplicateCodes,
    });
  }, []);

  // manualLinks writes -> persist + backup on every write.
  const setManualLink = useCallback((invoiceCode, entry) => {
    setManualLinksState((prev) => {
      const next = { ...prev, [invoiceCode]: entry };
      writeJSON(KEYS.links, next);
      writeBackup(next, logRef.current);
      return next;
    });
  }, [writeBackup]);

  const removeManualLink = useCallback((invoiceCode) => {
    setManualLinksState((prev) => {
      const next = { ...prev };
      delete next[invoiceCode];
      writeJSON(KEYS.links, next);
      writeBackup(next, logRef.current);
      return next;
    });
  }, [writeBackup]);

  // Restore: validate shape, then replace manualLinks + deliveryLog only.
  const restoreFromBackup = useCallback((obj) => {
    const errors = [];
    if (!obj || typeof obj !== "object") errors.push("backup is not an object");
    else {
      if (typeof obj.manualLinks !== "object" || obj.manualLinks === null || Array.isArray(obj.manualLinks))
        errors.push("manualLinks missing or not an object");
      if (!Array.isArray(obj.deliveryLog)) errors.push("deliveryLog missing or not an array");
    }
    if (errors.length) return { ok: false, errors };

    writeJSON(KEYS.links, obj.manualLinks);
    writeJSON(KEYS.log, obj.deliveryLog);
    setManualLinksState(obj.manualLinks);
    setDeliveryLogState(obj.deliveryLog);
    return { ok: true, errors: [] };
  }, []);

  return {
    storageAvailable,
    idealposExport,
    setIdealposExport,
    manualLinks,
    setManualLink,
    removeManualLink,
    deliveryLog,
    downloadBackup,
    restoreFromBackup,
    lastBackup,
  };
}

export default useAppData;
