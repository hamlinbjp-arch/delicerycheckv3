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

## Current phase: PARSER ONLY

We are building and validating the WSS invoice parser. Until I explicitly say
otherwise, do **not** build:
- matching logic
- CSV import / Idealpos identity
- localStorage / persistence
- the delivery workflow
- price history
- manual links
- the checklist UI

The only exception is a minimal, single-page test harness whose sole purpose is to
validate the parser. No app routing, no other components.

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
