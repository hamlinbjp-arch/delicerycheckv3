// src/hooks/useDeliverySession.js
//
// The resumable in-progress delivery (step 3, persistence phase). Persists the full
// session object to localStorage on every change, throttled to 500ms, so a reload /
// lock / crash never loses check-offs. On mount it detects an existing session and
// surfaces it for a Resume prompt (it does NOT auto-activate). Clears only on an
// explicit confirm() or discard(). See docs/DeliveryCheck_Architecture_v3.md
// §active_session.

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "dc.activeSession";
const THROTTLE_MS = 500;

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
    console.warn(`useDeliverySession: write failed for ${key}`, e);
    return false;
  }
}

// A session is "resumable" only if it actually holds a delivery.
function isNonEmptySession(s) {
  return (
    s != null &&
    typeof s === "object" &&
    (s.invoiceMeta != null || (Array.isArray(s.items) && s.items.length > 0))
  );
}

export function useDeliverySession() {
  const [session, setSession] = useState(null);
  const [resumable, setResumable] = useState(null);

  const sessionRef = useRef(session);
  const lastWriteRef = useRef(0);
  const timerRef = useRef(null);

  // Keep a latest-value ref so the throttle timer and unload flush write the most
  // recent session, not a stale snapshot.
  useEffect(() => {
    sessionRef.current = session;
  });

  // Detect an existing in-progress delivery on mount (offer Resume; don't activate).
  useEffect(() => {
    const stored = readJSON(KEY, null);
    if (isNonEmptySession(stored)) setResumable(stored);
  }, []);

  // Throttled persist (trailing): at most one write per 500ms, always the latest.
  useEffect(() => {
    if (session === null) return;
    const since = Date.now() - lastWriteRef.current;
    const flush = () => {
      timerRef.current = null;
      lastWriteRef.current = Date.now();
      writeJSON(KEY, sessionRef.current);
    };
    if (since >= THROTTLE_MS) {
      lastWriteRef.current = Date.now();
      writeJSON(KEY, sessionRef.current);
    } else if (timerRef.current == null) {
      timerRef.current = setTimeout(flush, THROTTLE_MS - since);
    }
  }, [session]);

  // Durability across tab unload: flush the latest session on pagehide, and on
  // unmount clear any pending timer and flush.
  useEffect(() => {
    const flush = () => {
      if (sessionRef.current !== null) writeJSON(KEY, sessionRef.current);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
    };
  }, []);

  const startSession = useCallback((initial = {}) => {
    setResumable(null);
    setSession({
      invoiceMeta: initial.invoiceMeta ?? null,
      items: initial.items ?? [],
      reviewRows: initial.reviewRows ?? [],
      flaggedNotOnList: initial.flaggedNotOnList ?? [],
      step: initial.step ?? "setup",
    });
  }, []);

  const resume = useCallback(() => {
    setResumable((r) => {
      if (r) setSession(r);
      return null;
    });
  }, []);

  const updateSession = useCallback((updaterOrPartial) => {
    setSession((prev) => {
      if (prev === null) return prev;
      return typeof updaterOrPartial === "function"
        ? updaterOrPartial(prev)
        : { ...prev, ...updaterOrPartial };
    });
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable — nothing to clear */
    }
    sessionRef.current = null;
    setSession(null);
    setResumable(null);
  }, []);

  // confirm runs an optional callback (e.g. trigger a backup) on the session being
  // confirmed, then clears. discard just clears.
  const confirm = useCallback(
    (onConfirm) => {
      if (typeof onConfirm === "function") onConfirm(sessionRef.current);
      clear();
    },
    [clear]
  );

  const discard = useCallback(() => {
    clear();
  }, [clear]);

  return { session, resumable, startSession, resume, updateSession, confirm, discard };
}

export default useDeliverySession;
