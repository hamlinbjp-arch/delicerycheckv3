# CLAUDE.md — DeliveryCheck

Standing context for this repo. Read this before every task.

## What this is

A single-user stockroom delivery-checking tool. The user uploads a Wholesale
Solutions (WSS) invoice PDF and checks items off as they pull them from the box,
seeing the correct sell price and being alerted to cost-price changes before stock
goes out. The authoritative spec is `./docs/DeliveryCheck_Architecture_v3.md`; the
real-data analysis behind it is `./docs/WSS_Invoice_Parsing_Analysis.md`.

## Hard constraints — do not violate, do not propose otherwise

This is a personal, offline, single-user tool. It does **not** have, and we will
**not** add:
- user accounts, authentication, or multi-user anything
- a backend or server
- cloud sync or multi-device support
- analytics or telemetry
- enterprise features

When a choice exists between a simple approach and a complex one, take the simple
one and say why.

## Current phase: PRICE HISTORY

**Done and frozen** (validated/built; don't change their output shape or behaviour
without flagging it first):
- the WSS invoice parser (`src/lib/parsePDF.js`)
- the Idealpos export ingest + identity sets (`src/lib/parseIdealpos.js`)
- the matching core (`src/lib/utils.js` — `matchItem()`, `trackingKey()`)
- the persistence layer (`src/hooks/useAppData.js`, `src/hooks/useDeliverySession.js`)
  — the existing stores (`active_session`, Idealpos export, `manual_links`,
  `delivery_log`), backup/restore, throttled session writes, and Resume-on-launch

**Now building:** the `price_history` store (keyed by **tracking key**), its
**pre-population from the Idealpos export**, and **price-change detection**:
- pre-pop rule: for each export row with `LSTCST > 0`, seed `{ lastCost, lastSellPrice,
  lastInvoice: "idealpos-import", lastDate }` — **never overwrite** an existing entry,
  **skip blank `SUPPCODE`** rows.
- `detectPriceChange()` and `suggestedSellPrice()` in `utils.js` (advisory; margin/
  rounding from a setting). History is written **once per key on confirm**, only for
  matched items with `qtyReceived > 0`.
- Two in-scope extensions to the frozen persistence layer: **add the `price_history`
  store alongside the existing stores in `useAppData.js`**, and **fold `price_history`
  into the backup/restore payload** (architecture §Backup files).

Follow architecture §price_history, §Price Change Detection, §Suggested Sell Price.

Until I explicitly say otherwise, do **not** build:
- the checklist UI, end-of-delivery workflow, reconciliation-recovery UI, or the
  delivery workflow

Test harnesses that validate the frozen modules and this phase headless / in the
existing Vite harness are fine. No delivery-workflow UI yet.

## Parser principles (from the architecture)

- **Classify by structure, not by description text.** A row is a product only if it
  has a leading numeric code AND qty > 0 AND amount > 0. Shipping, store credit, N/A
  lines, page headers, and totals are classified by shape, not keywords.
- **Never guess. Never silently discard.** Any row that fits no class becomes a
  *review row* (raw text + reason), surfaced for the user — never dropped, never
  assumed.
- **Fail loud, but recoverable.** A missing header field warns and continues; only
  "zero products parsed" is a hard stop. The parser surfaces problems; it does not
  strand the user.
- **Anchor on `Subtotal` / `TOTAL NZD`, never on PAYMENT ADVICE** — the tear-off
  slip can linearize before the final line items on multi-page invoices.
- **Reconcile completeness:** `Σ(product amounts) + shipping − store credit ≈ printed
  Subtotal`, within a small, justified, line-count-aware tolerance. This is what
  catches a dropped line.

## Output interface (freeze once validated)

`parsePDF.js` returns: `{ meta, items, nonProductLines, reviewRows, reconciliation,
debug }`. `items` is products only. `nonProductLines` carries shipping / storeCredit
/ notSupplied (reconciliation needs them). `debug` carries the intermediate stages
(raw text, reconstructed rows, classifications) as structured data. Once validated,
do not change this shape without flagging it first.

## Tech & environment

- React + Vite · `pdfjs-dist` (PDF) · `papaparse` (CSV) · `localStorage` (later)
- No external UI library.
- **The parser must run headless in Node** so it's batch-testable. pdfjs-dist in
  Node typically needs the legacy build and the worker disabled — the spike sorts
  out the exact setup and everything reuses it.
- Fixtures: `./fixtures/*.pdf`. Tools/scripts: `./tools/`. Parser: `./src/lib/`.

## Working agreements

- **Design before code** on anything non-trivial; show the plan and wait.
- **Expose intermediate state as structured data**, not scattered console.logs.
- **State your assumptions** wherever the spec is silent (e.g. the reconciliation
  tolerance) rather than picking silently.
- **Be honest about ground truth.** There's no printed line-count to validate
  product counts against; don't claim correctness you can't substantiate. Reconcile
  against extracted printed totals and cross-check totals against the analysis
  appendix.
- **Don't expand scope** while fixing bugs or building a step. Stay inside the
  current phase.
- Validate against the **real invoices in `./fixtures/`**, never invented examples.
