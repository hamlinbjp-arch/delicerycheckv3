# WSS Invoice Parser — Parsing Strategy (design, pre-implementation)

**Status:** design only, no code. Grounded in the ten real fixtures via the spike
dumps (`tools/dumpText.js` → `tools/_dump/*.txt`), the
[data analysis](./WSS_Invoice_Parsing_Analysis.md), and the Parsing / Validation /
Matching sections of the [architecture](./DeliveryCheck_Architecture_v3.md).

The analysis already catalogued the row types and edge cases. This document
**confirms each against the raw dumps**, flags what the analysis missed, and turns
it into a concrete, staged parsing design. Every example below is a verbatim line
from a fixture dump (trailing spaces trimmed), cited by invoice.

Output interface is frozen by `CLAUDE.md`:
`{ meta, items, nonProductLines, reviewRows, reconciliation, debug }`.

---

## 0. Headline findings from the dumps (what the analysis got right / missed)

**Confirmed as written:** consistent template; per-line `round(qty×unit)==amount`;
trailing three-number anchor; repeated page header; PAYMENT-ADVICE interleave;
inline-zero-qty ↔ N/A double listing; two ` - ` in N/A lines; parenthesised
store-credit; comma thousands in totals only; digits inside names; duplicate codes
within an invoice; price drift per code; old `WSL-9260` scheme.

**Corrections / additions the analysis under-weighted (all confirmed in dumps):**

1. **The PAYMENT-ADVICE interleave is a coin-flip, not a rare case.** 5 of 10
   invoices linearise Shipping + N/A + Subtotal/GST/Total *after* the slip
   (INV-17874, 17875, 17663, 17457, 17405); 5 put them *before* a bare slip
   (INV-16814, 17770, 17764, 17708, 17237). Anchoring on `Subtotal`/`TOTAL NZD` is
   mandatory, not defensive.
2. **N/A detail lines wrap, and far more often than product lines do.** Product
   wraps occur **once** in the whole set (`322433`). N/A wraps are common
   (INV-17457 ×3, INV-16814 ×2, INV-17764 ×1), and **the trailing `x {qty}` itself
   splits across the wrap** — e.g. `… Luxe Silicone Lubricant x` / `2.0` /
   `0.00 10.65 0.00`. Reconstruction must cover the N/A shape, not just products.
3. **The qty/unit/amount triple lands alone on its own line** after a wrap (both
   product and N/A). Reconstruction needs a "bare trailing triple attaches to the
   buffered row" rule, not just "join forward."
4. **`Amount Due` (in the slip) equals `TOTAL NZD` and appears *before* it** on
   interleaved invoices. Anchoring on the first total-shaped number would grab the
   slip's `Amount Due`. Anchor on the **labelled** `TOTAL NZD`/`Subtotal` lines.
5. **Within a page the order is clean** — each product row is a single line with
   columns intact. The "inconsistent order" risk is entirely *cross-page / slip*
   ordering plus wrapping, not intra-row scrambling.
6. **Header field layout differs by block.** Page-1 header is **label-line then
   value-line** (`Invoice Number` ⏎ `INV-17875`); the slip is **label + value on
   one line** (`Invoice Number   INV-17875`). The customer block **precedes** the
   supplier block in linear order (issuer is *second*).
7. **Quantities are always integers** (`N.00`). This has a direct, important
   consequence for the reconciliation tolerance — see §6.

---

## 1. Every row type present (with a real dump example)

Classification is **structural**. The "label text" column below is only ever a
*secondary confirmation*, never the primary discriminator.

| # | Row type | Real example (verbatim) | Structural signature | Disposition |
|---|---|---|---|---|
| 1 | **Page column header** | `Description   Quantity   Unit Price   Amount NZD` (every body page) | exact header string | skip (debug) |
| 2 | **Product** | `233291 - Mini P Bullet Vibrator   1.00   10.56   10.56` (INV-17875) | leading `\d{4,6} - `, qty>0, amount>0 | → `items` |
| 3 | **Product, wrapped desc** | `322433 - Fantasy For Her … Swirling` ⏎ `Flicking Rabbit Vibrator Purple` ⏎ `1.00   107.90   107.90` (INV-17770) | code line + continuation(s) + bare triple | reconstruct → `items` |
| 4 | **Inline not-supplied** | `314883 - Satisfyer Drop To Go   0.00   51.00   0.00` (INV-17875) | leading code, qty==0, amount==0 | → `nonProductLines.notSupplied` |
| 5 | **N/A section marker** | `N/A's below (not delivered / supplied)   0.00   0.00   0.00` (INV-17663) | no code, all-zero triple, `N/A's below` prefix | skip (debug) |
| 6 | **N/A detail** | `N/A (Not delivered or supplied) - 7563 - Paradice Sex Game x 1.0   0.00   6.58   0.00` (INV-17663) | `N/A (Not delivered or supplied) -` prefix, **two** ` - `, `x {qty}` suffix, triple | → `nonProductLines.notSupplied` |
| 7 | **N/A detail, wrapped (+split `x`)** | `… Luxe Silicone Lubricant x` ⏎ `2.0` ⏎ `0.00   10.65   0.00` (INV-16814) | N/A prefix + continuation(s) + bare triple | reconstruct → `notSupplied` |
| 8 | **Shipping** | `Shipping   1.00   120.00   120.00` (INV-17875) | no code, qty==1, unit==amount, amount>0 | → `nonProductLines.shipping` |
| 9 | **Store credit / adjustment** | `Store Credit Used   1.00   (9.09)   (9.09)` (INV-17663) | no code, parenthesised (negative) amount | → `nonProductLines.storeCredit` |
| 10 | **Totals** | `Subtotal   2,832.02` · `TOTAL GST 15%   426.28` · `TOTAL NZD   3,258.30` (INV-17663) | labelled, **single** trailing number | → `meta` |
| 11 | **Payment-advice labels** | `Invoice Number   INV-17875` · `Amount Due   3,558.75` · `Customer   Brew-Worx & Beyond` | `PAYMENT ADVICE` region; label + value, no triple | skip (slip mirror of meta) |
| 12 | **Page-1 header block** | `Invoice Number` ⏎ `INV-17875` … `Wholesale Solutions Limited` | label-line/value-line; address blocks | → `meta` (header pass) |
| 13 | **Footer boilerplate** | `Bank account 06-0507-0169657-01` · `Please pay by Direct Credit…` | fixed strings, no triple | skip (debug); bank acct used to ID supplier |

---

## 2. Variations & edge cases — confirmed vs suspected

**Confirmed (seen in the dumps):**

- Comma thousands separators in totals only (`4,845.20`); never in sub-$1000 line
  amounts. — INV-17457.
- Parenthesised negatives, store credit only: `(9.09)`, `(23.00)`. — INV-17663/16814.
- Digits inside descriptions: `11 INCH`, `9.4 Inch`, `No.4`, `100G`, `2X12ml`,
  `4.5 Inch`. The last-three-numbers anchor immunises against these.
- PAYMENT-ADVICE interleave, 5/10 (see §0.1).
- Repeated page column header at the top of every body page.
- Product-description wrap: exactly one (`322433`), one continuation line.
- N/A-line wrap incl. split `x {qty}`: multiple (see §0.2).
- Bare qty/unit/amount triple on its own line as a wrap remainder. — 4 invoices.
- Inline-zero-qty also listed in the N/A block (double-count hazard): `21111`,
  `204156` (INV-17405); `314883` (INV-17875); `7563` (INV-17663).
- Same code, multiple lines: `65972`×3 (INV-17663), `215452`×2 (INV-17874),
  `107457`×2 (INV-17764), `217200`×2 (INV-17237).
- Same code, different unit price across invoices: `204270` 42.70 vs 47.45;
  `93590` 6.36/7.90; `252179` 5.67.
- Variable shipping: 60 / 100 / 120 / 130. Variable page count: 4–9.
- Old reference scheme `WSL-9260` + older prices (INV-16814).
- **All quantities integer** (`N.00`); smallest non-zero product amount **$1.74**;
  largest invoice ~237 coded lines.
- Benign pdfjs font warning `TT: undefined function: 32` — cosmetic, no text impact.

**Suspected (not seen; handled defensively, never assumed away):**

- Non-integer quantity (e.g. `0.5`) or unit price with >2 decimals — *unseen*;
  affects only sub-cent rounding (see §6) and is caught by the per-line check.
- Non-numeric supplier code — analysis warns against assuming numeric; the
  classifier treats "no leading numeric code" structurally, so a non-numeric code
  simply fails the product test and becomes a **review row** (not a silent drop).
- Multiple shipping or multiple store-credit lines — only single instances seen;
  the pipeline sums a *list* for each, so multiples are handled.
- A product wrap spanning 3+ continuation lines — max seen is 1; the join window
  (§3, stage 2) is bounded and over-covers this.
- A description whose **name** contains ` - ` — harmless: we split on the *first*
  ` - ` only (code|name); extra dashes stay in the name.
- Scanned invoice / no text layer — latent; hard stop (§7).
- A genuinely new WSS line type — review row (§5).

---

## 3. Parsing pipeline (stage by stage)

`parsePDF.js` runs headless (the spike's pdfjs setup: legacy build, worker pointed
at the bundled `pdf.worker.mjs`). Each stage writes its intermediate result into
`debug` as structured data (not console logs).

### Stage 0 — Extract text
Per page, `getTextContent()`, join `items[].str` **in native order**:
`hasEOL` → newline, else a space. No x/y re-sorting (the dumps show native order is
correct within a page). Concatenate pages into one line stream; record page
boundaries in `debug.pages`. **No text at all → hard stop** ("no readable text — may
be a scan").

### Stage 1 — Header pass (whole-document, anchored)
Scan the full stream (not just page 1; fields recur in the slip) for:
- `invoiceNumber` = first `INV-\d+`.
- `date` = first `\d{1,2} [A-Z][a-z]{2} \d{4}` (no leading zero).
- `reference` = first `WSL-\d+` (variable width).
- `gstNumber` = `98-435-107`-shaped.
- `supplier` = issuer block / constant bank account `06-0507-0169657-01`
  (**never** the customer block — customer is the *first* org name, supplier the
  second; the bank account is the unambiguous tiebreak).
- Printed totals from the **labelled** lines: `Subtotal`, `TOTAL GST 15%`,
  `TOTAL NZD`, and `Due Date`. Take `TOTAL NZD`, **not** the slip's `Amount Due`,
  as the authoritative total (but keep `Amount Due` to cross-check, §6).

A **missing header field warns and continues** with a fallback (today's date, blank
reference, default supplier name). Only a missing *Subtotal* degrades reconciliation
(§6); nothing here except zero-products is a hard stop.

### Stage 2 — Reconstruct wrapped rows
Walk the line stream maintaining an optional *buffer* for an in-progress record.

- A line is **record-complete** if it ends in a trailing **three-number group**
  (qty/unit/amount, allowing commas/parens) — or is a recognised single-number
  total / pure-label / boilerplate line.
- A line **starts a record** if it matches a code prefix `^\d{4,6} - ` **or** the
  N/A prefix `^N/A \(Not delivered or supplied\) - `. If such a line is *not*
  complete, open the buffer.
- A line that is a **bare trailing triple** (only `qty unit amount`, no leading
  text) **closes** the open buffer (it's the wrapped row's number row).
- Any other non-starting line while a buffer is open is a **continuation**
  (appended to the description), e.g. `Flicking Rabbit Vibrator Purple`, or the
  split `2.0` from a torn `x 2.0`.
- **Bounded window:** if no triple appears within **3** continuation lines, flush
  the buffer as a **review row** (reason: `"looks like a line item but found no
  qty/unit/amount"`) — never guess, never drop.

Output: reconstructed logical rows, each tagged with the source line span (debug).
This single mechanism covers **both** product wraps and N/A wraps incl. the split
`x {qty}` — the analysis only described the product case.

### Stage 3 — Tokenize
For each reconstructed row, locate the **last three** whitespace-separated numeric
tokens → `qty`, `unit`, `amount` (anchoring on the *last* three sidesteps
digits-in-names). Everything before = `descriptionText`. Normalise numbers: strip
commas; map `(x)` → `-x`. Rows with a single trailing number (totals) or none
(labels/boilerplate) carry no triple and are passed through for Stage 4 to classify.

### Stage 4 — Classify (exactly one class, structural, ordered)
First match wins; order chosen so specific shapes precede general ones:

1. **Page header** — equals `Description Quantity Unit Price Amount NZD` → skip.
2. **Boilerplate / slip label / header block** — fixed strings, `PAYMENT ADVICE`
   region labels, address lines → skip (kept in debug).
3. **Totals** — labelled `Subtotal | TOTAL GST 15% | TOTAL NZD | Amount Due` with a
   single trailing number → `meta` (Amount Due retained only for cross-check).
4. **N/A section marker** — `N/A's below` + all-zero triple → skip.
5. **N/A detail** — `N/A (Not delivered or supplied) -` prefix. Parse the embedded
   code from the **second** ` - ` and qty from the `x {qty}` suffix; the trailing
   triple gives the (zero) amounts. → `notSupplied`. **Never split on the first
   ` - `.**
6. **Shipping** — no leading code, qty≈1, `unit==amount`, amount>0 → `shipping`.
7. **Store credit / adjustment** — no leading code, parenthesised/negative amount
   → `storeCredit`.
8. **Inline not-supplied** — leading numeric code, qty==0 **and** amount==0 →
   `notSupplied`.
9. **Product** — leading numeric code, qty>0 **and** amount>0 → `items`. Split
   `descriptionText` on the **first** ` - ` → `code` + `name`.
10. **Otherwise** → **review row** (raw text + reason) — never dropped, never
    guessed.

### Stage 5 — De-duplicate not-supplied
Collapse a code present **both** inline (qty 0) and in the N/A block into one
not-supplied entry (keyed by code). Keep both raw lines in debug. Not-supplied
items never enter `items` and never feed cost capture.

### Stage 6 — Validate (per-line + totals); see §6
### Stage 7 — Reconcile completeness; see §6

**Final object:** `{ meta, items, nonProductLines:{shipping[], storeCredit[],
notSupplied[]}, reviewRows[], reconciliation, debug }`.

---

## 4. How each architecture rule is honoured

| Architecture rule | Where honoured |
|---|---|
| **Wrapped-row reconstruction** | Stage 2 — forward-join **and** bare-triple-attaches-back; covers product *and* N/A wraps + split `x {qty}` (extends the spec, which named only product wraps). Bounded window → review row, never an infinite/greedy join. |
| **Structural classification** | Stage 4 — leading-code presence, trailing-number count, `unit==amount`, parentheses, qty/amount sign. Label text (`Shipping`, `Store Credit`) is confirmation only, never the trigger. |
| **N/A double-` - ` handling** | Stage 4 rule 5 — detect by prefix + `x {qty}` suffix; extract code from the **second** ` - `; first-` - ` split is never applied to N/A rows. |
| **Subtotal reconciliation** | Stage 7 (§6) — `Σ items + shipping − storeCredit ≈ printed Subtotal`, integer-cents, line-count-aware tolerance. |
| **Review rows** | Stage 2 (unjoinable) and Stage 4 (unclassifiable) both emit review rows with raw text + reason. |
| **No silent guessing / no silent drop** | Product requires `code + qty>0 + amount>0`; everything else is explicitly classed or sent to review. Nothing is inferred from description text; nothing is discarded. |

---

## 5. Failure modes & how each degrades

| Failure | Severity | Behaviour |
|---|---|---|
| No text layer at all | **Hard stop** | "This PDF has no readable text — it may be a scan." |
| Zero products parsed | **Hard stop** | "No items found — check this is a Wholesale Solutions invoice." |
| Missing date / reference / supplier | Warn + continue | Fallback (today / blank / default name); recorded in `meta` + `debug.warnings`. |
| Missing printed **Subtotal** | Warn + continue | Completeness check marked **indeterminate** (can't verify); surfaced prominently; Start still gated by user (override). Not a hard stop. |
| Missing GST or Total | Warn | Skip the affected total identity check; flag. |
| Row matches no class | Review row | Surfaced for product / not-a-product / skip. |
| Wrapped row never completes (no triple in window) | Review row | Raw buffer + reason. |
| Per-line `round(qty×unit)≠amount` | Warn (flag) | Line kept and listed; user can inline-edit. Not dropped. |
| Completeness gap > tolerance | Reconciliation **fails** (recoverable) | Show gap + lines; user keys missing line(s) or overrides. |
| `Subtotal+GST≠Total` or `Amount Due≠Total` | Warn (anomaly) | Surfaced; not a hard stop (data quality, not parse failure). |
| Non-integer qty / >2dp unit (suspected) | Handled / flagged | Numeric path is generic; sub-cent effect absorbed by tolerance or caught per-line. |
| New WSS line type (suspected) | Review row | Classifier never assumes; degrades, never strands. |

Principle, per architecture: **only "zero products" and "no text layer" hard-stop.**
Everything else warns-and-continues or routes to review/reconciliation so the user
is never stranded.

---

## 6. Validation & reconciliation — and the tolerance decision

**Per-line:** `round(qty × unit, 2) == amount` for every product/shipping/credit
line. Failures are listed, not dropped.

**Total identities (exact, no tolerance):** `Subtotal + GST == Total` and
`Amount Due == Total`. GST is **never** recomputed as 15% × Subtotal (the printed
GST differs by line-level rounding — the analysis measured up to ~0.12).

**Completeness (the real check):**
`Σ(item.amount) + Σ(shipping.amount) − Σ(storeCredit.amount)` vs printed
`Subtotal`.

### The tolerance — decision and justification

The architecture (§Validation) explicitly leaves the number to us, asking for
"small and line-count-aware … a few cents scaled to the number of product lines."
Here is the concrete decision and *why*, argued against the appendix totals.

**Decision:**
1. **Compute the sum in integer cents** (`Math.round(amount*100)`, sum as integers,
   compare integers). This eliminates binary floating-point drift entirely — with
   ~237 lines on the largest invoice, naive float summation could otherwise wander a
   fraction of a cent for no good reason.
2. **Sum the printed `amount` column**, not a recomputed `qty×unit`. The Subtotal is
   *defined* as the sum of the printed amounts, so a complete capture reproduces it
   exactly; a **dropped or merged line** is what makes the sum diverge — which is
   precisely what this check exists to catch.
3. **Expected residual is exactly `0`.** This is a stronger statement than the
   architecture assumed, and the dumps justify it: **every quantity is an integer**
   (`N.00`) and every unit price is exact-to-the-cent, so `qty×unit` is itself exact
   to the cent — there is **no line-level rounding in the Subtotal** to "absorb."
   (Line-level rounding is real for *GST* — a 15% fraction — but not for the
   Subtotal, whose inputs are all exact cents.)
4. **Tolerance band (defensive only):**
   `tol_cents = min(10, max(2, ceil(N / 20)))`, where `N` = number of product +
   not-supplied lines. So **2¢ for small invoices, ≤10¢ for the largest.**

**Why a non-zero band at all, if the expected residual is 0?** Purely to stay robust
against the *suspected-but-unseen* cases (a future fractional quantity, or a unit
price with >2 decimals), where a single line could legitimately round by ≤0.5¢. The
linear `ceil(N/20)` term covers several such lines without ballooning; the 2¢ floor
covers one; the 10¢ cap keeps it bounded even at 237 lines.

**Why this can't mask a real error.** The smallest non-zero product line in the
entire fixture set is **$1.74 (174¢)**. The tolerance maxes out at **10¢ — under 6%
of the smallest real line** — and is **two orders of magnitude below** a typical
$20–60 line. Any genuinely dropped or misread line moves the residual by ≥174¢ and
trips the check; the band only ever absorbs sub-cent rounding that, on today's data,
does not even occur.

**Behaviour:** residual `0` within band → **pass**. A non-zero residual *within* the
band is still surfaced as info (it would hint at a fractional-qty line or a misread).
Residual *beyond* the band → **fail, recoverable**: show the gap and the parsed lines
beside the printed totals; the user keys in the missing line(s) from the paper
invoice (or resolves review rows) until parsed accounts for printed, or overrides
with a visible warning.

**Validation against the appendix (sanity):** for each of the ten invoices the
identity `Subtotal + GST = Total` is printed and exact (e.g. INV-17457
`4,213.11 + 632.09 = 4,845.20`), and `Amount Due = Total`. The completeness sum is
expected to land on Subtotal to the cent; these printed triples are the cross-checks
the implementation's fixture tests will assert against.

---

## 7. What we are explicitly *not* doing in this phase

Per `CLAUDE.md` (PARSER ONLY): no matching, no CSV/Idealpos, no persistence, no
checklist UI, no price history. The parser's job ends at the frozen output object;
matching/reconciliation-recovery UI consume it later. The only companion artifact is
the single-page test harness that validates the parser against `fixtures/*.pdf`.
