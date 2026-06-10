// src/lib/parsePDF.js
//
// WSS (Wholesale Solutions) invoice parser. PARSER ONLY — no matching, CSV,
// persistence, or UI. See docs/WSS_Parser_Strategy.md for the design and
// docs/DeliveryCheck_Architecture_v3.md §Parsing/Validation for the rules.
//
// Design principles (do not violate):
//   - Classify by STRUCTURE, not description text.
//   - Never guess. Never silently discard. Anything data-shaped that fits no class
//     becomes a review row (raw text + reason).
//   - Fail loud but recoverable: only three conditions hard-stop (no text layer,
//     zero products, missing Subtotal); everything else warns/continues or routes
//     to review/reconciliation.
//
// Runs headless in Node (reuses the spike's pdfjs setup: legacy build, worker
// pointed at the bundled worker file) so it is batch-testable against fixtures.
//
// Output interface (FROZEN — do not change shape without flagging):
//   { meta, items, nonProductLines, reviewRows, reconciliation, debug }
//
// Two deliberate sign conventions:
//   - nonProductLines.storeCredit[].amount is the NORMALIZED SIGNED value:
//       "(9.09)" -> -9.09  (parentheses mean a credit / negative contribution).
//   - reconciliation.storeCredit is the POSITIVE MAGNITUDE subtracted, so
//       computedSubtotal = productSum + shipping - storeCredit  reads literally.

import { fileURLToPath } from "node:url";

import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";

// Headless Node: pdfjs v4 still requires a worker source. Point it at the bundled
// legacy worker file so everything runs in a single Node process (matches
// tools/dumpText.js). In a browser build this line is replaced by the bundler's
// worker wiring — kept isolated here for that reason.
GlobalWorkerOptions.workerSrc = fileURLToPath(
  new URL(
    "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url
  )
);

// ---------------------------------------------------------------------------
// Hard-stop errors (the three "fail loud" conditions). Thrown so a headless
// batch run / the test harness can surface the message and stop.
// ---------------------------------------------------------------------------
export class ParserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ParserError";
    this.code = code;
  }
}

const HARD_STOP = {
  NO_TEXT_LAYER: "This PDF has no readable text — it may be a scan.",
  MISSING_SUBTOTAL: "Subtotal not found — cannot reconcile this invoice.",
  ZERO_PRODUCTS: "No items found — check this is a Wholesale Solutions invoice.",
};

// ---------------------------------------------------------------------------
// Constants & small helpers
// ---------------------------------------------------------------------------

const PAGE_HEADER = "Description Quantity Unit Price Amount NZD";
const NA_DETAIL_PREFIX = "N/A (Not delivered or supplied) -";
const NA_MARKER_PREFIX = "N/A's below";
const SUPPLIER_NAME = "Wholesale Solutions Limited";
const WSS_BANK_ACCOUNT = "06-0507-0169657-01";

const MONTHS = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// A money token: optional parentheses (negative), optional comma thousands,
// exactly two decimals. e.g. "10.56", "2,774.70", "(9.09)".
const MONEY = String.raw`\(?-?[\d,]+\.\d{2}\)?`;

// The trailing Qty / Unit / Amount triple at end of a (reconstructed) line.
// Qty is always N.NN in the data; unit/amount may carry commas or parentheses.
const TRAILING_TRIPLE = new RegExp(
  String.raw`(-?\d+\.\d{2})\s+(${MONEY})\s+(${MONEY})\s*$`
);

// A line that is ONLY a triple (a wrap remainder — the numbers landed on their
// own line after a wrapped description).
const BARE_TRIPLE = new RegExp(
  String.raw`^(-?\d+\.\d{2})\s+(${MONEY})\s+(${MONEY})\s*$`
);

// Record-start signatures.
const CODE_PREFIX = /^(\d{4,6}) - /;
const NA_DETAIL_START = /^N\/A \(Not delivered or supplied\) - /;

// Collapse runs of whitespace; trim. (pdfjs joins columns with multiple spaces.)
function squash(s) {
  return s.replace(/\s+/g, " ").trim();
}

// Parse a money string to a Number. Strips commas; maps "(x)" -> -x.
function parseMoney(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/,/g, "");
  const n = Number.parseFloat(s);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

// Integer cents from a Number, to keep all reconciliation arithmetic exact.
function cents(n) {
  return Math.round(n * 100);
}

// ---------------------------------------------------------------------------
// Stage 0 — extract text per page (pdfjs), native token order.
// ---------------------------------------------------------------------------
async function extractTextByPage(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const doc = await getDocument({
    data: bytes,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
  }).promise;

  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (typeof item.str !== "string") continue; // skip marked-content markers
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }
    pages.push(text);
  }
  await doc.cleanup();
  return pages;
}

// ---------------------------------------------------------------------------
// Stage 1 — header / meta pass over the full joined text (anchored regexes).
// Missing optional fields -> null and continue. Missing Subtotal -> hard stop.
// ---------------------------------------------------------------------------
function extractMeta(fullText) {
  const invoiceNumber = fullText.match(/INV-\d+/)?.[0] ?? null;
  const reference = fullText.match(/WSL-\d+/)?.[0] ?? null;

  // Date "D Mon YYYY" (no leading zero) -> ISO. First occurrence is the invoice
  // date (the slip's Due Date is labelled separately and matched below).
  let date = null;
  const dm = fullText.match(/\b(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/);
  if (dm) {
    const day = dm[1].padStart(2, "0");
    date = `${dm[3]}-${MONTHS[dm[2]]}-${day}`;
  }

  // Due Date appears as "Due Date   20 Jul 2026" (slip) and "Due Date: ..." (footer).
  let dueDate = null;
  const dd = fullText.match(/Due Date:?\s+(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})/);
  if (dd) dueDate = `${dd[3]}-${MONTHS[dd[2]]}-${dd[1].padStart(2, "0")}`;

  // Supplier: the issuer block, confirmed by the constant WSS bank account. Never
  // the customer block. If the marker isn't present, leave null (warn/continue).
  const supplier =
    fullText.includes(SUPPLIER_NAME) || fullText.includes(WSS_BANK_ACCOUNT)
      ? SUPPLIER_NAME
      : null;

  // Printed totals via LABELLED anchors. TOTAL NZD (not the slip's Amount Due) is
  // authoritative for the total; Amount Due is captured only to cross-check.
  const grab = (re) => parseMoney(fullText.match(re)?.[1] ?? null);
  const printedSubtotal = grab(new RegExp(String.raw`Subtotal\s+(${MONEY})`));
  const printedGST = grab(new RegExp(String.raw`TOTAL GST 15%\s+(${MONEY})`));
  const printedTotal = grab(new RegExp(String.raw`TOTAL NZD\s+(${MONEY})`));
  const amountDue = grab(new RegExp(String.raw`Amount Due\s+(${MONEY})`));

  if (printedSubtotal == null) {
    throw new ParserError("MISSING_SUBTOTAL", HARD_STOP.MISSING_SUBTOTAL);
  }

  return {
    invoiceNumber,
    date,
    reference,
    supplier,
    dueDate,
    printedSubtotal,
    printedGST,
    printedTotal,
    amountDue,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — reconstruct wrapped rows. Joins a record-start line that lacks its
// trailing triple with following continuation line(s) until a bare triple closes
// it. Covers wrapped product descriptions AND wrapped N/A lines (incl. a split
// "x {qty}"). Bounded window -> unjoinable buffers become review rows.
// ---------------------------------------------------------------------------
const MAX_CONTINUATIONS = 3;

function reconstructRows(lines) {
  const rows = []; // { text, reason? }  reason set => emit as review row
  let buffer = null; // { text, continuations }

  const flushIncomplete = () => {
    if (buffer) {
      rows.push({
        text: buffer.text,
        reason: "looks like a line item but found no qty/unit/amount",
      });
      buffer = null;
    }
  };

  for (const rawLine of lines) {
    const line = squash(rawLine);
    if (!line) continue;

    const isComplete = TRAILING_TRIPLE.test(line);
    const startsRecord = CODE_PREFIX.test(line) || NA_DETAIL_START.test(line);

    if (buffer) {
      // A bare trailing triple closes the buffered (wrapped) record.
      if (BARE_TRIPLE.test(line)) {
        rows.push({ text: squash(`${buffer.text} ${line}`) });
        buffer = null;
        continue;
      }
      // A new record-start (or any self-complete line) means the buffer never
      // completed: emit it as a review row, then handle this line fresh.
      if (startsRecord || isComplete) {
        flushIncomplete();
        // fall through to handle `line` below
      } else if (buffer.continuations < MAX_CONTINUATIONS) {
        // A wrapped-description continuation (e.g. "Flicking Rabbit Vibrator
        // Purple", or the split "2.0" from a torn "x 2.0").
        buffer.text = squash(`${buffer.text} ${line}`);
        buffer.continuations += 1;
        continue;
      } else {
        flushIncomplete();
        // fall through
      }
    }

    if (isComplete) {
      rows.push({ text: line });
    } else if (startsRecord) {
      buffer = { text: line, continuations: 0 };
    } else {
      // Not a record-start and not complete: chrome (header/slip/footer) or a
      // total line. Passed through for classification to skip/route.
      rows.push({ text: line });
    }
  }
  flushIncomplete();
  return rows;
}

// ---------------------------------------------------------------------------
// Stage 3/4 — tokenize + classify a single reconstructed row.
// Returns { class, ...fields }. class is one of:
//   product | notSupplied | shipping | storeCredit | pageHeader | total |
//   naMarker | chrome | review
// ---------------------------------------------------------------------------
function classifyRow(text) {
  // Page column header (exact, after whitespace squash).
  if (text === PAGE_HEADER) return { class: "pageHeader" };

  // N/A section marker ("N/A's below ... 0.00 0.00 0.00").
  if (text.startsWith(NA_MARKER_PREFIX)) return { class: "naMarker" };

  // N/A detail line: two " - ", code from the SECOND one, qty from "x {qty}".
  // Never split on the first " - " (that would capture the "N/A (...)" prefix).
  if (NA_DETAIL_START.test(text)) {
    const body = text.slice(NA_DETAIL_PREFIX.length).trim();
    // body = "{code} - {name} x {qty}  0.00  unit  0.00"
    const m = body.match(/^(\d{4,6}) - (.*?) x (\d+(?:\.\d+)?)\b/);
    if (m) {
      return {
        class: "notSupplied",
        invoiceCode: m[1],
        name: squash(m[2]),
        qty: Math.round(Number.parseFloat(m[3])),
      };
    }
    // Prefix matched but the body didn't parse -> data-shaped ambiguity.
    return { class: "review", reason: "N/A line did not match expected shape" };
  }

  const triple = text.match(TRAILING_TRIPLE);
  const codeMatch = text.match(CODE_PREFIX);

  if (codeMatch && triple) {
    const qty = Number.parseFloat(triple[1]);
    const unitPrice = parseMoney(triple[2]);
    const amount = parseMoney(triple[3]);
    const descriptionText = text.slice(0, triple.index).trim();
    // Split description on the FIRST " - " -> code | name.
    const dash = descriptionText.indexOf(" - ");
    const name = dash >= 0 ? descriptionText.slice(dash + 3).trim() : descriptionText;
    const invoiceCode = codeMatch[1];

    if (qty > 0 && amount > 0) {
      return { class: "product", invoiceCode, description: name, qty, unitPrice, amount };
    }
    if (qty === 0 && amount === 0) {
      // Inline "not supplied" twin.
      return { class: "notSupplied", invoiceCode, name, qty: 0 };
    }
    // Coded line with an odd triple (e.g. qty>0 but amount 0) -> surface it.
    return { class: "review", reason: "coded line with unexpected qty/amount" };
  }

  if (!codeMatch && triple) {
    const qty = Number.parseFloat(triple[1]);
    const unitPrice = parseMoney(triple[2]);
    const amount = parseMoney(triple[3]);

    // Store credit / adjustment: parenthesised (negative) amount.
    if (amount < 0) {
      return { class: "storeCredit", amount, unitPrice, qty };
    }
    // Shipping: qty 1, unit == amount, positive. (Label is confirmation only.)
    if (Math.abs(qty - 1) < 1e-9 && cents(unitPrice) === cents(amount) && amount > 0) {
      return { class: "shipping", amount, unitPrice, qty };
    }
    // A code-less triple that is neither credit nor shipping -> data-shaped
    // surprise: review, never assume.
    return { class: "review", reason: "uncoded line with an unrecognised amount triple" };
  }

  // No code, no triple. A labelled total line, or page chrome (header/slip/footer).
  // Totals are sourced in the meta pass; here they are simply skipped. Chrome is
  // skipped too (recorded in debug, not dropped). Reconciliation is the backstop
  // for any value-bearing line that ever hides in this shape.
  if (/^(Subtotal|TOTAL GST 15%|TOTAL NZD|Amount Due)\b/.test(text)) {
    return { class: "total" };
  }
  return { class: "chrome" };
}

// ---------------------------------------------------------------------------
// Pure pipeline: page-text strings -> frozen result object. No pdfjs here, so
// this is unit-testable with canned page text.
// ---------------------------------------------------------------------------
export function parsePages(rawTextByPage) {
  const fullText = rawTextByPage.join("\n");
  const meta = extractMeta(fullText); // may hard-stop on missing Subtotal

  // Reconstruct over the whole document's line stream (page boundaries don't
  // affect record joining; the slip interleave is handled by anchoring on
  // labelled totals in the meta pass, not on PAYMENT ADVICE position).
  const allLines = rawTextByPage.flatMap((p) => p.split("\n"));
  const reconstructed = reconstructRows(allLines);

  const items = [];
  const shipping = [];
  const storeCredit = [];
  const notSuppliedRaw = [];
  const reviewRows = [];
  const classifications = [];

  for (const row of reconstructed) {
    if (row.reason) {
      // Unjoinable wrapped buffer from stage 2.
      reviewRows.push({ rawText: row.text, reason: row.reason });
      classifications.push({ rawText: row.text, class: "review", reason: row.reason });
      continue;
    }

    const c = classifyRow(row.text);
    classifications.push({ rawText: row.text, class: c.class, reason: c.reason });

    switch (c.class) {
      case "product":
        items.push({
          invoiceCode: c.invoiceCode,
          description: c.description,
          qty: c.qty,
          unitPrice: c.unitPrice,
          amount: c.amount,
          source: "parsed",
        });
        break;
      case "shipping":
        shipping.push({ amount: c.amount });
        break;
      case "storeCredit":
        // Normalized signed value (parentheses already mapped to negative).
        storeCredit.push({ amount: c.amount });
        break;
      case "notSupplied":
        notSuppliedRaw.push({ invoiceCode: c.invoiceCode, name: c.name, qty: c.qty });
        break;
      case "review":
        reviewRows.push({ rawText: row.text, reason: c.reason });
        break;
      // pageHeader | total | naMarker | chrome -> intentionally skipped (in debug).
      default:
        break;
    }
  }

  // Stage 5 — de-dup not-supplied by code (inline qty-0 twin + N/A entry = one).
  // Prefer the N/A "x {qty}" (the real ordered count) over the inline 0.
  const notSupplied = dedupeNotSupplied(notSuppliedRaw);

  if (items.length === 0) {
    throw new ParserError("ZERO_PRODUCTS", HARD_STOP.ZERO_PRODUCTS);
  }

  const reconciliation = buildReconciliation({ items, shipping, storeCredit, meta });

  return {
    meta,
    items,
    nonProductLines: { shipping, storeCredit, notSupplied },
    reviewRows,
    reconciliation,
    debug: {
      rawTextByPage,
      reconstructedRows: reconstructed.map((r) => r.text),
      classifications,
    },
  };
}

function dedupeNotSupplied(rows) {
  const byCode = new Map();
  for (const r of rows) {
    const existing = byCode.get(r.invoiceCode);
    if (!existing) {
      byCode.set(r.invoiceCode, { ...r });
    } else {
      // Prefer a non-zero (N/A) qty and a non-empty name.
      if ((existing.qty ?? 0) === 0 && (r.qty ?? 0) > 0) existing.qty = r.qty;
      if (!existing.name && r.name) existing.name = r.name;
    }
  }
  return [...byCode.values()];
}

// ---------------------------------------------------------------------------
// Stage 6/7 — validation + reconciliation, all in integer cents.
// ---------------------------------------------------------------------------
function buildReconciliation({ items, shipping, storeCredit, meta }) {
  // Per-line check: round(qty*unit, 2) == amount, for every line with a triple.
  const perLineFailures = [];
  const checkLine = (invoiceCode, qty, unitPrice, amount) => {
    const expected = Math.round(qty * unitPrice * 100) / 100;
    if (cents(expected) !== cents(amount)) {
      perLineFailures.push({ invoiceCode, qty, unitPrice, amount, expected });
    }
  };
  for (const it of items) checkLine(it.invoiceCode, it.qty, it.unitPrice, it.amount);
  for (const s of shipping) checkLine(null, 1, s.amount, s.amount);
  for (const sc of storeCredit) checkLine(null, 1, sc.amount, sc.amount);

  // Completeness, in cents. storeCredit amounts are normalized-negative, so the
  // positive magnitude subtracted is -Σ(signed).
  const productSumC = items.reduce((a, it) => a + cents(it.amount), 0);
  const shippingC = shipping.reduce((a, s) => a + cents(s.amount), 0);
  const storeCreditC = storeCredit.reduce((a, sc) => a - cents(sc.amount), 0); // magnitude
  const computedC = productSumC + shippingC - storeCreditC;
  const printedC = cents(meta.printedSubtotal);
  const gapC = computedC - printedC;

  // Tolerance: small, line-count-aware defensive band (design §6). Expected
  // residual is 0 because all quantities are integers; the band only ever absorbs
  // a hypothetical future fractional-qty rounding, and maxes at 10c — well under
  // the smallest real line ($1.74), so a dropped line is always caught.
  const tolC = Math.min(10, Math.max(2, Math.ceil(items.length / 20)));
  const status = Math.abs(gapC) <= tolC ? "pass" : "fail";

  // Total identities (exact). null if an input is missing; GST never recomputed.
  const subtotalPlusGstEqualsTotal =
    meta.printedGST == null || meta.printedTotal == null
      ? null
      : cents(meta.printedSubtotal) + cents(meta.printedGST) === cents(meta.printedTotal);
  const amountDueEqualsTotal =
    meta.amountDue == null || meta.printedTotal == null
      ? null
      : cents(meta.amountDue) === cents(meta.printedTotal);

  return {
    productSum: productSumC / 100,
    shipping: shippingC / 100,
    storeCredit: storeCreditC / 100,
    computedSubtotal: computedC / 100,
    printedSubtotal: meta.printedSubtotal,
    gap: gapC / 100,
    tolerance: tolC / 100,
    status,
    perLineFailures,
    totalsCheck: { subtotalPlusGstEqualsTotal, amountDueEqualsTotal },
  };
}

// ---------------------------------------------------------------------------
// Public entry: PDF bytes -> frozen result object.
// `data` is a Uint8Array or ArrayBuffer of the PDF.
// ---------------------------------------------------------------------------
export default async function parsePDF(data) {
  const rawTextByPage = await extractTextByPage(data);
  const hasText = rawTextByPage.some((p) => squash(p).length > 0);
  if (!hasText) {
    throw new ParserError("NO_TEXT_LAYER", HARD_STOP.NO_TEXT_LAYER);
  }
  return parsePages(rawTextByPage);
}
