// src/hooks/useAppData.js
//
// Durable localStorage stores for DeliveryCheck. See
// docs/DeliveryCheck_Architecture_v3.md §Persistence.
//
//   dc.idealposExport — the parsed POS export (replaced entirely on re-upload)
//   dc.manualLinks    — invoiceCode -> link entry (backup on every write)
//   dc.deliveryLog    — append-only array (read/init only)
//   dc.priceHistory   — tracking key -> { lastCost, lastSellPrice, lastInvoice, lastDate }
//
// Backups (manualLinks + deliveryLog + priceHistory) download on every manualLinks
// write and on confirm. Restore replaces those three stores, after validating shape;
// it never touches idealposExport.

import { useCallback, useEffect, useRef, useState } from "react";

import { prePopulatePriceHistory as seedPriceHistory } from "../lib/utils.js";

const KEYS = {
  idealpos: "dc.idealposExport",
  links: "dc.manualLinks",
  log: "dc.deliveryLog",
  priceHistory: "dc.priceHistory",
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
  const [priceHistory, setPriceHistoryState] = useState({});
  const [lastBackup, setLastBackup] = useState(null);

  // Latest-value refs so a backup triggered elsewhere (e.g. session confirm) and the
  // pre-pop action never read a stale closure.
  const linksRef = useRef(manualLinks);
  const logRef = useRef(deliveryLog);
  const priceHistoryRef = useRef(priceHistory);
  const idealposRef = useRef(idealposExport);
  useEffect(() => { linksRef.current = manualLinks; }, [manualLinks]);
  useEffect(() => { logRef.current = deliveryLog; }, [deliveryLog]);
  useEffect(() => { priceHistoryRef.current = priceHistory; }, [priceHistory]);
  useEffect(() => { idealposRef.current = idealposExport; }, [idealposExport]);

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
    setPriceHistoryState(readJSON(KEYS.priceHistory, {}));
  }, [storageAvailable]);

  // Build + download a backup of manualLinks + deliveryLog + priceHistory.
  const writeBackup = useCallback((links, log, history) => {
    const payload = {
      type: "deliverycheck-backup",
      version: 2,
      createdAt: new Date().toISOString(),
      manualLinks: links,
      deliveryLog: log,
      priceHistory: history,
    };
    const filename = backupFilename();
    triggerDownload(filename, JSON.stringify(payload, null, 2));
    setLastBackup({ filename, at: payload.createdAt });
    return { filename, payload };
  }, []);

  const downloadBackup = useCallback(
    () => writeBackup(linksRef.current, logRef.current, priceHistoryRef.current),
    [writeBackup]
  );

  // idealposExport: persist rows + metadata only; rebuild index on read. Replaces the
  // store entirely and never touches links/log/priceHistory.
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

  // Pre-populate price_history from the current Idealpos export. Seeds a baseline cost
  // for clean rows with LSTCST > 0, never overwriting an existing entry. Returns the
  // seeded/skipped tally. (In the app this runs on CSV upload; exposed as an action so
  // the harness can trigger it.)
  const prePopulatePriceHistory = useCallback(() => {
    const ie = idealposRef.current;
    if (!ie) return { seeded: 0, skipped: 0, breakdown: null };
    const { history, seeded, skipped, breakdown } = seedPriceHistory(
      ie.rows,
      ie.duplicateCodes,
      priceHistoryRef.current
    );
    writeJSON(KEYS.priceHistory, history);
    setPriceHistoryState(history);
    return { seeded, skipped, breakdown };
  }, []);

  // manualLinks writes -> persist + backup on every write.
  const setManualLink = useCallback((invoiceCode, entry) => {
    setManualLinksState((prev) => {
      const next = { ...prev, [invoiceCode]: entry };
      writeJSON(KEYS.links, next);
      writeBackup(next, logRef.current, priceHistoryRef.current);
      return next;
    });
  }, [writeBackup]);

  const removeManualLink = useCallback((invoiceCode) => {
    setManualLinksState((prev) => {
      const next = { ...prev };
      delete next[invoiceCode];
      writeJSON(KEYS.links, next);
      writeBackup(next, logRef.current, priceHistoryRef.current);
      return next;
    });
  }, [writeBackup]);

  // Restore: validate shape, then replace manualLinks + deliveryLog + priceHistory.
  // Back-compat: a v1 backup with no priceHistory key is accepted and treated as {}.
  const restoreFromBackup = useCallback((obj) => {
    const errors = [];
    if (!obj || typeof obj !== "object") errors.push("backup is not an object");
    else {
      if (typeof obj.manualLinks !== "object" || obj.manualLinks === null || Array.isArray(obj.manualLinks))
        errors.push("manualLinks missing or not an object");
      if (!Array.isArray(obj.deliveryLog)) errors.push("deliveryLog missing or not an array");
      if (obj.priceHistory !== undefined && (typeof obj.priceHistory !== "object" || obj.priceHistory === null || Array.isArray(obj.priceHistory)))
        errors.push("priceHistory present but not an object");
    }
    if (errors.length) return { ok: false, errors };

    const history = obj.priceHistory ?? {}; // missing -> empty (back-compat)
    writeJSON(KEYS.links, obj.manualLinks);
    writeJSON(KEYS.log, obj.deliveryLog);
    writeJSON(KEYS.priceHistory, history);
    setManualLinksState(obj.manualLinks);
    setDeliveryLogState(obj.deliveryLog);
    setPriceHistoryState(history);
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
    priceHistory,
    prePopulatePriceHistory,
    downloadBackup,
    restoreFromBackup,
    lastBackup,
  };
}

export default useAppData;
