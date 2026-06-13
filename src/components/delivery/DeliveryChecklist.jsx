// Delivery — Step 5: the checklist. Header (invoice + progress + Finish), sticky
// search + FilterBar, and the item list. Computes match (defensive) and priceChange
// once on load and stores them on each item; never re-runs per render. Consumes the
// frozen utils/hooks.

import React, { useEffect, useMemo, useState } from "react";

import { matchItem, detectPriceChange } from "../../lib/utils.js";
import FilterBar from "./FilterBar.jsx";
import ItemRow from "./ItemRow.jsx";

function toMatch(r) {
  if (r.status === "matched") return { status: "matched", via: r.via, key: r.key, desc: r.row.desc, sellPrice: r.row.price };
  return { status: r.status };
}
function toChange(r) {
  return r.changed
    ? { previousCost: r.previousCost, previousSellPrice: r.previousSellPrice, suggestedSellPrice: r.suggestedSellPrice }
    : null;
}
function statusOf(it) {
  if (it.qtyReceived <= 0) return "unchecked";
  if (it.qtyReceived >= it.qty) return "checked";
  return "partial";
}

export default function DeliveryChecklist({ app, session }) {
  const s = session.session;
  const ie = app.idealposExport;
  const meta = s.invoiceMeta || {};
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  // Compute match (defensive — usually set in MatchAndLink) and priceChange ONCE for
  // every item that lacks them, then persist. Guard makes it a no-op afterwards.
  useEffect(() => {
    if (!s || !ie) return;
    if (s.items.every((it) => it.match !== undefined && it.priceChange !== undefined)) return;
    const items = s.items.map((it) => {
      const match = it.match !== undefined ? it.match : toMatch(matchItem(it.invoiceCode, ie.rows, ie.byCode, ie.duplicateCodes, app.manualLinks));
      const priceChange = it.priceChange !== undefined
        ? it.priceChange
        : toChange(detectPriceChange(it.invoiceCode, it.unitPrice, app.priceHistory, app.manualLinks, ie.byCode, ie.duplicateCodes));
      return { ...it, match, priceChange };
    });
    session.updateSession({ items });
  }, [ie, s, app.manualLinks, app.priceHistory, session]);

  const items = s.items;
  const received = items.filter((it) => it.qty > 0 && it.qtyReceived >= it.qty).length;

  const counts = useMemo(() => {
    const c = { all: items.length, unchecked: 0, partial: 0, checked: 0, priceChanged: 0, notInIdealpos: 0 };
    for (const it of items) {
      c[statusOf(it)] += 1;
      if (it.priceChange) c.priceChanged += 1;
      if (!it.match || it.match.status !== "matched") c.notInIdealpos += 1;
    }
    return c;
  }, [items]);

  // Filter then search. Keep each item's original index for in-place updates.
  const visible = useMemo(() => {
    const q = search.trim().toUpperCase();
    return items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => {
        if (filter === "priceChanged" && !it.priceChange) return false;
        if (filter === "notInIdealpos" && it.match && it.match.status === "matched") return false;
        if (["unchecked", "partial", "checked"].includes(filter) && statusOf(it) !== filter) return false;
        if (q && !it.description.toUpperCase().includes(q)) return false;
        return true;
      });
  }, [items, filter, search]);

  return (
    <div className="checklist">
      <div className="checklist__header">
        <div>
          <h1 style={{ margin: 0, fontSize: 17 }}>{meta.invoiceNumber}</h1>
          <div className="muted">{meta.date} · {meta.supplier}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="progress">{received} / {items.length}</div>
          <button className="btn-primary" style={{ width: "auto", minHeight: 36, padding: "6px 14px" }} onClick={() => session.updateSession({ step: "end" })}>Finish</button>
        </div>
      </div>

      <div className="checklist__search">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items…" />
        {search && <button className="clearx" onClick={() => setSearch("")} aria-label="clear search">×</button>}
      </div>

      <FilterBar filter={filter} onFilter={setFilter} counts={counts} />

      <div className="checklist__list">
        {visible.length === 0 ? (
          <p className="muted" style={{ padding: "12px 4px" }}>No items match.</p>
        ) : (
          visible.map(({ it, index }) => (
            <ItemRow key={index} item={it} index={index} app={app} session={session} ie={ie} />
          ))
        )}
      </div>
    </div>
  );
}
