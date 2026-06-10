# DeliveryCheck — Architecture & Specification (v3)

*Single-user stockroom delivery-checking tool. No backend, no accounts, no sync.*

*This revision keeps the v2 design intact where it was sound and folds in the decisions from the architecture review. The headline changes are all about how the app behaves when reality deviates from the sample invoices and when a phone misbehaves mid-delivery — the parser now degrades instead of halting, reconciliation is recoverable instead of just blocking, the in-progress delivery survives a tab reload, persistence is durable by default, and the identity model is simplified to one stable key per item.*

---

## Changes from v2

**Critical (each prevents lost work or a blocked delivery):**
1. **Resumable in-progress delivery.** The active session is persisted continuously and offered for resume on launch. v2 kept it in memory, which a backgrounded/unloaded tab loses.
2. **Parser degrades instead of halting.** Unclassifiable rows go into a review panel for the user to resolve inline; they are never silently dropped or guessed, but they no longer take the whole app offline.
3. **Reconciliation is recoverable.** A failed reconciliation shows the gap and lets the user key in the missing line(s) from the paper invoice until it closes. Override remains as a last resort.
4. **Durable-by-default persistence.** Prompt to install as a home-screen app (escapes browser storage eviction); back up on every manual-link change as well as on confirm; make Restore prominent.

**Simplifications and a correctness fix:**
5. **One tracking key per item.** The v2 description-coupled composite identity is removed. The key is the trimmed `SUPPCODE` for clean rows, and a generated `linkId` only for the rare blank/duplicated-`SUPPCODE` rows. No identity depends on description anymore.
6. **Matching consults links before declaring ambiguity** — so duplicated-`SUPPCODE` resolutions are remembered and never re-prompt.
7. **Workflow/cleanups:** "item not on list" is a pure receiving note (no reconciliation re-check loop); `delivery_log` no longer stores derivable `shortfalls`; the margin/rounding rule is a setting; confirm has an undo and an already-logged guard.

---

## Why This Exists

Current delivery process without the app:
1. Receive delivery — manually search the physical invoice for each item as it comes out of the box to check it off
2. Scan each item into Idealpos to get the sell price, print a price sticker, put item away
3. New items (not in Idealpos) go in a separate box for manual entry later
4. After the delivery, manually enter the invoice into Idealpos — which then alerts to any cost price changes
5. Print new stickers for changed prices and find the stock already put out to re-sticker it

**The app eliminates steps 2, 4, and 5** by showing the sell price and flagging cost price changes *before* stock goes out, so items are priced correctly the first time. It also replaces searching the physical invoice list.

---

## What The App Does

A fast, stockroom-friendly delivery checklist tool. The user uploads a Wholesale Solutions invoice PDF and works through each item as they pull it from the box — finding items by search, seeing the correct sell price immediately, getting alerted to any cost price changes with a suggested new price, and checking items off as received.

The app treats its own parsing as fallible. It validates every parse against the invoice's own totals and **surfaces anything it can't account for so the user can resolve it** — it never presents a silently-incomplete list, and it never silently guesses, but it also never strands the user when the data drifts.

---

## User Flow

### Before First Use
1. **Install to home screen** when prompted (this is what makes stored data durable — see Persistence). Skippable, but recommended.
2. Settings — upload Idealpos CSV export
3. App seeds price history from the CSV (see Pre-Population)
4. App is ready

### Before Each Delivery
1. Have the invoice PDF on your phone (email it to yourself or save to files first). This is a hard precondition — you need the WSS PDF on this device before starting.
2. Upload invoice PDF on the Delivery tab
3. App parses and classifies all rows. Anything it can't classify is collected, not dropped (see Review panel)
4. App validates against the invoice's printed totals and shows a **Reconciliation panel** (parsed totals vs printed totals) and a **matched / unmatched split**

### Review & Reconcile (before physical checking)
1. If any rows couldn't be classified, the **Review panel** lists their raw text. Mark each as *product* (key in qty/unit), *not a product* (ignore), or *skip*
2. The reconciliation panel shows the gap, if any. Close it by keying in missing line(s) from the paper invoice, or explicitly override with a visible warning
3. Start is enabled once reconciliation passes (or is overridden)

### Match & Link (optional, before physical checking)
1. Unmatched items are listed together. Link them in a batch now if you like — type to filter Idealpos by description, tap to link — so you're not interrupted at the box later. A high unmatched count is normal and gets lighter each delivery as links accumulate
2. Resolve any ambiguous (duplicate-code) matches with a one-time pick
3. Items you choose not to link stay "Not in Idealpos" and are set aside

### During Delivery
1. Search by name to find the item just pulled from the box
2. See the sell price — print sticker
3. If cost changed since last delivery — alert shows old cost, new cost, suggested new sell price
4. Tap ✓ to add one received. Tap ✗ to remove one. Use **Receive all** to fill a line, or tap the count to type a number directly
5. If something is in the box but not on the list, use **Item not on list** to record it as a receiving discrepancy
6. "Not in Idealpos" items are set aside — no further app involvement

*Progress is saved automatically and continuously. If the app is closed, the phone locks, or the tab is unloaded, you're offered **Resume** on next launch — no re-upload, no lost check-offs.*

### End of Delivery
1. Tap Finish — summary of fully received / partial / unchecked / price changes / not in Idealpos / flagged items
2. Confirm — writes updated cost prices to history, appends a delivery-log entry, **downloads a backup file**, clears session. If this invoice was already logged, you're warned first
3. **Undo last confirm** is available briefly afterward (restores the session and rolls back the history/log writes)
4. Or go back and keep working, or Discard without saving

---

## Persistence

All persistence is local (`localStorage`). There is no sync. Durability comes from three things working together: home-screen install, manual export/import, and automatic backup-on-confirm and backup-on-link-change.

> **Why install to home screen matters.** Mobile browsers (Safari especially) evict a site's `localStorage` after roughly a week without interaction — longer than the typical gap between deliveries — which would silently destroy accumulated links and price history. Installed home-screen apps are exempt from that eviction. This is the single most important durability step, and it costs nothing in code. Prompt for it on first run; if declined, the app still works but warns that data may not persist long-term.

> **Storage check on launch.** Verify `localStorage` is writable; if not (private mode / quota), warn that data won't persist this session.

### Tracking key (used everywhere a POS row is referenced)

**One stable key per tracked item**, derived once at match time and used unchanged thereafter for sell-price lookup, `price_history`, and link targets:

- **Clean row** — the matched POS row's `SUPPCODE` is non-blank and unique in the current export → the key is the **trimmed `SUPPCODE`**. This is the overwhelming majority of items, covers both auto-matches and cross-supplier manual links, and survives Idealpos description edits.
- **Keyless row** — the `SUPPCODE` is blank or duplicated, so it can't pick the row out → the key is a **generated `linkId`** created when the user links the item. The link also stores a row snapshot to re-find the row after a CSV re-upload.

Nothing downstream branches on which kind of key it is; the branch happens once, at match time, and after that the code just uses `match.key`. No key depends on a description. On parse, the app computes once the set of `SUPPCODE`s that are blank or duplicated, so the clean/keyless decision is cheap.

### Idealpos Export — `localStorage`
Stored as a parsed JSON array, replaced entirely on re-upload. Never touches `price_history` or `manual_links` when replaced.

**Exact CSV column names:** `SUPPCODE, DESC, PRICE1, LSTCST`

Each row stored normalised (whitespace trimmed at parse time, not just at match time):
```json
{ "suppcode": "225376", "desc": "BEN DOVER SUCTION CUP DILDO", "price": 26.99, "lstcst": 14.96 }
```
Settings shows the export's record count **and age**, and nudges when it's stale ("POS data is 34 days old — re-export?"), since a stale export means new items read as unmatched and sell prices may be wrong.

### active_session — `localStorage`  *(new)*
The full in-progress delivery: `invoiceMeta`, parsed `items` with `qtyReceived` and match state, `flaggedNotOnList`, any unresolved review rows, and the current step. Written (throttled) on every change during a delivery. Holds the **parsed result**, not the raw PDF — so resume needs no re-upload and no re-parse. Cleared only on confirm or explicit discard.

On launch, if `active_session` is present and non-empty → offer **"Resume in-progress delivery (INV-xxxx, started <time>)?"** with Resume / Discard.

### price_history — `localStorage`
Keyed by **tracking key** (trimmed `SUPPCODE`, or the `linkId` for keyless rows). History therefore survives invoice-side supplier-code changes and Idealpos description edits, and is consistent whether the match was auto or manual.

Written only on confirmed end of delivery, only for matched items with `qtyReceived > 0`. Never written for unmatched items.
```json
{
  "SE-1326": { "lastCost": 10.61, "lastSellPrice": 30.99, "lastInvoice": "INV-17874", "lastDate": "2026-06-02" },
  "225376":  { "lastCost": 14.96, "lastSellPrice": 26.99, "lastInvoice": "INV-17874", "lastDate": "2026-06-02" }
}
```

**Pre-population when CSV is uploaded:** for each row where `LSTCST > 0`, if no entry exists for that row's key, create one with `LSTCST` as `lastCost`, `PRICE1` as `lastSellPrice`, `lastInvoice: "idealpos-import"`, `lastDate` today.
- Never overwrite an existing entry — real delivery history always wins
- Rows with `LSTCST = 0.00` are skipped (zero = never purchased through Idealpos, not a real cost)
- Rows with a **blank `SUPPCODE`** are skipped during seeding (no stable key, and a WSS numeric code can never auto-match them). They become reachable only via an explicit manual link, which assigns their `linkId` at link time
- Note: a seeded baseline cost for a cross-supplier item may come from a different supplier's invoice, so the *first* WSS delivery may show a few expected "cost changed" flags that settle afterward

### manual_links — `localStorage`
Keyed by **invoice supplier code**. Each entry resolves the code to a specific POS row.
Written immediately when a link is created. Never overwritten by CSV re-upload. **A backup is triggered on every change to this store** (links are the most expensive data to recreate).
```json
{
  "95431": { "key": "SE-1326" },
  "20193": { "key": "lnk_8f3a", "snapshot": { "suppcode": "", "desc": "SOME PRODUCT NAME", "price": 19.99 } }
}
```
- Linking to a **clean row** stores its `SUPPCODE` as the key (the common cross-supplier case)
- Linking to a **keyless row** stores a generated `linkId` plus a snapshot to re-find it
- **Resolving a link:** look up the row by key/snapshot. If it resolves to exactly one row → matched; if it no longer resolves after a CSV re-upload → "Not in Idealpos" silently. Never a guessed row

### delivery_log — `localStorage`
Append-only. One entry per confirmed delivery, so the user can later answer "did that backorder ever arrive?" and review applied price changes.
```json
[
  {
    "invoiceNumber": "INV-17874",
    "date": "2026-06-02",
    "confirmedAt": "2026-06-02T14:31:00+12:00",
    "lines": [
      { "invoiceCode": "95431", "desc": "...", "qty": 4, "qtyReceived": 2, "cost": 14.96, "changed": true }
    ],
    "flaggedNotOnList": [ "hand-typed note" ]
  }
]
```
Lightweight by design — a receiving record, not an accounting ledger. **Shortfalls are derived on display** from `lines` (any line where `qtyReceived < qty`), not stored separately. On confirm, if `invoiceNumber` already exists → warn before appending.

### Backup files
`Export Data` and the automatic backups download a JSON of `price_history` + `manual_links` + `delivery_log`. Filename is timestamped to the minute — `deliverycheck-backup-YYYY-MM-DD-HHMM.json` — so same-day deliveries don't collide. Browsers can't truly overwrite a single file, so backups accumulate in Downloads; **Restore is therefore prominent (not buried) and shows the file's contents and date on import** so the user can confirm they picked the latest before it replaces local data.

---

## Parsing Specification

The parser is an **explicit row classifier**, not a permissive "grab anything ending in three numbers" rule. It implements the data analysis findings directly. Its guarantee is: **never silently drop and never guess** — anything it can't classify is surfaced for the user, not discarded and not assumed.

1. **Extract the text layer per page.** Assume nothing about page count (4–9 observed). If there is no text layer at all, stop with: "This PDF has no readable text — it may be a scan."
2. **Header pass.** Capture Invoice Number (`INV-\d+`), Date (`D Mon YYYY`, no leading zero), Reference (`WSL-…`, variable width), supplier from the issuer block / constant bank account `06-0507-0169657-01` (never the customer block), printed Subtotal, GST, Total, Due Date. **A missing header field warns and continues** (e.g. fall back to today's date, blank reference) rather than blocking — only "zero products parsed" is a hard stop.
3. **Reconstruct wrapped rows before tokenising.** A line that starts with a numeric code but has no trailing Qty/Unit/Amount triple is joined with the following line(s) until the triple appears. (Long descriptions wrap; the numbers land only after the wrap.)
4. **Identify line items by the trailing three-number triple** (Qty / Unit Price / Amount). Everything before the triple is the description; split the description on the **first** ` - ` to separate code from name.
5. **Classify every row** into exactly one of: **product** (leading numeric code, qty > 0, amount > 0) · **not-supplied** (inline qty 0, or an `N/A (Not delivered or supplied) - {code} - {name} x {qty}` line) · **shipping** (no code, qty 1, unit = amount) · **store-credit / adjustment** (no code, parenthesised negative) · **page header** (`Description Quantity Unit Price Amount NZD`) · **totals** (Subtotal / GST / Total / Amount Due). **Any row that matches none of these is added to the Review list with its raw text** — never dropped, never guessed.
6. **De-duplicate not-supplied items.** A code appearing both inline at qty 0 and in the N/A block is one not-supplied item, not two. Not-supplied items are excluded from the checklist and from cost capture.
7. **Handle the N/A block's double ` - `.** N/A lines contain two ` - ` separators; do not split them on the first one. Detect them by the `N/A (Not delivered or supplied) -` prefix and the trailing `x {qty}`.
8. **Normalise numbers.** Strip comma thousands separators; map `(x)` → `-x`. Do not be fooled by digits inside names ("11 INCH", "2.5 Inch", "100G") — anchoring on the *last* three numbers avoids this.
9. **Anchor on `Subtotal` / `TOTAL NZD` markers, not on PAYMENT ADVICE.** On multi-page invoices the tear-off slip is linearised before the final continued line items, so "everything after PAYMENT ADVICE is footer" is wrong.
10. **Skip** repeated page column headers and the "N/A's below" section marker.

Only rows classified **product** (plus any review rows the user marks as products) become checklist items.

### Review panel  *(new)*
If step 5 produced any unclassifiable rows, they are listed with their raw text before the checklist is offered. For each, the user chooses:
- **Product** → key in qty / unit price; it joins the checklist and counts toward reconciliation
- **Not a product** → ignored (e.g. a new charge or note line)
- **Skip** → excluded from this delivery

This keeps the no-silent-guessing guarantee while letting the app keep working when WSS introduces a line type the classifier hasn't seen.

---

## Validation & Reconciliation

Run after parse, before the checklist is offered. Shown as a panel; Start is disabled unless it passes (or the user explicitly overrides with a visible warning).

- **Per line:** `round(qty × unit, 2) == amount`. Any failure is listed.
- **Invoice totals:** `Subtotal + GST == Total` and `Amount Due == Total` (exact). GST is **not** recomputed as 15% × Subtotal — the printed value can differ by line-level rounding; use the printed value.
- **Parse completeness (the real check):** `Σ(product line amounts) + shipping − store credit ≈ printed Subtotal`. This catches a dropped or misread line. Tolerance is **small and line-count-aware** (a few cents scaled to the number of product lines, to absorb line-level rounding without letting a dropped sub-dollar item pass) — pick a concrete value and state it in code comments; do not leave it vague.
- **Match summary:** "X products · Y matched · Z unmatched (Not in Idealpos)." A high unmatched count is expected and normal — information, not an error.

**Recovery when completeness fails:** the panel shows the **gap amount** and the parsed lines side by side with the printed totals. The user closes the gap by **keying in the missing line(s)** from the paper invoice in hand (and/or resolving review rows), until parsed accounts for printed. Override remains available as a last resort with a visible warning, but with the review panel and manual-add path in place it should rarely be needed — so "fail loudly" and "let me fix it on the spot" are both true.

---

## Matching Logic (in `utils.js`)

Per product line, in priority order. **Links are consulted first** so remembered choices always win:

1. **Manual link** — if `manual_links[invoiceCode]` exists and resolves to exactly one row → matched, using its stored key. (This covers cross-supplier links and remembered ambiguous resolutions, so duplicated-`SUPPCODE` items never re-prompt.)
2. **Auto-match** — otherwise, trim the invoice code and match against trimmed POS `SUPPCODE` (exact).
   - Exactly one row → matched; key is the trimmed `SUPPCODE`.
   - More than one row (a duplicated `SUPPCODE`) → mark **ambiguous**, show the candidate rows (description + price), let the user pick once, and store the choice as a manual link (with a `linkId`, since the bare code can't identify the row).
3. **No match** → "Not in Idealpos."

**Linking onto a keyless (blank/duplicated) row:** allowed; the link stores a `linkId` plus a snapshot, and the user is told this item is tracked by an internal link rather than by code. Never silently resolves to the wrong row.

**Zero products parsed:** explicit error — "No items found — check this is a Wholesale Solutions invoice" — and do not proceed.

---

## Core Logic

### Sell Price
The matched POS row's `PRICE1`. Shown prominently per item. `null` if unmatched.

### Price Change Detection
On load, for each matched item check `price_history[key]`:
- No entry → first time seen, no alert
- Cost unchanged → no alert
- Cost differs → flag as price changed

Unmatched items skip this entirely.

### Suggested Sell Price (only when a change is detected)
Driven by a **Settings value** for target margin and rounding (default **60% margin, round up to end in `.99`**), so the rule isn't baked in:
```
default: cost = 40% of sell; result ends in .99
raw = unitPrice / 0.40
suggested = Math.ceil(raw) - 0.01
guard: if unitPrice <= 0, show no suggestion
// 14.96 → 37.99 · 10.61 → 26.99 · 9.30 → 23.99 · 6.25 → 15.99
```
Advisory only; the current `PRICE1` is shown alongside so the user decides.

### Duplicate invoice codes
A code may appear on several lines of one invoice (e.g. `65972` ×3). Keep them as **separate check-off rows** — that mirrors pulling each from the box.

Write `price_history` **once per key** on confirm, not once per row, to avoid a nondeterministic last-write-wins collision. Unit prices across duplicate lines of the same code are expected to agree; if they differ, flag it on the reconciliation/summary and write the value from the line with the largest amount. Aggregate received quantity across the duplicate rows when deciding whether the code was received (`qtyReceived > 0` on any row).

### Quantity Interaction
Per item row: ✓ (+1), ✗ (−1), a **Receive all** control, and a tappable count for direct numeric entry.

| Action | Result |
|---|---|
| Tap ✓ | qtyReceived +1 (stops at qty) |
| Tap ✗ | qtyReceived −1 (stops at 0) |
| Receive all | qtyReceived = qty |
| Tap count | type an exact number (0…qty) |

No destructive long-press. Derived status (never stored): `0` → unchecked · `0 < n < qty` → partial · `n === qty` → fully checked.

---

## Navigation

Persistent bottom tab bar.

- 📦 **Delivery** — Setup → Review/Reconcile/Link → Checklist → End of Delivery. Back at each step.
- ⚙️ **Settings** — CSV upload, manual links, delivery log, export/import, margin, danger zone.

Switching tabs never clears session. Session clears only on confirmed end of delivery or explicit discard, and is persisted across app/tab reloads in between.

---

## Views

### Delivery — Step 1: Setup
- No Idealpos data → prompt to upload CSV in Settings first
- Idealpos data present → show record count and age
- Upload invoice PDF
- After parse → **Review panel** (if any unclassified rows), then the **Reconciliation panel** and the **matched/unmatched split**
- Zero products → blocking error
- **Start Delivery** enabled only when reconciliation passes (or is explicitly overridden)

### Delivery — Step 2: Review & Match
- **Review** — resolve any unclassifiable rows (product / not a product / skip)
- **Reconcile** — close the completeness gap by keying in missing lines, or override
- **Match & Link** (optional) — list unmatched products together; inline link (type to filter Idealpos `DESC`, tap to link); saves immediately. Resolve ambiguous (duplicate-code) matches with a one-time pick. The user can skip and link at the box instead

### Delivery — Step 3: Checklist
**Header:** invoice number / date / supplier; progress "12 / 67 received" (counts fully received *line items*, not units); Finish.
**Search bar** — real-time filter by description; primary navigation.
**Filter bar:** All / Unchecked / Partial / Checked / Price Changed / Not in Idealpos.
**Each row:** description; sell price (large) or "Not in Idealpos" badge; qty counter `2 / 4`; ✓ / ✗ / Receive all / tap-to-type; ⚠️ price-change alert (old→new cost, old→suggested sell); inline **Link** for unmatched; inline **edit** of a parsed line's qty/cost/description (re-runs that line's per-line validation).
**Item not on list** — records something physically present but absent from the invoice as a **receiving discrepancy** in the delivery log. (This is a supplier/picking discrepancy, not a parse error, so it does **not** prompt a reconciliation re-check.)

### Delivery — Step 4: End of Delivery
- Summary: fully received / partial / unchecked / price changes / not in Idealpos / flagged-not-on-list, with partial and unchecked listed by name
- Confirm → (warn if `invoiceNumber` already logged) writes `price_history` (once per key, `qtyReceived > 0`), appends `delivery_log`, **downloads `deliverycheck-backup-YYYY-MM-DD-HHMM.json`**, clears `active_session`, returns to Setup
- **Undo last confirm** available briefly — restores the session and rolls back the history/log writes
- Discard → clears without saving

### Settings
- **Idealpos CSV** — upload; record count + age + staleness nudge; flags how many rows have blank or duplicated `SUPPCODE` (transparency, not an error)
- **Pricing rule** — target margin and rounding (defaults 60% / `.99`)
- **Manual Links** — list (invoice code → resolved POS row + name); delete per row (how wrong links get fixed)
- **Delivery Log** — read-only list of past deliveries; tap to view what arrived, derived shortfalls, and what changed
- **Export Data** — downloads JSON of `price_history` + `manual_links` + `delivery_log`
- **Import / Restore** — prominent; upload exported JSON; shows the file's contents and date before replacing entirely (no merge)
- **Install to Home Screen** — hint/affordance if not already installed (durability)
- **Danger Zone** — clear price history / clear manual links / clear delivery log (each requires confirmation)

---

## State Model

A single resolved **match reference** carrying one stable `key`.

```js
{
  invoiceMeta: {
    invoiceNumber: "INV-17874",
    date: "2026-06-02",
    supplier: "Wholesale Solutions Limited",
    printedSubtotal: 1662.97,   // extracted, ex-GST
    computedSubtotal: 1662.97,  // Σ product + shipping − credit (incl. user-added lines)
    gst: 249.43, total: 1912.40,
    reconciliationPassed: true
  },
  items: [
    {
      invoiceCode: "95431",          // from invoice — display + manual_links lookup
      match: {                       // null if "Not in Idealpos"
        key: "SE-1326",              // tracking key: sell price, price-history read/write
        desc: "Calexotics …",        // POS description at match time
        sellPrice: 30.99,            // PRICE1
        via: "auto" | "link" | "ambiguous-resolved"
      },
      description: "Ben Dover Suction Cup Dildo 7.6 Inch",  // invoice description (shown)
      qty: 4,
      qtyReceived: 2,
      costPrice: 14.96,              // ex-GST, from invoice
      source: "parsed" | "user-added",
      priceChange: { previousCost: 12.50, previousSellPrice: 30.99, suggestedSellPrice: 37.99 } // or null
    }
  ],
  reviewRows: [],        // unclassified raw rows awaiting product / not-a-product / skip
  flaggedNotOnList: [],
  step: "checklist"      // for resume
}
```

Rule of thumb: **`invoiceCode`** for anything invoice-side (display, manual link); **`match.key`** for anything POS-side (sell price, price history). For auto-matched clean items `match.key` is just the trimmed `SUPPCODE`. This whole object is what gets persisted as `active_session`.

---

## Component Structure

```
src/
  App.jsx                       — tab router + delivery step router, holds session state

  components/
    BottomTabBar.jsx
    ResumePrompt.jsx             — offered on launch if active_session exists

    delivery/
      Setup.jsx                  — CSV check, invoice upload
      ReviewPanel.jsx            — resolve unclassifiable rows (product / not / skip)
      Reconciliation.jsx         — printed vs computed totals, gap + add-missing-line, Start gate
      MatchAndLink.jsx           — batch-link unmatched, resolve ambiguous matches
      DeliveryChecklist.jsx      — search, filter bar, item list, "item not on list"
      ItemRow.jsx                — display, ✓/✗/Receive all/type, price alert, inline link, inline edit
      FilterBar.jsx
      EndOfDelivery.jsx          — summary, confirm (history + log + backup) / undo / discard

    settings/
      Settings.jsx               — CSV, pricing rule, manual links, delivery log, export/restore, install, danger zone

  lib/
    parsePDF.js                  — pdfjs-dist: classify + reconstruct + validate; returns { items, reviewRows, meta }
    parseIdealpos.js             — papaparse: parse + normalise + compute blank/duplicate sets
    utils.js                     — matchItem(), trackingKey(), suggestedSellPrice(),
                                   detectPriceChange(), reconcile()

  hooks/
    useDeliverySession.js        — session state; persists to / restores from active_session
    useAppData.js                — durable persistence (localStorage), export/restore, backups
```

---

## Tech Stack
- React + Vite
- `pdfjs-dist` (PDF parsing) · `papaparse` (CSV)
- `localStorage` for persistence; automatic backup file on confirm and on manual-link change
- Installable as a home-screen app (PWA manifest) for storage durability
- No backend, no auth, no external UI library
- *(Optional, only if the export ever outgrows `localStorage`'s ~5 MB: move the parsed POS array to IndexedDB behind `useAppData`. Not needed at ~7k rows today. The session is small parsed JSON and stays in `localStorage`.)*

---

## Reliability Features

- **Parser degrades, never strands** — unclassifiable rows are surfaced in the Review panel for the user to resolve; nothing is silently dropped or guessed, and a new line type never takes the app offline.
- **Reconciliation gate, recoverable** — Start is blocked unless parsed totals account for the printed Subtotal, and the user can key in missing lines to close the gap on the spot.
- **Resumable session** — the in-progress delivery is persisted continuously and offered for resume after any reload, lock, or crash. No re-upload, no lost check-offs.
- **Durable storage** — home-screen install escapes browser storage eviction; backups fire on confirm and on every manual-link change; Restore is prominent and confirms contents/date before replacing.
- **Storage check** — on launch, verify `localStorage` is writable; warn if not.
- **Undo last confirm** — guards against a fat-fingered finish.
- **Delivery log** — a persistent record of what arrived, derived shortfalls, and price changes.

---

## Rules & Edge Cases

1. **Classify by structure, not text.** Shipping, store credit, N/A header, N/A detail, inline zero-qty, page headers and totals are each excluded from the checklist; only `code + qty>0 + amount>0` rows are products.
2. **Reconstruct wrapped rows** before tokenising; anchor on the trailing three numbers; split description on the **first** ` - `.
3. **Unclassifiable rows go to the Review panel** — surfaced with raw text, resolved by the user; never dropped, never guessed, never a hard halt.
4. **De-dup not-supplied items** recorded both inline and in the N/A block.
5. **N/A lines have two ` - `** — detect by prefix/suffix, don't split on the first.
6. **Normalise** commas (`2,774.70`) and parentheses negatives (`(9.09)`) before parsing.
7. **Anchor on Subtotal/Total**, not PAYMENT ADVICE (interleaved on multi-page invoices).
8. **Header-field misses warn and continue;** only zero-products is a hard stop.
9. **One tracking key per item** — trimmed `SUPPCODE` for clean rows, `linkId` for blank/duplicated rows; no key depends on description.
10. **Matching consults `manual_links` before auto-match,** so remembered choices (including ambiguous-code resolutions) always win and never re-prompt.
11. **Duplicate invoice codes** — separate check-off rows; price history written once per key; flag unit-price disagreement.
12. **Stale links / keys** — fall back to "Not in Idealpos" silently; never guess a row.
13. **Pre-population** — `LSTCST > 0` only, never overwrites, skips blank-`SUPPCODE` rows.
14. **CSV re-upload** — replaces export data only; never touches history, links, log, or the active session.
15. **All invoice prices are ex-GST** — use as-is for the margin calc; never add GST. Don't recompute GST as 15% of Subtotal.
16. **Reconciliation is recoverable** — key in missing lines to close the gap; override is the last resort.
17. **✓/✗ have hard floors and ceilings**; no destructive long-press.
18. **Inline edit** of a parsed line is allowed and re-runs that line's validation.
19. **"Item not on list"** is a receiving-discrepancy note, not a parse error — it does not trigger a reconciliation re-check.
20. **Session persists across reloads** — resume offered on launch; lives untouched by tab navigation; clears only on confirm or discard.
21. **Confirm** warns if the invoice is already logged, and is reversible via Undo last confirm.
22. **Import/Restore replaces entirely** — shows contents/date first.

---

## Out of Scope (for now)
- Additional supplier invoice formats (each would be a separate flow due to different layouts)
- Supplier-namespaced manual links (e.g. `"WSS|95431"`) — add before a second supplier is supported, to prevent code collisions across suppliers
- Adding new items to Idealpos from within the app
- Barcode-to-row jump — the natural stockroom interaction, but blocked on data: neither the invoice nor the POS export carries a scannable barcode/EAN. Revisit only if a barcode field becomes available; don't build speculatively
- OCR for scanned invoices (all current invoices have a clean text layer; if one ever lacks one, parsing stops with a clear "no text layer" message)
- Any backend, sync, or multi-device support
