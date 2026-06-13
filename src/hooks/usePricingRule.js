// src/hooks/usePricingRule.js
//
// The pricing rule (target margin + rounding) used to suggest sell prices. Persisted
// to localStorage and consumed wherever a suggested sell is shown by recomputing
// suggestedSellPrice(cost, rule.margin, rule.rounding). New store — independent of the
// frozen useAppData. Defaults match the architecture: 60% margin, prices end in .99.

import { useCallback, useState } from "react";

const KEY = "dc.pricingRule";
const DEFAULT = { margin: 0.6, rounding: 0.99 };

function load() {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return DEFAULT;
    const v = JSON.parse(s);
    const margin = Number(v.margin);
    const rounding = Number(v.rounding);
    return {
      margin: margin >= 0 && margin < 1 ? margin : DEFAULT.margin,
      rounding: rounding > 0 && rounding < 1 ? rounding : DEFAULT.rounding,
    };
  } catch {
    return DEFAULT;
  }
}

export function usePricingRule() {
  const [rule, setRuleState] = useState(load);

  const setRule = useCallback((next) => {
    const merged = { ...rule, ...next };
    try {
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch (e) {
      console.warn("usePricingRule: write failed", e);
    }
    setRuleState(merged);
  }, [rule]);

  return { rule, setRule };
}

export default usePricingRule;
