# WHL Testing Platform — Working-Tree Guide

**What this doc is:** where the WHL testing section actually lives *in this repo*, what each file
owns, how the files wire together, and which ones to touch for a given change. Line numbers are real
and measured, not estimated — they drift, so treat them as "look here", not as addresses.

**How it differs from its siblings in this folder:**

| Doc | Answers | Audience |
|---|---|---|
| `CONTEXT.md` | *What* the module is — a portable spec, deliberately repo-agnostic | someone rebuilding it elsewhere |
| `PROMPT.md` | *Build it* — the prompt that drives that rebuild | an agent in a target repo |
| **`WORKING-TREE.md`** (this) | *Where it is here* — file map, wiring, change recipes | someone editing **this** codebase |

If the three disagree, `CONTEXT.md` wins on intent and this doc wins on location.

---

## Part 1 — Detailed summary

### What the section does

A per-order screen (the **Testing** tab of the order workspace) that carries a lot from "the PO says
this needs testing" to "we have a signed report and everyone who needs the result has it". It answers
six questions, in this order:

1. **What tests does each MPN need?** — parsed off the PO by a mock extractor, never hand-typed. A
   failed parse is an explicit flagged state with a reason and a retry, not an empty list.
2. **Where is each lot right now, and who owes the next move?** — a 9-stage lifecycle per lot,
   advanced automatically by inbound lab mail.
3. **Where does every test stand?** — a per-lot tracker of MPN × lot × test with full timestamped
   history, updated from the same inbound mail.
4. **What does the report say?** — a per-lot repository of *all* report revisions, with the header
   fields and the process-level result matrix parsed on screen so nobody opens the PDF.
5. **What does the lab charge, and is it paid?** — WHL's own testing invoice arrives by mail on
   booking, is downloadable per lot, goes to finance to pay, and has its own lifecycle stage.
6. **What happens next?** — notify supplier / buyer / escrow / lab / finance (masked from each other,
   each getting the right document), or hand off to logistics with a shipment pre-filled.

### The three progress axes — the thing to not get wrong

A lot carries **three independent progress dimensions**. Conflating them is the most tempting
mistake in this module.

| Axis | Question | Field | Vocabulary |
|---|---|---|---|
| **Lifecycle stage** | *Where are the parts, who owes the next move?* | `Lot.stage` + `Lot.stageHistory` | `TestingStage` (9 values) |
| **Test tracker** | *What was tested, with what result?* | `Lot.tests[].status` | `TestProcessStatus` (6 values) |
| **Lab fee** | *Has WHL been paid for the testing?* | `Lot.labPayment` | `LabPaymentStatus` (5 values) |

They interact but never substitute. A lot can sit at `TESTING_COMPLETED` while every test on the
tracker is still `IN_PROGRESS` — the lab has finished the bench but hasn't released results. A report
arriving settles the tracker *and* ends the lifecycle.

A fourth, separate field — `Lot.testStatus` (`PENDING | PASS | FAIL | MAYBE`) — is **pre-existing and
drives escrow release**. This module reads and sets it but never repurposes it.

### The lifecycle chain

```
1 Test Requested        1Buy      work order raised with WHL
2 Payment to WHL        1Buy      invoice mail states ADVANCE|CREDIT → payment ack closes it
3 Supplier Dispatching  Supplier  supplier's own dispatch advice, relayed onto the thread
4 Components Received   WHL       receipt confirmation mail
5 Testing In Progress   WHL       interim mails (these also move the test tracker)
6 Testing Completed     WHL       "all processes conducted" mail
7 Test Report Shared    WHL       report received  ← TERMINAL
```

**Every stage arrives by mail** — `syncWhlInbox` is the driver, including for the two stages that
don't originate with the lab. The operator paths (`recordSupplierDispatch`, `markLabFeePaid`,
`setLotStage`) are labelled fallbacks for the phone-call case.

Rules that fall out of this shape:

- **Stage 3 cannot come from a *lab* mail.** The lab only learns a shipment exists when it lands, so
  the stage comes from the supplier's dispatch advice (`kind: "DISPATCH"`, carrying courier/AWB/ETA)
  with `recordSupplierDispatch` as the manual fallback. Before it, the lab *chases us* for the samples.
- **Stages 6 and 7 are separate on purpose.** Testing finishing and the report landing are different
  events, often days apart. Keeping them separate is what makes the lag visible — and is why no
  "report being written" stage is needed between them.
- **Whether stage 2 gates stages 5+ depends on the terms.** On `CREDIT` the lab tests on account, so
  the chain routinely runs past the payment stage with the fee owed. On `ADVANCE` the lab holds the
  lot, so nothing past stage 4 fires until a payment acknowledgement lands. That node therefore reads
  the payment record (amber unpaid-on-credit, red when blocking), not its index — the only node in the
  stepper whose truth isn't positional.
- **Two stages were removed** (`TESTING_STARTED` after 4, `REPORT_PREPARATION` after 6). "In progress"
  already says the lot is on the bench and "report shared" already says the write-up finished, so both
  were nodes the operator read past. Don't reintroduce them.
- **Reaching stage 9 is not a verdict.** It means the report is in hand. Whether the lot is acceptable
  is `testStatus` + the blocker; an F.A.R. still needs follow-up on a chain that reads complete.

### Entity chain

```
PO → MpnTestSpec (per MPN, per order) → Lot → LotTest → TestAuditEntry[]
                                          ├→ TestingStageEvent[]   (lifecycle history)
                                          ├→ LotDispatch           (supplier → lab leg)
                                          ├→ LabPayment → LabInvoice (the lab's own fee)
                                          ├→ WhlReport[]           (versioned, one current)
                                          └→ LotNotification[]     (who was told)
Order-level: MpnTestSpec[] (mpnTests) · LabEmail[] (labEmails, incl. unmatched inbound)
```

### Everything external is a mock

No backend, no real mail, no real OCR. Five adapters sit behind one transport (`mockCall`) that
injects latency, injects failures from a global chaos rate, and logs every call to the Integrations
console. The seam matters more than the mock — swapping in `fetch` is meant to be a one-line change
per adapter.

---

## Part 2 — The working tree

`✦` = **owned** by this module (delete the module, delete the file).
`◈` = **shared** file with a module-owned region (delete the module, delete only those lines).

```
src/
├── app/fulfilment/
│   ├── orders/[id]/page.tsx           ◈  route → order workspace → Testing tab (the main screen)
│   ├── testing/page.tsx           76  ✦  cross-order lab board (every lot, every order)
│   └── logistics/page.tsx        144  ◈  hand-off target for ?order=&lot= / &lots=
│
├── components/order/
│   ├── order-workspace.tsx      578  ◈  host shell; renders <TestingTab> for tab === "Testing"
│   ├── testing-tab.tsx        1 277  ✦  the whole screen: roll-up, 3 sub-tabs, menus, density
│   ├── testing-stages.tsx       294  ✦  lifecycle stepper + compact bar + the lab-fee panel
│   └── modals.tsx               889  ◈  7 of 19 modals belong here
│
├── store/
│   ├── store.ts               1 398  ◈  19 testing actions + the moveStage helper
│   └── selectors.ts             395  ◈  all derived testing/lifecycle/fee state (pure)
│
├── integrations/
│   ├── lab-whl.ts               333  ✦  WHL: submit · report · invoice · mail out · stage-aware inbox
│   ├── doc-extract.ts            98  ◈  PO test-table parser (also used by PO-upload screens)
│   ├── notify.ts                 32  ✦  party notification transport (incl. finance)
│   └── mock-client.ts            68  ◈  shared transport: latency · chaos · call log
│
├── data/
│   ├── enums.ts                 583  ◈  reference data, lifecycle chain, fee labels, 16 templates
│   ├── fixtures.ts              832  ◈  the 3-lot demo seed incl. stage + fee histories
│   └── order-details.ts         731  ◈  narrative detail for the hero order
│
├── types/index.ts               582  ◈  ~230 lines of testing interfaces
└── lib/role.ts                   39  ✦  useRole() → canEditTests / canEmailLab
```

**Footprint:** 6 wholly-owned files — 2 components, 3 adapters/helpers, 1 route — plus regions inside
12 shared files.

Two more files **read** testing state without belonging to the module, and both read only the
pre-existing `lot.testStatus`, never the lifecycle or the tracker:

| File | Reads | Why |
|---|---|---|
| `app/fulfilment/page.tsx` (72) | `allLots(...).filter(l => l.testStatus === "MAYBE")` | dashboard attention queue |
| `app/fulfilment/escrow/page.tsx` (46) | `lots.some(l => l.testStatus === "PASS")` | the release trigger |

That is the full blast radius: changing the lifecycle or the tracker cannot break them, but changing
how `testStatus` is derived can.

---

## Part 3 — File-by-file

### Owned outright

#### `components/order/testing-tab.tsx` — 1 277 lines, 18 components

The screen. `TestingTab` (L113) is the only export; everything else is local.

| Component | L | Role |
|---|---|---|
| `TestingTab` | 113 | roll-up panel, scope selector, stat tiles, alert stack, bulk bar, lot table, sub-tab switch, modal host |
| `MpnTestsSection` | 430 | sub-tab 1 — one collapsed card per MPN |
| `LotsSection` | 590 | sub-tab 2 — one collapsed card per lot |
| `LotCard` | 741 | a lot: stepper → tracker → reports → circulated → verdict footer |
| `MailSection` | 1134 | sub-tab 3 — templates, match queue, thread |
| `MailRow` | 1242 | one thread message, body clamped, `view full email` |
| `ReportRepository` / `ReportSummary` | ~960 / ~1010 | version switcher + the parsed report header on screen (no process table — see below) |
| `NextActionsMenu` / `BulkActionsMenu` | 690 / 622 | per-lot and N-lot follow-through |
| `LotProgressToggle` | 404 | the roll-up table's **Progress** cell |
| `LotFeeCell` | ~430 | the roll-up table's **Lab fee** cell: gross · terms pill · held/unpaid/paid |
| `MAIL_KIND_LABEL` / `MAIL_KIND_TONE` | ~1250 | the thread's kind pills (invoice · payment · dispatch · report) |
| `CollapsibleCard` / `ExpandBar` | 65 / 93 | the density primitives (see Part 5) |
| `Empty` / `Notice` / `Denied` / `Stat` | 39–109, ~455 | local presentation helpers |

#### `components/order/test-tables.tsx` — the two per-test tables

Extracted so there is one owner for "render the test list", after an earlier cut rendered it three
times (MPN requirements, lot tracker, report process matrix — the same names three times over):

- `LotTestTable` — the lot card's tracker, rows from `lotTestRows(lot)`. Columns
  `Test | Status | Accept/Reject | Per the report | Updated | Set`. The `Per the report` column **is**
  the old process matrix: result pill, report no, process note. `TestRow` (local) expands to the
  status history.
- `MpnTestMatrix` — requirements down, lots across, each cell that lot's status for that test
  (`not on lot` when the requirement never propagated), a `Rate` column when every invoice on the MPN
  agrees, and a `passed / tracked` footer per lot.
- `MpnFeeStrip` — the MPN's fee from `mpnFeeRollup`: gross, per-process rate, terms (or `mixed terms`),
  unpaid total, held lot codes.

#### `components/order/testing-stages.tsx` — ~330 lines

- `TestingStageBar` (L34) — 7 thin segments + label + `n/7` + "waiting on X". Used in the scope
  banner and on the cross-order board.
- `TestingStageChain` (L65) — the horizontal stepper. Reuses the **Journey stepper's** markup and
  classes on purpose, so order-level and lot-level progress read as one idea at two scales. Per-stage
  detail lives in `title` tooltips; below the rail sit the current stage in words, `Next: …`, the
  action buttons, and the dispatch block.
- `LabFeePanel` (L216) — WHL's invoice and its settlement (§9.3b in CONTEXT): status pill, amounts,
  `Request invoice` / `Download invoice` / `Send to finance` / `Mark paid`, and the access-log count.
  Renders nothing until a work order exists — there is nothing to bill before that.
- `STAGE_ICON` (L21) — the only place stage → icon is decided.

#### `integrations/lab-whl.ts` — 333 lines

| Export | L | Notes |
|---|---|---|
| `whlSubmitTestJob` | 32 | returns the work-order no |
| `whlPollTestReport` | 39 | legacy simple poll (pre-dates the repository) |
| `whlFetchReport` | 70 | builds a full weighted report; call again → next revision |
| `whlSendMail` | 121 | outbound |
| `whlPollInbox` | 178 | **stage-aware** inbox |
| `nextStageMail` | 209 | *internal* — the stage → next-plausible-mail transition table |
| `mapVerdict` / `conclusionToLotStatus` / `processToTestStatus` | 22 / 25 / 29 | vocabulary mappers |

`nextStageMail` also issues the lab's **invoice** — its first reply after a work order, gated on
`hasInvoice` so it goes out once, then chased at 20% while `feePaid` is false. An invoice carries no
`stage`: a bill is not progress.

`nextStageMail` is where the demo gets its coherence: given the lot's current stage it returns the
mail that would plausibly come *next*, so repeated polling walks the chain one step at a time instead
of firing a random status mail at a finished lot. Two ordering rules are load-bearing and commented
in place — the "testing commenced" mail carries **no** `testUpdates`, and the first interim update
always lands before report preparation. Both were bugs first.

#### `integrations/notify.ts` (32) · `lib/role.ts` (39) · `app/fulfilment/testing/page.tsx` (76)

Small and single-purpose: the party-notification transport, the permission hook
(`canEditTests` / `canEmailLab`, gated in one place), and the cross-order board that renders one
`TestingStageBar` per lot across every order.

### Shared files — the module's regions

| File | Lines | What's ours |
|---|---|---|
| `types/index.ts` | 18–27 · 178–398 · ~570 | `TestingStage` (L18, 9 values); the `// ---- WHL testing` block — `TestAuditEntry` 181, `TestRequirement` ~245, `MpnTestSpec` ~258, `LotTest` ~271, `WhlReport` ~293, `LabEmail` ~324, `LotNotification` ~346, **`LabInvoice` 315, `LabPaymentStatus` 333, `LabPayment` 335**, `LotDispatch` ~365, `Lot` 375 (last 9 fields added); `OrderBundle.mpnTests` / `.labEmails` near 570 |
| `data/enums.ts` | 101–583 | WHL reference data ~101; **testing lifecycle** (`TESTING_STAGES` 136, `TESTING_TERMINAL_STAGE` ~148, `TESTING_STAGE_META` 162); **lab-fee vocabulary** (`LAB_PAYMENT_LABEL` 224, `LAB_PAYMENT_TONE`, `FINANCE_CONTACT`, `WHL_TEST_FEE_PER_PROCESS`, `WHL_INVOICE_TAX_PCT`); mail templates (`WHL_EMAIL_TEMPLATES` 294 — 10 incl. `INVOICE_REQUEST`, `NOTIFY_TEMPLATES` 403 — 5 incl. `FINANCE`, `notifyDigest` with its `FINANCE` payment-run branch) |
| `store/store.ts` | 57–86 · ~377–435 · 436–1050 | `moveStage` 57; lifecycle touch-points inside pre-existing lot actions (`addLot` ~377 stamps `TEST_REQUESTED`, `setLotStatus`, `fetchLabResult`); the `// ---- WHL testing platform` block from 436 |
| `store/selectors.ts` | 85–305 | testing selectors ~85; **lifecycle** (`derivedStage` 115, `lotStage` 166, `lotStageProgress` 174); **lab fee** (`labPaymentOf` 134, `outstandingLabFees` 139, `labFeeOutstandingTotal` 160); mail/SLA/reconciliation/summary after. `allLots` feeds the cross-order board |
| `components/order/modals.tsx` | 7 modals | `AddLotModal` 45, `RecordDispatchModal` 78, **`MarkLabFeePaidModal` 134**, `ComposeWhlEmailModal` ~186, `NotifyLotResultModal` 267, `BulkNotifyModal` 354, `MatchLabEmailModal` ~494 (+ `CreateShipmentModal` as the hand-off target) |
| `integrations/mock-client.ts` | all of it | shared transport; `mockCall` 32, `pickWeighted` 63 (the weights that make F.A.R. reports and unroutable mail happen by themselves) |
| `data/fixtures.ts` | the hero lots | 3 lots + tests + reports + emails + notifications + **stage histories** + **lab-fee records and the 3 invoice mails** |

### Store actions

Under `// ---- WHL testing platform ----` (store.ts L436):

```
autofillMpnTests    439    addMpnTest          ~507   removeMpnTest       ~529
setLotTestStatus   ~544    recordSupplierDispatch 560  setLotStage         637
requestWhlInvoice   584    markLabFeePaid       603   logInvoiceAccess    628
fetchWhlReport      655    requestWhlUpdate    ~741   sendLabEmail       ~753
syncWhlInbox        767    matchLabEmail       ~826   escalateLabEmail   ~841
logReportAccess    ~847    reconcileReportPo   ~854   notifyLotResult     899
notifyLotsResult    978
```

`moveStage` (L57) is the **single** path for every automatic lifecycle move. It compares against
`lot.stage` — the *recorded* stage — never `lotStage(lot)`, the displayed one. The displayed stage is
floored by what the tests/report imply, and that floor can run ahead of what the lab has told us; using
it here silently swallows history rows. The comment above it spells this out. Don't "simplify" it.

Three helpers, not one: `moveStage` (forward-only, advances the cursor + records),
`recordStageEvent` (records only), and `settleStage` (records even when the stage is already behind the
cursor). **`WHL_PAYMENT` uses `settleStage`** — from `markLabFeePaid` and from the `PAYMENT_ACK` branch
of `syncWhlInbox` — because the fee routinely clears after the lot has shipped, and `moveStage` would
treat that as a backwards move and drop the row. That was a live bug: the fee read "paid" with no
history row behind it.

### Selectors

```
specForMpn · lotTestProgress · currentReport · lotTestRows (the joined tracker rows)
derivedStage (internal) · lotStage · lotStageProgress · stageWaiting
labPaymentOf · labFeeUnpaid · labTerms · labFeeGross · labFeeBlocking
outstandingLabFees · labFeeOutstandingTotal · mpnFeeRollup
lotEmails · unmatchedEmails · testAutofillGaps · overdueUpdateRequests
reconciliationAlerts · testingSummary · lotResults
```

`lotStage` = `max(recorded, derived)`. The derived value is a **display floor** so a lot holding a
report can never *read* as pre-report — which keeps imported or legacy lots from displaying a lie.

`lotTestRows` is the join that killed the third test list: one row per `lot.tests[]` entry with the
current report's matching process folded in, plus a `report only` row for any process on the report
that never had a tracker entry (dropping it would hide a process the lab ran).

`labFeeBlocking` is the advance gate — `terms === "ADVANCE" && status !== "PAID"`. Read it, don't
re-derive it: it's what separates "owes money" from "the bench is stopped", and it's consulted by the
stepper node, the header pill, the lot summary, the roll-up cell and the order alert.

---

## Part 4 — Wiring

### Render tree

```
/fulfilment/orders/[id]                    /fulfilment/testing
  └── order-workspace.tsx                    └── page.tsx
        └── TestingTab            (L107)           └── TestingStageBar   ← same component,
              ├── MpnTestsSection                                          cross-order view
              ├── LotsSection
              │     └── LotCard
              │           ├── TestingStageChain  ──┐
              │           │     └── LabFeePanel    │  all three from
              │           ├── TestRow              │  testing-stages.tsx
              │           └── ReportRepository     │
              │                 └── ReportSummary  │
              ├── MailSection → MailRow            │
              ├── LotProgressToggle ──► expands ───┘  (TestingStageChain again,
              └── 6 modals from modals.tsx              inline in the roll-up table)
```

### Import graph (measured, not assumed)

```
order-workspace.tsx ──► testing-tab.tsx ──┬─► testing-stages.tsx ──┬─► selectors.ts
                                          │                        └─► enums.ts
app/fulfilment/testing/page.tsx ──────────┘ (also imports testing-stages + selectors)
                                          │
testing-tab.tsx ──┬─► modals.tsx          ├─► store.ts ──┬─► lab-whl.ts ──► mock-client.ts
                  ├─► lib/role.ts         │              ├─► doc-extract.ts      └─► enums.ts
                  ├─► selectors.ts        │              └─► notify.ts
                  └─► enums.ts, ui/*      └─► selectors.ts
```

Worth knowing: `doc-extract.ts` is **also** imported by the client-PO and supplier-PO upload screens,
so it isn't ours alone. `lib/role.ts` is shared with `layout/header.tsx` (the persona switch).
`selectors.ts` is imported by 12 route files — the testing selectors are a region, not the file.

### Where state lives

One Zustand store (`store.ts`), `immer` + `persist` to `localStorage` under key `poc-sourceops`,
storage guarded by `typeof window !== "undefined"`. Everything testing-related hangs off
`orders[orderId]`: `lots[]`, `mpnTests[]`, `labEmails[]`. No server state, no React Query for this
module. A store `version` bump / `migrate` exists so stale local state can't hide new seed data.

---

## Part 5 — The four flows

**1 · Test requirements (PO → tracker)**
`autofillMpnTests` → `extractPoTestRequirements` (doc-extract) → build/replace `MpnTestSpec`, stamp
`sourceDoc` / `parsedAt` / `confidence`, write an `AUTOFILL` audit row → push new tests onto every
existing lot of that MPN. Manual `addMpnTest` / `removeMpnTest` are audited overrides that stay
visually distinguishable forever (`from PO` vs `manual` pills). A failed parse marks *every* target
MPN `FAILED` with the reason — never blank.

**2 · Lifecycle advance (the loop that makes the demo move)**
`syncWhlInbox` → collects `{ workOrderNo, lotCode, mpn, testNames, stage: lotStage(lot) }` per lot →
`whlPollInbox` → `nextStageMail` picks the plausible next mail → back in the store: route by `lotCode`
then `workOrderNo`, apply `testUpdates` to the tracker (**never** downgrading a test a report already
settled), then `moveStage` to `msg.stage` citing the mail's subject and id. Unroutable mail lands in
the manual-match queue with a note. Forward-only, so a stale mail can't rewind a finished lot and
re-polling the same stage adds no duplicate row.

**3 · Report ingest**
`fetchWhlReport` → `revision = max(existing) + 1`, so calling again fetches the *next* revision →
mark prior reports `current: false`, push the new one → set `reportNo` / `testedAt` / `testStatus`
(via `conclusionToLotStatus`) → roll the process matrix onto `lot.tests` with a `REPORT` history row
each → append an inbound thread entry + a `WHL_REPORT` doc → clear the SLA clock → flip awaiting
outbound mail to `UPDATE_RECEIVED` → `moveStage(REPORT_SHARED)`. Reconciliation `parseFlags` are added
when the report's MPN or client PO disagrees with the lot.

**4 · Follow-through**
`notifyLotResult` (one lot) / `notifyLotsResult` (one digest, N lots) → template from `enums.ts` →
`sendPartyNotification` → log a `LotNotification` on **every** lot the mail covered. Escrow also gets a
zero-amount ledger marker; WHL also gets a thread entry. Masking is absolute in both directions, and a
buyer digest spanning several client POs is split into one mail per PO.

**5 · The lab's fee (parallel to 2–4)**
The lab bills on booking, so `nextStageMail` returns an `INVOICE` mail as its first reply after the
work order — carrying an `invoice` payload (N processes × USD 145 + 6% tax, due in 15 days). `syncWhlInbox`
stores it as a `LabInvoice` — **including the `terms` (`ADVANCE` | `CREDIT`), `creditDays` and
`ratePerProcess` the mail states** — files the PDF in the document vault, and sets the fee to
`INVOICE_RECEIVED`; the mail lands on the thread as `kind: "INVOICE"`. From there:
`requestWhlInvoice` (chase it) → `notifyLotResult(party: "FINANCE")` attaches the **invoice** and marks
it `SENT_TO_FINANCE` → and once it's with finance, WHL's own `PAYMENT_ACK` mail sets `PAID` with its
`paidRef` and calls `moveStage(WHL_PAYMENT)`; `markLabFeePaid` does the same by hand. `logInvoiceAccess`
logs every download. Bulk: `notifyLotsResult(FINANCE)` is a payment run that moves every covered invoice
at once and flags advance lots as held.

**The terms decide whether the fee blocks.** On `CREDIT` it's a parallel track — amber stepper node,
lot pill, order alert, nothing stopped. On `ADVANCE` the lab holds the lot: the mock stops answering
with bench mails until a payment acknowledgement lands, and the UI goes red (`Held — advance fee
unpaid`). The terms are never chosen in the app; they are only ever read off the invoice mail.

### Density (built in, not a polish pass)

An order can carry 100 lots, so every repeated card starts collapsed:

| Surface | Collapsed | Always visible |
|---|---|---|
| MPN card | test matrix, fee strip, meta, edit, audit | MPN · mode · state pill · `k tests` · `m manual` · fee gross · terms · unpaid/held |
| Lot card | stepper, tracker, reports, notifications, verdict | lot · MPN · verdict · `n/m tests` · stage + `n/7` · report no · blocker · fee pill · awaiting clock |
| Result circulated | the notification log | the party pills |
| Correspondence | everything past the 2 newest; bodies clamped to 2 lines | the 2 most recent messages |

`ExpandBar` shows `N lots · M expanded · collapse all`; **`expand all` only appears at ≤ 12 items** —
at 100 it would recreate the problem collapsing solves. Filtering to a single lot/MPN auto-expands it
(the filter is already the request to see it). Nothing truncates silently: *"Showing the 2 most recent
of 6"*, `Show 4 earlier message(s)`, `Show history (3)`.

---

## Part 6 — Change recipes

| I want to… | Touch |
|---|---|
| add / rename / reorder a lifecycle stage | `types/index.ts` L18 (union) → `enums.ts` L136 + L162 (order + meta) → `selectors.ts` L115 (`derivedStage`, if derivable) → `lab-whl.ts` L209 (`nextStageMail` branch) → `testing-stages.tsx` L21 (icon) → `fixtures.ts` (seed rows). **Nothing hardcodes which stage is last** — use `TESTING_TERMINAL_STAGE`. |
| change how a stage is reached | `lab-whl.ts` L209 only, if it's mail-driven |
| change the lab-fee flow | `types/index.ts` L315–347 (`LabInvoice` / `LabPayment`) → `enums.ts` L224 (labels/tones/rates) → `selectors.ts` L134 (fee selectors) → `store.ts` L584/603/628 (request / pay / access) → `LabFeePanel` (testing-stages L216) |
| change the invoice's shape or amount | `lab-whl.ts` L209 (the `INVOICE` branch) + `WHL_TEST_FEE_PER_PROCESS` / `WHL_INVOICE_TAX_PCT` in `enums.ts` |
| add a notify party | `types/index.ts` (`NotifyParty`) → `enums.ts` L403 (`NOTIFY_TEMPLATES`) + the `notifyDigest` switch → `store.ts` L899 `noteFor` map → the menus in testing-tab |
| add a WHL / notification mail template | `enums.ts` L294 / L403 — both the store action and the compose UI read the same source, so add it once |
| add a test process or standard | `enums.ts` (`WHL_PROCESSES` / `TEST_STANDARDS`) |
| change a report's parsed shape | `types/index.ts` (`WhlReport`) → `lab-whl.ts` L70 → `ReportSummary` (testing-tab L1025) |
| change the roll-up table | `TestingTab` L113 (the `<table>` and its 10 columns; the expanded stepper row uses `colSpan={10}` — keep them in step) |
| change collapse behaviour | `CollapsibleCard` L65 / `ExpandBar` L93, and the `RECENT_MAILS` / clamp constants in `MailSection` L1134 |
| add a per-lot action | `NextActionsMenu` L690 (+ `BulkActionsMenu` L622 if it batches). Note the per-lot menu is gated on a report existing — anything available earlier (like the fee) belongs in `LabFeePanel` instead |
| adjust mock realism (weights, latency, failures) | `lab-whl.ts` L70 / L178, `doc-extract.ts` L46 |
| change what a persona may do | `lib/role.ts` only |
| re-seed the demo | `fixtures.ts` — and read the lifecycle seed rules in `CONTEXT.md` §13 first |

**Three traps.** (1) `moveStage` compares the recorded stage, not the displayed one — see Part 3.
(2) A stage-advancing mail that also carries `testUpdates` can imply a *later* stage through the
derived floor and swallow its own row; that's why the "testing commenced" mail carries none.
(3) The `WHL_PAYMENT` stepper node must keep reading `labFeeUnpaid(lot)` rather than its index —
"simplifying" it to positional rendering makes the tab claim a fee is settled when it isn't.

---

## Part 7 — Verifying a change

```bash
npx tsc --noEmit && npx eslint src && npx next build     # all three must be clean
pnpm dev                                                  # then actually load the screen
```

Render checks that catch what typechecking can't:

- **Collapsed *and* expanded separately.** A card that renders its body while collapsed defeats the
  density rule and is invisible in a collapsed screenshot.
- The Testing tab isn't the default tab — to server-render it, temporarily flip
  `useState<WorkspaceTab>("Overview")` in `order-workspace.tsx` L28 (and `useState<Sub>("lots")` in
  testing-tab L112 for the sub-tab), fetch, then **revert**.
- Hero order for all of this: `/fulfilment/orders/ord-148`. Cross-order board: `/fulfilment/testing`.

### The lifecycle harness — not in the tree

The stage chain is probabilistic, so eyeballing it isn't enough: both stage-ordering bugs found so far
reproduced only across repeated runs. A harness drives the **real store and real adapter** from Node
and asserts all 9 stages are visited in order, nothing moves backwards, mail-driven rows cite an email
that exists, a completed lot is inert under further polling, and the whole fee path works (invoice
arrives on booking → filed in the vault → sent to finance → marked paid closes the payment stage).

It currently lives in the **session scratchpad, not the repo** (`stage-check.ts` + a `registerHooks`
resolver for the `@/` alias + a `sonner` stub). That means it is ephemeral. To recreate it: resolve
`@/*` → `src/*` via `node:module`'s `registerHooks`, stub `sonner`, shim `window.localStorage` (the
store's `persist` throws without it), set `NEXT_PUBLIC_DEMO_SPEED=40` to compress mock latency, then
drive `useStore.getState()` directly and poll `lotStage()` between `syncWhlInbox()` calls. Nothing in
the graph is `.tsx`, so `node --experimental-strip-types` is enough.

**Worth promoting into the repo** if this module keeps changing — it is the only thing that catches
the stage-ordering class of bug.

---

## Part 8 — Known gaps

- **No test runner.** Manual verification + the ephemeral harness above. There is no `pnpm test`.
- **`SOP.md`'s documentation-maintenance policy doesn't list this folder**, so the three docs here are
  maintained by convention only.
- **A re-test doesn't restart the chain.** `REPORT_SHARED` is terminal and forward-only, so a revised
  report (`.2`) lands on a lot that already reads complete. Correct for the POC; revisit if re-tests
  become a tracked workflow rather than an exception.
- **`whlPollTestReport`** (lab-whl L39) pre-dates the report repository and is still wired to
  `fetchLabResult`. Live but largely superseded by `whlFetchReport`.
- **The lab fee has no bank rail.** `markLabFeePaid` records what finance says it did; nothing calls the
  banking adapter. Deliberate for the POC — the fee is evidence-tracked, not executed.

---

## Keeping this doc honest

Line numbers drift with every edit; the **structure** is what's load-bearing. When changing the
module, update `CONTEXT.md` in the same turn (that's the standing rule), and update this doc when a
file is added or removed, a component moves between files, or the import wiring changes. Re-measure
rather than re-estimate:

```bash
wc -l src/components/order/testing-{tab,stages}.tsx src/integrations/lab-whl.ts
grep -n "^function \|^export function " src/components/order/testing-tab.tsx
grep -rl "@/components/order/testing-stages\"" src        # reverse import check
```
