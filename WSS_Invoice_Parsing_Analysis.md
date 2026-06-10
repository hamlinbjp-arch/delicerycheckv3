# Wholesale Solutions (WSS) Invoice — Data Analysis & Parsing Specification

**Prepared as a pre-build analysis. No code. Focus: understanding the real data.**

**Inputs reviewed:** 10 WSS tax-invoice PDFs (Aug 2025 – Jun 2026) and the Idealpos POS product export (`POS7_6_26.txt`, 7,276 data rows).

**Key relationship established:** The POS export (`SUPPCODE`, `DESC`, `PRICE1`, `LSTCST`) is the matching target, and a WSS invoice's **unit price feeds the POS `LSTCST` (last cost)** — confirmed by exact matches (e.g. WSS `95206` @ 6.16 → POS `LSTCST` 6.16; `216915` @ 57.19 → 57.19). This underpins several data-quality findings below.

---

## 1. Do WSS invoices follow a consistent structure?

Yes — all ten share one template, but with **variable-length, multi-page bodies and an inconsistent linearised text order**. Every invoice has:

- A header block (issuer top-right, customer top-left, invoice metadata in the middle).
- A line-item table with fixed columns: **Description | Quantity | Unit Price | Amount NZD**.
- An optional "not delivered" section, optional adjustment lines, a Shipping line, then Subtotal / GST / Total.
- A tear-off **PAYMENT ADVICE** slip repeating customer, invoice number, amount due and due date.

The structure is consistent in *fields*, not in *layout order* (see §5).

---

## 2. Fields that can be reliably extracted

**Header (always present, one value per invoice):**

- **Invoice Number** — `INV-#####` (5 digits in all samples).
- **Invoice Date** — `D Mon YYYY` (no leading zero on day, e.g. `2 May 2026`, `18 Aug 2025`).
- **Reference** — `WSL-####`/`WSL-#####` (**not fixed width** — `WSL-43194` vs `WSL-9260`).
- **Supplier GST Number** — `98-435-107` (constant).
- **Supplier** — Wholesale Solutions Limited (issuer block; also identifiable by the constant bank account `06-0507-0169657-01`).
- **Customer** — Brew-Worx & Beyond / Karl Hunt / Queenstown (constant across this set).
- **Due Date** — in totals and payment advice.

**Totals (always present):** Subtotal, TOTAL GST 15%, TOTAL NZD. `Subtotal + GST = Total` holds *exactly* in all ten (a strong validation anchor). `Amount Due` in the payment slip duplicates `TOTAL NZD`.

**Per line item:** supplier code, description, quantity, unit price (= cost price), line amount.

---

## 3. How line items should be identified

A genuine product line has this shape: it **begins with a numeric code**, followed by ` - ` (space-hyphen-space), then the name, and **ends with three numeric columns**: quantity, unit price, amount.

**Recommended rule:** anchor on the **trailing three numbers** as Qty / Unit / Amount, treat everything before them as the description, then split the description on the **first** ` - ` to separate code from name.

WSS line codes are **always numeric (4–6 digits)** in every sample — itself a useful discriminator: charge/total rows (Shipping, Store Credit, Subtotal, GST, Total, and the "N/A's below" header) carry **no leading numeric code**.

**Per-line validation:** for real lines `round(qty × unit, 2) == amount`. This holds throughout and is the best per-row integrity check.

---

## 4. Variations, edge cases and anomalies

- **Wrapped descriptions.** Long names break across two text lines, with qty/unit/amount appearing only after the wrap (e.g. INV-17770, code `322433`, the "Intimotion Pulse Pro … Rabbit Vibrator Purple" line). A line-at-a-time parser mis-reads these.
- **Zero-quantity "not supplied" items, recorded two different ways** — sometimes inline in the body (`qty 0.00`, unit price shown, `amount 0.00`), sometimes only in a trailing **"N/A (Not delivered or supplied) - {code} - {name} x {qty}"** block, and sometimes **both** (e.g. INV-17708 lists `126391` inline at qty 0 *and* again in the N/A block). De-dup and double-count hazard.
- **N/A detail lines contain two ` - ` separators** plus a trailing `x {qty}`. Splitting on the first ` - ` would wrongly extract "N/A (Not delivered or supplied)" as the code.
- **Negative adjustment lines.** "Store Credit Used" with the amount in **accounting parentheses** — `(9.09)`, `(23.00)` (INV-17663, INV-16814). Not a product.
- **Comma thousands separators** appear in totals (`2,774.70`, `4,845.20`) but not in sub-1000 line amounts.
- **Same code, different unit price across invoices** — cost genuinely changes over time (e.g. `252179` at 5.67 vs 5.20; `204270` at 42.70 vs 47.45; `93590` at 6.21 / 6.36 / 7.90). Cost is **per-invoice**, never assumed constant.
- **Same code, different description** (e.g. `218036` "Cock Ring By Satisfyer" vs "Power Ring Vibrating Cock Ring"; `65972` "Wet Stuff Banana Flavoured Lubricant 100Ml" vs "Wet Stuff Banana"). Description is not a stable per-code attribute.
- **Same product name under different codes** (e.g. `314883`/`314825` both "Satisfyer Drop To Go"; `225072`/`225073` both Sassy Anal Beads). Distinct SKUs — must not be merged on name.
- **Variable shipping** (60 / 100 / 120 / 130) and **variable page counts** (4–9).
- **Older numbering scheme.** INV-16814 (Aug 2025) uses `WSL-9260` and an older price set — the reference scheme and prices shifted between then and 2026.

---

## 5. What could cause a parser to fail

- **Interleaved PAYMENT ADVICE block.** On multi-page invoices the tear-off slip is linearised *before* the final continued line items (seen in INV-17875, INV-17874, INV-17405). "Treat everything after PAYMENT ADVICE as footer" is therefore wrong — real line items and the Subtotal/GST/Total can appear after it. Anchor on the `Subtotal`/`TOTAL NZD` markers instead.
- **Repeated column header** ("Description Quantity Unit Price Amount NZD") at the top of every page — must be skipped, not parsed.
- **Digits inside descriptions** ("11 INCH", "2.5 Inch", "No.4", "100G", "12 Pack", "9.4 Inch"). A loose "grab any numbers" regex mistakes these for columns. Anchoring on the *last three* numeric fields avoids it.
- **Wrapped lines** (§4) breaking the one-row assumption.
- **Two address blocks** — customer (Brew-Worx) vs supplier (Wholesale Solutions). Swapping them mislabels the supplier.
- **Parentheses negatives** and **commas** breaking naive numeric parsing.
- A future **scanned** invoice (no text layer) would yield nothing — all ten current files have a clean text layer, so OCR isn't needed yet, but it's a latent failure mode.

---

## 6. Are supplier stock codes always present and reliable?

**On the invoice:** yes for product lines — every product line carries a numeric code, and they appear internally consistent (one code = one WSS SKU). Charge/total rows correctly have none.

**As a reliable join key into POS: no.** Three problems, all confirmed against the export:

1. Many WSS products are stored in Idealpos under **a different supplier's code** (Calexotics `SE-1326`, Conrad `CN-101463545`, etc.) even though physically supplied by WSS. The WSS code (`210241`, `222022`) is absent; only the cost matches. Matching purely on WSS code reports these as "new/unknown".
2. Some WSS items aren't in the master at all (e.g. `269771` Masturbator Eggs).
3. The POS `SUPPCODE` field is messy: numeric codes are **left-space-padded** (`"           95206"`) for most but **unpadded** for some (`"216915"`); 912 rows are blank; and **13 codes are duplicated** within the master (so `SUPPCODE` is not a unique key in POS either).

So: treat the invoice code as reliable *for the invoice*, but **trim/normalise before matching**, and expect a meaningful unmatched rate.

---

## 7. Can qty, cost, invoice number, date, subtotal, GST, supplier always be extracted?

| Field | Always present | Caveat |
|---|---|---|
| Quantity | Yes | Integer-valued, shown as `N.00`; N/A block uses `x N.0` |
| Cost / unit price | Yes on product lines | Per-invoice; varies for same code over time |
| Invoice number | Yes | `INV-#####` |
| Date | Yes | `D Mon YYYY`, no leading zero |
| Subtotal | Yes | Strip commas |
| GST | Yes | **Don't recompute as 15% × Subtotal** — printed GST differs by up to ~0.12 from that (line-level rounding). Use printed values; validate `Subtotal + GST = Total` |
| Supplier name | Yes | Issuer block, not the customer block |

---

## 8. Shipping, freight, discounts, non-product lines

Classify by **structure**, not description text:

- **Shipping** — single line, no code, qty 1.00, unit = amount. A **freight charge**, not stock. GST-exclusive, rolled into Subtotal.
- **Store Credit Used** — no code, negative parenthesised amount. A **credit/adjustment** against the invoice total, not a product.
- **"N/A's below…" header** — no code, all zeros. **Skip** (section marker).
- **N/A detail lines / inline zero-qty lines** — **ordered-but-not-supplied**. **Exclude from received stock and from cost capture** (qty 0, amount 0); de-duplicate against any inline twin.
- **Subtotal / GST / Total** — document totals, not line items.

**Rule of thumb:** only rows with a leading numeric code **and** qty > 0 **and** amount > 0 are received stock lines.

---

## 9. Handling duplicate supplier codes

Two distinct cases:

- **Same code, multiple lines on one invoice** (e.g. `107457` at qty 1 then qty 2; `217200` twice; `65972` three times). Legitimate repeated entries. For stock receipting, **aggregate by code (sum quantity, sum amount)**; the unit price should agree across duplicates — flag if it doesn't. Keep the raw lines for audit.
- **Duplicate codes in the POS master** (13 exist). Because `SUPPCODE` isn't unique in POS, a code match can return **multiple** master rows — define a tie-break (e.g. nearest `LSTCST`, or flag for manual review) rather than silently taking the first.

Never de-duplicate on *description*, and never merge near-identical names carrying different codes.

---

## 10. Recommended parsing specification

1. **Extract the text layer** per page (all ten have one; assume nothing about page count).
2. **Header pass** — capture Invoice Number (`INV-\d+`), Date, Reference, GST Number, supplier (issuer block / bank account), customer.
3. **Reconstruct wrapped rows** before tokenising: a line starting with a numeric code but lacking a trailing 3-number group should be joined with following line(s) until the qty/unit/amount triple appears.
4. **Identify line items** by the trailing **Qty / Unit / Amount** triple; description = everything before it; split description on the **first** ` - ` → code + name.
5. **Classify each row**: product (numeric code, qty>0, amount>0) · not-supplied (qty 0 / N/A block) · shipping · store-credit/adjustment · totals/headers. Detect the N/A block by its `N/A (Not delivered or supplied) -` prefix and trailing `x {qty}`.
6. **Normalise numbers**: strip commas; map `(x)` → `-x`.
7. **Validate**: per line `qty × unit ≈ amount`; per invoice `Subtotal + GST = Total` and `Amount Due = Total`. Do not enforce `GST = 15% × Subtotal` exactly — use a tolerance.
8. **Skip** repeated page column headers and the "N/A's below" marker.
9. **Aggregate** duplicate codes within an invoice; preserve raw lines.
10. **Match to POS** on **trimmed** code, expecting misses; fall back to cost/description-assisted review rather than auto-creating.

---

## Hidden assumptions to flag

- That the customer is always Brew-Worx — true here, but don't hard-code it if WSS issues to others.
- That invoice codes are always numeric and POS codes are the same identifier — only ~3,770 POS codes are numeric, and many WSS items live under other suppliers' codes.
- That unit price = current cost — it's the cost *on that invoice*, which changes.
- That line "Amount" is GST-exclusive (it is here; Subtotal includes shipping and credits, GST added on top).

## Potential failure modes

Wrapped descriptions; PAYMENT-ADVICE interleaving; N/A double-counting; double ` - ` in N/A lines; parentheses/commas; digits-in-names; two address blocks; reference-format variation; and (latent) a future scanned invoice.

## Data-quality concerns

Unstable description-per-code; price drift per code; duplicate codes both within an invoice and within the POS master; 912 blank POS codes; inconsistent POS code padding; cross-supplier code storage causing unmatched WSS items; and the small per-invoice GST rounding gap.

## Recommendations before any code

1. Decide the **match-key strategy** up front (trimmed code primary; a manual review queue for unmatched/ambiguous — this will be a non-trivial share).
2. Decide whether duplicate-code lines are **summed or preserved** for your stock flow.
3. Confirm with WSS whether **invoice codes are guaranteed numeric** and whether the **reference and INV formats** are stable — don't infer from ten samples alone.
4. Build **validation gates** (the total/line checks above) and make the parser **fail loudly** on any row it can't classify, rather than guessing.
5. Obtain a **scanned/edge-case sample** if one could ever occur, before committing to text-only extraction.

---

### Appendix — invoice sample index

| Invoice | Date | Reference | Pages | Subtotal | GST | Total | Notable features |
|---|---|---|---|---|---|---|---|
| INV-16814 | 18 Aug 2025 | WSL-9260 | 5 | 2,571.33 | 389.32 | 2,960.65 | Old ref scheme; Store Credit (23.00); multiple N/A |
| INV-17237 | 2 Dec 2025 | WSL-42560 | 5 | 3,872.74 | 581.04 | 4,453.78 | Duplicate code `217200`; N/A block |
| INV-17405 | 21 Jan 2026 | WSL-42746 | 4 | 3,091.01 | 463.68 | 3,554.69 | Inline zero-qty + N/A; PAYMENT-ADVICE interleave |
| INV-17457 | 3 Feb 2026 | WSL-42815 | 9 | 4,213.11 | 632.09 | 4,845.20 | Largest; many N/A; `225072`/`225073` near-dupes |
| INV-17663 | 1 Apr 2026 | WSL-43087 | 5 | 2,832.02 | 426.28 | 3,258.30 | Store Credit (9.09); `65972` ×3 lines |
| INV-17708 | 15 Apr 2026 | WSL-43132 | 5 | 1,717.80 | 257.67 | 1,975.47 | Inline zero-qty duplicated in N/A block |
| INV-17764 | 2 May 2026 | WSL-43194 | 7 | 2,774.70 | 416.25 | 3,190.95 | Duplicate code `107457`; zero-qty `225020` |
| INV-17770 | 4 May 2026 | WSL-43204 | 4 | 2,477.28 | 371.68 | 2,848.96 | Wrapped description (`322433`) |
| INV-17874 | 2 Jun 2026 | WSL-43332 | 5 | 1,662.97 | 249.43 | 1,912.40 | PAYMENT-ADVICE interleave; `215452` ×2 |
| INV-17875 | 2 Jun 2026 | WSL-43333 | 4 | 3,094.46 | 464.29 | 3,558.75 | N/A `314883`; `314825` same name diff code |
