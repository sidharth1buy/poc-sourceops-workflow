# WHL Testing Module — Portable Specification

Complete, implementation-ready spec for the **WHL (White Horse Laboratories) testing section** of a
component-trade fulfilment console. It is written to be dropped into *any* codebase: it defines the
data model, derived state, actions, mock integration contracts, email/notification copy, UI layout and
invariants precisely enough to rebuild the module byte-for-behaviour without seeing the original code.

Pair this file with `PROMPT.md` (the instruction to give Claude in the target repo).

- **Frontend only.** No backend, no real mail, no real OCR. All external systems are in-memory mock
  adapters behind a logging transport; all state is client-side and persisted locally.
- **Reference implementation:** `poc-sourceops-workflow` (Next.js 16 + React 19 + Zustand + Tailwind v4).
  File inventory in §12. Nothing here depends on those choices — §11 maps the seams.

---

## 1. What the module does

The primary screen lives on **one order** and answers six questions:

1. **What tests does each MPN need, and what do they cost?** — auto-filled by parsing the PO (never
   hand-typed), with an audited manual override and an explicit "auto-fill failed — needs manual review"
   state; priced from the lab's invoice, which is that same list × a per-process rate.
2. **Where is each lot right now, and who owes the next move?** — a 7-stage testing lifecycle per lot
   (request → fee → supplier dispatch → lab receipt → testing → report). **Every stage is established by
   an inbound mail**, with a timestamped row per stage citing the message that moved it.
3. **Where does every test stand, per lot?** — a live status tracker per MPN × lot × test, updated
   automatically from inbound lab email, with full timestamped history (not just latest state) **and the
   report's process result folded into the same row**.
4. **What does the report say?** — a per-lot report repository holding *all* revisions, with the key
   header fields parsed on screen so nobody opens the PDF.
5. **What does the lab charge, on what terms, and has it been paid?** — WHL's own invoice for the testing
   service arrives by mail on booking (long before the report), states **advance or credit terms**, is
   downloadable per lot, and is handed to finance to pay. Its own lifecycle stage sits right after the
   work order, and on advance terms it genuinely gates the bench.
6. **What happens next?** — per-lot and bulk follow-through: notify supplier / buyer / escrow / lab /
   finance (the right document attached), or hand off to logistics with a shipment pre-filled.

Questions 2 and 3 are **separate axes** and the module keeps them separate: the lifecycle answers *where
the parts are*, the tracker answers *what was tested*. Conflating them is the most tempting wrong turn
here — see §3 and invariant 18.

**The test list is rendered exactly twice, and the two are different questions.** Once per lot (the
tracker: status, quantities, and the report line that settled each test) and once per MPN (a
requirements × lots matrix: is every requirement covered on every lot, and what did each say). An
earlier cut rendered it three times — MPN requirements, lot tracker, *and* the report's process matrix —
which was the same names three times over, because the report's results are rolled onto the tracker the
moment it's fetched. See invariant 25.

Plus the plumbing that makes it trustworthy: a WHL correspondence thread per lot, a manual-match queue
for unroutable inbound mail, reconciliation alerts, an SLA clock on unanswered chases, an audit trail on
every change, role-gated actions and an NDA access log on reports.

### Non-goals

- Lot creation / numbering / association logic is **pre-existing and unchanged** — this module consumes
  lots, it does not redesign them.
- The escrow/payment state machine is **unchanged** — the lot verdict keeps driving it exactly as before.

---

## 2. Domain primer (read this or the model won't make sense)

| Term | Meaning |
|---|---|
| **Masked back-to-back trade** | Three parties: client (buyer) → masking entity (us) → supplier. The buyer must never learn the supplier and vice-versa. Every outbound mail must respect this. |
| **MPN** | Manufacturer part number, e.g. `STM32F407VGT6`. The unit of demand and of test requirements. |
| **Lot** | A physical batch of one MPN submitted for testing: lot code, date code, qty, sample qty, lab, work-order no. One MPN can have several lots; one order has many lots. |
| **WHL** | The independent test lab. Communicates **by email**: interim status notes, delay notices, report PDFs, revised reports. |
| **Work order no.** | WHL's internal job id for a submitted lot, e.g. `352146`. |
| **Report no. + revision** | WHL issues `352146.1`, then `352146.2` when a result is revised. All versions are kept; exactly one is *current*. |
| **Client PO no.** | The buyer's PO. Appears on WHL reports and must reconcile with the PO on file — WHL sometimes prints `PO Unknown`. |
| **Process** | A step inside a report (Documentation & Packaging, General Inspection, External Visual, Electrical Test, X-Ray, Decapsulation & Die Analysis, …), each independently graded. |
| **F.A.R.** | *Further Analysis Recommended.* A per-process verdict. A report can be **Acceptable overall** while one process is F.A.R. — that still needs follow-up. This is the single most-missed nuance. |
| **Conclusion set** | WHL's own overall verdicts: **Acceptable / Not Acceptable / Suspect Counterfeit**. Not a generic pass/fail. |
| **Escrow release trigger** | Money is released to the supplier on an independent lab PASS. So a lot verdict has financial consequence. |
| **Three identifiers** | Client PO no., WHL work-order no., WHL report no. (with revision) are *separate* keys and must all be tracked; email routing and reconciliation depend on them. |
| **Testing lifecycle** | The physical journey of a lot while it's at the lab, distinct from its test results: we raise a work order, settle the lab's fee, the **supplier** ships samples to the lab, the lab confirms receipt, tests it, and shares the report. Every step is established by an inbound mail — the lab's, or the supplier's dispatch advice relayed onto the same thread. |
| **Testing fee** | WHL bills for the testing itself — a separate invoice from the test report, issued on booking, payable by our finance team. Nothing to do with the supplier's material payment or the escrow; it is our cost against the order. Priced per process, so the fee is the test list × a rate. |
| **Advance vs credit** | The two modes the lab bills on, stated on its invoice mail and **never chosen by us** — it's the lab's call per work order. **Advance:** the fee clears before the bench starts, so the lot sits in the lab's store and the fee is a genuine gate. **Credit:** the lab tests on account and bills on terms, so the fee is a parallel track that must block nothing. |
| **On account** | Credit terms in practice: the lab starts testing before the fee clears, so the physical chain legitimately runs ahead of the payment stage with the invoice still outstanding. Does **not** apply on advance terms. |
| **Bench-vs-report lag** | Testing finishing and the report arriving are different events, often days apart — the lab is done but the signed report is with its reviewer. Keep them as separate stages so the gap is visible in the timestamps; it does **not** need a "report being written" stage of its own. |

---

## 3. Data model

Verbatim TypeScript. Field comments are part of the spec.

```ts
// ---- status vocabularies ----
export type TestStatus = "PENDING" | "PASS" | "FAIL" | "MAYBE";          // LOT-level (pre-existing)
export type TestProcessStatus = "PENDING" | "IN_PROGRESS" | "PASSED" | "FAILED" | "NOT_CONDUCTED" | "FAR";
export type WhlProcessResult = "ACCEPTABLE" | "NOT_ACCEPTABLE" | "FAR" | "NOT_CONDUCTED";
export type WhlConclusion = "ACCEPTABLE" | "NOT_ACCEPTABLE" | "SUSPECT_COUNTERFEIT";
export type TestSource = "AUTO_PO" | "MANUAL";
export type AutofillState = "PENDING" | "OK" | "FAILED";
export type LabEmailDirection = "OUT" | "IN";
export type LabEmailStatus = "AWAITING_RESPONSE" | "UPDATE_RECEIVED" | "REPORT_DELIVERED" | "ESCALATED" | "SENT";
export type NotifyParty = "SUPPLIER" | "BUYER" | "ESCROW" | "WHL" | "FINANCE";

/**
 * Where a lot sits in the testing LIFECYCLE — "where are the parts and who owes the next
 * move", as opposed to TestProcessStatus which answers "what was tested". Ordered; a lot
 * only ever travels forward through it.
 *
 * Seven stages, and every one is established by an inbound mail (see §7.3). Two earlier
 * stages were deliberately dropped:
 *   - TESTING_STARTED — "in progress" already says the lot is on the bench, and the
 *     interim mail that reports progress is the same mail that would have said "started".
 *   - REPORT_PREPARATION — "report shared" already says the write-up finished. The
 *     bench-vs-report lag that justified it is still visible as the gap between the
 *     TESTING_COMPLETED and REPORT_SHARED timestamps, which is all it was ever for.
 *
 * Note the tail order: testing finishing and the report landing are separate events and
 * the gap between them can be days, so TESTING_COMPLETED sits before REPORT_SHARED — the
 * point at which we can actually act.
 */
export type TestingStage =
  | "TEST_REQUESTED"
  | "WHL_PAYMENT"
  | "SUPPLIER_DISPATCHING"
  | "COMPONENTS_RECEIVED"
  | "TESTING_IN_PROGRESS"
  | "TESTING_COMPLETED"
  | "REPORT_SHARED";

/** One audit row. Every manual test edit and every status change (automated or manual) writes one. */
export interface TestAuditEntry {
  id: string;
  at: string;                 // "YYYY-MM-DD HH:mm" — datetime precise, not date
  by: string;                 // operator, or the automation ("WHL inbox (auto)", "Doc extraction (auto)")
  action: "AUTOFILL" | "ADD" | "DELETE" | "STATUS" | "REPORT" | "RECONCILE" | "EMAIL";
  target?: string;            // test name / report no / lot code the row is about
  before?: string;
  after?: string;
  note?: string;
  sourceEmailId?: string;     // inbound email that triggered an automated change
}

/** A required test as parsed off the PO (never hand-typed unless the operator overrides). */
export interface TestRequirement {
  id: string;
  name: string;               // e.g. "External Visual Inspection"
  standard?: string;          // e.g. "AS6081"
  source: TestSource;
  addedBy?: string;
  addedAt?: string;
}

/**
 * Test requirements for ONE MPN on ONE order (i.e. per PO). The same MPN can carry a
 * different list on another PO/lot, so this is keyed by order + mpn, never globally by mpn.
 */
export interface MpnTestSpec {
  id: string;
  mpn: string;
  autofill: AutofillState;    // FAILED → "needs manual review" flag on the MPN
  autofillNote?: string;      // why it failed (bad scan / no test table / unparseable)
  sourceDoc?: string;         // which PO the tests were parsed from
  parsedAt?: string;
  confidence?: number;        // 0..1
  tests: TestRequirement[];
  audit: TestAuditEntry[];
}

/** Live status of one required test on one lot, with its full progression. */
export interface LotTest {
  id: string;
  requirementId?: string;     // links back to the MpnTestSpec entry it was inherited from
  name: string;
  standard?: string;
  source: TestSource;
  status: TestProcessStatus;
  acceptQty?: number;
  rejectQty?: number;
  updatedAt?: string;
  history: TestAuditEntry[];  // timestamped progression, not just the latest state
}

export interface WhlReportProcess {
  name: string;
  result: WhlProcessResult;
  acceptQty?: number;
  rejectQty?: number;
  note?: string;
}

/** One version of a WHL report (WHL revises: 352146.1, 352146.2 …). */
export interface WhlReport {
  id: string;
  reportNo: string;           // incl. revision, e.g. "352146.2"
  revision: number;
  reportDate: string;
  workOrderNo: string;
  fileName: string;
  receivedAt: string;
  current: boolean;           // exactly one current version per lot
  revisionNote?: string;
  // auto-parsed header fields (surfaced on screen — no need to open the PDF)
  partNumber: string;
  manufacturer: string;
  lotQty: number;
  client: string;
  clientPo: string;           // may come back as "PO Unknown" → reconciliation flag
  conclusion: WhlConclusion;
  anyFar: boolean;            // a process came back F.A.R. even if the overall conclusion is Acceptable
  processes: WhlReportProcess[];
  approvedBy: string;
  approverTitle: string;
  standards: string[];        // e.g. ["AS6081", "AS6171"]
  riskClass?: string;         // e.g. "ERAI Low Risk"
  msl?: string;               // e.g. "MSL 3"
  packageType?: string;       // e.g. "LQFP-100"
  confidentialityNote?: string;
  parseFlags: string[];       // missing/placeholder data needing manual reconciliation
  accessLog: { at: string; by: string; action: "VIEW" | "DOWNLOAD" }[];
}

/** One message in the WHL correspondence thread for a lot. */
export interface LabEmail {
  id: string;
  direction: LabEmailDirection;
  lotId?: string;             // undefined = couldn't be matched → manual-match queue
  lotCode?: string;
  mpn?: string;
  workOrderNo?: string;
  poNo?: string;
  subject: string;
  body: string;
  at: string;
  by: string;                 // "You (demo)" / "WHL Reports"
  status: LabEmailStatus;
  // DISPATCH = the supplier's advice relayed onto this thread; PAYMENT = WHL's receipt for the fee
  kind: "REQUEST_UPDATE" | "CUSTOM" | "STATUS_UPDATE" | "REPORT" | "ESCALATION" | "INVOICE" | "DISPATCH" | "PAYMENT";
  attachments?: string[];
  matchedBy?: string;         // set when an operator resolved it out of the manual-match queue
  matchNote?: string;         // why auto-matching failed
}

/** A circulated result: who was told, when, and whether the report rode along. */
export interface LotNotification {
  id: string;
  party: NotifyParty;
  to: string;
  subject: string;
  body: string;
  attachments?: string[];
  reportNo?: string;
  at: string;
  by: string;
  status: "SENT" | "FAILED";
  note?: string;             // masking caveat / NDA disclosure / failure reason
}

/**
 * How WHL agreed to be paid for this work order, as stated on its invoice mail. Read,
 * never chosen — which mode applies is the lab's call per work order.
 *   ADVANCE — the fee clears before the bench starts; the lab holds the lot, so the fee
 *             is a genuine gate on the lifecycle.
 *   CREDIT  — the lab tests on account and bills on terms; a parallel track that must
 *             never block dispatch or results.
 */
export type LabPaymentTerms = "ADVANCE" | "CREDIT";

/**
 * WHL's own invoice for the testing service — a different document from the test report,
 * arriving by mail the same way. Per lot, because the lab invoices per work order.
 */
export interface LabInvoice {
  id: string;
  invoiceNo: string;
  amount: number;             // net of tax
  taxAmount?: number;
  currency: string;
  fileName: string;
  receivedAt: string;
  dueDate?: string;
  note?: string;
  terms: LabPaymentTerms;     // ← the mode the lab stated; decides whether unpaid = blocked
  creditDays?: number;        // ← CREDIT only: days allowed from the invoice date
  ratePerProcess?: number;    // ← so a test row can show its own price
  processCount?: number;      // ← amount === processCount × ratePerProcess
  accessLog: { at: string; by: string; action: "VIEW" | "DOWNLOAD" }[];
}

/** How far the fee has got. Distinct from the terms: terms say whether unpaid blocks. */
export type LabPaymentStatus = "NOT_REQUESTED" | "REQUESTED" | "INVOICE_RECEIVED" | "SENT_TO_FINANCE" | "PAID";

export interface LabPayment {
  status: LabPaymentStatus;
  invoice?: LabInvoice;
  requestedAt?: string;       // we asked WHL for the invoice
  sentToFinanceAt?: string;   // the finance mail that initiates payment
  sentToFinanceBy?: string;
  paidAt?: string;
  paidRef?: string;           // wire / UTR reference finance came back with
  note?: string;
}

/**
 * One recorded move along the lifecycle. A list, not a single "current stage", so the UI
 * can show WHEN each step happened and WHAT moved it — an operator, or an inbound WHL
 * mail (linked, so the row is auditable back to its evidence).
 */
export interface TestingStageEvent {
  id: string;
  stage: TestingStage;
  at: string;                 // "YYYY-MM-DD HH:mm"
  by: string;                 // operator, "WHL inbox (auto)", or "Supplier (relayed)"
  note?: string;
  sourceEmailId?: string;     // the inbound mail that moved the stage
  manual?: boolean;           // an operator recorded it by hand instead of a mail driving it
}

/**
 * The supplier → lab shipment. The lab cannot tell us a shipment exists until it lands, so
 * this stage comes from the SUPPLIER's own dispatch advice, relayed onto the lot's thread
 * (`kind: "DISPATCH"`), with a manual modal as the phone-call fallback. Everything except
 * the fact of dispatch is optional — chasing a supplier for an AWB must not block the
 * chain from showing the lot as on its way.
 */
export interface LotDispatch {
  courier?: string;
  awb?: string;
  dispatchedOn?: string;
  expectedArrival?: string;
  note?: string;
  recordedBy: string;
  recordedAt: string;
}

/** EXISTING entity — only the flagged fields are added by this module. */
export interface Lot {
  id: string;
  orderLineMpn: string;
  lotCode: string;
  dateCode: string;
  qty: number;
  sampleQty: number;
  testStatus: TestStatus;     // drives escrow release / refund — DO NOT repurpose
  lab?: string;
  workOrderNo?: string;
  reportNo?: string;          // current report no (incl. revision)
  tatDays?: number;
  testedAt?: string;
  clientPoNo?: string;        // ← added: client PO this lot's demand belongs to (reconciliation)
  tests?: LotTest[];          // ← added: inherited from the MPN's spec at lot creation
  reports?: WhlReport[];      // ← added: all versions; exactly one `current`
  lastUpdateRequestAt?: string; // ← added: SLA clock for an unanswered "Request Update"
  notifications?: LotNotification[]; // ← added
  stage?: TestingStage;       // ← added: recorded lifecycle position (see lotStage for the displayed one)
  stageHistory?: TestingStageEvent[]; // ← added: timestamped progression through the chain
  dispatch?: LotDispatch;     // ← added: supplier → lab leg, recorded when the supplier tells us
  labPayment?: LabPayment;    // ← added: WHL's testing invoice and its settlement
}

/** Order-level containers added by this module. */
export interface OrderBundle /* extends the host's order aggregate */ {
  mpnTests?: MpnTestSpec[];   // PO-parsed test requirements per MPN on this order
  labEmails?: LabEmail[];     // full WHL correspondence (incl. unmatched inbound)
}
```

**Entity chain:** `PO → MpnTestSpec (per MPN) → Lot → LotTest → TestAuditEntry[] → WhlReport[] (versioned) → LabEmail[] / LotNotification[]`

**Two orthogonal progress axes on a lot — do not conflate them:**

| Axis | Question it answers | Carried by |
|---|---|---|
| Lifecycle stage | *Where are the parts, who owes the next move?* | `Lot.stage` + `stageHistory` (`TestingStage`) |
| Test tracker | *What was tested and with what result?* | `Lot.tests[].status` (`TestProcessStatus`) |

They interact but never substitute: a lot can be `TESTING_COMPLETED` with every test still
`IN_PROGRESS` on the tracker (the lab has finished the bench but hasn't released results),
and a report arriving settles the tracker *and* ends the lifecycle.

### Status → colour tone map

Feed these into the host's existing badge/pill component. Tones: `ok | bad | warn | active | neutral`.

| Tone | Values |
|---|---|
| `ok` | `PASS`, `PASSED`, `ACCEPTABLE`, `REPORT_DELIVERED`, `DONE`, `APPROVED`, `RELEASED`, `DELIVERED` |
| `bad` | `FAIL`, `FAILED`, `NOT_ACCEPTABLE`, `SUSPECT_COUNTERFEIT`, `ESCALATED`, `REJECTED`, `BLOCKED`, `REFUNDED` |
| `warn` | `FAR`, `MAYBE`, `PENDING`, `AWAITING_RESPONSE`, `FUNDED`, `REQUESTED` |
| `active` | `IN_PROGRESS`, `UPDATE_RECEIVED`, `ACTIVE`, `IN_TRANSIT` |
| `neutral` | `NOT_CONDUCTED`, `SENT`, anything unmapped |

Display rule: render `FAR` as **“F.A.R.”**, never “Far”. Render other enums title-cased with `_` → space.

---

## 4. Reference data (exact values)

```ts
export const WHL_PROCESSES = [
  "Documentation & Packaging Inspection",
  "General Inspection",
  "External Visual Inspection",
  "Electrical Test",
  "X-Ray Inspection",
  "XRF / Solderability",
  "Decapsulation & Die Analysis",
  "Marking Permanency",
  "Solvent Resistance Test",
  "Scanning Acoustic Microscopy",
] as const;

export const TEST_STANDARDS = ["AS6081", "AS6171", "AS5553", "IDEA-STD-1010", "J-STD-033"] as const;
export const WHL_CONCLUSIONS = ["ACCEPTABLE", "NOT_ACCEPTABLE", "SUSPECT_COUNTERFEIT"] as const;
export const TEST_PROCESS_STATUSES = ["PENDING", "IN_PROGRESS", "PASSED", "FAILED", "FAR", "NOT_CONDUCTED"] as const;

export const WHL_CONTACT = "reports@whitehorselabs.example";
export const WHL_SLA_BUSINESS_DAYS = 3;   // unanswered "Request Update" past this → flagged

export const WHL_CONFIDENTIALITY =
  "CONFIDENTIAL — issued to <MASKING ENTITY> under NDA. Internal use only; no redistribution to the client or supplier without WHL's written consent.";

// role gate — only these personas may override auto-filled tests or mail on our behalf
export const TEST_EDIT_ROLES = ["SC", "Mgmt"];
export const LAB_EMAIL_ROLES = ["SC", "Mgmt"];
```

### Testing lifecycle chain (exact copy — this is product text)

Order matters and is the single source of truth; nothing may hardcode which stage is last.

```ts
export const TESTING_STAGES: readonly TestingStage[] = [
  "TEST_REQUESTED", "WHL_PAYMENT", "SUPPLIER_DISPATCHING", "COMPONENTS_RECEIVED",
  "TESTING_IN_PROGRESS", "TESTING_COMPLETED", "REPORT_SHARED",
] as const;

export const TESTING_TERMINAL_STAGE = TESTING_STAGES[TESTING_STAGES.length - 1]; // REPORT_SHARED

export type StageOwner = "1BUY" | "SUPPLIER" | "WHL";   // labels: "1Buy" | "Supplier" | "WHL"

export const stageIdx   = (s?: TestingStage) => (s ? TESTING_STAGES.indexOf(s) : -1);
export const stageLabel = (s?: TestingStage) => (s ? TESTING_STAGE_META[s].label : "Not started");
```

| # | Stage | Label | Description (verbatim) | Owner | Moved by (always a mail) |
|---|---|---|---|---|---|
| 1 | `TEST_REQUESTED` | Test Requested | Testing request has been initiated. | 1Buy | Work order raised with WHL for this lot. |
| 2 | `WHL_PAYMENT` | Payment to WHL | WHL's testing invoice has been received and settled — on advance terms this is what frees the bench. | 1Buy | Invoice mail states the terms; WHL's payment acknowledgement closes it. |
| 3 | `SUPPLIER_DISPATCHING` | Supplier Dispatching Components | Supplier is preparing and shipping the components to WHL. | Supplier | Supplier's dispatch advice mail (courier / AWB) — or record it by hand. |
| 4 | `COMPONENTS_RECEIVED` | Components Received by WHL | WHL has confirmed receipt of the components. | WHL | Receipt confirmation mail from WHL. |
| 5 | `TESTING_IN_PROGRESS` | Testing In Progress | The lot is on the bench — WHL is conducting the required tests and mailing progress. | WHL | Interim progress mails from WHL — each one updates the test tracker. |
| 6 | `TESTING_COMPLETED` | Testing Completed | Every process in the agreed test plan has been run; the write-up is with WHL's reviewer. | WHL | WHL confirms the bench work is finished. |
| 7 | `REPORT_SHARED` | Test Report Shared | WHL has shared the completed test report and results. | WHL | Report received and parsed onto the lot. |

### The lab's testing fee (exact values)

```ts
export const LAB_PAYMENT_LABEL: Record<LabPaymentStatus, string> = {
  NOT_REQUESTED: "Invoice not requested",  REQUESTED: "Invoice requested",
  INVOICE_RECEIVED: "Invoice received — unpaid",
  SENT_TO_FINANCE: "With finance for payment",  PAID: "Paid",
};
export const LAB_PAYMENT_TONE = { NOT_REQUESTED: "neutral", REQUESTED: "warn",
  INVOICE_RECEIVED: "warn", SENT_TO_FINANCE: "active", PAID: "ok" };

// ---- the two modes the lab bills on (read off its invoice mail, never chosen by us) ----
export const LAB_TERMS: readonly LabPaymentTerms[] = ["ADVANCE", "CREDIT"] as const;
export const LAB_TERMS_LABEL = { ADVANCE: "Advance", CREDIT: "Credit" };
export const LAB_TERMS_TONE  = { ADVANCE: "warn", CREDIT: "info" };
export const LAB_TERMS_HINT  = {
  ADVANCE: "Payable before testing — WHL holds the lot until the transfer clears.",
  CREDIT: "WHL tests on account and bills on terms — the fee never blocks the bench.",
};

/** On advance terms an unpaid fee is a hard stop at the bench, not just an amber flag. */
export const labFeeGates = (terms?: LabPaymentTerms, status?: LabPaymentStatus) =>
  terms === "ADVANCE" && status !== "PAID";

export const FINANCE_CONTACT = "finance@sharpbuy.example";
export const WHL_TEST_FEE_PER_PROCESS = 145;   // USD per process — drives the mock invoice
export const WHL_INVOICE_TAX_PCT = 0.06;       // lab-site service tax
export const WHL_CREDIT_DAYS = 15;             // days the lab allows on CREDIT terms
```

Anything short of `PAID` means the fee is outstanding — including `SENT_TO_FINANCE`. What that
*means* depends on the terms: on `CREDIT` it owes money, on `ADVANCE` it stops the bench.

`owner` drives the "waiting on X" pill: the owner of the stage **after** the current one, or
`null` once the chain is complete.

Test plan by testing mode (used by the PO parser mock):

- `WHL` → first **6** of `WHL_PROCESSES`, standard `AS6081`
- `SUPPLIER_SELF` → `["Documentation & Packaging Inspection", "General Inspection", "Electrical Test"]`, no standard
- `NONE` → empty list + note `"PO specifies no incoming test for this MPN."` (this is **not** a failure)

---

## 5. Derived state (pure functions)

```ts
specForMpn(bundle, mpn)            → MpnTestSpec | undefined

lotTestProgress(lot)               → { total, settled, far, failed, open, notConducted }
// settled = tests with status PASSED. open = PENDING + IN_PROGRESS.
// F.A.R. and NOT_CONDUCTED are NOT settled — they need follow-up.

currentReport(lot)                 → the report with current === true, else highest revision

lotTestRows(lot)                   → LotTestRow[] — the ONE per-test table's rows:
//   { key, name, test?, acceptQty?, rejectQty?, report? { reportNo, result, note } }
// One row per lot test, with the current report's matching process folded in. This is what
// lets the report section stop re-listing the processes: fetching a report already rolls
// every result onto lot.tests[].status, so the only thing the second table added was the
// process note. A process on the report with NO tracker row still gets a row (test:
// undefined, rendered "report only") — dropping it would hide a process the lab ran.

// ---- lifecycle ----
lotStage(lot)                      → TestingStage | undefined
// max(recorded stage, derivedStage(lot)) — the DISPLAYED stage. The derived value is a
// FLOOR, so a lot that already has a report can never read as "awaiting dispatch", and
// lots created before the chain existed still render correctly.

derivedStage(lot)                  → TestingStage | undefined   (internal)
//   reports.length > 0                        → REPORT_SHARED
//   tests.length > 0 && open === 0            → TESTING_COMPLETED
//   any test status !== PENDING               → TESTING_IN_PROGRESS
//   lot.dispatch                              → SUPPLIER_DISPATCHING
//   labPayment.status === "PAID"               → WHL_PAYMENT
//   lot.workOrderNo                           → TEST_REQUESTED
//   else                                      → undefined  ("not started")

lotStageProgress(lot)              → { stage, idx, total, complete, done, pct, next,
                                       waitingOn, lastEvent, eventFor(stage) }
// complete  = stage === TESTING_TERMINAL_STAGE
// done      = idx + 1        pct = round((idx + 1) / total * 100)
// waitingOn = owner of the NEXT stage, null when complete, "1BUY" when not started
// eventFor  = the history row that recorded that stage, or undefined if it was skipped

stageWaiting(bundle)               → rows for every lot whose chain is not complete

// ---- the lab's fee ----
labPaymentOf(lot)                  → LabPayment  (defaults to { status: "NOT_REQUESTED" })
labFeeUnpaid(lot)                  → status !== "PAID"
labTerms(lot)                      → LabPaymentTerms | undefined  (invoice.terms; undefined pre-invoice)
labFeeGross(lot)                   → amount + taxAmount, 0 with no invoice
labFeeBlocking(lot)                → labFeeGates(labTerms, status) — advance + unpaid, i.e. the lab
                                     is holding this lot and the bench is stopped

outstandingLabFees(bundle)         → unpaid rows { lot, status, terms, blocking, invoiceNo, gross,
                                     currency, dueDate }, worst first: a BLOCKING row sorts above
                                     everything regardless of status (it stops the bench; the rest
                                     only owe money), then
                                     SENT_TO_FINANCE > INVOICE_RECEIVED > REQUESTED > NOT_REQUESTED
labFeeOutstandingTotal(bundle)     → { count, gross, currency, blocking: lotCode[] }
                                     — invoiced-but-unpaid only; `blocking` drives its own alert

mpnFeeRollup(bundle, mpn)          → what testing this MPN costs and how it's paid, across its lots:
//   { lots, invoiced, gross, currency, terms[], ratePerProcess?, unpaid, unpaidGross, blocked[] }
// terms is an array because lots of one MPN are separate work orders with separate invoices and
// can legitimately differ — report "mixed terms" rather than picking one. ratePerProcess is
// undefined unless every invoice agrees on it.

// testingSummary also gains: feesUnpaid, feesToPay (INVOICE_RECEIVED and not yet with finance)

lotEmails(bundle, lotId)           → emails whose lotId matches
unmatchedEmails(bundle)            → inbound emails with no lotId  (the manual-match queue)

testAutofillGaps(bundle)           → for each order line with testingMode !== "NONE":
                                     no spec, or spec.autofill === "FAILED", or spec.tests empty

overdueUpdateRequests(bundle)      → lots with lastUpdateRequestAt whose business-day age
                                     >= WHL_SLA_BUSINESS_DAYS, as { lot, days }

reconciliationAlerts(bundle)       → for every CURRENT report, one entry per parseFlag:
                                     { lotId, lotCode, reportId, reportNo, message, kind }
                                     kind = "PO" if the flag mentions client p/o,
                                            "MPN" if it mentions mpn, else "DATA"

testingSummary(bundle, lotId?)     → { lots, tests, passed, far, failed, notConducted, open,
                                       reports, awaiting, unmatched, gaps, overdue }
// lotId scopes EVERY number to one lot — except `unmatched`, which is always order-wide
// (unmatched mail isn't attached to a lot yet; that's the point of the queue).
// reports = sum of lot.reports.length (revisions count separately).

lotResults(bundle)                 → one row per lot:
   { lot, progress, pct, report, revisions, awaiting, overdueDays, blocker }
// pct = round(progress.settled / progress.total * 100), 0 when total === 0
// awaiting = count of OUT emails on the lot with status AWAITING_RESPONSE
// blocker = first match, in this order:
//     failed > 0        → "not-acceptable result"
//     far > 0           → "F.A.R. — needs follow-up"
//     notConducted > 0  → "process not conducted"
//     total === 0       → "no tests on file"
//     open > 0          → "<n> test(s) still open"
//     else              → null   (rendered as "clear")
```

Business-day age: count weekdays strictly between the request date and today (`Mon–Fri`), i.e. iterate
days from the date, count non-weekend days, subtract 1.

---

## 6. Actions (state transitions)

Every action is optimistic-then-confirmed where it calls an adapter, toasts its outcome, and writes audit
where the spec says so. `stamp()` = `"YYYY-MM-DD HH:mm"`, `today()` = `"YYYY-MM-DD"`.

| Action | Signature | Behaviour |
|---|---|---|
| **autofillMpnTests** | `(orderId, mpn?)` | Parse the PO's test table for one MPN or all lines. Per MPN: build/replace the spec, `autofill: "OK"` or `"FAILED"` (+ note), stamp `sourceDoc`/`parsedAt`/`confidence`. **Preserve existing MANUAL tests across a re-parse.** Append an `AUTOFILL` audit row (before = old test count, after = new). Push newly-parsed tests onto every existing lot of that MPN that lacks them (each with an `ADD` history row). Whole-document failure ⇒ mark *every* target MPN `FAILED` with the error as the note — never leave blank. Toast: success, or `"N MPN(s) need manual review — auto-fill failed."` |
| **addMpnTest** | `(orderId, mpn, { name, standard? })` | Manual override. Ignore duplicates (case-insensitive). Push `TestRequirement` with `source: "MANUAL"`, `addedBy`, `addedAt`. Append `ADD` audit row noting "Manual override of the auto-filled list." If spec was `FAILED`, move it to `PENDING` (a human has now reviewed it). Propagate to every lot of that MPN. |
| **removeMpnTest** | `(orderId, mpn, testId)` | Remove from spec, append `DELETE` audit row (before = "auto-filled test"/"manual test", after = "—"), remove the matching row from every lot of that MPN. |
| **setLotTestStatus** | `(orderId, lotId, lotTestId, status, note?)` | No-op if unchanged. Set status + `updatedAt`, append `STATUS` history row (before → after, by = operator). |
| **recordSupplierDispatch** | `(orderId, lotId, { courier?, awb?, dispatchedOn?, expectedArrival?, note? })` | Store `lot.dispatch` (+ `recordedBy`/`recordedAt`), move the stage to `SUPPLIER_DISPATCHING` with the courier/AWB/date summarised into the history note, and write an order event. **The by-hand fallback** — normally the supplier's `DISPATCH` mail does this on the next sync. |
| **requestWhlInvoice** | `(orderId, lotId)` | Send the `INVOICE_REQUEST` template (same source as the compose modal) and move the fee to `REQUESTED` + stamp `requestedAt`. Never walks a received/paid invoice backwards. |
| **markLabFeePaid** | `(orderId, lotId, { paidRef?, paidAt?, note? })` | Finance confirms the transfer out of band: status → `PAID`, stamp `paidAt`/`paidRef`, `moveStage(WHL_PAYMENT)`, and write an order event. **The by-hand fallback** — normally WHL's own `PAYMENT_ACK` mail closes the stage on the next sync. Either way, a recorded payment is the only thing that closes it; receiving an invoice never does. |
| **logInvoiceAccess** | `(orderId, lotId, "VIEW" \| "DOWNLOAD")` | Unshift onto the invoice's `accessLog`, mirroring the report's. The per-lot download button goes through this. |
| **setLotStage** | `(orderId, lotId, stage, note?)` | Manual correction — a phone call, or fixing a mis-step. Bypasses the forward-only rule (an operator may go back) and always writes a history row with `manual: true`, noting whether it was a correction backwards. Note the display floor still applies: you cannot make a lot with a report *read* as pre-report. |
| **fetchWhlReport** | `(orderId, lotId)` | Guard: needs `workOrderNo`. `revision = max(existing revisions) + 1` → calling it again fetches the **next revision**. On success: mark all existing reports `current: false`, push the new one as current, set `lot.reportNo`/`testedAt`, set `lot.testStatus = conclusionToLotStatus(...)`, roll the process matrix onto `lot.tests` (create missing rows; append a `REPORT` history row per process citing the report no), append a `REPORT_DELIVERED` inbound email to the thread, add a `WHL_REPORT` document to the order's document vault, clear `lastUpdateRequestAt`, flip any `AWAITING_RESPONSE` outbound mails on that lot to `UPDATE_RECEIVED`. Add reconciliation `parseFlags` when the report MPN ≠ lot MPN, or report client PO ≠ the PO on file. **Lifecycle: move the stage to `REPORT_SHARED`** (the end of the chain) with the report no + conclusion as the note. |
| **requestWhlUpdate** | `(orderId, lotId)` | Send the `STATUS_REQUEST` template (same source as the compose modal) and set `lot.lastUpdateRequestAt = today()` (starts the SLA clock). |
| **sendLabEmail** | `(orderId, { lotId?, subject, body })` | Unshift an OUT email with `status: "AWAITING_RESPONSE"`, `kind = subject.startsWith("Status request") ? "REQUEST_UPDATE" : "CUSTOM"`, then call the mail adapter. On failure mark that email `ESCALATED` with a retry note. |
| **syncWhlInbox** | `(orderId)` | **The lifecycle's single driver.** Poll the mailbox for all lots that have a work order, passing each lot's `lotStage` plus its fee state (`hasInvoice`, `feePaid`, `feeWithFinance`, `terms`) so the adapter can answer with the mail that plausibly comes next. For each message: route by `lotCode` then `workOrderNo`. Matched ⇒ apply its per-test interim statuses (**never downgrade a test already `PASSED`/`FAILED` by a report**), set status `UPDATE_RECEIVED`/`REPORT_DELIVERED`, flip that lot's awaiting outbound mails to `UPDATE_RECEIVED`, and apply whichever payload the mail carries: `invoice` ⇒ store the invoice **including its `terms`/`creditDays`/`ratePerProcess`**, set `INVOICE_RECEIVED` (never over `PAID`), file the PDF in the vault; `dispatch` ⇒ set `lot.dispatch` with `recordedBy: "Supplier (mail)"` (only if absent); `payment` ⇒ status → `PAID` with the mail's `paidRef`/`paidAt` + an order event. `by` is set from the kind (`Supplier (relayed)` / `WHL Accounts` / `WHL Reports`). Unmatched ⇒ store with `lotId: undefined` + `matchNote` (“Subject line carries no work order, lot or report number — match it manually.”). Then `moveStage` to the message's `stage` citing its subject + id. Toast priority: fees settled > invoices received > stage advances > `"N update(s) applied · M need manual matching"`. |
| **matchLabEmail** | `(orderId, emailId, lotId)` | Attach the email to the lot (copy lotCode/mpn/workOrderNo/poNo), set `matchedBy`, clear `matchNote`, set status by kind, and append an `EMAIL` audit row on that MPN's spec. |
| **escalateLabEmail** | `(orderId, emailId)` | Set status `ESCALATED`. |
| **logReportAccess** | `(orderId, lotId, reportId, "VIEW" \| "DOWNLOAD")` | Unshift `{ at, by, action }` onto the report's `accessLog` (NDA requirement). |
| **reconcileReportPo** | `(orderId, lotId, reportId)` | Guard: a client PO must exist on the lot (or via the order's sourcing allocations) else error-toast. Set `report.clientPo` to it, drop the client-p/o `parseFlags`, append a `RECONCILE` audit row (before → after). |
| **notifyLotResult** | `(orderId, lotId, { party, to, subject, body, attachReport })` | For `FINANCE` the attachment is the **lab invoice**, not the report, and sending it sets the fee to `SENT_TO_FINANCE` (+ `sentToFinanceAt`/`By`) — handing the invoice over *is* the payment initiation. Otherwise: optimistically log a `LotNotification` (attachments = current report filename when ticked; `note` = the party's masking caveat + NDA line), call the notify adapter, then write an order event. `ESCROW` also appends a zero-amount `HOLD` escrow-ledger row citing lot + report + conclusion. `WHL` also appends the message to the lab thread. Failure ⇒ mark the notification `FAILED` with a retry note. |
| **notifyLotsResult** | `(orderId, lotIds[], { party, to, subject, body, attachReports })` | For `FINANCE` this is a **payment run**: attachments are the de-duplicated *invoice* files, every covered lot moves to `SENT_TO_FINANCE`, and lots with no invoice yet are named as excluded. Otherwise: **one** mail for many lots. Attachments = de-duplicated current-report filenames. Write the notification row onto **every** lot it covered, each `note`d `"Sent as one digest covering N lot(s): A, B, C."`. One order event, one escrow marker, one thread entry — not N. Failure ⇒ mark all rows `FAILED`. |

Mapping helpers:

```ts
conclusionToLotStatus(conclusion, anyFar): TestStatus =
  conclusion === "ACCEPTABLE" ? (anyFar ? "MAYBE" : "PASS") : "FAIL";

processToTestStatus(result): TestProcessStatus =
  result === "ACCEPTABLE" ? "PASSED" :
  result === "NOT_ACCEPTABLE" ? "FAILED" :
  result === "FAR" ? "FAR" : "NOT_CONDUCTED";
```

Lifecycle mutation helpers — every automatic stage move goes through one of these:

```ts
/** Forward-only. Returns true if the stage actually moved. */
function moveStage(lot, stage, by, o) {
  const from = stageIdx(lot.stage);      // ← the RECORDED stage, not lotStage(lot)
  const to   = stageIdx(stage);
  if (to <= from) return false;          // stale mail can't rewind; re-poll is a no-op, not a dupe row
  lot.stage = stage;
  recordStageEvent(lot, stage, by, o);
  return true;
}

/** Append a history row WITHOUT touching the cursor. */
function recordStageEvent(lot, stage, by, { note?, sourceEmailId?, manual? }) {
  (lot.stageHistory ??= []).push({ id: uid(), stage, at: stamp(), by, note, sourceEmailId, manual });
}

/** For a stage that may already be behind the cursor. Used ONLY by WHL_PAYMENT. */
function settleStage(lot, stage, by, o) {
  if (moveStage(lot, stage, by, o)) return true;
  if ((lot.stageHistory ?? []).some((e) => e.stage === stage)) return false;  // already recorded
  recordStageEvent(lot, stage, by, o);   // keep the audit row, leave the cursor alone
  return false;
}
```

**`WHL_PAYMENT` must go through `settleStage`, not `moveStage`** — both from `markLabFeePaid` and from
the `PAYMENT_ACK` branch of `syncWhlInbox`. The fee is a parallel track, so it routinely settles *after*
the cursor has passed index 1: on credit because the lab tests on account, and on advance because the
lot ships and books in before the transfer clears (the hold bites at the bench, not at the loading
dock). `moveStage` sees a backwards move and no-ops, which silently drops the payment's timestamp,
author and source mail — the exact bug the note below warns about, on the stage most likely to hit it.
Found by driving a fresh lot end to end: the fee showed as paid, and its history row did not exist.

**A consequence worth knowing before you write a test:** the displayed cursor legitimately steps *over*
`Payment to WHL` on most lots, so "every stage is visited in order" holds for the other six only. The
payment stage's presence is asserted through its **history row**, not the cursor's path.

**Compare against `lot.stage`, never `lotStage(lot)`.** The displayed stage is floored by what
the tests/report imply, and that floor can run *ahead* of what the lab has actually told us —
applying a mail's per-test updates implies "in progress" before that same mail's own stage is
recorded. Using the floor here silently swallows those rows, so a stage the lab genuinely reported
never gets a timestamp. (This was a real bug, found on the since-removed `TESTING_STARTED` stage,
which was dropped on 3 of 3 runs. The trap is still live for any stage a mail's payload implies.)

---

## 7. Mock integration adapters

All adapters share a transport that (a) logs each call to a visible integration console as
pending → ok/error, (b) sleeps a random latency in a given range, (c) can inject failures from a global
"chaos" rate plus a per-call rate, (d) throws a typed error `{ code, message, status }`. Keep that seam —
swapping in `fetch` later must be a one-line change per adapter.

### 7.1 `extractPoTestRequirements({ sourceDoc, mpns[], testingModes })`
Latency 700–2000 ms · failure `UNPARSEABLE_FILE / "Could not parse the PO test table — needs manual review" / 422`.

Returns `{ sourceDoc, mpns: [{ mpn, tests: [{name, standard?}], confidence, note? }], overallConfidence }`.

Rules: mode `NONE` ⇒ empty + note `"PO specifies no incoming test for this MPN."`; **the second MPN of a
PO fails ~45% of the time** with note `"Test table on page 2 is a low-resolution scan — columns could not
be resolved."` (confidence ≈ 0.31) — this exercises the manual-review path; otherwise the mode's plan with
confidence 0.90–0.99.

### 7.2 `whlFetchReport({ workOrderNo, mpn, manufacturer, lotQty, client, clientPo?, revision, testNames[] })`
Latency 600–1800 ms · failure `REPORT_NOT_READY / "Report not yet issued for this work order" / 404`.

Builds a realistic report:
- `conclusion` weighted **ACCEPTABLE 72 / NOT_ACCEPTABLE 18 / SUSPECT_COUNTERFEIT 10**.
- one process row per requested test name (fall back to the first 5 `WHL_PROCESSES`); sample = `min(lotQty, 20)`.
- if conclusion is ACCEPTABLE: each process weighted **ACCEPTABLE 80 / FAR 12 / NOT_CONDUCTED 8**
  (so “Acceptable overall, one process F.A.R.” happens naturally).
- if not ACCEPTABLE: first process ACCEPTABLE, the rest weighted **NOT_ACCEPTABLE 55 / FAR 25 / ACCEPTABLE 20**.
- `rejectQty` = 15% of sample on NOT_ACCEPTABLE, 1 on FAR, 0 otherwise; `acceptQty = sample − rejectQty`;
  both `undefined` on NOT_CONDUCTED. FAR note: `"Further analysis recommended — anomaly on sampled unit."`
- `anyFar` = any process FAR. `reportNo = "<wo>.<revision>"`, `fileName = "WHL-<reportNo>.pdf"`.
- **`clientPo` returns the literal `"PO Unknown"` when absent or ~25% of the time**, adding parse flag
  `"Client P/O came back as “PO Unknown” — reconcile against the PO on file."`
- any NOT_CONDUCTED adds `"One or more processes were Not Conducted — confirm the agreed test plan was run in full."`
- fixed extras: `approvedBy "K. Ng" / "Laboratory Manager"`, `standards ["AS6081","AS6171"]`,
  `riskClass "ERAI Low Risk"`, `msl "MSL 3"`, `packageType "LQFP-100"`, the confidentiality note, and for
  `revision > 1`: `revisionNote = "Revision N — supersedes <wo>.<N-1> (electrical re-test on the flagged units)."`

### 7.3 `whlPollInbox({ workOrders: [{ workOrderNo, lotCode, mpn, testNames, stage?, hasInvoice?, feePaid?, feeWithFinance?, terms? }] })`
Latency 500–1500 ms · no injected failure beyond chaos.

Message kinds: `STATUS_UPDATE | REPORT | DELAY | AMBIGUOUS | RECEIPT | INVOICE | DISPATCH | PAYMENT_ACK`.
Each message may carry `stage?: TestingStage` — the lifecycle position it moves the lot to (absent ⇒ no
stage change) — plus one optional payload: `invoice`, `dispatch` or `payment`.

**The adapter is stage- and fee-aware**: it answers with the mail that plausibly comes *next* for that
lot. This is what makes the lifecycle demoable — polling repeatedly walks a lot along the whole chain one
step at a time instead of firing a random status mail at a lot that already has its report. Independently
of stage, **~15% of polls return an `AMBIGUOUS` mail** (subject `"RE: Testing update"`, no routing keys)
so the manual-match queue keeps getting exercised.

Branches are evaluated **in this order** — the order is the contract:

| # | Lot is at | Reply | Kind | → stage |
|---|---|---|---|---|
| 1 | **no invoice yet** | `"Invoice <no> — testing services (advance\|credit) — …"` — N processes × USD 145 + 6% tax, PDF attached, carrying an `invoice` payload whose **`terms` is weighted CREDIT 55 / ADVANCE 45**. Advance ⇒ due in 3 days + *"the lot will be held in our bonded store until the transfer clears"*; credit ⇒ due in `WHL_CREDIT_DAYS` + *"testing proceeds on account"* | `INVOICE` | **— none.** An invoice is a bill, not progress |
| 2 | fee unpaid **and with finance** | `"Payment received — invoice <no> — …"` — settled in full, receipt attached, `payment` payload `{ invoiceNo, paidRef, paidAt }`; on advance terms adds *"the lot is released from hold"* | `PAYMENT_ACK` | `WHL_PAYMENT` |
| 3 | before `SUPPLIER_DISPATCHING` | **25%:** `"Awaiting samples — …"` — the lab chases *us* (no stage: it cannot confirm a receipt that hasn't happened). **Else:** `"Dispatch advice — samples to WHL — …"` from `logistics@supplier.example`, carrying a `dispatch` payload (courier, AWB, dispatched, ETA) | `STATUS_UPDATE` / `DISPATCH` | — / `SUPPLIER_DISPATCHING` |
| 4 | before `COMPONENTS_RECEIVED` | `"Receipt confirmation — …"` — quantity and packaging match, lot booked in and queued; on an unpaid advance it adds that the lot is held and unscheduled | `RECEIPT` | `COMPONENTS_RECEIVED` |
| 5 | **advance terms, unpaid** | `"Lot held — advance payment pending — …"` — booked in but on hold; testing will not be scheduled until the transfer clears | `INVOICE` | **— none.** This is the gate: nothing downstream fires until a `PAYMENT_ACK` lands |
| 6 | credit terms, unpaid (20%) | `"Payment reminder — invoice … still outstanding"` | `INVOICE` | — |
| 7 | before `TESTING_IN_PROGRESS` | first interim update (20% a delay notice instead) | `STATUS_UPDATE` / `DELAY` | `TESTING_IN_PROGRESS` |
| 8 | before `TESTING_COMPLETED` | weighted **interim 30 / delay 10 / done 60**; "done" = `"Testing complete — all processes conducted, results with our reviewer"` | `STATUS_UPDATE` / `DELAY` | `TESTING_IN_PROGRESS` (no-op) or `TESTING_COMPLETED` |
| 9 | before `REPORT_SHARED` | `"WHL Report <wo> — <mpn> (Lot <lot>)"`, attachment `"WHL-<wo>.1.pdf"` | `REPORT` | `REPORT_SHARED` |
| 10 | at `REPORT_SHARED` | `null` — nothing further unless we ask (re-test, F.A.R. follow-up) | — | — |

Ordering rules that must not be dropped:

1. **The advance gate (5) sits after receipt (4) and before the bench (7).** The supplier can still ship
   and the lab can still book the lot in on an unpaid advance — what it won't do is test. Putting the
   gate earlier would wrongly freeze the shipping legs too.
2. **The payment acknowledgement (2) outranks everything except issuing the invoice.** Otherwise an
   advance-held lot deadlocks: branch 5 keeps firing and the mail that would release it never comes.
3. **The first interim update always lands before the "done" pick** (branch 7 is its own branch, not part
   of branch 8's weighting), otherwise a lot can jump straight to "testing completed" and
   `TESTING_IN_PROGRESS` is never visited.

Interim mails set the first 2 test names to `IN_PROGRESS`; delay notices set them to `PENDING` with
note `"Delayed — bench backlog at WHL"`.

### 7.4 `whlSendMail({ to, subject, body, workOrderNo?, lotCode?, mpn?, poNo? })`
Latency 300–900 ms · failure `MAIL_RELAY_DOWN / "Mail relay unavailable — retry" / 503`. Returns `{ messageId, to, queuedAt }`.

### 7.5 `sendPartyNotification({ party, to, subject, body, attachments[], orderNo, lotCode, reportNo? })`
Latency 350–1100 ms · same failure as above. Returns `{ messageId, to, queuedAt, attachments }`.

---

## 8. Template library (copy verbatim — this is product copy, not filler)

### 8.1 WHL compose templates (10)

Shared builders:

```
refLine(c) = the non-empty lines of:
  · MPN: {mpn}{ (date code {dateCode}) }
  · Lot: {lotCode}{ — qty {qty}{, sample {sampleQty}} }
  · Work order: {workOrderNo}
  · Report: {reportNo}
  · Client PO: {clientPoNo}
  · Lab site: {lab}

head(c) = "Hi WHL team,\n\nReference:\n" + refLine(c) + "\n\n"
sign(c) = "Thanks,\nSourcing Ops\n{entity}"
tag(c)  = "WO {workOrderNo|(pending)} / Lot {lotCode|—} / {mpn|—}"
```

| id | label · hint | subject | body |
|---|---|---|---|
| `STATUS_REQUEST` | Status request · *Where is this lot? (also used by “Request Update”)* | `Status request — {tag}` | `{head}Could you share the current status of the above lot — which processes are complete, which are in progress, and the expected date for the report?\n\nIf the report is already issued, please attach the latest revision.\n\n{sign}` |
| `INVOICE_REQUEST` | Invoice request · *Ask WHL for the testing invoice so payment can be raised* | `Invoice request — {tag}` | `{head}Could you issue your invoice for the testing booked against the above work order?\n\nSo our finance team can raise the payment without a further exchange, please include:\n1. the invoice number and date,\n2. the processes billed and the amount, with any taxes shown separately,\n3. your bank details and the payment due date, and\n4. this work order and lot code as the payment reference.\n\nWe will confirm once the transfer is initiated.\n\n{sign}` |
| `REPORT_REQUEST` | Report / latest revision · *Ask for the PDF or the newest revision* | `Report request — {tag}` | `{head}Please send the test report for this lot as a PDF. If a revision has been issued since {reportNo}, share the current version and confirm which report number supersedes which.\n\n{sign}` |
| `RETEST_REQUEST` | Re-test request (result disputed) · *Supplier disputes a Not-Acceptable result* | `Re-test request — {tag}` | `{head}The supplier has disputed the result recorded in report {reportNo} for this lot.\n\nCould you re-test the affected units and issue a revised report? Please confirm:\n1. the units to be re-tested and the method used,\n2. the additional TAT, and\n3. whether any re-test cost applies.\n\n{sign}` |
| `FAR_FOLLOWUP` | F.A.R. follow-up · *A process came back Further Analysis Recommended* | `F.A.R. follow-up — {tag}` | `{head}Report {reportNo} is Acceptable overall, but a process is flagged F.A.R. (Further Analysis Recommended).\n\nBefore we release this lot, please confirm:\n1. which units and which process the F.A.R. applies to,\n2. what further analysis you recommend, with cost and TAT, and\n3. whether the lot can be accepted as-is with a documented caveat.\n\n{sign}` |
| `TAT_ESCALATION` | TAT escalation · *Past the quoted turnaround / unanswered chase* | `Escalation — TAT overdue — {tag}` | `{head}This lot is past the quoted turnaround and our earlier request is still unanswered. The order is held on this result.\n\nPlease confirm today: current stage, blocker, and a committed report date. If the lab site is the constraint, let us know whether the balance testing can be moved.\n\n{sign}` |
| `PO_RECONCILE` | Reference mismatch · *Report shows “PO Unknown” or the wrong reference* | `Reference correction — {tag}` | `{head}The report we received does not carry our reference correctly — it should read Client P/O {clientPoNo}.\n\nPlease re-issue with the correct Client P/O, MPN and lot code so the report reconciles against our PO on file.\n\n{sign}` |
| `SAMPLE_QUERY` | Sample / test-plan query · *Confirm sample size or a Not-Conducted process* | `Test plan query — {tag}` | `{head}Could you confirm the test plan applied to this lot — sample size drawn, standard followed, and the reason any process was recorded as Not Conducted?\n\nOur PO requires the full screen, so please advise if anything is outstanding.\n\n{sign}` |
| `NEW_SUBMISSION` | New submission / booking · *Tell WHL a lot is on its way* | `Incoming submission — {mpn} / Lot {lotCode}` | `{head}We are shipping the above lot to you for testing per our PO test plan.\n\nPlease confirm receipt, the work-order number raised against it, and the expected TAT.\n\n{sign}` |
| `FREE_TEXT` | Blank (free text) · *Context block only — write your own ask* | `{tag}` | `{head}\n\n{sign}` |

### 8.2 Party notification templates (single lot, 5)

Shared: `verdictWord` = `Acceptable` / `Acceptable (with one process flagged F.A.R.)` / `Not Acceptable` /
`Suspect Counterfeit` / `pending`. `lotRef(c)` = MPN line, Lot line, `· Test report: {reportNo} dated {reportDate}`,
`· Conclusion: {verdictWord}`.

| party | label · hint · default To | masking rule shown in the UI | subject | body |
|---|---|---|---|---|
| `SUPPLIER` | Notify supplier · *Result + report to the supplier (buyer stays masked)* · `quality@supplier.example` | “The buyer's identity, client PO and sell prices are never included.” | `Test result — {mpn} / Lot {lotCode} — {verdictWord} ({supplierPoNo})` | `Dear supplier,\n\nThe independent test on the lot supplied against {supplierPoNo} is complete.\n\n{lotRef}\n\n` + **if ACCEPTABLE** `The lot is accepted{, subject to closing out the process flagged for further analysis}. We are proceeding with onward logistics and payment per the agreed terms.` **else** `The lot is NOT accepted. Per the PO, the cost of test failure and return sits with the supplier. Please confirm within 2 business days whether you will (a) replace the lot with fully traceable stock, or (b) accept return and refund.` + `\n\nThe attached report is issued to us by White Horse Laboratories under NDA and is shared with you solely to evidence this lot's disposition — please do not redistribute it further.\n\nRegards,\nSourcing Ops\n{entity}` |
| `BUYER` | Notify buyer / client · *Result + report to the client (supplier stays masked)* · `procurement@client.example` | “The supplier's identity, buy prices and inbound AWB are never included.” | `{orderNo} — test result for {mpn} / Lot {lotCode} — {verdictWord}` | `Dear customer,\n\nIndependent testing on your order against {clientPoNo} is complete.\n\n{lotRef}\n· Laboratory: {lab}\n\n` + **if ACCEPTABLE** `The lot has passed the agreed screen{, with one process flagged for further analysis — we are closing that out with the laboratory before dispatch| and is cleared for dispatch}. We will confirm the delivery schedule shortly.` **else** `The lot did not pass the agreed screen and will not be dispatched to you. We are sourcing replacement stock and will confirm the revised schedule; your funds remain protected under the agreed payment terms.` + `\n\nThe laboratory report is attached for your records. It is issued under NDA — kindly keep it internal to your organisation.\n\nRegards,\nSourcing Ops\n{entity}` |
| `ESCROW` | Notify escrow provider · *Release-trigger evidence to HKIN* · `ops@hkin.example` | “Sent by the masking entity only — counterparties are referenced by escrow token.” | `Escrow {escrowRef} — release trigger evidence — Lot {lotCode} {verdictWord}` | `Dear HKIN team,\n\nRe escrow {escrowRef} for {orderNo}:\n\n{lotRef}\n\n` + **if ACCEPTABLE** `The release trigger (independent lab PASS) is satisfied for this lot.{ Note one process is flagged F.A.R.; we are proceeding on the overall Acceptable conclusion.} Please treat the attached report as the supporting evidence for the tranche release of up to {currency} {releasable}.` **else** `The lab result is {verdictWord} — the release trigger is NOT satisfied. Please hold the funds; a refund instruction may follow once the return is agreed with the seller.` + `\n\nRegards,\nSourcing Ops\n{entity}` |
| `WHL` | Acknowledge to WHL · *Confirm receipt of the report to the lab* · `{WHL_CONTACT}` | — | `Report received — {reportNo} / WO {workOrderNo} / Lot {lotCode}` | `Hi WHL team,\n\nThank you — report {reportNo} for the lot below is received and logged.\n\n{lotRef}\n\n{One process is flagged F.A.R. — we will revert separately on the further analysis.\n\n}Please retain the samples until we confirm disposition.\n\nThanks,\nSourcing Ops\n{entity}` |

| `FINANCE` | Send to finance — initiate payment · *Forward WHL's invoice so finance can pay the testing fee* · `finance@sharpbuy.example` | "Internal mail. The client's identity and sell prices are not needed to pay a lab fee — leave them out." | `Payment request{ (ADVANCE — lot held)} — WHL invoice {invoiceNo} — {mpn} / Lot {lotCode}` | `Hi Finance,\n\nPlease initiate payment of the independent testing fee below. The invoice is attached.\n\n{lotRef}\n· Laboratory: {lab}\n· Invoice: {invoiceNo} · due {invoiceDueDate}\n· Amount: {cur} {invoiceAmount} + tax {invoiceTax}\n· Terms: {ADVANCE — payable before testing \| CREDIT — testing is running on account}\n\n{if ADVANCE: This work order is on advance terms, so the laboratory is holding the lot and has not started testing. The order is waiting on this transfer — please treat it as priority.\n\n}Please quote work order {workOrderNo} and lot {lotCode} as the payment reference so the lab can reconcile it, and send us the transfer reference once released.\n\nThis is a testing cost against {supplierPoNo} — book it to the order, not to the supplier's material payment.\n\nThanks,\nSourcing Ops\n{entity}` |

The terms line goes near the top and into the subject: on advance terms this mail is the thing standing
between us and a test result, and finance cannot infer that from an amount and a due date.

Default `attachReport` = **true** for supplier/buyer/escrow/finance, **false** for WHL (they wrote it).
For `FINANCE` the flag attaches the **invoice** PDF, not the report.

### 8.3 Digest templates (many lots, 1 mail)

The `FINANCE` digest is a **payment run**: one line per invoiced lot
(`MPN · Lot · WO · invoice (due) — amount + tax · advance|credit`), a currency total, the
payment-reference instruction, and an explicit note naming any selected lot with no invoice yet as
excluded. Advance-terms lots are called out twice — in the subject (`(N ADVANCE — lots held)`) and as
their own paragraph naming the codes and asking for priority, because those lots are not being tested.

Per-lot line: `{i+1}. {mpn} (DC {dateCode}) · Lot {lotCode} · qty {qty} · report {reportNo} ({reportDate}) — {verdict}`
where verdict ∈ `Acceptable` / `Acceptable (one process F.A.R.)` / `Not Acceptable` / `Suspect Counterfeit` / `result pending`.

Outcome split block (only non-empty lines):
```
Accepted: {codes}.
Accepted subject to F.A.R. close-out: {codes}.
Not accepted: {codes}.
Result still pending: {codes}.
```

| party | subject | body shape |
|---|---|---|
| `SUPPLIER` | `Test results — {n} lot(s) against {supplierPoNo}{ — {k} not accepted}` | `Dear supplier,\n\nIndependent testing is complete on the following lot(s) supplied against {supplierPoNo}:\n\n{list}\n\n{split}\n\n` + (if any bad) `For the lots not accepted, the PO places the cost of test failure and return with the supplier. Please confirm within 2 business days whether you will replace with fully traceable stock, or accept return and refund.\n\n` + (if any good) `For the accepted lots we are proceeding with onward logistics and payment per the agreed terms.\n\n` + NDA line + sign |
| `BUYER` | `{orderNo} — test results for {n} lot(s) ({clientPoNo})` | `Dear customer,\n\nIndependent testing on your order against {clientPoNo} is complete for the following lot(s):\n\n{list}\n\n{split}\n\n` + (if any good) `The accepted lots are cleared for dispatch and we will confirm the delivery schedule shortly.\n\n` + (if any bad) `The lots not accepted will not be dispatched to you. We are sourcing replacement stock and will confirm the revised schedule; your funds remain protected under the agreed payment terms.\n\n` + `The laboratory report(s) are attached for your records. They are issued under NDA — kindly keep them internal to your organisation.\n\n` + sign |
| `ESCROW` | `Escrow {escrowRef} — release trigger evidence — {n} lot(s)` | `Dear HKIN team,\n\nRe escrow {escrowRef} for {orderNo}, the independent lab results for the following lot(s):\n\n{list}\n\n{split}\n\n` + (if any good) `The release trigger (independent lab PASS) is satisfied for {codes}. Please treat the attached report(s) as supporting evidence for the tranche release of up to {currency} {releasable}.\n\n` + (if any bad) `The trigger is NOT satisfied for {codes} — please hold those funds; a refund instruction may follow once the return is agreed with the seller.\n\n` + sign |
| `WHL` | `Reports received — {n} lot(s) / {orderNo}` | `Hi WHL team,\n\nThank you — the following reports are received and logged:\n\n{list}\n\n{We will revert separately on the further analysis for {codes}.\n\n}Please retain the samples until we confirm disposition.\n\nThanks,\nSourcing Ops\n{entity}` |

**NDA line** (supplier digest): *"The attached report(s) are issued to us by White Horse Laboratories under NDA and are shared solely to evidence these lots' disposition — please do not redistribute them further."*

---

## 9. UI specification

### 9.1 Shell — the order's Testing tab

```
┌ Panel: "WHL testing — MPN × lot × test" ──────────────────────────────────────────┐
│ actions: [lot scope ▾] [Check mail] [Auto-fill tests from PO] [+ Add lot]          │
│                                                                                    │
│ scope banner   ─ "All lots" → "Order total across N lot(s) — pick a lot above…"    │
│                ─ lot chosen → pill "viewing LOT-B" · mpn · lab · WO · qty/sample   │
│                              · verdict pill · "report X — acceptable"              │
│                              · [show order total]                                  │
│ 6 stat tiles   ─ Lots|Lot · Tests tracked · Passed n/m · F.A.R. · Not acceptable   │
│                  · Reports on file            (all scoped by the selector)         │
│ progress bar   ─ passed / tests                                                    │
│ caption        ─ "n/m required tests passed across N lot(s). k still open. F.A.R.  │
│                   and Not-Conducted results still need follow-up before release."  │
│                                                                                    │
│ alerts (stacked, only when non-empty; all scoped except unmatched)                 │
│   • reconciliation  ⚠ "LOT-B · 352147.1 — Client P/O …" [Reconcile to PO on file]  │
│   • SLA overdue     ⏱ "LOT-C — update requested …, unanswered for N business       │
│                        day(s) (SLA 3)."  [Chase again] [Escalate]                  │
│   • autofill gaps   ⚠ "Auto-fill failed / incomplete for X, Y" [Review MPNs]       │
│   • unmatched mail  ✉ "N inbound WHL email(s) couldn't be matched" [Open queue]    │
│   • fee HELD (bad)  🔒 "ADV-2 held at the lab — invoiced on advance terms and      │
│                        unpaid, so testing hasn't started." [Open lots]             │
│   • fee owed (warn) 🧾 "N WHL invoice(s) unpaid — {cur} {total} owed to the lab on │
│                        credit terms, so nothing is blocked." [Open lots]           │
│     → two separate alerts on purpose: one stops the bench, the other only owes     │
│       money, and collapsing them hides which is which                              │
│                                                                                    │
│ bulk bar   "Select lots: all (N) · with report (n) · acceptable (n) ·              │
│             not acceptable (n) · F.A.R. (n) · clear      N selected                │
│             [Next actions (N) ▾]"                                                  │
│                                                                                    │
│ lot-wise results table (always visible) — 9 columns                                │
│   ☑ | Lot (+lab/WO) | MPN | Verdict | Tests n/m + bar (+ "k F.A.R. · k not acc. ·  │
│     k not cond." beneath) | Lab fee | Current report (no + conclusion pill +        │
│     "k rev.") | Outstanding (blocker, "chase Nd overdue", "awaiting reply") |       │
│     Progress                                                                       │
│   → F.A.R. and Not-acceptable used to own a column each; folding them under Tests  │
│     as coloured counts freed the width for the fee, which nothing else showed      │
│   → Lab fee cell = {cur} gross · terms pill (Advance/Credit) · state pill:         │
│     🔒 held (bad) when advance+unpaid · "with finance"/"unpaid" (warn) · ✓ paid;   │
│     "not invoiced" / "invoice requested" before the invoice mail lands             │
│   → clicking a row scopes to that lot (click again clears); the checkbox cell      │
│     stops propagation so ticking never changes scope                               │
│   → Progress cell = [▸ <current stage>  n/7] "track progress". Clicking expands    │
│     the lifecycle stepper as a full-width row directly beneath (§9.3a), so the     │
│     stages are reachable without leaving the roll-up. One lot open at a time;      │
│     the cell stops propagation so tracking never changes scope.                    │
│                                                                                    │
│ escrow strip (unchanged behaviour) — green "A lot PASSED — release the escrow      │
│   tranche" + [Extend window] [Release escrow]; footnote about PASS/FAIL + refund   │
└────────────────────────────────────────────────────────────────────────────────────┘

sub-tabs:  [MPNs · tests · fee (gapBadge)] [Lots · status · reports]
           [Mail (drives every stage) (unmatchedBadge)]
```

Default sub-tab: **Lots · status · reports**. Badges are small warn-coloured counts.

### 9.2 Sub-tab — MPNs · tests · fee

Intro line: *"Test requirements are **parsed off the PO**, never typed — the PO already carries the test
table. Manual edits are allowed as an override and every one is logged (who · when · before → after).
Each MPN shows what the lab charges to run that list and how it wants paying — both read off its
invoice mail."*

One **collapsed-by-default** card per order line (filtered to the scoped lot's MPN when a lot is
selected) — see §9.7 for the collapse rules:
- title (always visible): `MPN` (mono) · testing-mode pill · `make · qty N · k lot(s)`
- summary (always visible): state pill (`auto-filled` / `auto-fill failed` / `not parsed`) ·
  `k tests` · `m manual` when a human overrode anything · **`{cur} {gross}` · terms pill (or
  `mixed terms`) · `N lot(s) held` (bad) or `fee unpaid` (warn)** — so the money is triageable
  without opening the card
- actions (only when expanded): `[🕘 auditCount]` toggle · `[✎ Edit tests | Done]` (role-gated)
- `auto-fill failed` ⇒ red notice with the reason + `[Retry parse]`
- no spec at all (and mode ≠ NONE) ⇒ amber notice + `[Auto-fill now]`
- meta row: `source: <PO>` · `parsed: <ts>` · `confidence: n%` · `k auto · m manual`
- **fee strip** (`MpnFeeStrip`): `🧾 TESTING FEE  {cur} {gross} · {cur} {rate} per process ·
  <terms pill> · settled | {cur} {unpaidGross} unpaid across N lot(s) · 🔒 <codes> held for advance
  payment · k lot(s) not invoiced yet`. Before any invoice: *"No WHL invoice for this MPN yet — the
  amount and the payment mode both arrive on the lab's invoice mail."* It sits with the tests because
  the bill **is** the test list priced: amount = processes × rate.
- **test matrix** (`MpnTestMatrix`), not a flat list — rows are the requirements, columns are the
  lots of this MPN:
  `Required test (+standard) | Source (from PO / manual + addedBy·addedAt) | Rate | <one column per
  lot> | 🗑 (edit mode only)`
  - each lot column header: `LOT-x` over `{cur} {gross} · advance|credit · <payment status>`
  - cells: that lot's `StatusPill` for that test, or amber `not on lot` when the requirement never
    reached it (a real gap worth seeing, and invisible in a flat list)
  - `Rate` column only when every invoice on the MPN agrees on `ratePerProcess`
  - footer row: `passed / tracked` with each lot's `settled/total`, green when complete
  - no lots yet ⇒ a single `Lots` column reading `no lots yet`
- edit mode footer: process `<select>` (from `WHL_PROCESSES`) + standard `<select>` + `[+ Add]`,
  caption *"Adds to this MPN's list and to every lot of it. Logged as a manual override."*
- audit panel (toggle): newest-first rows — action pill (`ADD` warn / `DELETE` bad / else neutral),
  `target · before → after`, `by · at · note`
- empty states: mode NONE ⇒ *"This MPN needs no incoming test per the PO."*; else *"No tests on file for this MPN."*
- when the role can't edit: *"🔒 Editing tests needs the SC or Mgmt persona"*

### 9.3 Sub-tab — Lots · status · reports

One **collapsed-by-default** card per lot (only the scoped lot when filtered, with a note explaining
the filter) — see §9.7 for the collapse rules:

- **title** (always visible): flask icon · lot code · MPN (mono) · `lab · WO n · qty N / sample M · DC x`
- **summary** (always visible — enough to spot the lot that needs attention among a hundred):
  verdict pill · `n/m tests` · current lifecycle stage + `n/7` (green when complete) · report no
  (or amber `no report`) · blocker pill (`not acceptable` / `F.A.R.` / `not conducted`) · **fee pill
  when the fee is outstanding: `🔒 held — advance fee` (bad) when the lab is holding the lot, else
  `fee unpaid` / `fee with finance` (warn)** · clock icon when a WHL reply is outstanding
- **actions** (only when expanded): `[⚡ Next actions ▾]` (disabled until a report exists) ·
  `[Fetch report | Fetch revision]` · `[Email WHL]`
- **lifecycle stepper** (§9.3a) — first thing in the body, above the test tracker: where the parts
  physically are comes before what was tested
- **WHL invoice & payment** block (§9.3b) — the lab's fee, inside the stepper card
- **status tracker** header: `Test status tracker  n/m passed · k F.A.R. · k not acceptable · k not conducted · k open`
- **tracker table** (`LotTestTable`, rows from `lotTestRows`) — **the only per-test table on the
  screen**: `Test | Status | Accept / Reject | Per the report | Updated | Set`
  - `Test` carries the standard and `· manual` / `· report only` as faint suffixes instead of owning
    a `Std` and a `Source` column — two columns of one-word values weren't worth the width
  - `Per the report` = result pill (`F.A.R.` spelled out) · report no (mono) · the process note.
    **This is the report's process matrix**, which is why §9.4 no longer repeats it. `not reported
    yet` before a report lands.
  - the test name is a disclosure toggle; expanded row shows **Status history** newest-first:
    `at · before → after (pills) · by · note · "from inbound email"`
  - `Set` is a `<select>` over `TEST_PROCESS_STATUSES` (role-gated), labels title-cased, `FAR` →
    `F.A.R.`; a report-only row has no tracker entry to set, so it reads `not on the PO`
  - caption: with a report, *"Results are from report X, process by process — a report can be
    Acceptable overall while one process is F.A.R., so these rows are the source of truth, not the
    headline conclusion."* Without one: *"Statuses come from WHL's interim mails until the report
    lands and settles them."*
  - empty: *"No tests on this lot — the MPN's test list is empty or failed to auto-fill (see MPNs & tests)."*
- **report repository** (§9.4)
- **result circulated** block (only when a report exists): party pills
  `Supplier ✓ <ts> · report attached` / `Buyer · not notified` (ok / bad / neutral tones) stay visible —
  they are the summary. The line-per-notification log (`at · party → to · subject · attachments`,
  failures in red with the reason) sits behind a **`▸ Show history (n)` / `▾ Hide history (n)`**
  disclosure, **collapsed by default**. Caption: *"use **Next actions** above to send"*.
- **footer**: `Lot verdict [PASS][MAYBE][FAIL]` (unchanged lot logic) + *"drives the escrow release /
  refund path"*; right side: `awaiting WHL reply` chip, `n message(s)`, and context buttons —
  `[Request update]` when no report, `[F.A.R. follow-up]` when `anyFar`, `[Re-test request]` when FAIL,
  `[Escalate TAT]` when awaiting.

### 9.3a Testing lifecycle stepper (per lot)

Deliberately the **same visual shape as the order's Journey stepper**, so the two read as one idea at
different scales: reuse the host's stepper markup rather than inventing a second treatment.

```
┌ Testing lifecycle · 6/7 stages                          [◉ At: Testing Completed ·  ┐
│                                                             waiting on WHL]         │
│   ✓────✓────✓────✓────✓────◉────⑦                                                   │
│  Test  Pay   Supp  Comp  Test  Test  Test                                           │
│  Req   WHL   Disp  Recd  InPr  Cmpl  RepShared                                      │
│  07-19 07-19 07-19 07-21 07-21 07-24                                                │
│ ─────────────────────────────────────────────────────────────────────────────────── │
│  Testing Completed — Every process in the agreed test plan has been run; the         │
│    write-up is with WHL's reviewer. · 2026-07-24 09:05 · WHL inbox (auto)            │
│  Testing complete — all six processes conducted; results with the reviewer.         │
│  Next: Test Report Shared — Report received and parsed onto the lot.                │
│  [↻ Check mail for updates]  [🚚 Record dispatch by hand]  mark test report shared… │
│  ┌ 🧾 WHL INVOICE & PAYMENT  [Credit · 15d] [Paid]  WHL-INV-352146  USD 923 ──────┐  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
│  ┌ 🚚 Supplier → WHL Shenzhen · recorded by Supplier (mail) · 2026-07-19 15:10 ───┐  │
│  │ DHL Express · AWB 4471-9920-11 · dispatched 2026-07-19 · ETA 2026-07-21        │  │
│  └───────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────┘

held on an unpaid advance instead of the "At:" pill:
  [🔒 Held — advance fee unpaid]   (bad tone; tooltip names the invoice)
  "Held at the lab: invoice X is on advance terms and unpaid, so nothing moves until the
   transfer clears. Settle the fee below — WHL's payment acknowledgement releases the lot."
```

- **Nodes**: done = filled primary with ✓ · current = primary ring + the stage's icon · future =
  muted outline with its index number. Half-rails either side, coloured primary up to the current node.
- **Labels** under each node, current one emphasised, with the recorded date (`MM-DD`) beneath when a
  history row exists. Non-1Buy owners carry a tiny icon (truck for Supplier, flask for WHL).
- **Tooltip per node**: the stage description, plus either `at · by — note` when recorded, or
  `↳ <trigger>` when not yet reached. This is where the per-stage detail lives — the stepper itself
  stays one line tall.
- **Header pill**: `✓ Report received` when complete; else `🔒 Held — advance fee unpaid` (bad) when
  `labFeeBlocking(lot)`, because nothing else on the chain is true while the lab is holding the lot;
  else `◉ At: <stage> · waiting on <owner>`, or `⏳ Not requested yet` before a work order exists.
- **Below the rail**: the current stage in words + its recorded `at · by` (`(recorded manually)` when
  applicable) + note, then `Next: <stage> — <trigger>` — or, when blocked, the held sentence instead
  of `Next:` (there is no next until the money moves).
- **Actions**: `[Check mail for updates]` (= `syncWhlInbox`) first and until complete — it is the
  primary driver of every stage, not a refresh; then the fallbacks: `[Record dispatch by hand]`
  (ghost, only while short of `SUPPLIER_DISPATCHING`) and a `mark <next stage> done` text link
  (role-gated) for the phone-call case.
- **Dispatch block** rendered whenever `lot.dispatch` exists; `recordedBy` reads `Supplier (mail)`
  when the dispatch advice supplied it, or the operator's name when typed in.
- Stages before the current one read as **done even without a history row** — a lot can arrive
  mid-chain (report fetched before anyone recorded the dispatch), and pretending those steps never
  happened misleads more than showing them done without a timestamp.
- **One deliberate exception: the `WHL_PAYMENT` node reads the payment record, not its index.** On
  credit terms the lab tests on account, so the chain routinely runs past the payment stage with the
  fee still owed; index alone would paint that node "done" — a lie. While `labFeeUnpaid(lot)` it
  renders amber (or **red when `labFeeBlocking(lot)`**) with its own icon and a tooltip naming the fee
  state and the terms, wherever the current stage happens to be. This is the only node whose truth is
  not positional.

**Compact variant** (`TestingStageBar`) — 7 thin segments + `<stage label> n/7 · waiting on <owner>`.
Used in the scope banner and on the cross-order testing board, one row per lot.

### 9.3b WHL invoice & payment (per lot)

Rendered inside the stepper card, below the actions, and only once a work order exists — there is
nothing to bill before that. Amber-tinted while the fee is outstanding, **red-tinted while it blocks**.

```
┌ 🧾 WHL INVOICE & PAYMENT  [Credit · 15d] [With finance for payment]  WHL-INV-352151  USD 615  due … ┐
│ USD 580 net + tax 35 (4 × 145) · received 2026-07-26 10:15 · to finance 2026-07-27 09:40 · A. Sharma│
│ Credit terms — the lab is testing on account, so this owes money but blocks nothing.                │
│ [⬇ Download invoice] [🏦 Re-send to finance] [✓ Mark paid by hand]   1 access entry                 │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘

on an unpaid advance the second line becomes, in bad tone:
  🔒 Advance terms: WHL holds the lot until this clears — testing has not been scheduled.
and [Send to finance] is promoted to the primary button.
```

- **Terms pill first**, before the status pill: it is what makes an unpaid fee urgent or not. Reads
  `Advance` (warn) or `Credit · {creditDays}d` (info), tooltip = `LAB_TERMS_HINT`.
- **No invoice yet** → the copy says so and offers `[✉ Request invoice]`; if already requested it
  states *"it arrives on the WHL thread, so **Check mail for updates** pulls it in, terms and all"*.
  Otherwise: *"…that mail is what tells us whether this work order is advance or credit."*
- The amount line shows `({processCount} × {ratePerProcess})` so the fee reads as the priced test list.
- **`[Download invoice]`** writes a `DOWNLOAD` row to the invoice's `accessLog`, like the report's.
  The access count is shown with the full log in its tooltip.
- **`[Send to finance]`** opens the notify modal for `FINANCE` with the invoice attached; the label
  becomes **Re-send to finance** once it has gone once.
- **`[Mark paid by hand]`** (ghost) opens the payment modal — reference, date, note — and closes the
  payment stage. Named "by hand" because WHL's `PAYMENT_ACK` mail normally does this on the next sync.
- Buttons that mutate are role-gated (`canEditTests`); **Download is not** — reading your own
  invoice is not an override.

### 9.4 Report repository + parsed summary (per lot)

No reports ⇒ dashed block: **"WHL report — Not Available"**, *"Nothing received by email for WO n yet.
Update requested <date>. Use **Request update** below to chase <lab address>."* — **no button here**:
the card footer already carries `[Request update]` while there's no report, and two buttons firing the
same mail two inches apart is just a second thing to read.

With reports ⇒ bordered block:
- header: `WHL report repository · k version(s)` + one button per version, newest first, current marked
  with a ✓; clicking selects **and logs a VIEW** access entry.
- summary body for the selected version:
  - top row: report no (mono) · `current` / `superseded` pill · conclusion pill (ok when ACCEPTABLE, else
    bad) · amber pill **"F.A.R. on a process — follow up"** when `anyFar`
  - right: `[🛡 accessCount]` toggle · `[👁 Open PDF]` · `[⬇ Download]` (both log access)
  - `revisionNote` in a muted box when present
  - parse flags as amber notices; a client-p/o flag gets `[Set to <PO on file>]`
  - field grid (2-col): Report no · date | Work order | Part number (MPN — **red when ≠ lot MPN**) |
    Manufacturer | Lot qty (+ *"(lot on file N)"* when different) | Client | Client P/O (**amber when
    “PO Unknown”**) | Approved by + title | Standards | Risk classification | MSL | Package type
  - **process roll-up strip** — *not* a table: `N process(es) reported` + one count pill per distinct
    result (`6 acceptable`, `1 F.A.R.`, …) + *"per-process results, quantities and notes are on the test
    tracker above"*. The full matrix used to be repeated here; fetching a report rolls every process
    onto the tracker, so the tracker **is** the matrix (§9.3) and this only says how many and how they
    split. See invariant 25.
  - access log (toggle): `at · by · action`
  - NDA footer with a lock icon

### 9.5 Sub-tab — Mail (drives every stage)

Named for what it does: this thread is the lifecycle's driver, not an archive.

1. **Panel "Compose from a template — subject & body pre-filled"** — a chip per WHL template (tooltip =
   hint) opening the compose modal for that template; caption explains the auto-fill; role note when gated.
2. **Panel "WHL inbox — manual match queue"** — `[Check mail]` `[Compose]`; each unmatched mail in an
   amber card: subject, `by · at · attachments`, body, the match note, `[Match to lot]`. Empty: *"Nothing
   waiting — every inbound WHL email is matched to a lot."* Caption: *"Unroutable mail is held here rather
   than dropped or applied to the wrong lot. Matching it applies its updates to that lot's tracker."*
3. **Panel "Correspondence & tracking history"** — lot filter `<select>` (defaults to the header's scope,
   still overridable); newest-first thread with a dot (primary = sent, ok = received), `sent`/`received`
   pill, **kind pill** (`invoice` warn · `payment` ok · `dispatch` info · `report` ok — the kinds that
   moved a stage; `STATUS_UPDATE` and the outbound kinds are left unlabelled because the subject already
   says it), status pill, timestamp, `lotCode · mpn · WO`, subject, body (pre-wrapped), then
   `by · attachments · matched by · [Mark escalated]` for awaiting outbound mail.
   Caption: *"This thread is what drives the lifecycle. Everything to and from `<lab>` lands here against
   its lot — the invoice and its payment terms, the supplier's dispatch advice, receipt confirmations,
   interim updates, the payment acknowledgement and the report — and each one moves the stage it
   establishes."*

   **Only the 2 most recent messages render.** The rest sit behind
   `▸ Show N earlier message(s)` / `▾ Hide the earlier N message(s)`, and the panel footer states the
   truncation plainly: *"Showing the 2 most recent of N."* A long-running lot accumulates dozens of
   mails; silently rendering all of them buries the thread that matters.

   Each body is **clamped to 2 lines** with a `▸ view full email` / `▾ collapse` toggle (the subject is
   also clickable). Short mails — under ~160 characters and single-line — render whole and get **no**
   toggle, so the control only appears where it does something.

### 9.6 Menus and modals

**Per-lot "Next actions"** (disabled until a report exists; tooltip *"Available once a test report is
received"*). Header line: `LOT-A · 352146.2 · acceptable`. Items — label / sub-label / icon:

- **Notify supplier** — *Result + report; buyer stays masked* — factory icon
- **Notify buyer / client** — *Result + report; supplier stays masked* — users icon
- **Notify escrow provider** — *Release-trigger evidence to HKIN (`<ref>`)*, or *No escrow on this order* — bank icon
- **Acknowledge to WHL** — *Confirm the report is received and logged* — flask icon
- *— separator —*
- **Arrange logistics for this lot** — *Opens Logistics with a shipment pre-filled for this lot* — truck icon

Already-sent items show a ✓ and *"already sent <timestamp>"* instead of the sub-label. All notify items
are role-gated.

**Bulk "Next actions (N)"** — same five items, disabled when nothing is ticked. Header line:
`N lot(s) · k with a report · (m listed as pending)`. Sub-labels state the batching: *"One digest covering
N lot(s)"*, or for the buyer with several client POs *"Split into k mails — one per client PO"*.
"Acknowledge to WHL" is disabled when no selected lot has a report.

**Bulk "Send invoices to finance"** — a sixth bulk item: sub-label *"Payment run — N unpaid
invoice(s), {cur} {total}"*, disabled when no selected lot has an unpaid invoice. Deliberately on the
**bulk** menu and not the per-lot "Next actions" menu: that menu is gated on a report existing, and the
invoice arrives long before one. The per-lot route is the `[Send to finance]` button in §9.3b.

**Compose WHL email modal** — template `<select>` (hint under it) + lot `<select>`; changing either
re-fills; `To` is fixed to the lab, `Subject` + `Message` (tall mono textarea) pre-filled and editable;
*"Reset to the “X” template"* link appears once edited; footer `[Open in mail client]` (mailto) +
`[Send & log]`.

**Notify (single lot) modal** — context strip (lot · MPN · qty · report + conclusion + F.A.R.), amber
masking rule banner, `To` / `Subject` / `Message` pre-filled + editable, checkbox *"Attach the test report
<file>"* with caption *"WHL reports are issued under NDA — attaching one records the disclosure on the
lot's notification log."*, reset link, `[Send notification]`.

**Bulk notify modal** — title `<label> — N lot(s)`; note *"One digest instead of N separate mails."*
(+ *"Split into k mails — one per client PO, so no client sees another's lots"*); masking banner; amber
warning listing lots without a report ("listed as ‘result pending’"); group chips when split; a scrollable
**"Lots in this mail (k)"** list (lot · MPN · qty · report + conclusion, or "no report yet"); per-group
`To`/`Subject`/`Message` editable; checkbox *"Attach all available reports (k PDFs)"* with caption *"Each
disclosure is logged on every lot the digest covered."*; footer `[Send k mails]`.

**Match-email modal** — the mail in a bordered preview, the match note, a lot `<select>` with hint *"the
mail's updates get applied to this lot's tracker"*, `[Match]`.

**Record-dispatch modal** — context strip (`lot · MPN · sample of qty · WO → lab`) plus the consequence
spelled out: *"Moves the lot to **Supplier Dispatching Components**. WHL's receipt confirmation then
advances it again on the next inbox sync."* Fields: `Courier` · `AWB / tracking no` (hint *"optional —
leave blank if the supplier hasn't shared it"*) · `Dispatched on` (defaults to today) · `Expected at lab`
(optional) · `Note` (hint *"how the supplier told us — mail, call, portal"*). Footer `[Record dispatch]`.
Only the fact of dispatch is required — see `LotDispatch`.

**Mark-paid modal** — context strip (lot · MPN · WO · lab, then `invoice <no> — <cur> <net> + tax
<tax> = <gross> · due <date>`, or an amber *"No invoice on file yet — recording payment without one is
unusual; confirm with finance first."*), plus *"Closes the **Payment to WHL** stage on this lot's
lifecycle."* Fields: `Transfer reference` (hint *"the UTR / wire ref finance sends back"*) · `Paid on`
(defaults today) · `Note`. Footer `[Mark paid]`.

**Notify modal, `FINANCE` variant** — same shell, but the context strip shows the **invoice** (or an
amber "no WHL invoice received yet"), and the attachment tick reads *"Attach the WHL invoice
<file>"* with the caption *"Finance needs the invoice itself to release the transfer; the send is
logged on the lot's notification log."* The bulk variant reads *"Attach all available invoices (N
PDFs)"* and warns which selected lots are excluded for having no invoice.

### 9.7 Collapse / density rules (all three sub-tabs)

An order can carry 100 lots. Rendering every card open makes the tab unscrollable and the 100th lot
unreachable, so **every repeated card starts collapsed** and the operator opens what they need.

| Surface | Collapsed by default | Always-visible summary |
|---|---|---|
| MPN card (§9.2) | test matrix, fee strip, meta row, edit controls, audit trail | MPN · mode · make/qty/lots · state pill · `k tests` · `m manual` · fee gross · terms · unpaid/held |
| Lot card (§9.3) | stepper, test tracker, report repository, notifications, verdict footer | lot · MPN · lab/WO/qty/DC · verdict · `n/m tests` · stage + `n/7` · report no · blocker · fee pill · awaiting-reply clock |
| Result circulated (§9.3) | the per-notification log | the party pills |
| Correspondence (§9.5) | everything older than the 2 most recent; each body clamped to 2 lines | the 2 most recent messages |

Rules that apply to the card lists:

- **`ExpandBar` above the list**: `N lot(s) · M expanded · collapse all · expand all · click a row to
  open it`. `collapse all` shows only when something is open; **`expand all` only when the list has ≤ 12
  items** — with 100 lots it would recreate the exact problem the collapse solves.
- **Filtering auto-expands.** When the list is filtered to a single item (lot scope selector, or the MPN
  of a scoped lot), that card renders open — the filter is already the request to see it, so don't make
  them click twice.
- **Multiple cards may be open at once** (so two lots can be compared); `collapse all` resets.
- Chevron ▸/▾ on the card title, `aria-expanded` set, whole title row is the hit target, tooltip
  `Minimize` / `Expand`.

### 9.8 Logistics hand-off (separate screen)

Deep link: `/<logistics-route>?order=<orderId>&lot=<lotId>` (single) or `&lots=a,b,c` (bulk).

The logistics screen, when the link is present, shows a panel above its usual board:
- title `Create logistics for a tested lot` / `… for N tested lots`
- summary row: order link · `lots N` · `to move Q across k MPN(s)` · `from <origins joined>`
- table: `Lot | MPN | Qty | Verdict | Report | Currently at`
- caption listing the merge: *"Lots of the same MPN are merged into one shipment line: MPN ×Q (capped from
  W — rest already shipped) · … . Destination is the 1Buy hub for relabelling."*
- warnings: multiple origins (*"one AWB can only collect from one origin"*), failed lots (*"book the return
  leg to the supplier"*), lots with no report (*"moving them now pre-empts the result"*)
- actions `[Dismiss]` (clears the query string) and `[Create shipment | Fully shipped]`
- it **auto-opens** the host's create-shipment modal, pre-filled: lines = per-MPN summed qty **capped by
  what is still unshipped on the inbound leg**, origin = the lab holding the goods, destination = the hub,
  leg = inbound. The modal shows a primary-tinted strip: *"Pre-filled from N tested lots LOT-A, LOT-B ·
  MPN ×Q · origin <lab> (where the goods currently sit)"*.

If the host route is statically pre-rendered, wrap the search-param reader in a Suspense boundary.

---

## 10. Invariants — the rules that make this correct

1. **Never blank on a parse failure.** A failed auto-fill is an explicit flagged state with a reason and a
   retry, never an empty list that looks intentional.
2. **Never drop or misapply inbound mail.** Anything unroutable goes to the manual-match queue.
3. **Tests are never hand-typed as the primary path.** Manual entry exists only as an audited override, and
   auto vs. manual stays visually distinguishable forever (`from PO` / `manual` pills + `addedBy`).
4. **History, not just state.** Every status change (automated or manual) appends a row; the current value
   is never the only record. Automated rows name the automation and link the source email.
5. **The process matrix is the source of truth, not the headline conclusion.** F.A.R. and Not-Conducted are
   never counted as done, and a lot with `anyFar` maps to `MAYBE`, not `PASS`.
6. **All report versions are kept.** Exactly one `current`; superseded versions stay openable and labelled.
7. **Same MPN, different POs, different test lists.** Specs are keyed by order + MPN.
8. **Masking is absolute.** Supplier mail never contains buyer identity / client PO / sell price; buyer mail
   never contains supplier identity / buy price / inbound AWB. A buyer digest spanning several client POs is
   **split into one mail per client PO**.
9. **NDA on reports.** Every view/download is access-logged; every attachment records the disclosure on the
   lot; the confidentiality note is always visible.
10. **A digest is logged on every lot it covered** — one mail, N truthful lot trails, one order event, one
    escrow marker.
11. **Lot logic is untouched.** Lot creation/numbering/association and `lot.testStatus` → escrow behaviour
    stay exactly as the host already has them; this module only adds fields and reads.
12. **Reconciliation is automatic, resolution is explicit.** Mismatches surface themselves; a human clicks to
    reconcile, and that click is audited.
13. **Logistics quantities are capped by reality.** Never offer to ship more than is unshipped; say when a
    quantity was capped rather than silently reducing it.
14. **Role gating lives in one place** (a `useRole()`-style hook), not sprinkled through components.
15. **Nothing silently truncates.** Counts, caps, exclusions and pending lots are always stated on screen —
    including the collapsed surfaces: *"Showing the 2 most recent of 6"*, `N lots · M expanded`, `Show N
    earlier message(s)`. Collapsed is never the same as absent.
16. **The lifecycle only moves forward.** A stale interim mail arriving after the report cannot rewind a
    lot, and re-polling the same stage is a no-op, not a duplicate history row. Only an explicit operator
    correction (`setLotStage`) may go backwards, and it is logged as `manual`.
17. **The displayed stage is floored by evidence.** A lot holding a report can never *read* as
    pre-report, whatever is recorded — so imported or legacy lots can't display a lie. But the floor is
    display-only: stage *writes* compare against the recorded stage (see `moveStage`).
18. **Stage and test status are separate axes.** Neither is derived from the other's vocabulary; a lot can
    be `TESTING_COMPLETED` with tests still `IN_PROGRESS`. Don't collapse them into one field.
19. **The lab can't report what hasn't happened.** No mail *from the lab* may establish
    `SUPPLIER_DISPATCHING` — it learns of a shipment only when it lands. That stage comes from the
    **supplier's** dispatch advice relayed onto the same thread, with a manual modal as the fallback;
    before either, the lab chases *us* for the samples.
20. **What an unpaid fee means depends on the terms, and the terms come off the mail.**
    On `CREDIT` the fee is a parallel track: testing proceeds on account, so it must never block
    recording dispatch or applying results — amber node, lot pill, order alert, no hard stop. On
    `ADVANCE` it is a real gate: the lab holds the lot, so the chain stops after
    `COMPONENTS_RECEIVED` until a payment acknowledgement lands, and that state renders red and says
    so. Never let the UI present one as the other, and never let the app *choose* the terms — they
    are the lab's call per work order and are only ever read off its invoice.
21. **An invoice is a bill, not progress.** Receiving one does not advance the chain; only a recorded
    payment does. And the payment node reports the fee record rather than its position, so a lot can
    never *display* a settled fee it hasn't settled.
22. **The finance mail carries the invoice, never the report.** Different document, different
    recipient, different reason. The attachment tick names whichever document that party actually gets.
23. **Lab fees are booked to the order, not to the supplier.** The testing fee is our cost; it is not
    the supplier's material payment and never touches the escrow release maths. Every finance mail says
    so explicitly.
24. **Reaching the last stage ≠ a good result.** `REPORT_SHARED` means the report is in hand; whether the
    lot is acceptable is `testStatus` + the blocker, and an F.A.R. still needs follow-up on a chain that
    reads complete.
25. **The test list is rendered twice, and only twice.** Once per lot (the tracker, with the report's
    process result folded into each row) and once per MPN (requirements × lots). A third rendering is
    always a duplicate, because the requirements propagate into `lot.tests` at lot creation and the
    report's processes roll onto `lot.tests` on fetch — so all three views read from the same names.
    If a new surface needs per-test data, join it into one of the two tables rather than adding a
    third; and if you drop a rendering, keep whatever it *uniquely* carried (the process note and
    report number moved into the tracker's `Per the report` column, not into the bin).
26. **Every stage has a mail behind it.** `syncWhlInbox` is the primary driver of the whole chain,
    including the two stages that don't originate with the lab — the supplier's dispatch advice and
    the lab's payment acknowledgement are relayed onto the same thread. The operator actions
    (`recordSupplierDispatch`, `markLabFeePaid`, `setLotStage`) are fallbacks for the phone-call case
    and must be labelled as such, never presented as the normal path.

---

## 11. Host-adaptation matrix

| Seam | Reference implementation | What to do in the target repo |
|---|---|---|
| State | Zustand + immer + `persist` (localStorage), actions on one store | Use whatever the host uses (Redux slice, Pinia, MobX, React Query + reducer, service class). Keep the action names/semantics from §6. |
| Schema drift | a `normalizeBundle()` that defaults every new array | Mirror it: `tests`, `reports`, `notifications`, `mpnTests`, `labEmails` must default to `[]`. |
| Persisted seed | store `version` bump + `migrate` returning `undefined` for older versions | Do the equivalent so stale local state can't hide the new demo data. |
| Routing | Next.js App Router, `useRouter().push` + `useSearchParams` | Any router; keep the `?order=&lot=` / `?order=&lots=` contract. |
| UI kit | local primitives: `Panel`, `Pill`, `StatusPill`, `Button`, `Progress`, `Field`, `DataTable`, `Dialog`, `Labeled`, `Input`, `Select`, `Textarea` | Map onto the host's equivalents; do not introduce a second design language. |
| Toasts | `sonner` | Host's notification system; keep the messages. |
| Permissions | `useRole()` reading a persisted persona + a change event | Host's auth/permission source; keep `canEditTests` / `canEmailLab`. |
| Mock transport | `mockCall(system, label, endpoint, req, produce, opts)` writing to an integration console | Host's mock/fixture layer; preserve latency + failure injection + visible logging. |
| Money/qty format | `money()`, `qtyfmt()` | Host's formatters. |

---

## 12. Reference file inventory

Sizes are indicative — they tell you the shape of the work, not an exact target. For the reference
implementation's **actual** tree (measured line counts, per-file symbol maps, the import graph, and
"change X → touch these files" recipes) see the sibling **`WORKING-TREE.md`**. That doc is specific to
the reference repo; this table is what a target repo should expect to end up with.

| File | Role | ~size |
|---|---|---|
| `src/types/index.ts` | all interfaces from §3 | +190 lines added |
| `src/data/enums.ts` | reference data §4, tone map §3, templates §8, role gates | +330 |
| `src/lib/role.ts` | `useRole()` + `setActiveRole()` via an external-store subscription | 45 |
| `src/integrations/lab-whl.ts` | §7.2–7.4 + `conclusionToLotStatus` / `processToTestStatus` | 200 |
| `src/integrations/doc-extract.ts` | §7.1 | +55 |
| `src/integrations/notify.ts` | §7.5 | 35 |
| `src/store/store.ts` | actions §6 + the `moveStage` helper | +480 |
| `src/store/selectors.ts` | derived state §5 incl. the lifecycle selectors | +180 |
| `src/components/order/testing-tab.tsx` | the whole screen §9.1–9.7 + both menus + `CollapsibleCard` / `ExpandBar` / `MailRow` / `LotProgressToggle` / `LotFeeCell` | 1100 |
| `src/components/order/test-tables.tsx` | the two — and only two — per-test tables: `LotTestTable` (§9.3 tracker, report folded in) + `MpnTestMatrix` / `MpnFeeStrip` (§9.2) | 290 |
| `src/components/order/testing-stages.tsx` | §9.3a/§9.3b — `TestingStageChain` (stepper) + `TestingStageBar` (compact) + `LabFeePanel` | 330 |
| `src/components/order/modals.tsx` | compose / notify / bulk-notify / match / record-dispatch / mark-paid / shipment-prefill | +450 |
| `src/app/fulfilment/logistics/page.tsx` | §9.8 hand-off | +90 |
| `src/app/fulfilment/testing/page.tsx` | cross-order board — one `TestingStageBar` per lot | +10 |
| `src/data/fixtures.ts`, `src/data/order-details.ts` | demo seed §13 | +700 |

---

## 13. Demo seed (so every state is visible without clicking)

Seed **one order** with three lots that between them exercise everything:

| Lot | MPN | State | Demonstrates |
|---|---|---|---|
| **LOT-A** | MCU, qty 300, sample 20, WO `352146` | `PASS`, two reports: `352146.1` Not Acceptable (electrical 18/2, die analysis Not Conducted) superseded by **`352146.2` Acceptable** (all six processes acceptable, revision note). Lifecycle **`REPORT_SHARED`** — full 6-row history | revision history · superseded vs current · a settled lot · full test history including a FAILED → IN_PROGRESS → PASSED progression · a **completed** lifecycle |
| **LOT-B** | power IC, qty 150, sample 20, WO `352147` | `MAYBE`, report `352147.1` **Acceptable with X-Ray F.A.R.** (19/1) and `clientPo: "PO Unknown"`. Lifecycle **`REPORT_SHARED`** | the Acceptable-but-F.A.R. nuance · reconciliation alert + one-click fix · blocker text "F.A.R. — needs follow-up" · a chain that is complete while the *result* still needs follow-up · **a settled ADVANCE fee** |
| **LOT-C** | same MPN as B, qty 100, sample 15, WO `352151` | `PENDING`, **no report**, `lastUpdateRequestAt` ≈ 4 business days ago, tests `IN_PROGRESS`/`PENDING`. Lifecycle **`TESTING_IN_PROGRESS`** | "Not Available" + Request Update · SLA-overdue banner with Chase/Escalate · an open lot in the roll-up · a chain **mid-flight**, so "Check mail" visibly advances it |

**Lab-fee seed** — both terms and three payment states, so every path is visible without clicking:

| Lot | Fee state | Shows off |
|---|---|---|
| LOT-A | **`CREDIT` · 15d**, `PAID` — invoice `WHL-INV-352146`, USD 870 + 53 tax (6 × 145), requested → finance → paid `UTR-7741930`, 1 download logged | the settled credit path end-to-end, incl. the access log |
| LOT-B | **`ADVANCE`**, `PAID` — invoice `WHL-INV-352147`, USD 580 + 35 tax (4 × 145), `UTR-7742118`, due 3 days after issue | the advance path *completed*: its `WHL_PAYMENT` row sits **before** the dispatch row, because the lab held the lot until the transfer cleared |
| LOT-C | **`CREDIT` · 15d**, **`SENT_TO_FINANCE`** — invoice `WHL-INV-352151`, USD 580 + 35, due 2026-08-10, **unpaid** | the amber payment node on a chain that has run *past* it (only legal on credit terms), the order-level "nothing is blocked" fee alert, the `fee with finance` pill, the `Mark paid` path — and, because it sits at `SENT_TO_FINANCE`, it makes WHL's **payment acknowledgement** the next mail to arrive, so one sync demoes the mail-driven settlement |

Between LOT-B and LOT-C the *same MPN* carries different terms, which is what exercises the
`mixed terms` pill on the MPN card. **Do not seed an advance+unpaid lot on a chain that has passed
`COMPONENTS_RECEIVED`** — that contradicts invariant 20; reach the held state by adding a fresh lot
and syncing (the mock issues advance terms ~45% of the time).

Also seed, so the thread reads as the driver it is: the three **invoice mails** (`kind: "INVOICE"`,
from "WHL Accounts", PDF attached, terms stated in the body) dated on each work order's booking day;
LOT-B's **payment acknowledgement** (`kind: "PAYMENT"`, receipt attached, quoting `UTR-7742118`); and
LOT-C's **dispatch advice** (`kind: "DISPATCH"`, from "Supplier (relayed)", courier/AWB/ETA). Give
LOT-A and LOT-B a `WHL_PAYMENT` stage row; LOT-C deliberately has none.

**Lifecycle seed rules** (get these wrong and the tab contradicts itself):

- Every lot gets a `stageHistory` **consistent with its own test tracker**. LOT-C's tracker already has a
  test `IN_PROGRESS`, so its history must reach `TESTING_IN_PROGRESS`, or the derived floor overrides the
  seed and the two disagree.
- Give LOT-A a **visible gap between `TESTING_COMPLETED` (24th 09:05) and `REPORT_SHARED` (25th 16:05)**.
  That gap is the reason the two are separate stages — and the reason no third stage sits between them.
  A seed where they share a timestamp hides the point.
- Seed `lot.dispatch` (courier · AWB · dates) on all three. Where a mail supplied it, `recordedBy` is
  `Supplier (mail)`, not an operator name.
- Point every mail-driven row at its seeded `LabEmail` via `sourceEmailId` — the `REPORT_SHARED`,
  `TESTING_IN_PROGRESS`, `SUPPLIER_DISPATCHING` and `WHL_PAYMENT` rows — so "which mail moved this?"
  resolves in the demo. A mail-driven row must **not** carry `manual: true`.

Also seed:
- **MPN specs**: MCU = auto-filled OK (5 from the PO + 1 manual `Decapsulation & Die Analysis` with a real
  reason) · power IC = **`autofill: "FAILED"`** ("low-resolution scan") with 4 manually-added tests and an
  audit trail that includes a `DELETE` ("Added in error — not on this PO")
- **7 lab emails**: one **unmatched** (`"RE: Testing update"`), a request/reply pair, two report deliveries,
  a re-test request, an interim update
- **Notifications**: LOT-A already circulated to supplier + buyer + escrow (report attached, masking notes);
  LOT-B and LOT-C deliberately **not** notified so the flow has something to do
- **Shipment headroom**: the inbound AWB must cover *only* the passed lot, so "Arrange logistics" has real
  quantity to book (otherwise every prefill is ×0 and looks broken)

Extra orders worth seeding to show the range: a **Suspect Counterfeit** order (visual/X-ray/die all
non-conforming, electrical Not Conducted, quality-hold approval, dispute thread), a **supplier self-test**
order (CoC instead of a WHL report, F.A.R. on visual), a **Not Acceptable + escrow hold** order (chase past
SLA, unmatched mail, X-Ray Not Conducted because the bench was down), a **closed** order (all passed, escrow
released, notifications to all four parties), and a **no-testing** order (`"PO specifies no incoming test"`).

---

## 14. Acceptance checklist

Data & auto-fill
- [ ] Auto-fill from PO populates per-MPN test lists; re-running keeps manual additions.
- [ ] A failed parse shows "Auto-fill failed — needs manual review" + reason + Retry; never an empty list.
- [ ] Manual add/delete is logged with who · when · before → after, and stays distinguishable (`from PO` / `manual`).
- [ ] The same MPN on a different order/PO can carry a different test list.

Tracker
- [ ] Every lot shows every required test with status, accept/reject qty and last-updated.
- [ ] **The tracker is the only per-test table on the lot card** — its `Per the report` column carries the
      process result, report number and process note, and the report block below does not repeat them.
- [ ] A process on the report that was never on the PO's list still gets a row, marked `report only`.
- [ ] The MPN card shows requirements × lots, flags a requirement missing from a lot, and totals
      `passed / tracked` per lot — it is not a second flat list of the same names.
- [ ] Expanding a test shows the full timestamped progression, naming the automation and source email.
- [ ] `Check mail` applies interim statuses; a report never gets downgraded by a later interim note.
- [ ] Unroutable inbound mail lands in the manual-match queue; matching applies its updates.

Reports
- [ ] Fetching twice produces `.1` and `.2`; both stay openable; exactly one is current.
- [ ] The parsed summary shows every §9.4 header field — no PDF needed — plus the process roll-up strip.
- [ ] An Acceptable report with one F.A.R. process is flagged, sets the lot to MAYBE, and blocks "clear".
- [ ] `PO Unknown` / MPN mismatch raise reconciliation alerts; the fix is one click and audited.
- [ ] Views and downloads are access-logged; the NDA note is visible.

Lifecycle
- [ ] Every lot shows the 7-stage chain with the current stage, `n/7`, and who the next step is waiting on.
- [ ] Neither "Testing Started" nor "Report Preparation" appears anywhere — label, icon, meta or seed.
- [ ] A fresh lot walks the whole chain **on mail alone**: work order → invoice (with terms) → dispatch
      advice → receipt → [advance: pay, then the acknowledgement] → in progress → testing completed →
      report shared. No operator input is required, and the cursor skips no stage **except
      `Payment to WHL`**, which the fee settles out of band (see §6) — assert its history row instead.
- [ ] `Testing Completed` and `Test Report Shared` are separate rows with separate timestamps — the bench
      can finish days before the report lands.
- [ ] Polling repeatedly advances one step at a time; a completed lot is left untouched.
- [ ] Before dispatch, the lab sometimes chases us for the samples; the stage itself only ever comes from
      the supplier's dispatch advice (or the manual modal), never from a lab mail.
- [ ] A stale interim mail can't rewind a lot; re-polling the same stage adds no duplicate row.
- [ ] Mail-driven history rows cite a `sourceEmailId` that exists on the lot's thread and are **not**
      flagged `manual`.
- [ ] A fee that settles after the lot has shipped still writes its `WHL_PAYMENT` history row (timestamp,
      author, source mail) — `settleStage`, not `moveStage`. This was a real dropped-row bug.
- [ ] Manual `mark … done`, the dispatch modal and `Mark paid by hand` write rows attributed to the
      operator, and each is presented as a fallback rather than the primary action.

Lab fee — amount, terms, settlement
- [ ] The lab's invoice arrives by mail on booking — before any report — and is filed in the document vault.
- [ ] The invoice mail is the **only** source of the terms: advance vs credit is never chosen in the UI.
- [ ] The amount reads as the priced test list: `processCount × ratePerProcess`, with the rate shown on
      the MPN matrix and the per-MPN fee strip.
- [ ] It is downloadable per lot and the download is access-logged.
- [ ] `Request invoice` uses the same template source as the compose modal.
- [ ] Sending to finance attaches the **invoice** (not the report) and marks the fee "with finance".
- [ ] WHL's payment acknowledgement closes the Payment-to-WHL stage on the next sync, carrying its own
      `paidRef`; `Mark paid by hand` does the same out of band. Receiving an invoice never closes it.
- [ ] **On credit terms** an unpaid fee never blocks dispatch or results — amber node, lot pill, alert
      that says nothing is blocked.
- [ ] **On advance terms** an unpaid fee *does* block: the lot reads `Held — advance fee unpaid`, the
      chain stops after `COMPONENTS_RECEIVED`, the node is red, and a separate bad-tone alert names the
      held lots. Paying it releases the lot on the next sync.
- [ ] The payment node reads amber (or red) while unpaid even when the chain has moved past it.
- [ ] One MPN whose lots came back on different terms reads `mixed terms`, not one of them.
- [ ] Bulk `Send invoices to finance` sends one payment run, totals the currency, names excluded lots,
      flags advance lots as held/priority in the subject and body, and moves every covered lot to
      "with finance".

Roll-up & filter
- [ ] The lot selector scopes tiles, progress, alerts and all three sub-tabs; "All lots" restores the total.
- [ ] The lot-wise table shows verdict, tests n/m with F.A.R./not-acceptable/not-conducted counts folded
      into that cell, the lab fee (amount · terms · state), current report, the blocker and the
      lifecycle stage.
- [ ] Clicking a row scopes; clicking again clears; ticking a checkbox never changes scope.
- [ ] The Progress cell expands the stepper in place without changing the scope.

Density (works at 100 lots, not just 3)
- [ ] MPN and lot cards start collapsed, with enough summary to pick the right one without opening it.
- [ ] `collapse all` appears once something is open; `expand all` only for ≤ 12 items.
- [ ] Filtering to one lot / MPN auto-expands that card.
- [ ] Correspondence shows only the 2 most recent mails, states the total, and expands on demand.
- [ ] Long mail bodies are clamped with `view full email`; short ones get no toggle.
- [ ] The "Result circulated" notification log is collapsed behind `Show history (n)`.

Actions
- [ ] "Next actions" is disabled until a report exists, and shows ✓ + timestamp for parties already told.
- [ ] Supplier / buyer mails are masked from each other; the modal states the rule.
- [ ] Escrow notification also writes an escrow-ledger marker; the WHL one also joins the lab thread.
- [ ] Bulk: quick filters select by report/verdict/F.A.R.; one digest lists every lot with its verdict and
      splits the disposition by outcome; buyer digests split per client PO.
- [ ] A digest writes a notification row on every lot it covered, but only one order event.
- [ ] Logistics deep links (single + bulk) pre-fill a shipment with merged, capped quantities and warn about
      mixed origins, failed lots and missing reports.

Non-functional
- [ ] Edit-tests and all mail actions are role-gated with a visible reason when denied.
- [ ] Every adapter call appears in the integration console; injected failures surface as retryable errors.
- [ ] Typecheck, lint and production build are clean; the screen renders for an order with 0 lots, 1 lot and
      many lots without layout breakage.
