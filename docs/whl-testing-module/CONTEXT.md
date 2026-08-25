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

The primary screen is scoped to **one order** and answers six questions:

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
| **Advance vs credit** | The two modes the lab bills on, stated on its invoice and **never chosen by us** — it's the lab's call per work order. (If the invoice arrives by some other medium, the operator uploads the lab's PDF and its terms are read off that document — never chosen; the record is flagged `entered by hand` so an upload is never mistaken for the lab's own mail — see §6.x `uploadLabInvoiceFile`.) **Advance:** the fee clears before the bench starts, so the lot sits in the lab's store and the fee is a genuine gate. **Credit:** the lab tests on account and bills on terms, so the fee is a parallel track that must block nothing. |
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
export type TestSource = "AUTO_BOOKING" | "MANUAL";   // AUTO_* = read off the lab's booking appointment
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
  | "TEST_BOOKED"
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

/** A required test as read off the lab's booking appointment (never hand-typed unless the operator overrides). */
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

### Test slots — the booking step that comes before any lot

**Added 2026-08-21.** Nothing about a lot exists until the lab has agreed to test it. The desk books a
slot, mails the lab, and waits:

```
Book test slot            →  step 1 "details": per-MPN qty / sample / date code / test plan
        ↓ [Review the mail]
                             step 2 "draft": the exact subject + body, EDITABLE. Nothing sent yet.
        ↓ [Send to <lab>]
TestSlot { status: REQUESTED }  +  outbound BOOKING_REQUEST mail
        ↓                          … the desk is BLOCKED here …
[Get <lab>'s reply]  →  inbound BOOKING_CONFIRMED  →  status: CONFIRMED, appointmentNo
        ↓
lots created (one per requested line) with their work orders and test plans, stamped TEST_BOOKED
```

**We never quote the lab a booking reference of ours** (2026-08-21). `slotNo` (`TS-<order>-<n>`) is
**internal**: it labels the slot in our UI and appears nowhere in the mail or its subject. The lab
issues the reference — its **booking appointment no** in the confirmation, plus a **work order per
lot** — and those are what both sides quote afterwards. A re-test request therefore cites
*"your appointment <no>, work orders <a, b>"*, never our earlier slot number, and the confirmation
names the MPNs rather than echoing a reference we never sent.

**The operator picks the MPN; the form does not assume one block per line** (2026-08-21). Booking
**per order** — the workspace's header button, the board's grouped-view header — opens with **one
row**: an MPN `<Select>` over the order's testable lines, plus **lot code**, date code, lot qty, a
**Preferred start** and the test checklist, and an **`+ Add MPN`** button that repeats the whole block
for another part. Every row carries a **`🗑 Delete`**, **including the last one** — a control that
appears and disappears with the row count is worse than an empty booking, which is recoverable
(`+ Add MPN`) and shows *"No MPN on this booking — add one to send the request."* with the review
button disabled. It used to open with a block per testable line and a tick to *exclude* the ones you
didn't want, which is backwards: a booking is usually for one part, and unticking five blocks to book
one is work. Changing a row's MPN **re-seeds its lot qty** off that order line, since the old number
belonged to the part that was there before. **`Preferred start` is per MPN and nowhere else**
(2026-08-24): a slot-level default used to sit above the rows, which meant the same date got typed
twice for no gain. `TestSlot.preferredDate` is gone; `TestSlotLine.preferredDate?` carries it, and a
row's date is quoted in that MPN's block when set.

**Booking per part fixes the part** (2026-08-24, `presetMpn`). A booking opened from a Testing-board
row is *for that row's MPN*, so the form does not offer a way to make it a different one: **no MPN
dropdown** (the part shows as text with its make and order qty), **no `+ Add MPN`**, **no `🗑 Delete`**
— with no Add to recover with, deleting the only row would leave a form that cannot be sent. Its
**lot code is pre-filled** with the next free `LOT-A / LOT-B …` on the order — the same convention the
confirmation falls back to, so a suggested code and an invented one look alike — and stays editable,
because whatever the field holds is still what gets quoted and what the confirmed lot is created
under. A **re-test** opened per part re-runs only that part (rather than every FAIL on the prior slot)
and is **not** pre-filled with a lot code: its lots are deliberately prefixed `RT<n>-` at
confirmation, and a plain code here would defeat that.

**Nobody tells the lab what to sample** (2026-08-24). The `Sample qty` field is **gone from the
booking form**, and the request mail no longer carries a `Sample qty:` line — it never should have:
the lab draws the sample, and the mail has always *closed* by asking it to confirm "work order
numbers, sample quantities and the agreed test plan". Quoting a number of ours in the same mail read
as an instruction and was pure invention (a 5% clamp). `TestSlotLine.sampleQty` is therefore
**optional** now and normally absent; the confirmation supplies the figure
(`line.sampleQty ?? appt.sampleQty ?? 5%`), where the first term only ever fires for a slot booked
before this change or a seeded one. Nothing that already carries a sample loses it, and every
`sampled X of Y` reading on the board and the workspace still comes off `Lot.sampleQty`, which is
unchanged and still required — the lot *has* a sample, we just don't choose it. **`AddLotModal`
keeps its sample field**: that form transcribes an appointment the lab has already issued, so the
number is being *read off a document*, not decided.

**`Lot code` is asked for, not invented — but it can be suggested** (2026-08-24). `TestSlotLine.lotCode?` goes out in the mail
(`Lot code: <x>` in the MPN block) and the confirmation **creates the lot under exactly that code** —
falling back to the appointment's own only when the field was left blank. Both sides then track one
name for the submission; letting the app name it meant our lot code and the lab's never matched. Duplicate MPNs
across rows are allowed on purpose — one line split across two date codes is two lots at the lab, not
a mistake. A re-test still seeds from the failed submission's lines (only the MPNs whose verdict came
back FAIL).

**Tests are a numbered list, one per line.** Each MPN gets its own block —
`MPN <x>` / `Lot code:` / `Lot qty:` / `Date code:` / `Tests requested:` then `1.`…`n.` — because a
comma-run of ten process names is the exact part the lab has to work from and is unreadable inline.
An MPN with nothing ticked reads *"as per your standard AS6081 screen"*.

**No standard on a booking request.** The `Standard` select was removed from the modal (2026-08-21):
the lab states the standard it screens to on its confirmation, so asking an operator to pick one here
was asking them to guess. `TestSlotLine.tests[].standard` stays optional in the type for whatever the
confirmation carries.

**No outbound mail leaves unseen.** `BookTestSlotModal` is two steps: *details*, then a **draft
review** built by `draftTestSlotMail` (the same `buildSlotMail()` `requestTestSlot` uses, so what is
shown is what is sent) with subject and body both editable. `requestTestSlot` takes the reviewed
`subject`/`body` and falls back to the generated pair only for a caller with no UI. Same rule the
escrow module follows — don't add a send path that skips the review.

**The reply is a real (simulated) inbound mail, not a state flip.** The pending notice's primary
action reads `Get <lab>'s reply` and says in as many words that the confirmation is generated for the
demo while the real integration polls the mailbox. Both mails — the request and the reply — sit in
`Communication` as `booking` / `confirmed` rows marked `order-level`.

- `TestSlot` = `{ id, slotNo, lab, status: REQUESTED|CONFIRMED|DECLINED, preferredDate?, lines[{mpn,
  qty, sampleQty?, dateCode, tests[]}], note?, requestedAt/By, requestEmailId?, confirmedAt?,
  appointmentNo?, confirmEmailId?, createdLotIds[], retestOfSlotId?, retestOfSlotNo?, retestReason? }`
  on `OrderBundle.testSlots`. A lot back-references its slot via `testSlotId` / `testSlotNo` /
  `retestOfSlotNo`.
- **Booking happens inside the order, never from the queue** (2026-08-22). The board's `Test slot`
  column is **read-only** — it reports the slot, it does not start one. A button there could only ever
  book "something on this order", and a booking is per-MPN with quantities, samples and a test plan,
  which is not fillable from a queue row. Its `nextTestingAction` for an order with no lots reads
  *"Open the order and book a test slot with the lab"*. Inside the workspace the **Test lots** section
  has its own `TEST SLOTS · n` header, which since 2026-08-25 **links to the board** rather than
  booking (`Book a test slot on the Testing board →`, §9.3). While a slot is `REQUESTED` that
  header reads *"<slotNo> is still with the lab — one booking at a time."* instead. The section renders
  the header **before** its empty state, so an order with no lots can still book.
- **`pendingTestSlot(b)` is a real gate.** While a slot is `REQUESTED` the workspace shows a warn
  `Notice` naming it and **holds the lot actions** (`canAct = canEditTests && !pending`). Mail stays
  open, because checking the mailbox is the way out. Acting on lots the lab has not agreed to test is
  how a tracker starts lying — don't soften this into a hint.
- **The confirmation is delivered by `syncWhlInbox`, and answered first.** If any slot is `REQUESTED`
  the poll delivers that confirmation and **returns without polling the lab** — with no work orders
  yet there is nothing else the mailbox could say. It marks the request mail `UPDATE_RECEIVED`, files
  the inbound `BOOKING_CONFIRMED` mail (with the appointment PDF attached), writes each MPN's spec
  from the **plan we asked for** (falling back to the lab's own), creates the lots, and stamps
  `TEST_BOOKED`.
- **A re-test is another slot pointing back** (`retestOfSlotId`). Its lots are stamped
  `TEST_BOOKED → SUPPLIER_DISPATCHING → COMPONENTS_RECEIVED` in one go, because the parts are already
  at the lab from the original submission and recording a dispatch that never happened would be a
  lie. Lot codes are prefixed `RT<n>-`, and both the slot strip and the lot card carry a
  `re-test of <slotNo>` pill. The booking modal defaults to **only the MPNs that failed**.
- **Work orders belong against the slot.** The lab issues one per lot when it approves the booking, so
  the confirmed slot strip carries a `WORK ORDERS` group — one `<WO no> <lotCode>` pill per lot
  (tooltip: lot code · MPN) — and a `REQUESTED` slot reads *"work orders issued when <lab> confirms"*.
  That is the reference the lab's own invoices and reports quote, so reading it off the slip that
  produced it beats hunting it lot by lot.
- A `BOOKING_CONFIRMED` mail is **excluded from the manual-match queue**: it is order-level by design
  (it is the mail that creates the lots, so it cannot name one), and the thread shows `order-level`
  rather than `unmatched` for both booking kinds.

### Testing lifecycle chain (exact copy — this is product text)

Order matters and is the single source of truth; nothing may hardcode which stage is last.

```ts
export const TESTING_STAGES: readonly TestingStage[] = [
  "TEST_BOOKED", "SUPPLIER_DISPATCHING", "COMPONENTS_RECEIVED",
  "TESTING_IN_PROGRESS", "TESTING_COMPLETED", "REPORT_SHARED",
  "WHL_PAYMENT", "RETURNED_TO_SELLER", "ASSIGNED_TO_LOGISTICS",
] as const;

export const TESTING_TERMINAL_STAGE = TESTING_STAGES[TESTING_STAGES.length - 1]; // REPORT_SHARED

export type StageOwner = "1BUY" | "SUPPLIER" | "WHL";   // labels: "1Buy" | "Supplier" | "WHL"

export const stageIdx   = (s?: TestingStage) => (s ? TESTING_STAGES.indexOf(s) : -1);
export const stageLabel = (s?: TestingStage) => (s ? TESTING_STAGE_META[s].label : "Not started");
```

| # | Stage | Label | Description (verbatim) | Owner | Moved by (always a mail) |
|---|---|---|---|---|---|
| 1 | `TEST_BOOKED` | Test Booked | The lab has confirmed a test slot — its booking appointment names the lots, their sample quantities and the agreed test plan. | 1Buy | Booking appointment from the lab — upload the PDF and the lots and their tests are read off it. |
| 2 | `SUPPLIER_DISPATCHING` | Supplier Dispatching Components | Supplier is preparing and shipping the components to WHL. | Supplier | Supplier's dispatch advice mail (courier / AWB) — or record it by hand. |
| 3 | `COMPONENTS_RECEIVED` | Components Received by WHL | WHL has confirmed receipt of the components. | WHL | Receipt confirmation mail from WHL. |
| 4 | `TESTING_IN_PROGRESS` | Testing In Progress | The lot is on the bench — WHL is conducting the required tests and mailing progress. | WHL | Interim progress mails from WHL — each one updates the test tracker. |
| 5 | `TESTING_COMPLETED` | Testing Completed | Every process in the agreed test plan has been run; the write-up is with WHL's reviewer. | WHL | WHL confirms the bench work is finished. |
| 6 | `REPORT_SHARED` | Test Report Shared | WHL has shared the completed test report and results. | WHL | Report received and parsed onto the lot. |
| 7 | `WHL_PAYMENT` | Payment to WHL | WHL's testing invoice has been received and settled. The lab bills **after** it has shared the report, so this sits behind it — not at the start (moved 2026-08-21; at index 1 it described a billing model WHL does not use and left every live lot showing an un-started payment stage for weeks). Knock-on: `labFeeBlocking()` still models an unpaid *advance* invoice holding the bench, which can no longer happen in this order of events — the machinery stays because terms are read off whatever document arrives, never assumed. | 1Buy | Request the invoice (or upload it if it came another way); WHL's payment acknowledgement closes it. |
| 8 | `RETURNED_TO_SELLER` | Returned to Seller from WHL | WHL has sent the samples back to the seller — the goods are out of the lab and with the party that will ship them. | WHL | WHL confirms the return, or record it by hand on the lot. |
| 9 | `ASSIGNED_TO_LOGISTICS` | Assigned to Logistics | The testing desk has handed this test lot to logistics — its result is final and the goods are cleared to move. | 1Buy | Assign to logistics on the test lot. That click alone completes this stage. |

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

Test plan by testing mode (used by the PO parser mock — see §7.1 for the full contract):

- `WHL` → a **random draw of 4–6** of `WHL_PROCESSES` in WHL's own order, standard `AS6081`
  (`AS6171` for `Decapsulation & Die Analysis`)
- `SUPPLIER_SELF` → a random **2–3** of the first four processes, no standard
- `NONE` → empty list + note `"PO specifies no incoming test for this MPN."` (this is **not** a failure)

The draw is random rather than a fixed slice because which processes a PO lists genuinely varies by
part; a fixed "first 6" made every MPN on every order carry an identical table.

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
//   lot.logisticsAssignedAt                   → ASSIGNED_TO_LOGISTICS
//   lot.returnedToSellerAt                    → RETURNED_TO_SELLER
//   lot.workOrderNo                           → TEST_BOOKED
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

allLabFees(ordersMap)              → cross-order rows for the finance ledger (§9.9):
//   { id, orderId, orderNo, supplierPoNo, lot, pay, invoice, gross, terms, unpaid, blocking, currency }
// A lot enters the ledger once it has a work order AND the fee track has started (status is past
// NOT_REQUESTED) — finance wants to see a fee coming, not only one already owed.

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
| **uploadBookingAppointment** | `(orderId, file \| null)` *async* | Read the lab's **booking appointment** and let it create the work. `file === null` is the demo/auto-fill path — same parse, no document filed. Per parsed lot: build/replace that MPN's spec (`sourceDoc` = `Booking appointment <no>`, `parsedAt`, `confidence`, **preserving existing MANUAL tests**) with an `AUTOFILL` audit row; then either **create the lot** (code, MPN, qty, sampleQty, dateCode, lab, workOrderNo, tatDays, clientPoNo, tests all from the appointment) stamped straight to `TEST_BOOKED` via `moveStage` with the appointment/WO/TAT in its note, or, if a lot with that code or MPN+WO already exists, **top up its tracker and fill only blank booking facts** — never clobber a lot mid-flight. Files the PDF as a document when there is one, logs one order event, toasts `<appointmentNo>: N lot(s) created — test plans filled`. Replaced **autofillMpnTests** (parse the PO's test table), 2026-08-21: the PO says what the buyer requires, the appointment says what the lab agreed to run on which lots, and the tracker mirrors the second. |
| **addMpnTest** | `(orderId, mpn, { name, standard? })` | Manual override. Ignore duplicates (case-insensitive). Push `TestRequirement` with `source: "MANUAL"`, `addedBy`, `addedAt`. Append `ADD` audit row noting "Manual override of the auto-filled list." If spec was `FAILED`, move it to `PENDING` (a human has now reviewed it). Propagate to every lot of that MPN. |
| **removeMpnTest** | `(orderId, mpn, testId)` | Remove from spec, append `DELETE` audit row (before = "auto-filled test"/"manual test", after = "—"), remove the matching row from every lot of that MPN. |
| **setLotTestStatus** | `(orderId, lotId, lotTestId, status, note?)` | No-op if unchanged. Set status + `updatedAt`, append `STATUS` history row (before → after, by = operator). |
| **recordSupplierDispatch** | `(orderId, lotId, { courier?, awb?, dispatchedOn?, expectedArrival?, note? })` | Store `lot.dispatch` (+ `recordedBy`/`recordedAt`), move the stage to `SUPPLIER_DISPATCHING` with the courier/AWB/date summarised into the history note, and write an order event. **The by-hand fallback** — normally the supplier's `DISPATCH` mail does this on the next sync. |
| **requestWhlInvoice** | `(orderId, lotId)` | Send the `INVOICE_REQUEST` template (same source as the compose modal) and move the fee to `REQUESTED` + stamp `requestedAt`. Never walks a received/paid invoice backwards. |
| **assignLotToLogistics** | `(orderId, lotId)` | Hand a tested lot to the freight desk: stamp `logisticsAssignedAt`/`logisticsAssignedBy`, log one order event naming the lot, MPN and report. **Idempotent** — a second call toasts "already assigned" and changes nothing. Deliberately a **stamp, not a booking**: no stage moves and no shipment is created, the test lot simply appears on the Logistics board's own queue (§9.8) for that desk to act on. The UI gates it on `lotStage === "REPORT_SHARED"`, since before the report there is nothing cleared to move. |
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

### 6.x `uploadLabInvoiceFile(orderId, lotId, file)`  *(async)*

`file = { name, size }` — **that is the whole input.** Rebuilt 2026-08-21: this used to be
`uploadLabInvoiceManually(orderId, lotId, input)` with a thirteen-field modal (`invoiceNo`, `currency`,
`amount`, `taxAmount`, `terms`, `creditDays`, `dueDate`, `processCount`, `ratePerProcess`, `fileName`,
`receivedVia`, `note`) asking the operator to re-key the lab's own document. Every one of those fields
belongs to WHL, `terms` most of all — it decides whether the lot is held off the bench — so re-keying
them was the most likely way for a wrong value to get in. The operator now picks the PDF and nothing
else; the fields are read off it via `extractLabInvoice` (§7.6).

Flow: read the lot → `await extractLabInvoice({ fileName, bytesLen, workOrderNo, lotCode, processCount:
lot.tests?.length })` → on a parse failure, toast the adapter's message and write nothing → otherwise
write `lot.labPayment.invoice` (replacing any existing one) with the parsed amount / tax / currency /
rate / processCount / terms / creditDays / dueDate and the **operator's real file name**, stamp
`source: "MANUAL" · enteredBy · receivedVia: "uploaded PDF"` and a note naming the file, move the status
to `INVOICE_RECEIVED` unless the fee is already `PAID`, file the document in the order's vault as
`WHL_INVOICE` / `uploadedBy: "<me> (by hand)"`, and log an order event naming the terms and the file.
The success toast states the invoice no., the gross and the terms, because that is what the operator
did not type and now needs to see.

Still flagged **`entered by hand`** — the record came off a file someone picked, not off the lab's mail,
and §10's invariant that the two are never indistinguishable is unchanged.

It does **not** touch the lifecycle stage: an invoice arriving has never moved `WHL_PAYMENT` — paying it
does (`markLabFeePaid` → `settleStage`), by mail or by hand.

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

### 7.6 `extractLabInvoice({ fileName, bytesLen, workOrderNo?, lotCode?, processCount? })`
Latency 700–1800 ms · failure `UNPARSEABLE_FILE / "Could not read the lab's invoice off that file" / 422`.

Returns `{ invoiceNo, currency, amount, taxAmount, processCount, ratePerProcess, terms, creditDays?,
dueDate?, overallConfidence }` — the lab's invoice read out of the PDF the operator just picked, so
"Upload invoice" can be exactly that (§6.x, §9.3b). The mock prices the test list
(`processCount × WHL_TEST_FEE_PER_PROCESS` + `WHL_INVOICE_TAX_PCT`), derives the invoice no. from the
work order so it reconciles against the lot, and bills work orders of ≥5 processes on `CREDIT` (due in
`WHL_CREDIT_DAYS`) and smaller ones on `ADVANCE`. In the real project this is OCR + an extraction call;
the seam is the same as every other adapter here.

### 7.7 `extractBookingAppointment({ fileName, bytesLen, orderNo, lab?, lines[] })`
Latency 900–2400 ms · failure `UNPARSEABLE_FILE / "Could not read the booking appointment — check the file and retry" / 422`.

Returns `{ appointmentNo, lab, bookedAt, lots: [{ lotCode, mpn, qty, sampleQty, dateCode, lab,
workOrderNo, estimatedTatDays, tests: [{name, standard?}] }], overallConfidence }`.

The booking appointment is the confirmation the lab sends back when a slot is booked, and it is the
one document that carries the whole picture: which lots go in, the sample pulled from each, the date
codes, the work order the lab bills against, the quoted TAT, and the agreed test plan per lot. That
is why it — not the PO — is what `uploadBookingAppointment` (§6) reads: reading it creates the lots
*and* their trackers in one step, where before an operator added a lot by hand and then parsed a PO
for its tests.

Mock: one lot per testable order line; sample ≈ 5% of line qty clamped to 5–50 (labs test a sample,
not the lot); a work order in the lab's own numbering derived from the order no; and the plan the
testing mode implies — the six-process AS6081 screen for a `WHL` line, a three-process list for
`SUPPLIER_SELF`. Deterministic for the same lines, so the demo is stable. **This is the seam the
real lab feed replaces** — swap the body, keep the shape.

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

**Terminology (2026-08-21):** every user-facing label in this module calls the entity a **test lot**,
not a "lot" — *Test lots · status & actions*, *Add test lot*, *Select test lots*, *All test lots*,
*Slowest test lot*, *N test lot(s)*, *No test lot raised*. The **type, field and variable names stay
`Lot` / `lots` / `lotCode`** — this was a copy change, not a data-model one, and renaming the model
would churn every selector for nothing. Long explanatory sentences still say "the lot" where a second
"test lot" in the same breath reads worse; the rule is about labels, counts and headings.

### 9.0 Where the module is mounted — one acting screen (two doors), one reading surface

The screen specified below is the acting screen, and it is mounted in **two** places that render
the identical component with the identical actions:

- the **order workspace's Testing tab** — `/fulfilment/orders/[id]?tab=Testing`
- the **testing workspace route** — `/fulfilment/testing/[orderId]`, reached by picking an order on
  the cross-order Testing board (`/fulfilment/testing`)

Two doors, one screen: whichever way an operator arrives, WHL mail, report fetches, stage moves,
lab-fee settlement and lot verdicts all behave the same.
Never fork them — a feature added to one and not the other is a bug by construction.

**The two doors no longer cross-link** (2026-08-20). The testing route's `Order workspace` header
button was removed, and the order-flow page's Testing section links nowhere at all: its
`Testing board` link was dropped in the same pass that stripped every section's board link off the
flow page (see CLAUDE.md's reading-surface rules) — the reading surface carries no navigation, so
neither a per-order acting screen nor a board is reachable from it. The workspace's Testing tab is
still a live door — you just reach it from the workspace, not from the flow page.

The one **reading** surface is the **Testing section of the order-flow page**
(`/fulfilment/order-flow/[orderId]`, the page the Dashboard links to): **five tiles**, the unpaid/held
fee notice, a current-reports strip, and the test-slot table (verdict · tests · lab fee · report ·
outstanding · lifecycle). Expanding a row renders `LotReadOnlyDetail`, and that is deliberately
**two things only**: the `readOnly` lifecycle stepper, and the report — parsed on screen, openable
and downloadable.

**The tiles count test slots, not tests** (2026-08-24): `Test slots` · `Passed` · `Failed` ·
`Completed n/N` · `In progress n/N`, where completed means the lifecycle reached its terminal stage.
There were seven — lots, tests tracked, passed n/m, still open, F.A.R., not acceptable, reports —
a per-test breakdown of the whole order added together, which is the wrong altitude twice over on a
reading page: the numbers belong to different submissions that were never one batch, and nobody
scanning an order needs the test-level tally to know where it stands. The page also says
**"test slot"** rather than "lot" throughout — the column header, the reports strip and the caption.

Rules that keep the split honest:

- **One dataset, one rendering of each part.** The reading surface calls the same §5 selectors and
  reuses the same components (`TestingStageBar`, `TestingStageChain`/`TestingStageDetail`,
  `LotFeeCell`, `ReportRepository`, `LotReadOnlyDetail`); it never recomputes a number or
  re-lays-out a report of its own.
- **No half-disabled controls.** An action is absent there, not greyed out — `readOnly` drops the
  whole action row on `TestingStageChain` / `LabFeePanel` — and, until the parse-flag notices went
  (2026-08-25), a report's reconcile action; on `ReportRepository` it now only changes the empty
  state's wording — rather than passing `canEdit={false}`, which is the *role* gate and means something
  different.
- **Reading a report is not an action.** Opening and downloading a report **are** available on the
  reading surface — the report is the deliverable that page exists to show. Both write an NDA
  access-log row wherever they happen, which is the invariant that matters (no unlogged look at a
  report). The download toasts what was logged, because the PDF itself is a mock.
- **Say each thing once.** Three things were built onto the reading surface and then cut, and the
  reasons are worth keeping so they don't come back:
  - a **vertical stage list** ("progress stages", one row per stage with its timestamp and source
    mail) — the lifecycle stepper directly above it already names all 9 stages with the date each
    was established, so this was the same information twice on one screen;
  - the **per-test table** — the report says what each process concluded, and the report is right
    there to read and download; a reading surface doesn't need an approximation of a document it
    can hand over;
  - the **requirements-by-MPN roll-up** — that's a working view (auto-fill state, audit counts,
    manual overrides) and belongs with the sub-tab that can act on it (§9.2).
  What's left answers the two questions a reader has: *where is this lot* and *what did the lab
  say*. Anything more granular is one link away on the acting screen.
- The cross-order board is **slot-first** (2026-08-24, was order-first): a row is one MPN's
  submission, sorted by bucket severity, then by what needs a human (mail to match, chases past
  SLA, lots the lab is holding, bad results), then newest — see §9.0a.

### 9.0a The cross-order Testing board (`/fulfilment/testing`)

**Rebuilt 2026-08-21 to the Logistics-queue idiom** (`lib/logistics-order.ts` +
`app/fulfilment/logistics/page.tsx`), so the two desks read alike: mutually-exclusive pressure
buckets as filter chips with live counts, one search box, one paginated `DataTable` whose whole row
is the link, and a column that states where the work stands instead of making the reader infer it.

**A ROW IS ONE MPN'S TEST SLOT, NOT AN ORDER (2026-08-24).** The lab does not test orders: it tests
one part's samples against one work order, and every record this module keeps — lifecycle stage,
verdict, report revisions, the invoice — already hangs off that submission. While rows were orders,
each cell had to merge several submissions into one figure (*"2 test slots · 1 failed"*) and the
reader still had to open the order to learn **which part** failed; the fee columns had the same
problem one level up, summing invoices raised against different work orders. Now the row is the
submission and every column on it is that submission's own. Consequences worth stating:

- **The party columns exist because the row no longer names an order by itself.** `Order no`,
  `Buyer` and `Supplier` put a submission in context without a second lookup — a lab queue is
  scanned across orders, so "whose part is this" is a question every row has to answer.
- **A testable line with nothing booked still gets a row** (`pressure = NOT_BOOKED`, no slot). That
  is the entire point of the bucket, and a list of only-booked work could never answer *"which of my
  parts is not at the lab yet"* — the same reasoning as the workspace's grouped view being driven by
  the order's lines rather than by which MPNs happen to have lots (§9.3).
- **Rows come from the LOTS once a slot is confirmed, not from the slot's lines.** One line can
  become two lots (the same MPN split across two date codes is two samples, two work orders, two
  verdicts). Matching a line back to *"the lot with this MPN"* collapsed them into one row and
  reported the first lot's result twice — a real bug on the seeded ORD-151, caught in review the
  same day. Lines are the source only *before* a confirmation exists, when no lot does.
- **Two order-level facts stay off the rows.** Unmatched WHL mail belongs to no lot **by
  definition** — that is what makes it unmatched — so it stays on the board's attention card and the
  grouped view's header. The Testing phase clock (`atRisk`) *is* per order, and does show on every
  row of that order as `behind clock`, because it is a statement about the testing those rows are.

`lib/testing-queue.ts` holds all of the derivation — pure, no store access, so any surface can
share the answer:

| export | what it is |
|---|---|
| `TestingPressure` | `FAILED` → `IN_PROGRESS` → `NOT_BOOKED` → `COMPLETED` → `PASSED`, worst first. A **row** lands in exactly one; the **`Completed` chip** is a superset of `FAILED`/`PASSED` (see `pressureMatches`), so the chip counts no longer sum to the queue length |
| `pressureMatches(chip, rowPressure)` | which rows a chip selects — identity for four of them, `FAILED ∪ PASSED ∪ COMPLETED` for `Completed` |
| `TESTING_PRESSURE_META` | per bucket: `label`, `tone`, and `what` (the chip's tooltip) |
| `testingSlotRows(b)` | **the board's unit**: one `TestingSlotRow` per submission — party fields, the part, the slot (`slotNo/status/lab/isRetest/rebooked`), the lot it became (`lotCode/workOrderNo/stage/verdict`), that lot's own test tallies, and that work order's own money (`feeBilled/feeDue/invoiceNo/labTerms/held/feeAwaiting/feeToSend`) |
| `slotStatusLine(r)` | the `Status / updates` sentence for one submission: held advance → lab gone quiet → a FAIL to decide → F.A.R. → invoice to pass to Finance → no test list → awaiting the lab → passed → the residual |
| `sortSlotRows(rows)` | bucket severity, then `attention`, then newest order, then slot no, then MPN |
| `testingView(b)` | the **order-level** roll-up, now used only by the grouped view's header: tallies (`lots/tests/passed/open/far/failed/reports`), attention signals (`unmatched/overdue/gaps`), the fee position (`feeGross/feeCount/held[]`), the **slowest lot** (least-advanced lifecycle — an order moves at the speed of its slowest lot), `atRisk`, `pct`, and `attention` (the count of separate things wanting a human) |
| `nextTestingAction(b, v)` | the one sentence: pay the held advance → raise a lot → match mail → chase past SLA → decide a not-acceptable → close out F.A.R. → parse a test list → send fees to finance → awaiting WHL → nothing pending |
| `sortTestingQueue(rows)` | bucket severity, then `attention`, then newest order |

**Five buckets, and the order they are tested in *is* the semantics** (2026-08-21). Since
2026-08-24 the same precedence is read one altitude down, per submission (`slotRowPressure`) — so a
row is one test slot, not one order:

```
no slot at all                 → NOT_BOOKED   // this part is not at the lab
slot exists, no lot yet        → IN_PROGRESS  // booked; we are waiting on the lab's confirmation
lot testStatus === "FAIL"      → FAILED       // needs a decision now, not when the rest finishes
lot testStatus === "PASS"      → PASSED       // terminal and good
open tests > 0 || attention > 0→ IN_PROGRESS
otherwise                      → COMPLETED    // every result in, but not a clean pass
```

A slot the lab has not confirmed is deliberately **`IN_PROGRESS`, not `NOT_BOOKED`**: it *is*
booked, the wait is on the lab. `testingView`'s order-level version of this precedence is unchanged
and still drives the grouped header. The old order-level rule `b.lots.length === 0 → NOT_BOOKED`
survives as the row-level *"no slot at all"* test.

- **`NOT_BOOKED` first, before anything else.** An order with no lot raised has nothing at the lab, and
  its test list not being parsed yet is the normal state of a fresh order. Without that precedence
  every untouched order claimed to need a human (23 of 24 on the demo seed).
- **`FAILED` outranks open tests.** A FAIL is a decision (retest or return) and the escrow refund
  path hangs off it; waiting for the other lots to finish before surfacing it is the wrong default.
- **`COMPLETED` is the one chip that is a superset, not a bucket** (2026-08-25). As a bucket it was
  the residual — results all in, no FAIL, not every lot PASS: a `MAYBE` lot, an F.A.R. closed out, an
  accepted not-conducted process — and it read `0` next to `Failed 2` and `Passed 4`, which is the
  board contradicting itself: a submission the lab has finished with is completed whichever way it
  came out. `pressureMatches(chip, rowPressure)` now makes the **chip** match `FAILED` and `PASSED`
  as well, while the **row** keeps its own precise pill, and the residual keeps the label for rows
  that are neither.
  - **The counts therefore no longer sum to `All`** — deliberate, and the reason the function carries
    the note. They did while every bucket was exclusive, which made them trustworthy as a partition;
    one chip now answers *"how far along"* at a coarser grain than its neighbours. Narrowing
    `Completed` back to the residual to restore the arithmetic would re-introduce the `0`.
  - The residual is still worth its own rows: folding a MAYBE lot into `PASSED` would let a not-clean
    result pass for a clean one.
- **`HELD` and `ACTION` were buckets and are not any more.** An unpaid advance holding a lot, mail to
  match, a chase past SLA, an unparsed test list — each describes what kind of trouble an *in-progress*
  order is in, and the board-level question is how far along it is. Those signals still drive the row's
  pills, the `nextTestingAction` sentence, the row accent (red for a FAILED bucket, a held lot or a
  phase behind its clock; amber for anything else wanting a human) and the `attention` tie-break in the
  sort, so the worst in-progress orders are still the top rows. Don't re-add them as buckets.

**Columns, and what each one refuses to do** (per-submission since 2026-08-24).
**The part comes first** — `MPN`, `Lot code`, *then* `Order no` / `Buyer` / `Supplier`: a row is one
MPN's submission, so those two are its identity and everything after them is context (which order it
belongs to, who is waiting on it, where it is). Leading with the order number made the table read
order-shaped again, which is what the per-slot redesign moved away from.

- **Order no** — the order number alone, and a **link that deliberately goes somewhere else than
  the row** (2026-08-24): the row opens the one submission that was clicked, the order number opens
  the **whole order** — every part, every test slot, the full mail history. Two questions, two
  targets, and the number is the obvious place for the second. The grouped view's header carries the
  same link, which is why the order number there sits *outside* the collapse button (nesting a link
  in a button is invalid) — the chevron and the party line are the toggle. The supplier PO number sat under it for half a day and cost
  the table more width than the whole `Lab fee due` column, for a reference nobody scans a lab queue
  by; it is on the workspace header.
- **Buyer** / **Supplier** — two columns, not one merged `Buyer → Supplier` cell. They are separate
  questions ("who is waiting on this part" vs "who shipped the samples") and the grouped view is
  where the pair reads as a relationship.
- **MPN** — the part, in the **plain UI face at `text-xs`, not `font-mono`** (2026-08-24): a part
  number is read here as a name, and the mono face rendered its hyphens as minus-like glyphs that
  looked pasted-in against the white row. `whitespace-nowrap`, because a part number broken across
  two lines stops being one token. Sub-line: make · `20/400 sampled`, the share of the ordered
  quantity that actually went to the lab.
- **Test slot** — this submission's own references, the ones the lab quotes back at us: slot no ·
  `re-test of <slotNo>` when it is one · a status pill **only when the status is not `CONFIRMED`**
  (a confirmed slot's state is already told by its stage and verdict, so the pill would be noise on
  the majority of rows) · then lot code · `WO <no>` · the lab. Before a confirmation the sub-line
  says *"lot code with the confirmation"* rather than inventing one.
  - **Submissions are never added together.** Two slots on one order — even for the same MPN — are
    independent: their own samples, work orders and results. That is what the old merged
    *"N test slots · n passed · m failed"* cell got wrong, and it is why the row is the unit now.
  - The confirmation **de-duplicates lot codes and work orders across slots** (suffix `-2`, bump the
    WO), because the mock appointment derives both from the order number and would otherwise hand a
    second slot the first one's identifiers — the collision that made two submissions look like one.
  - **This cell also carries the booking control** (2026-08-24) — `Book test` with no slot, `Re-test`
    on an un-re-run FAIL, **nothing at all on a slot that is simply running** (2026-08-25: the quiet
    ghost `Book again` that used to sit there offered a second submission for a part the lab is still
    working on — a bill for nothing, and it read as if the first submission needed replacing; a real
    second submission is still bookable from the grouped view's order-level control, where picking
    the MPN is a deliberate act rather than a button beside a running test), or
    *"awaiting <slotNo>'s reply"* while `pendingTestSlot` holds the order. It started as a trailing `Book` column and moved here the same
    day: at nine columns the trailing column sat past the right edge of the viewport, so the one
    control a row offers needed a horizontal scroll to reach — and booking is what this column is
    *about* (an unbooked row's entire content is "not booked"). The click `stopPropagation()`s, since
    the row itself is a link into the slot's workspace. Rationale for booking from a board row at all
    (and why it does not contradict the workspace's single entry point) is in §9.3.
- **Lot code** — its own column since 2026-08-24, previously a sub-line under the slot no. The lot
  code and its **work order** are the two references the lab, its invoices and its reports all quote,
  so they are what an operator matches an incoming mail or bill against — that is a column's job, not
  a caption's. The sample figure (`20/400`) lives here rather than under the MPN because the lab
  pulls a sample **per lot**: it is this submission's fact, not the part's. Before a confirmation the
  cell says *"with the confirmation"* rather than inventing a code; with no slot at all, a dash.
- **Lab fee** and **Lab fee due** — **two columns since 2026-08-24**, because *"what did this
  testing cost"* and *"what do we still owe"* are different questions and one figure could only ever
  answer one of them. At row altitude each is a single invoice, since the lab bills per work order.
  - **Lab fee = the cost.** What the lab invoiced on this work order, settled or not — plain text,
    not a pill: a cost is not an alert, and the urgency belongs to the column beside it. Sub-line is
    the invoice no, plus `· advance` **only** when the terms are ADVANCE, the case that can hold a
    lot; `CREDIT` changes nothing about how the row is read and the due column says the rest.
  - **`none due` vs `awaiting`.** The lab bills *after* it issues the report, so for most of a lot's
    life there is no invoice to state — and that is not the same as owing nothing. A lot that is
    unpaid and carries no invoice (`feeAwaiting`) reads **`awaiting` and nothing else** (2026-08-25):
    the explanatory *"bills after report"* line under it was explaining the pill to a reader who had
    already understood it, on every unbilled row. `none due` is reserved for the only case that earns
    it — nothing at the lab.
  - **Lab fee due = the worklist figure. A dash, never a zero, while no invoice has arrived** — the
    amount is unknown, not nil, and a `0` there would read as "nothing to pay". It briefly repeated
    the cost column's `awaiting` pill instead (2026-08-25) and went back to the dash the same day:
    two identical cells side by side spent this column on a state the column to its left already
    reported. The pill lives in one place, the dash means "ask that column". Billed and paid reads
    `settled · nothing owed`, which is the whole reason the cost column exists. **Held outranks the figure**: an unpaid *advance* means the lab is
    sitting on the parts, so the amount goes red with a lock and the sub-line says `advance — lot
    held`; otherwise the sub-line says whether the invoice is with Finance yet.
  - The order-level roll-ups these columns used to show (`labFeeBilledTotal` /
    `labFeeOutstandingTotal`, `across N invoices`, `· N awaiting`) are unchanged in `selectors.ts`
    and still used by the workspace and the board's own attention card. They are just not what a row
    reports any more.
- **Row colour is the bucket** (2026-08-25) — `bad` for `FAILED` **and for a held lot whatever
  bucket it sits in** (an unpaid advance means the parts are off the bench), `ok` for `PASSED`, `warn`
  for `IN_PROGRESS` and for the `COMPLETED` residual, and **no tint at all for `NOT_BOOKED`**: nothing
  has happened yet, so no colour should claim otherwise. Before this only rows wanting a human were
  tinted, which left a passed slot and an unbooked one looking identical — both plain — though one is
  finished and the other has not started. `DataTable`'s `rowAccent` gained `"ok"` for it.
  - `rowMuted` is **gone**. It dimmed passed rows so live work read first, but green already says
    *done and good*, grey text on a green ground reads muddy, and the sort puts `PASSED` last anyway,
    which is what the dimming was really for.
  - The order's phase clock (`atRisk`) is deliberately **not** in the accent: it would paint every row
    of that order, passed ones included. It keeps its `behind clock` pill in the status cell.
- **Status / updates** — renamed from *"Action to perform"* (2026-08-24): at slot altitude most rows
  are **reporting** where the submission has got to and only some are asking for something, so a
  column called "action" mislabelled the majority of its own contents. Carries the bucket pill, the
  lifecycle stage, an `F.A.R. follow-up` pill for a `MAYBE` verdict, `behind clock` for the order's
  phase clock, then `slotStatusLine(r)` and a `n/m tests passed · n open · n F.A.R. · n reports`
  tally line.

**Two cuts of the same rows** (2026-08-24) — the same two-views-one-dataset shape the Payments board
uses, never a second implementation: one `filtered` array, one predicate, one set of columns.

- **All test slots** (default) — every submission across every order, worst first. This is the cut
  that answers *"what does the lab desk do next"*, which is not an order-shaped question.
- **Group by order** — the same rows stacked under a collapsible order header. The header carries
  what is genuinely order-level and therefore has no row of its own: the parties, the worst bucket
  among its rows, the slot count, the unmatched-mail count, `nextTestingAction`'s order-level
  sentence, and a **`Book test slot` button** — one appointment can carry several parts, and that
  booking belongs to the order, not to any one of its rows. **The three party columns are dropped inside a group**, because the header just said all
  three. Pagination switches unit with the cut: 20 rows/page flat, 8 order-groups/page grouped.

**One section: the queue.** A second `Lots at the lab` table across every order was built and
removed on 2026-08-21 — and the per-slot redesign is what that table was reaching for, done as the
board's own unit instead of as a tail on it. Don't re-add a second table.

```
┌ attention cards (only when non-empty; board-wide facts, invisible in a per-row table) ──┐
│ ✉ "N WHL emails await matching" — the WHOLE CARD links to /fulfilment/testing/inbox     │
│    (§9.5a): every unmatched mail vs every test slot on every order. NO order            │
│    numbers on it — which order it belongs to is what the inbox is for                   │
│ 🔒/🧾 "{cur} {total} owed to WHL across N invoices" — advance ⇒ names the held lots,     │
│        credit ⇒ "owed, but nothing is blocked"; links to Payments ?tab=whl               │
└─────────────────────────────────────────────────────────────────────────────────────────┘
┌ Panel "Test slots · N" ─────────────────────────────────────────────────────────────────┐
│ chips: [All] [Failed] [In progress] [Not booked] [Completed] [Passed]                    │
│        …right: [▤ All test slots | ⧉ Group by order]  search: order, party, MPN, slot, WO │
│ columns: MPN | Lot code (+ WO, sampled) | Order no | Buyer | Supplier | Test slot         │
│          (+ Book test / Re-test only) | Lab fee | Lab fee due | Status / updates          │
│          (Order no / Buyer / Supplier are dropped inside a group, which leaves the part    │
│           leading there too; the group header adds an order-level [Book test slot])        │
│ rowAccent IS the bucket (2026-08-25): bad = FAILED or a held lot · ok = PASSED ·          │
│ warn = IN_PROGRESS or COMPLETED · nothing = NOT_BOOKED. No rowMuted any more.              │
│ whole row → /fulfilment/testing/[orderId]?mpn=<mpn>[&lot=<id> | &slot=<id>]                │
│ pagination 20 rows/page · 8 orders/page grouped                                           │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 9.1 Shell — the testing workspace (`/fulfilment/testing/[orderId]`)

**Scoped to one submission on arrival (2026-08-24).** The board's rows are submissions, so a click
carries **`?mpn=<mpn>` always**, plus `&lot=<lotId>` — or `&slot=<slotId>` while the lab has not
confirmed the booking and no lot exists to point at. The screen opens on **that submission's
journey**: its stages, its report, its fee, its mail. Showing the order's other parts there would
answer a question nobody asked by clicking one row, and the records are already kept per lot, so
nothing has to be re-derived to do it.

**Three tiers, narrowest first — `lot` → `slot` → `mpn`.** The `mpn` tier was added the same day and
is the one that closed the actual hole: a row with **nothing booked** has neither a lot nor a slot,
so the two narrower tiers had nothing to bind to and the click fell through to the whole order —
click one part, get the part list. The part is what was clicked, so it is on every link and is the
floor of the scope. Scoped by part, `LotsSection` renders that MPN's section and nothing else, however
many lots it carries, and the note reads *"Filtered to `<mpn>` — the order's other parts are on the
whole-order view."*

- `TestingTab` gained `focusLotId` / `focusSlotId`. `focusLotId` **seeds the existing scope state**
  (`useState(focusLotId ?? "ALL")`) rather than adding a second scoping mechanism — the lot selector
  in the toolbar is still the one control, and widening to the whole order is one click on it.
- `focusSlotId` is the pre-confirmation case and narrows by **the slot's own MPN lines** instead
  (`onlySlotId` on `LotsSection`): it has no lot to filter by, and the order's whole part list would
  bury the one booking that was clicked.
- All three are **verified against the order** before use, so a stale id or part after a demo reset
  falls back to the whole order instead of scoping the screen to nothing.
- A strip under the header names what is on screen — *"Showing one test slot: `MPN · slotNo · lot
  code · WO`"*, or *"Showing one part: `MPN`"* when nothing is booked — and links to
  `show the whole order — N testable parts, M test slots →`. Scoping is a starting point, not a cage — and it has to be
  visible, or the screen silently shows a subset of what the order has.
- The **bulk bar and the per-card tick key off the count *in view*, not the order's** (`lots.length`,
  not `b.lots.length`): arriving on one slot leaves nothing to select between, so both would be
  controls with one possible outcome.
- The section switcher's **fee badge follows the scope** too (`feeBadge`, off the scoped lot rather
  than `labFeeOutstandingTotal(b)`): scoped to one submission, the order roll-up reported another
  lot's unpaid invoice on a section about this one — exactly the merging the board stopped doing.
- **Communication follows the scope and cannot be widened from inside it** (2026-08-24). `MailSection`
  takes the whole `scope` (`{lotId, slotId, mpn}`) rather than a default lot id, and:
  - the **lot `<Select>` on `Correspondence & tracking history` and on `Result circulated` is gone**
    while a scope is set, replaced by *"only `<lot · MPN>` — the order's other threads are on the
    whole-order view"*. A picker there let a screen opened on one test slot read the order's entire
    mail history, which is the question the click did not ask. Unscoped, both selects return.
  - the composer's **`About` field is static text** when the scope is a lot (a picker would let a
    screen about LOT-A file a mail against LOT-B) and narrows to the scope's lots otherwise.
  - **booking mails have no lot** — the lot does not exist until the lab answers — so scoped they are
    matched by the mail's own `mpn`, or failing that by the slot that names it as its
    `requestEmailId`/`confirmEmailId`; on the whole-order view they show in every list as before.
  - the **manual match queue is no longer on this tab at all** (2026-08-25): it was the one panel that
    had to ignore the scope, which was the clue it belonged elsewhere — it is now the board-level WHL
    inbox screen (§9.5a), where an unmatched mail can be filed against any slot on any order.
- Arriving with no parameter — the attention cards, an older link, the order workspace's own Testing
  tab — still opens the whole order, unchanged.
- The route reads the params with `useSearchParams()`, so its component sits under `<Suspense>`; the
  production build refuses the page otherwise. Same wrapper and same reason as the Logistics queue.

**Rebuilt twice on 2026-08-21.** It began as one full-height panel titled *"WHL testing — MPN × lot ×
test"* holding the scope banner, six stat tiles, a caption, the alert stack, the bulk bar, a
nine-column lot roll-up table and two escrow notes — everything above the sub-tabs, so the work sat
below the fold and the sub-tabs read as furniture. The first pass split it into an overview strip, a
`Needs attention` panel and a `Lots at the lab` panel; the second removed the roll-up entirely and
put the sections first. Current shape, top to bottom:

```
┌ order header + phase notices (at-risk / mark-returned-to-supplier) ─────────────────┐
└─────────────────────────────────────────────────────────────────────────────────────┘
  9/14 tests passed [▬▬▬▬░░] · 3 lots · 3 reports (4 open) (1 F.A.R.) (🧾 fee unpaid)
       …right-aligned: [lot scope ▾] [Check mail]        (no [+ Add lot] since 2026-08-25 —
                                                          booking is board-only, §9.3)

  WORK THE ORDER
┌──────────────────────┬───────────────────────────┬────────────────────────┐
│ ▤ Testing overview   │ ⚗ Lots · status & actions │ ✉ Communication        │
│              1 gap   │                 1 fee due │            1 to match  │
│ Where the order      │ Each lot's lifecycle,     │ Every stage arrives as │
│ stands, and what the │ reports, verdict and lab  │ mail: the thread, the  │
│ PO requires per MPN  │ fee — with its actions.   │ templates and the match│
│ × lot — with what    │                           │ queue.                 │
│ the lab charges.     │                           │                        │
└──────────────────────┴───────────────────────────┴────────────────────────┘
┌ the active section's content ───────────────────────────────────────────────────────┘
```

**There is no "Needs attention" panel** (removed 2026-08-21). It stacked six alert kinds —
reconciliation, SLA overdue, autofill gaps, unmatched mail, fee-held, fee-owed — between the
sections and the work. Every action on it already existed on the thing it was about, so the panel
was a second copy of controls rather than the only way to reach them:

| the alert offered | where that action lives |
|---|---|
| `[Reconcile to PO on file]` | the report's own row in `ReportRepository` — `[Set to {poOnFile}]` |
| `[Chase again]` | the lot card's `[✉ Request update]` |
| `[Escalate]` | the lot card's `[✉ Escalate TAT]`, and `[Mark escalated]` on the mail row |
| `[Review MPNs]` / `[Open match queue]` / `[Open lots]` | the three section cards, which carry the same counts as badges |

The **signals** still surface where they belong: the section badges (`gap(s)`, `held`/`fee(s)`,
`to match`), the lot card's collapsed summary (verdict · tests · stage · report · fee · blocker),
the fee panel's terms + held state, and the phase notices above. The cross-order versions live on
the Testing board's attention cards (§9.0a). Don't rebuild the panel.

**Reading the booking appointment is a per-lot action only** (2026-08-21). The header briefly carried
an order-wide `⬆ Upload booking appointment` + `Auto-fill from booking` pair, and a copy also sat on
the lifecycle chain at `TEST_BOOKED`; both were removed. Labs book per lot, so the document an operator
holds belongs to a lot, and the controls live on that lot's action row (§9.3) — the one place every
other per-lot control already lives. `uploadBookingAppointment` keeps its optional `lotId` (order-wide
is still expressible in the store) but **no surface calls it order-wide**.

**Lot *creation* from an appointment lives in the Add-lot modal** (§9.6), which is where it belongs —
raising lots is that flow's job. So `[+ Add lot]` offers both "read the appointment" and "type it in",
and the per-lot controls (§9.3) are for re-reading an appointment against a lot that already exists.
Don't put an order-wide reader back on the header.

**The sections come first.** They are the screen's navigation, and anything above them is something
a reader has to scroll past to reach the work. Only the order-level controls ride above (lot scope,
Check mail), because they are needed whichever section is open. Do not put another panel
between the header and the switcher.

**Two sections, and no roll-up metrics** (2026-08-21). The header briefly carried a metrics row —
`n/m tests passed` + bar, `N lots · N reports`, and pills for open / F.A.R. / not-acceptable / fee
unpaid — and there was a third section, **Testing overview**, holding `TestingOverview` (scope banner,
six stat tiles, caption, escrow notes) above the per-MPN requirement cards. Both are gone: every
number in that row is already on the lot rows below, where the lot it belongs to is *named*, and a
section whose whole job was restating them is a page you scroll past.

**The switcher is a segmented control** — the same one the app header uses for personas
(`inline-flex … rounded-lg border bg-background p-0.5`, each tab `rounded-md px-3 py-1.5`), so it
reads like the rest of the console instead of like a feature of its own. It sits on **one row with the
order-level controls**, tabs left and controls right; there is no "WORK THE ORDER" heading any more.

It has been three things, and the reasons are worth keeping: an **underlined tab strip** (lost between
the panels above and below — people missed that Mail existed), then a **grid of description cards**
with an icon and a line of explanatory text each (found, but at two sections they read as banners and
dwarfed everything around them), now this. The **filled** active tab is the one thing carried through
all three; keep it. Each tab is icon + label + a **badge** when something in that section wants
attention (`held`/`fee(s)` on lots, `to match` on Communication); the hint text survives as the
button's `title`; badge labels arrive ready-pluralised — never auto-suffix an "s" (that produced
"to matchs").

**There is no lot roll-up table.** The nine-column `lotResults` table was a second rendering of the
lot cards in §9.3 and was deleted — §10's "one test list, rendered twice" applies to lots too. What
it carried moved rather than vanished:

| the table had | where it lives now |
|---|---|
| the **bulk bar** | top of the **Lots** section, above the cards — the actions are about lots and that is where the lots are. Shown only when the order has more than one lot. Now just `SELECT LOTS · tick the lots below, then pick an action · [clear] · N selected · [Next actions ▾]`: the quick-select presets (`all` / `with report` / `acceptable` / `not acceptable` / `F.A.R.`) were removed 2026-08-21, since the ticks on the cards are the selection and five preset filters on top of them was a second way to do the same thing. |
| the per-row **checkbox** the bulk bar acted on | on each **`LotCard`** title row (`stopPropagation` so ticking never expands the card), and **only when the order has more than one test lot** — with a single lot the selection does nothing the lot's own actions don't, so the tick is noise; the bulk bar hides on the same condition |
| the **Progress** cell's `LotProgressToggle` → inline lifecycle stepper | the card's own stepper (§9.3a) — deleted here, it was the same component |
| verdict · tests · fee · report · outstanding | the card's collapsed **summary row**, which already showed all of it |
| **click-a-row-to-scope** | the lot selector in the top toolbar, which always did the same thing |

Default section: **Lots · status & actions**.

### 9.2 PARKED — MPNs · tests · fee

**Not mounted anywhere as of 2026-08-21.** The Testing-overview section that rendered this was removed
from the workspace (§9.1), which took with it the only surface for:

- the **requirements × lots matrix** (`MpnTestMatrix`, still exported from `test-tables.tsx`),
- **deleting a requirement** by hand (`removeMpnTest` — still in the store, audited). *Adding* one
  came back on 2026-08-21 through the Add-lot form's test-plan checklist (§9.6), which writes to the
  MPN's spec as well as the lot,
- the per-MPN **spec metadata** (`sourceDoc`, `parsedAt`, `confidence`, auto-vs-manual counts) and its
  **audit trail**,
- the per-MPN **fee strip** (`MpnFeeStrip` — still mounted on the read-only order-flow rendering).

What survived: a lot's tests are still listed and settable per lot (`LotTestTable` inside the lot card,
§9.3), and the test plan still arrives from the booking appointment (§6, §7.7). So the module is not
broken — it has no MPN-level *view*. The spec below is kept verbatim for whoever brings it back; if it
is decided it never returns, delete this section, `MpnTestMatrix`, and the two store actions together.

<details><summary>Original §9.2 spec (kept for reference)</summary>



Intro line: *"Test requirements are **read off the lab's booking appointment**, never typed — that
document is what the lab agreed to run, on which lots, with which samples.
Manual edits are allowed as an override and every one is logged (who · when · before → after).
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
  `Required test (+standard) | Source (from booking / manual + addedBy·addedAt) | Rate | <one column per
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

</details>

### 9.3 Sub-tab — Lots · status · reports

One **collapsed-by-default** card per lot (only the scoped lot when filtered, with a note explaining
the filter) — see §9.7 for the collapse rules:

- **title** (always visible): flask icon · lot code · MPN (mono) · `lab · WO n · qty N / sample M · DC x`
- **summary** (always visible — enough to spot the lot that needs attention among a hundred):
  verdict pill · `n/m tests` · current lifecycle stage + `n/9` (green when complete) · report no
  (or amber `no report`) · blocker pill (`not acceptable` / `F.A.R.` / `not conducted`) · **fee pill
  when the fee is outstanding: `🔒 held — advance fee` (bad) when the lab is holding the lot, else
  `fee unpaid` / `fee with finance` (warn)** · clock icon when a WHL reply is outstanding
**Grouping — `Group by MPN` (default) / `Flat list`** (segmented control on the section's expand bar;
2026-08-21). One MPN routinely carries several test lots — date codes, re-tests, split reels — and
*"how does this part stand"* is the question the section is opened with, so grouping is the baseline
and the flat list is the alternate cut. **The lot cards are identical either way; only the grouping
changes.**

**Grouped mode is driven by the order's testable LINES, not by which MPNs have lots.** A part with
nothing booked yet still has to appear — *"which of my parts has no test lot"* is the question this
view answers, and an MPN that vanishes until someone books it cannot answer it — so it shows with an
empty note: *"No test lot for this MPN yet — book a slot with the lab, and its confirmation creates
the lot."* An MPN that somehow has lots with no matching line is appended so nothing is hidden.

**Booking has left this screen, with one exception (2026-08-25).** There is no `Add test slot` and no
`Book test slot` / `Book another test slot` header button: **booking lives on the Testing board**,
where the queue of orders and test slots is. The one control that stays is **`Book re-test` on a lot
whose own verdict is `FAIL`** — that is not "book a test", it is the decision a failed result forces
(re-test or return), and it is taken where the failure is being read, on the card that shows the
report. Precisely gated:

- **the lot's own `testStatus === "FAIL"`, not its slot's.** LOT-KS-2 sharing submission TS-0153-1
  with a failed LOT-KS-1 has not failed, and offering to re-run it would re-screen a good part at our
  cost. The first cut of this used a slot-wide check and did exactly that.
- **not already re-run, per part** (`rebookedFor`): a later slot with `retestOfSlotId === this slot`
  **whose lines include this MPN**. Slot-wide was wrong here too — re-running one part of a
  two-part submission says nothing about the other, and hid a re-test the second part still needed.
  `TestingSlotRow.rebooked` on the board was fixed the same way.
- the modal opens as a re-test **against that slot and preset to that part** (`retestOfSlotId` +
  `presetMpn`), so the lab is cited its own appointment and work orders and the part cannot drift.

Everything else — a first booking, a second slot for a part that already has one, an order-level
appointment carrying several parts — is board-only. The
history is worth keeping because it went back and forth: per-MPN buttons on the workspace's own MPN
headings were removed 2026-08-24 (from inside the order the form already picks its own MPNs, so a
per-line variant was a second way in with nothing to add), the board then gained per-row booking the
same day (a board row *is* one MPN, so its button knows the part), and once the board could do it
per part, per order and as a re-test, keeping a second set of controls here meant two places to keep
honest for no gain. The section header now **says where booking went** —
`Book a test slot on the Testing board →` — rather than going quiet; while a slot is `REQUESTED` it
still reads *"<slotNo> is still with the lab — one booking at a time."*

The board covers all of it (§9.0a): `Book test` on a row with no slot, `Re-test` on an un-re-run FAIL
(the same act as the lot card's, from the queue side), and the grouped header's order-level
`Book test slot` — which is also the only way to open a *second* submission for a part that already
has one, since a running slot offers no booking control of its own. **`AddLotModal` is therefore
PARKED** — nothing mounts it. It is kept rather than deleted because re-reading an appointment
against an *existing* lot is still live (the lot card's `⬆ Booking appointment` picker, same
`uploadBookingAppointment` action) and because hand-entering a lot is the obvious escape hatch if the
mail path ever fails. **Consequence to accept, not to paper over:** with it unmounted there is no
hand-entry path for a lot or for a hand-typed test plan while §9.2 stays parked — a lot now only ever
comes from the lab's confirmation. Whoever brings it back: mount it somewhere that is not a second
booking entry point.

**The Testing board books per row and per order (2026-08-24, and it is not the same decision.)**
Booking from the *board* was asked for the same day and it earns its place, because a board row **is
one MPN's submission**: the button knows which part it is booking and opens the modal with that part
already picked (`presetMpn`), which is precisely what the workspace's per-line buttons could not
offer. Three acts, and they are distinguished on purpose — `Book test` on a row with no slot,
`Re-test` on a FAIL nobody has re-run (`retestOfSlotId`, so the lab is cited its own appointment and
work orders), and — since 2026-08-25 — **nothing on a slot that is merely in progress**. A second
submission for a part that already has one is still legal (one line, two date codes, two
submissions) but it is an order-level decision, not a button beside a test the lab is still running. The grouped cut adds the **order-level** booking in its header, which is the workspace's
control in the workspace's place. All of it obeys `pendingTestSlot` — while the lab has not answered
a request the button becomes *"awaiting <slotNo>'s reply"*, because there are no work orders to act
on and the desk books one at a time. See §9.0a for where the controls sit.
Each MPN heading carries: the MPN (mono) · its testing-mode pill · `N test lot(s)` · make · order qty ·
`sampled X of Y` (summed across its lots) · and a right-aligned verdict roll-up (`n pass` / `n maybe` /
`n fail` / `n pending`, only the non-zero ones). MPN order follows the order's own lines, so the
grouping reads like the PO.

- **actions** (only when expanded): `[⚡ Next actions ▾]` (disabled until a report exists) ·
  **`[⬆ Booking appointment]`** · `[Fetch report | Fetch revision]` · `[Email WHL]`
  - Once the stage is `REPORT_SHARED` or later, two more appear: **`[↩ Returned to seller]`** (ghost,
    hidden once `returnedToSellerAt` is set) and **`[🚚 Assign to logistics]`**, which becomes a green
    `✓ Assigned to logistics` pill. The assign click **completes the chain** (stage 9) as well as
    queueing the lot on the Logistics board — see §9.8. Assigning without recording the return is
    allowed: `moveStage` is forward-only and skipping is legal, so a desk that only tracks the
    hand-off is not blocked by a stage it never observes.
  - `[⬆ Booking appointment]` and `[Auto-fill]` (ghost) are the **only** ways in — there is no
    order-wide reader (§9.1). `[Auto-fill]` runs the identical parse with no file, scoped to this lot:
    the demo path, and the seam the real lab feed replaces.
  - `[⬆ Booking appointment]` is a per-lot file picker (`lot-booking-appt-{lot.id}`, hidden
    `<input type="file" accept=".pdf">`, `e.target.value` cleared so re-picking the same file
    fires again) calling `uploadBookingAppointment(orderId, file, lot.id)` — **scoped to this
    lot**, because labs book per lot and applying LOT-B's appointment must not touch LOT-A.
    Scoping also narrows what goes to the parser to that lot's own line, so a re-read can never
    invent lots for lines nobody has booked. Role-gated on `canEditTests`.
  - Five controls is why `CollapsibleCard`'s title carries `min-w-[18rem]`: without it the title
    shrinks to a stack of wrapped words instead of pushing the action row onto its own line.
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
  refund path"*; right side: the `awaiting WHL reply` chip and context buttons —
  `[Request update]` when no report,
  `[Escalate TAT]` when awaiting.

### 9.3a Testing lifecycle stepper (per lot)

Deliberately the **same visual shape as the order's Journey stepper**, so the two read as one idea at
different scales: reuse the host's stepper markup rather than inventing a second treatment.

**A lot walks the stages that apply to it, not all nine (2026-08-25).** `RETURNED_TO_SELLER` is now
**opt-in at booking**: `TestSlotLine.returnToSeller` (a per-MPN checkbox in `BookTestSlotModal`, *"Return
samples to the seller — adds the return stage to this lot's lifecycle"*, unticked by default) is copied
onto `Lot.returnToSeller` by the lab's confirmation. `lotStages(lot)` filters the canonical nine down to
what the lot actually walks, and `lotStageProgress` counts `total`/`done`/`pct`/`next` over **that**
list — so an unticked lot reads `1/8 stages` with no return node, and a ticked one reads `1/9` with it.
Verified both ways on the demo seed.

- **Why opt-in:** a screen can be destructive and plenty of lots are consumed or scrapped rather than
  shipped back. As a fixed stage it claimed a step most lots would never reach, which left every
  chain looking permanently unfinished.
- **`lotReturnsToSeller(lot)` is `returnToSeller === true || !!returnedToSellerAt`** — a lot that
  already carries the stamp shows the stage whatever the flag says. Never hide something that
  demonstrably happened, including on lots booked before the flag existed (which is also why no store
  version bump was needed: the field is additive and its absence is a meaningful default).
- **`idx` stays an index into the canonical nine** — that is what `stageIdx`, every stored
  `stageHistory` row and the forward-only `moveStage` are keyed on. Display maths counts over
  `stages`, and "current" is the **next applicable** stage rather than `idx + 1`, which could land on
  a stage the lot skips. Both steppers (`TestingStageBar`, `TestingStageChain`) render `stages`.
- The lot card's **`Returned to seller` action is gated on the same predicate** — with no return
  asked for, there is nothing to record.
- The booking mail states it only when ticked (*"After testing: please return the samples to the
  seller."* in that MPN's block); silence means we are not expecting them back.

```
┌ Testing lifecycle · 6/9 stages                    [◉ Next: Payment to WHL ·         ┐
│                                                       waiting on 1Buy]              │
│   ✓────✓────✓────✓────✓────✓────◉────⑧────⑨                                        │
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

- **Nodes**: `done = i <= idx` — filled primary with ✓ · `current = i === idx + 1` — primary ring +
  that stage's icon · future = muted outline with its index number. Half-rails either side, coloured
  primary up to and including the stage reached.
  - **The stage a lot is AT renders as done, and the ring sits on the one after it** (fixed
    2026-08-24). Every stage in this chain is a **past-tense fact** established by a mail — *Test
    Booked*, *Components Received by WHL*, *Test Report Shared* — so treating `lot.stage` as
    "in progress" meant a stage only ticked once the *next* one happened: booking a test showed
    incomplete until the supplier dispatched, and the whole chain read one step behind the truth.
  - Same rule in the compact `TestingStageBar` (`i <= idx` filled, `i === idx + 1` primary) and in the
    header pill, which now names **what is being waited for** — `Next: <label> · waiting on <owner>`
    — falling back to `At: <label>` only on the terminal stage. `waitingOn` was already the *next*
    stage's owner, so it was the pill's label that disagreed with it, not the data.
  - The one node whose truth is not positional is still `WHL_PAYMENT`: an unpaid fee paints it
    warn/bad regardless of index, because on credit terms the chain runs past it while the money is
    still owed.
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

**Compact variant** (`TestingStageBar`) — 9 thin segments + `<stage label> n/9 · waiting on <owner>`.
Used in the scope banner and on the cross-order testing board, one row per lot.

### 9.3b WHL invoice & payment (per lot)

**The panel is hidden until the report is out** (2026-08-24), and that is enforced on **both sides**:

- **UI:** `if (stageIdx(lotStageProgress(lot).stage) < stageIdx("REPORT_SHARED")) return null` — the
  whole money block (request · upload · download · send-to-finance · mark-paid) belongs to the
  `WHL_PAYMENT` stage, and rendering it from the moment a work order existed put an *"Invoice not
  requested"* notice on every live lot for weeks.
- **Adapter:** `whlPollInbox` withholds the `INVOICE` mail until the lot is at `REPORT_SHARED`
  (`if (!wo.hasInvoice && at >= stageIdx("REPORT_SHARED"))`). It used to bill on booking, so
  `Check mail` pulled an invoice in at stage 1 and the panel appeared with it. **Fixing only the UI
  would have meant hiding data the app already held** — the two now agree. The no-invoice copy reads *"The report is out, so the lab can bill: **Request
invoice** asks for it, and it arrives on the WHL thread with its own terms. Already have it by another
medium? **Upload invoice**."* — it used to say the lab bills on booking, which is the model this
module no longer follows.

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
- **No invoice yet** → the copy says so and offers `[✉ Request invoice]` **and `[⬆ Upload invoice]`**; if
  already requested it states *"it arrives on the WHL thread, so **Check mail for updates** pulls it in,
  terms and all. If it never lands, **Upload invoice** takes it by hand."* Otherwise: *"…that mail is what
  tells us whether this work order is advance or credit. Came by another medium? **Upload invoice**."*
- **`[⬆ Upload invoice]` / `[⬆ Replace invoice]`** (role-gated, ghost once an invoice exists) is a
  **plain file picker — no modal** (2026-08-21). It is a `<label htmlFor>` over a hidden
  `<input type="file" accept="application/pdf,.pdf">`, one per lot (`lab-invoice-{lot.id}`, so two open
  lot cards never share an input), and the handler clears `e.target.value` afterwards so re-picking the
  same file fires again. Choosing a PDF calls `uploadLabInvoiceFile` (§6.x) directly and the panel
  re-renders — the operator has the lab's PDF, and that PDF is the entire input. It replaced a
  thirteen-field hand-entry modal; do not put the form back, and in particular never ask an operator to
  *choose* `terms` (§10). This is still the way out when the lab's mail never arrives, never parses, or
  the bill came by WhatsApp/phone/portal — without it the fee track dead-ends at *invoice requested* and
  on advance terms the lot stays held with nothing anyone can do. An uploaded invoice carries the
  **`entered by hand`** pill beside the status and its amount line reads
  `received <at> · by hand via uploaded PDF`.
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
  - **no parse-flag notices** (removed 2026-08-25). `WhlReport.parseFlags` used to render as a stack of
    amber `Notice`s above the field grid — *"Client P/O came back as “PO Unknown” — reconcile against
    the PO on file."*, *"One or more processes were Not Conducted or inconclusive…"* — with a
    `[Set to <PO on file>]` reconcile action on the first. **Nothing is hidden by dropping them:** every
    discrepancy they announced is already **on the field it is about**, one line below — the client P/O
    renders amber when it reads `PO Unknown`, an MPN that disagrees with the lot renders red, a lot qty
    that disagrees carries *"(lot on file N)"*, and a not-conducted or inconclusive process is a row in
    the test tracker with its own status. The banners restated all of it in prose, above the data, on
    the one panel whose job is to hand over the document. `parseFlags` stays on the model, and
    `reconcileReportPo` stays in the store, for whoever wants either elsewhere.
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

### 9.5 Section — Communication (mail drives every stage)

Named **Communication** (2026-08-21, was "Mail (drives every stage)") because it now covers every
outbound line from this order, not only the WHL thread: the lab correspondence *and* the record of who
has been told each result.

Named for what it does: this thread is the lifecycle's driver, not an archive.

0. **Panel "Result circulated · N lots with a report"** (`ResultCirculated`) — **moved here from inside
   every lot card** (2026-08-21). Circulating a result *is* communication — the same act as the thread
   below it, just aimed at the supplier, the buyer, the escrow provider or the lab — so the section that
   owns outbound mail owns this too, and the lot card stays about the lot's own testing. **Its own lot filter** in the panel actions (`All lots with a report (n)` + one option per
   such lot, shown only when there is more than one) — seeded from the header's lot scope and
   independent afterwards, because *"who was told about LOT-B"* is a different question from
   *"what did we say to the lab about LOT-B"*, and sharing the Correspondence panel's select made
   answering one of them change the other. One block per lot **that has a report** (nothing to
   circulate before one exists): lot code · MPN · report no, the four party pills (`Supplier`/`Buyer`/`Escrow`/`WHL` — `ok` with
   a ✓ and `· <at> · report attached` when sent, `bad` on FAILED, `neutral` + *"· not notified"*
   otherwise), and a `Show history (n)` toggle over the message-by-message trail (`at · party → to ·
   subject · attachments`, with the failure note in `bad`). Empty: *"Nothing to circulate yet — a lot
   needs a report before its result can go out."* **Sending is still `Next actions` on the lot**; this is
   only the record, and the panel says so.
1. **Panel "Write to WHL" — an OPEN composer, not a button that opens one** (2026-08-24). Modelled on
   the Logistics desk's *"Communication on this order"*
   (`components/logistics/logistics-communication.tsx`): a real mail head sitting at the top of the
   thread, typed into directly, because the mail *is* the work here and a modal put a click in front
   of it every time.
   - **To** (defaults to `WHL_CONTACT`) · **CC** (comma-separated) · **About** — a lot `<Select>`
     (`No specific test lot` + one option per lot) which is what `sendLabEmail`'s `lotId` files the
     mail against, so it lands on that lot's tracker instead of the match queue.
   - **Template chips fill the form in place** rather than opening a modal — which is what they were
     always for. The active chip is highlighted; `whlTemplate(id).subject/body` are built from
     `ctxFor(lot)` (MPN, lot code, qty/sample, work order, client P/O, report no, lab, date code), and
     **every field stays editable** afterwards. Re-picking the lot re-fills a *templated* mail and
     leaves a hand-typed one alone.
   - **Subject** · **Message** (8 rows) · `[✉ Send to WHL]` (disabled until both are filled) ·
     `[Check mail]` · a `clear` link once anything is typed · the role note when gated.
   - Sending resets the form. `ComposeWhlEmailModal` still exists and is still the way in from a
     lot's own `[Email WHL]` button — that entry point carries lot context from elsewhere on the
     page, so a modal is right there.

2. **The manual match queue is NOT here any more (2026-08-25)** — it is a board-level screen,
   `/fulfilment/testing/inbox` (§9.5a). It sat on this tab as *"WHL inbox — manual match queue"* and
   was wrong here twice over: an unmatched mail belongs to no test slot **by definition**, so a tab
   scoped to one submission could never be where it is resolved (it was the one panel that had to
   ignore the scope), and its dropdown could only offer *this order's* lots — while an unroutable mail
   is precisely the one whose order cannot be trusted. `MatchLabEmailModal` is parked with it. The
   Communication tab's `to match` **badge went too**: a badge pointing at a queue this tab no longer
   holds would send the reader to a section with nothing to do about it.
3. **Panel "Correspondence & tracking history — every party"** — **one merged list** (2026-08-21):
   the lab's `labEmails` **and** every party notification off `lot.notifications` (supplier, buyer /
   client, escrow, WHL, finance), sorted newest-first into one row shape (`ThreadRow`). Three stores,
   one question — "what has been communicated?" — so they are merged here rather than leaving two of
   them elsewhere on the page. A notification renders through `NotifyRow` with the **party** as its
   kind pill and `to <address>` under the subject; booking mails have no lot and show `order-level`.
   Lot filter `<select>` (defaults to the header's scope,
   still overridable), then the newest-first thread as a **table**, one row per message:

   | When | Direction | Kind | Lot · MPN · WO | Subject | Status | Files | By |
   |---|---|---|---|---|---|---|---|
   | timestamp | `sent`/`received` pill | **kind pill** | lot code over `mpn · WO n` | subject + a 1-line body preview | status pill | attachment names | author, and `matched by x` beneath |

   Kind pills are `invoice` warn · `payment` ok · `dispatch` info · `report` ok — the kinds that moved a
   stage; `STATUS_UPDATE` and the outbound kinds show `—`, because the subject already says it.
   A timeline of cards came before this and read worse: the eye had to re-find the date, the direction
   and the lot inside each card, when what the operator does here is scan a column.

   **Clicking a row** opens the full body in a spanning row underneath (`colSpan={8}`), which is also
   where `[Mark escalated]` sits for outbound mail still awaiting a reply. The preview line is dropped
   while a row is open so the body isn't shown twice.

   Caption: *"This thread is what drives the lifecycle. Everything to and from `<lab>` lands here against
   its lot — the invoice and its payment terms, the supplier's dispatch advice, receipt confirmations,
   interim updates, the payment acknowledgement and the report — and each one moves the stage it
   establishes. Click a row to read the message in full."*

   **Only the 8 most recent messages render** (`RECENT_MAILS`). The rest sit behind
   `▸ Show N earlier message(s)` / `▾ Hide the earlier N message(s)`, and the footer states where you
   are: *"Showing the 8 most recent of N."* → *"Showing all N."* once expanded — a footer that still
   claims truncation after you've expanded is just wrong. Eight is a table-row budget, not the two a
   clamped-paragraph card could afford.

### 9.5a Screen — the WHL inbox (`/fulfilment/testing/inbox`)

**Where unroutable lab mail is resolved, board-level (2026-08-25).** One row per unmatched mail across
every live order, newest first; the door is the Testing board's *"N WHL emails await matching"*
attention card, which is now **a link, whole-card** (it used to list the order numbers as per-order
links — which dropped the reader on a screen that could only offer that order's lots).

**The card names no order at all** (2026-08-25). It listed the orders the mails had landed on, first as
links and then as plain text, and both were wrong for the same reason: the thread a mail arrived on is
the very thing in doubt — WHL filing against the wrong client PO is a normal way for one to land in the
wrong place — so printing an order there invited the reader to assume the answer before opening the
queue that exists to determine it. The card now says only how many are waiting and that deciding the
order is part of the job.

- A row shows: received · sender · **`arrived on <orderNo>`** (the thread it landed on — deliberately
  not called "its order", because that is the thing in doubt) · its kind · subject · the body in full ·
  the match note (falling back to *"No lot code, MPN or work order in the message"*) · attachments.
- **The mapping is one dropdown over every test slot on every order**, grouped by order
  (`<optgroup>` per order, labelled `orderNo — buyer → supplier`), each option
  `lotCode · MPN · WO · slotNo · qty`. Then `[Match to this slot]`, disabled until a slot is picked
  and for non-SC personas.
- **Matching across orders moves the mail** rather than copying it: `matchLabEmail` gained a
  `toOrderId` — the mail is spliced out of the source order's `labEmails`, pushed onto the target's,
  and stamped `matchNote = "Re-filed from <orderNo>."`. The row warns before the click
  (*"different order — the mail moves onto <orderNo>'s thread"*), and offers
  `open that slot first →` for when the operator wants to look before filing. Same-order matching is
  unchanged and still clears the note.
- Search covers order no, subject, body, sender and file names. `[Check every mailbox]` re-polls every
  order (`syncWhlInbox` per order) — a later mail sometimes names the work order the earlier one
  omitted. Empty state: *"Nothing waiting — every inbound WHL email is filed against a test slot."*
- SC-gated like the rest of the desk, and a `BOOKING_CONFIRMED` never appears here — it is
  order-level by design (`unmatchedEmails` excludes it).

### 9.6 Menus and modals

**"Add test slot" modal — PARKED 2026-08-25, nothing mounts it** (`AddLotModal`; renamed from "Add
test lot" 2026-08-24, since what the desk adds is a slot and the lots come off the lab's
confirmation). Booking moved wholesale to the board — see §9.3 for why it is kept rather than
deleted. What it offered, for whoever remounts it: a segmented control at the top,
same pattern as the section switcher; **From booking appointment** is the default.

- **From booking appointment** — explains what the document carries (which lots, the sample pulled
  from each, date codes, the work order, the quoted TAT, the test plan), then
  `[⬆ Choose appointment PDF]`, which calls `uploadBookingAppointment(orderId, file)` **with no
  `lotId`** and closes on completion. The `[✨ Use a sample appointment]` demo button was removed
  2026-08-24 along with the lot cards' per-lot `Auto-fill`: a confirmed test slot now creates the lots
  properly, and a one-click "fill it with something" button beside that only invited fake data. The
  action still accepts `file: null` as a harness seam, but no surface calls it. This is
  the **only order-wide** call to that action — it is the one that *creates* lots; everywhere else it
  is lot-scoped (§9.3). Says a pre-existing lot is topped up, never overwritten, and points at the
  other tab when there is no appointment yet.
- **Enter details by hand** — MPN (from the order's lines) · lot code * · date code · lot qty ·
  **sample qty** (*"what the lab pulls off the lot"*) · **lab** · **standard** (*"applied to every test
  ticked below"*) · and a **test-plan checklist** over `WHL_PROCESSES` with a `select all` / `clear`
  toggle and a live count. Save is disabled without a lot code and an MPN.
  - The checklist exists because §9.2 is parked: with no per-MPN requirements surface, this form is the
    only place a hand-typed plan can get in. Ticked tests are written onto the lot **and** onto the
    MPN's spec (`source: "MANUAL"`, `addedBy`/`addedAt`, one `ADD` audit row each, `sourceDoc:
    "Entered by hand with lot <code>"`) so the lot's tracker and the MPN's requirement list cannot
    drift apart. Leave everything unticked to inherit whatever the MPN already carries — the old
    behaviour.
  - `addLot` still submits the WHL test job and stamps the returned work order + `TEST_BOOKED`, so a
    hand-raised lot reaches the same first stage as one read off an appointment.

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
| Lot card (§9.3) | stepper, test tracker, report repository, verdict footer | lot · MPN · lab/WO/qty/DC · verdict · `n/m tests` · stage + `n/9` · report no · blocker · fee pill · awaiting-reply clock |
| Result circulated (§9.5) | the per-notification log, per lot | the four party pills |
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

**The hand-off itself** (2026-08-21): once a test lot reaches `REPORT_SHARED`, its card action row shows
`[🚚 Assign to logistics]` (role-gated). Clicking it calls `assignLotToLogistics` (§6) and the control
becomes a green `✓ Assigned to logistics` pill whose tooltip names who assigned it and when. That is the
whole interaction — it books nothing.

The Logistics board then shows a **`Test lots assigned to logistics · N`** panel above its order queue
(fed by `assignedTestLots(orders)`, newest hand-off first): per row the lot code · MPN · verdict pill ·
a link to its order · supplier · qty · report no · `assigned <at> · <by>` · `[Book freight]`, which is
what opens the deep-linked create-shipment flow below. Its own panel because it is a different grain
from that queue — a lot, not an order — and the freight for it is not booked yet.

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

### 9.9 Finance-side ledger (separate screen)

The lab fee is a **third money leg**: the client pays 1Buy, 1Buy pays the supplier, customs takes duty —
and WHL bills separately for the test itself. So it gets its own tab on the Payments board next to those:
`/fulfilment/payments?tab=whl` ("WHL testing"), fed by `allLabFees(orders)`.

The board's summary row carries **one card per money leg**, and the lab fee is the fourth: outstanding
(warn) beside settled (ok), an `N open` pill — or `N lot(s) held` when an advance fee is blocking — and a
`The lab's own fee, per work order` caption. Then one table, one row per work order:

| Order | Lot · MPN | Lab · work order | Invoice | Net + tax | Payable | Terms · due | Status | |
|---|---|---|---|---|---|---|---|---|
| links to the order flow's `#testing` | lot code over MPN | lab site over `WO n` | invoice no + `received at` (+ `entered by hand` when transcribed), or `awaited · asked <date>` | net `+` tax, with `processes × rate` beneath | gross, bold | terms pill + due date | `LAB_PAYMENT_LABEL` pill, plus a `lot held` pill when blocking | `Mark paid` / `✓ paid · ref` / `Enter / chase invoice` |

- **Same action, not a second one.** `Mark paid` expands the row (the board's attach-then-pay shape, as
  used for customs duty) for a transfer reference and calls the module's own `markLabFeePaid` — the
  workspace's per-lot button and this row cannot diverge.
- The expansion states what the lab needs quoted on the transfer (`WO n / LOT-x`), because a payment the
  lab can't reconcile is the reason a settled fee still reads unpaid.
- Terms are **displayed, never chosen** here either — same rule as everywhere else (§4). A transcribed
  invoice carries the `entered by hand` pill in the Invoice cell, because whoever pays it should know
  whether they're looking at the lab's mail or our typing.
- A row with no invoice yet offers `Enter / chase invoice` instead of `Mark paid`: nothing to pay until the
  lab bills it, and chasing the invoice (or transcribing it) is a mail action that belongs on the acting screen.
- **The board's page-wide status filter and ordering apply to this ledger too** (added 2026-08-19): the
  `Show: All statuses / Pending / Settled` control cuts the fee rows by `unpaid`, and unpaid fees always sort
  above settled ones — same rule the client/supplier/duty ledgers follow, so "what still owes money" reads
  first on every tab. When a table holds both, `DataTable`'s `sectionOf` prop bands them under
  `Pending · N` / `Settled · N` subheads and `rowMuted` dims the settled ones — one ordered table, not two.
- The board's **By order** tab folds this fee in as one leg among four (client collection, supplier payout,
  customs duty, WHL fee) under each order, carrying the *same* status pill, `Mark paid` button and
  attach-then-pay editor — it is a different cut of `allLabFees`, never a second implementation. An order
  counts as fully settled there only once its lab fees are paid too.

---

## 10. Invariants — the rules that make this correct

1. **Never blank on a parse failure.** A failed auto-fill is an explicit flagged state with a reason and a
   retry, never an empty list that looks intentional.
2. **Never drop or misapply inbound mail.** Anything unroutable goes to the manual-match queue.
3. **Tests are never hand-typed as the primary path.** Manual entry exists only as an audited override, and
   auto vs. manual stays visually distinguishable forever (`from booking` / `manual` pills + `addedBy`).
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
| Mount points | acting screen at `/fulfilment/testing/[orderId]`, read-only view on the order's Testing tab (§9.0) | Two routes/panels either way; whatever the host calls them, keep the actions in exactly one of the two. |
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
| `src/components/order/testing-tab.tsx` | the whole acting screen §9.1–9.7 + both menus + `CollapsibleCard` / `ExpandBar` / `MailRow` / `LotProgressToggle` | 1080 |
| `src/components/ui/primitives.tsx` | + `Notice` — the inline alert used by the acting screen, both reading surfaces and the report's parse flags (it was copied three times before) | +25 |
| `src/components/order/testing-readonly.tsx` | §9.0 the read-only lot rendering: `LotReadOnlyDetail` = `readOnly` lifecycle stepper + `ReportRepository`, nothing else. (`MpnRequirements` also lives here, currently unrendered — see the parked file below) | 95 |
| `src/components/order/testing-view-tab.tsx` | **PARKED**, unrendered — a read-only shell for the order's Testing tab from when that tab was view-only. Kept in case that decision returns; delete it if not | 300 |
| `src/components/order/report-repository.tsx` | §9.4 extracted so the report's field list exists once — `ReportRepository` + `ReportSummary`, `readOnly` drops only the reconcile action | 185 |
| `src/components/order/test-tables.tsx` | the two — and only two — per-test tables: `LotTestTable` (§9.3 tracker, report folded in) + `MpnTestMatrix` / `MpnFeeStrip` (§9.2), plus the shared `LotFeeCell` (both roll-ups) | 320 |
| `src/components/order/testing-stages.tsx` | §9.3a/§9.3b — `TestingStageChain` (stepper) + `TestingStageBar` (compact) + `LabFeePanel`; chain and fee panel take `readOnly` | 340 |
| `src/components/order/modals.tsx` | compose / notify / bulk-notify / match / record-dispatch / mark-paid / **upload-invoice** / shipment-prefill | +560 |
| `src/app/fulfilment/logistics/page.tsx` | §9.8 hand-off | +90 |
| `src/app/fulfilment/payments/page.tsx` | §9.9 the "WHL testing" tab — the finance-side fee ledger (tiles, table, attach-then-pay row) | +95 |
| `src/app/fulfilment/testing/page.tsx` | cross-order board, **slot-first** (§9.0a): a row per MPN submission, flat or grouped by order; the row links into that slot's own journey | ~470 |
| `src/app/fulfilment/testing/inbox/page.tsx` | the **WHL inbox** (§9.5a): every unmatched lab mail vs every test slot on every order, one dropdown each | ~190 |
| `src/app/fulfilment/testing/[orderId]/page.tsx` | the workspace route — order header + `TestingTab` + the add-lot modal | 70 |
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

Surfaces (§9.0)
- [ ] The Testing board is one queue of **test slots** — a row per MPN submission, with Order no / Buyer / Supplier / MPN / Test slot / Lab fee / Lab fee due / Status-updates columns — under five mutually-exclusive chips (Failed / In progress / Not booked / Completed / Passed) whose counts sum to All, plus a `Group by order` cut, search and pagination §9.0a; picking a row opens that slot's own journey in the full screen §9.1–9.7.
- [ ] The workspace opens with the overview strip collapsed, "Needs attention" only when non-empty, and the lots panel above the fold §9.1.
- [ ] The three sections are cards with icon + hint + attention badge, active one filled, not a tab strip §9.1.
- [ ] The order's Testing tab and `/fulfilment/testing/[orderId]` render the same component with the
      same actions — Check mail, the bulk menu and every alert action work on both (booking is on
      neither since 2026-08-25 — it is the board's, §9.3).
- [ ] The order-flow page's Testing section renders **no** order-changing control, and every number on
      it matches the acting screen for the same order: same selectors, no second implementation.
- [ ] That section shows exactly two things per lot: the lifecycle stepper and the report (openable +
      downloadable). No vertical stage list, no per-test table, no requirements-by-MPN — each would
      repeat something already on the page or on the acting screen (§9.0).
- [ ] Absent, not disabled: `readOnly` removes the stepper/fee action rows and the report's reconcile
      action outright; `canEdit={false}` remains the persona gate and still greys controls **in the workspace**.
- [ ] A report can be read in full and downloaded from a reading surface, and both write an access-log
      row there exactly as they do in the workspace.
- [ ] The report's header-field layout exists in exactly one file — grep `Risk classification` and expect
      one hit.

Data & auto-fill
- [ ] Reading the booking appointment creates the lots **and** populates their test lists; re-running keeps manual additions and does not clobber a lot mid-flight.
- [ ] A failed parse shows "Auto-fill failed — needs manual review" + reason + Retry; never an empty list.
- [ ] Manual add/delete is logged with who · when · before → after, and stays distinguishable (`from booking` / `manual`).
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
- [ ] Every test lot shows the 9-stage chain with the current stage, `n/9`, and who the next step is waiting on.
- [ ] The chain ends on `ASSIGNED_TO_LOGISTICS`, and the Assign-to-logistics click is what completes it.
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
- [ ] The terms always come from the lab's document — parsed off its mail, or transcribed from whatever
      medium it arrived on. Nothing in the UI lets an operator pick terms for a fee the lab hasn't stated.
- [ ] A hand-entered invoice makes the fee payable (status `INVOICE_RECEIVED`), files its document, and is
      labelled `entered by hand` on the lot **and** on the finance ledger — never indistinguishable from
      one the lab mailed.
- [ ] An advance-terms invoice entered by hand holds the lot exactly as a mailed one does; paying it
      releases it and writes the `WHL_PAYMENT` history row.
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
- [ ] "Result circulated" sits in the **Communication** section (not the lot card), lists only lots with a report, and its notification log is collapsed behind `Show history (n)`.

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
