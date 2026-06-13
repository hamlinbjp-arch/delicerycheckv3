// Single-select filter strip for the checklist. Counts are passed in (derived from
// session.items by DeliveryChecklist every render; never stored).
import React from "react";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "unchecked", label: "Unchecked" },
  { id: "partial", label: "Partial" },
  { id: "checked", label: "Checked" },
  { id: "priceChanged", label: "Price △" },
  { id: "notInIdealpos", label: "Not in POS" },
];

export default function FilterBar({ filter, onFilter, counts }) {
  return (
    <div className="filterbar">
      {FILTERS.map((f) => (
        <button
          key={f.id}
          className={`filterbar__tab${filter === f.id ? " active" : ""}`}
          onClick={() => onFilter(f.id)}
        >
          {f.label}
          <span className="filterbar__count">{counts[f.id] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
