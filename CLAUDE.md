# CLAUDE.md — poc-sourceops-workflow

Claude Code instructions for the internal 1Buy fulfilment-ops console POC.

## Project Summary

**poc-sourceops-workflow** is a Next.js 16 POC for 1Buy's masked back-to-back Mode-4 trade console. It is **internal-only** — for SC/Finance/Approver/Mgmt personas. Clients & suppliers never log in to the internal console (they only ever touch the two token-gated public portals — see RFQ Module below).

The console now spans the **full funnel**: client RFQ intake → demand aggregation → competitive supplier sourcing → Finance-approved client quoting (PI-gated) → Client PO / Supplier PO creation → a **gated fulfilment journey** (fund/escrow, per-line testing, shipping, customs, relabel, e-invoice, delivery, close). All external integrations are **mocks** (Escrow Agent/HKin, ICEGATE customs, WHL lab, logistics, banking, e-invoice, doc-extract, RFQ/quote mail) with a live call log for transparency.

**Key facts:**
- **Three fulfilment entities:** Client PO (demand) → Supplier PO (our purchase) → Order (fulfilment). The RFQ module now feeds both POs from the top of the funnel — see below.
- **State machine:** Journey gates enforce order phases (PAYMENT → TESTING → EXPORT → IMPORT → CUSTOMS → RELABEL → DELIVERY → CLOSE).
- **N:N sourcing:** one supplier PO serves multiple clients; one client line splits across supplier POs.
- **Per-line testing:** some MPNs need WHL, some self-test, some none; all testable lines must PASS (or the escrow's own `whlVerdict`) before release/journey gates open. Testing lifecycle (where a lot physically is) and testing verdict (PASS/FAIL) are **two separate axes** — see Testing Lifecycle below.
- **Masked:** the order masks the buyer from the supplier (relabel at 1Buy hub = masking act). The RFQ module's supplier/buyer portals enforce the same masking — never leak the other party's identity.

## RFQ Module (front of the funnel)

Client demand comes in as an RFQ, gets aggregated across buyers, floated to multiple competing suppliers, decided on, Finance-approved, and only then turns into a formal PI-backed Client PO / Supplier PO pair. Flow:

```
Client RFQ (email/manual) → DemandLine
  → aggregated into RfqBundle (RfqLine[], by MPN + currency + date tolerance)
  → floated to N suppliers (masked "Sharpbuy" identity) → SupplierQuote per supplier
  → SC compares & picks winners per line → ClientQuoteDecision (markup %)
  → Finance approves (per-line P&L, required reason on reject) → approveQuoteDecision
  → our PI issued (ClientQuote.piNo) → buyer accepts via /portal/quote/[id]/[token]
  → ClientPO auto-created, "Raised against {ourPiNo}"
  → winning supplier(s) send their own PI → recordSellerPi (gates the next step)
  → finalizeRfqToSupplierPos → SupplierPO auto-created, "Raised against {sellerPiNo}"
  → existing SupplierPO → "Create order" flow takes over (unchanged fulfilment journey)
```

**Masking & portals:** `/portal/rfq/[bundleId]/[token]` (supplier, submits quotes, asks clarifying questions) and `/portal/quote/[clientQuoteId]/[token]` (buyer, accepts/requests changes) are public, token-gated, and render under `src/app/portal/layout.tsx` (mounts the store hydrator — **required**, since these routes get opened cold with no prior page visit; without it the store never rehydrates from localStorage and a real link shows "Invalid or expired link"). **Known limitation:** there is no backend, so a portal link only ever resolves in the *same browser* that created the quote/invite — opening it on a different device shows the same "invalid" state, because there's genuinely nothing to hydrate from. This is accepted for now; a real backend is planned.

**Two separate approval boards, don't confuse them:** `/fulfilment/approvals` is order-level (PO_REVIEW/payment/escrow gates). `/fulfilment/quote-approvals` is RFQ-decision-level (Finance approves/rejects a `ClientQuoteDecision` with per-line P&L before it goes out as a client PI).

## Tech Stack

| Category | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 (strict mode) |
| Runtime | React 19 |
| UI primitives | **Hand-rolled** (`src/components/ui/primitives.tsx`, `form.tsx`) — no shadcn/Radix/Tailwind component library |
| Styling | Tailwind CSS v4 with CSS custom properties (`globals.css`, `theme.css`) |
| State | Zustand v5 + immer middleware + `persist` (localStorage) — single store, no server state library |
| Utilities | `clsx` + `tailwind-merge` (via `cn()`), `immer` |
| Icons | Lucide React |
| Notifications | Sonner (toast) |
| Testing | none in the app itself; `@playwright/test` devDependency used ad hoc for live-flow verification scripts (not a committed test suite) |
| Mock Integration | in-memory adapters under `src/integrations/`, latency + chaos-toggle injected |

There is **no** React Query, no TanStack Table, no React Hook Form/Zod, no Axios, no Recharts, no auth layer — earlier drafts of this doc listed those aspirationally; they were never added.

## Commands

```bash
pnpm dev                    # Start dev server on http://localhost:3000
pnpm build                  # Production build
pnpm start                  # Start production server
pnpm lint                   # Run ESLint
pnpm lint:fix               # Fix lint issues + Prettier
```

No test runner configured (manual testing via UI + integration logs).

## Directory Structure

```
src/
├── app/
│   ├── fulfilment/                 # Internal console (all "Create"/"Operate"/RFQ pages)
│   │   ├── page.tsx                 # Main dashboard
│   │   ├── client-rfq/              # Incoming client RFQ intake
│   │   ├── demand-intake/           # Raw demand queue (pre-aggregation)
│   │   ├── rfq-aggregation/         # Demand → RfqBundle aggregation flow
│   │   ├── rfq-bundles/             # Supplier RFQ bundles: list, new, [id] detail, [id]/decide
│   │   ├── quote-matching-inbox/    # Manual supplier-quote-email matching
│   │   ├── quote-approvals/         # Finance approval queue for ClientQuoteDecisions (per-line P&L)
│   │   ├── client-quotes/           # Outbound client quotes (our PI), accept/decline/expiry
│   │   ├── rfq-dashboard/           # RFQ funnel KPIs
│   │   ├── directory/               # Buyer/supplier master directory
│   │   ├── client-pos/, supplier-pos/   # PO management (both `new` sub-forms use directory dropdowns)
│   │   ├── orders/                  # Order listing + workspace (13 tabs incl. Escrow, Testing)
│   │   ├── approvals/               # Order-level approvals (PO_REVIEW/payment) — NOT the RFQ one above
│   │   ├── testing/                 # WHL testing lifecycle boards
│   │   ├── escrow/                  # Escrow Agent dashboard
│   │   ├── logistics/, warehouse/, delivery/, payments/
│   │   ├── integrations/            # API call log + chaos toggle
│   │   └── guide/                   # User guide + demo walkthrough
│   ├── portal/                      # Public, token-gated, NO app sidebar
│   │   ├── layout.tsx                # Mounts StoreHydrator + Toaster — required, see RFQ Module note above
│   │   ├── rfq/[bundleId]/[token]/   # Supplier quote-submission portal
│   │   └── quote/[clientQuoteId]/[token]/  # Buyer quote-acceptance portal
│   ├── layout.tsx                   # Bare root layout (no chrome — portal relies on this + its own layout)
│   ├── globals.css / theme.css
│
├── components/
│   ├── ui/                          # Hand-rolled primitives (Panel, Button, DataTable, Pill, StatusPill, form inputs)
│   ├── layout/                      # Sidebar (NAV_GROUPS-driven), app-shell, store-hydrator
│   └── order/                       # order-workspace.tsx (tabs) + escrow-tab.tsx + testing-tab.tsx + testing-stages.tsx + modals.tsx
│
├── store/
│   ├── store.ts                     # Single Zustand store: fulfilment + escrow + testing + RFQ actions, immer + persist
│   ├── selectors.ts                 # Pure functions: gateReason, escrow readiness, testing stage derivation, RFQ ledger math
│   └── integration-log-store.ts     # SEPARATE store for the Integrations board call log — mockCall() writes here, nothing else should
│
├── integrations/                    # Mock external APIs (latency + chaos injected)
│   ├── mock-client.ts               # Shared mockCall() wrapper — every adapter routes through this; logs to integration-log-store itself
│   ├── escrow-agent.ts              # Escrow Agent adapter (invoice/PO-PI/HKin-confirmation/verdict/payment-closure fetches)
│   ├── customs-icegate.ts, logistics.ts, banking.ts, einvoice-irp.ts, doc-extract.ts, notify.ts
│   ├── lab-whl.ts                   # WHL mailbox polling + report parsing
│   ├── rfq-send.ts, rfq-intake.ts   # Supplier RFQ invite send / client RFQ email parse
│   ├── quote-intake.ts, quote-counter.ts, quote-clarify.ts, client-quote-send.ts
│   ├── component-intelligence.ts    # Stock/price lookup (demand-intake)
│   └── registry.ts                  # Adapter registry for the Integrations board
│
├── data/
│   ├── enums.ts                     # NAV_GROUPS, currencies/incoterms/payment modes, ESCROW_STATUS_ORDER, TESTING_STAGES/META, statusTone()
│   ├── fixtures.ts                  # Seed data (demo POs, hero escrow, seeded RFQ bundle + quotes)
│   ├── directory.ts                 # BUYERS / SUPPLIERS master directory (dropdown source, no more free-text party names)
│   └── order-details.ts
│
└── types/
    └── index.ts                     # Central types: Order, Escrow*, SupplierPO, Shipment, Testing*, RFQ*, etc.
```

## Key Patterns

### Escrow (Escrow Agent model — rebuilt, no longer HKIN-direct)
Escrow is now a simulated **email-action-library** ("Escrow Agent"), not a direct fund/release API. `Escrow.status` (`EscrowOrderStatus`) moves strictly forward through 8 stages:
```
DRAFT → SENT_FOR_SELLER_CONFIRMATION → SELLER_CONFIRMED → ESCROW_FEE_INVOICED →
TT_PAYMENT_RECEIVED → GOODS_SHIPPED → RECIPIENT_INSPECTION → RELEASED_TO_SELLER
```
- **No more `materialAmount`/`escrowRemaining` release cap.** Instead: `poAmount` (total under escrow) + `milestoneReleases[]` tracking each tranche of the invoice's real `releaseMilestones` (`{percent, trigger}` free text). Release readiness is computed per-tranche by `escrowMilestoneTriggerMet()` (keyword-matches the trigger string against shipment/testing/goods-received state), not a stored decrementing number.
- **Every outbound email** goes through `sendEscrowEmail(orderId, purpose, draft, milestoneIndex?)` — always via a reviewable/editable compose modal first, never silent. **Every inbound email** goes through `receiveEscrowEmail(orderId, purpose)`, dispatched by the single `checkEscrowInbox(orderId)` action (a state machine over `status` that always applies exactly the one next expected item).
- `releaseEscrow`/`refundEscrow` as standalone functions **no longer exist** — release/refund are both two-step instruct-then-confirm flows through `sendEscrowEmail` + `checkEscrowInbox`.
- Release is still lab-anchored: `escrowReleaseReadiness()` requires every testing-required line to have a `Lot.testStatus === "PASS"` **or** the escrow's own parallel `whlVerdict === "PASS"` (WHL can be commissioned directly on the escrow side, bypassing the Testing tab).
- **"Create HKin order" is step 0, before `DRAFT`'s other actions.** Only
  shown while `status === "DRAFT"`, it calls `createHkinOrder(orderId)` →
  `POST escrow-agents:8000/escrow/orders/{orderId}/create-on-hkin` — this
  launches a **real Playwright RPA** (`hkin-rpa`, a separate project nested
  inside the backend repo, not part of this app) that fills HKin's actual
  live order-creation form with this order's buyer/seller/recipient
  contacts + `b.lines`, then stops at HKin's own Confirmation screen for a
  human to review and submit. It never auto-submits anything. See
  `../pushkar-poc-backend/hkin-rpa/CLAUDE.md` for how that automation
  actually works, and `../pushkar-poc-backend/CLAUDE.md`'s note on
  `create-on-hkin` for the backend side. `Escrow.hkinRpaStartedAt` records
  when it was last launched; it does **not** mean a real HKin order exists
  yet — only that a human was asked to go create one.
- **`ord-201`/`ord-202` in fixtures.ts are demo-ready orders** for this
  flow specifically — unlike most seed orders (`ord-180`..`ord-200`),
  which carry placeholder `"—"` seller/recipient contact data by design
  (they never leave this app), these two have real, complete contact data
  via a new `EscrowSeedScenario.contactsOverride` field, so "Create HKin
  order" actually goes through live without hitting the placeholder-email
  guard on the backend. Use this pattern (`contactsOverride`) for any
  future seed order that needs to exercise this specific flow.

### Testing Lifecycle (separate from testing verdict — two axes, never conflate)
- **`TestingStage`** (where a lot physically is, forward-only): `TEST_REQUESTED → WHL_PAYMENT → SUPPLIER_DISPATCHING → COMPONENTS_RECEIVED → TESTING_STARTED → TESTING_IN_PROGRESS → TESTING_COMPLETED → REPORT_PREPARATION → REPORT_SHARED`. Driven mostly by `syncWhlInbox()` polling lab mail (`moveStage()` is forward-only), plus explicit operator input for `SUPPLIER_DISPATCHING` (no mail from the lab can establish this) and `WHL_PAYMENT` (finance-confirmed).
- **`TestStatus`** (`PENDING|PASS|FAIL|MAYBE`, the verdict) lives on `Lot.testStatus`, derived from WHL's `conclusion` + any F.A.R. process flag — completely independent of stage. A lot can be `REPORT_SHARED` (stage) with verdict `MAYBE` (an Acceptable report with an F.A.R. process still needs follow-up).
- **Lab payment** is a third, separate track: `Lot.labPayment?.status` (`NOT_REQUESTED→REQUESTED→INVOICE_RECEIVED→SENT_TO_FINANCE→PAID`) — WHL bills for testing itself, separate from the test report and from escrow.

### Gate Guards (Journey Phases)
`gateReason()` in `src/store/selectors.ts` — PAYMENT gate now checks the new escrow model directly:
```ts
if (step.phase === "PAYMENT") {
  if (b.escrow) {
    if (b.escrow.cancelledAt) return "Escrow order was cancelled…";
    return escrowStatusIndex(b.escrow.status) >= escrowStatusIndex("TT_PAYMENT_RECEIVED") ? null : "Escrow T/T payment not received yet…";
  }
  return b.payments.some(p => p.direction === "1BUY_TO_SUPPLIER" && ...) ? null : "Supplier payment not initiated yet.";
}
```
Other phases: TESTING (all testable lines PASS) → EXPORT (inbound shipment dispatched) → IMPORT (inbound arrived) → CUSTOMS (BOE filed) → RELABEL (`OrderBundle.relabelledAt` set — manual "Mark relabelled" action) → DELIVERY (e-invoice + all lines mapped) → CLOSE (every `Approval` on the order is APPROVED, vacuously true if none exist).

### N:N Sourcing & Allocations
- One **Supplier PO** can serve multiple **Client POs** (lines reference client PO no. + client line MPN); one **Client PO line** can split across multiple **Supplier POs**.
- **Order** tracks sourcing allocations + per-line testing mode (NONE/SUPPLIER_SELF/WHL).
- **Delivery** queues only show unallocated received MPNs; allocate = map order line to client line.

### Zustand Store Pattern
Single store (`src/store/store.ts`), immer + persist, one big action surface spanning fulfilment + escrow + testing + RFQ:
```ts
const useStore = create<Store>()(
  persist(
    immer((set, get) => ({
      // fulfilment
      createClientPo: (payload) => set((s) => { s.clientPos.push(...) }),
      createOrderFromSupplierPo: (spoId) => set((s) => { s.orders[id] = scaffoldBundle(...) }),
      advanceStep: (orderId) => set((s) => { /* gateReason() guard, else step.status = "DONE" */ }),
      // escrow (action-library, not direct fund/release)
      sendEscrowEmail: (orderId, purpose, draft, milestoneIndex) => { /* ... */ },
      checkEscrowInbox: (orderId) => { /* dispatches receiveEscrowEmail for the one next expected item */ },
      // RFQ (front of funnel)
      createRfqBundle: (input) => { /* ... */ },
      approveQuoteDecision: (decisionId) => { /* sets decidedBy/decidedAt, calls sendClientQuote → issues our PI */ },
      recordSellerPi: (supplierQuoteId, piNo) => { /* gates finalizeRfqToSupplierPos */ },
    })),
    { name: "poc-sourceops", version: 13, migrate: () => undefined, skipHydration: true },
  ),
);
```
`skipHydration: true` + a manual `<StoreHydrator />` (mounted in `AppShell` for `/fulfilment/*`, and separately in `src/app/portal/layout.tsx` for the public portals) defers rehydration to after mount so SSR and first client render match. **Bump `version` and rely on `migrate: () => undefined`** (unconditional discard, not a conditional `from < N` check) whenever the schema changes — the conditional-migrate pattern was replaced because it silently kept incompatible old shapes when a version number was reused across independent branches of work.

## Naming Conventions

- **Files:** `kebab-case.tsx` / `kebab-case.ts`
- **Components:** `PascalCase`
- **Types:** `index.ts` (centralized, not per-domain)
- **Constants:** `SCREAMING_SNAKE_CASE`

## Code Style

- **ESLint:** `@typescript-eslint/no-explicit-any` is OFF; `no-console`/`no-unused-vars` WARN
- **TypeScript:** strict mode; no `any` unless unavoidable
- **`'use client'`:** for interactive components; the RFQ portal pages are all client components under a bare `layout.tsx` (no sidebar)
- **No UI library:** don't reach for shadcn/Radix — extend `src/components/ui/primitives.tsx`/`form.tsx` instead
- **Directory-first for party names:** never add a free-text buyer/supplier name input — wire a dropdown from `src/data/directory.ts` (`BUYERS`/`SUPPLIERS`), resolve display names by matching `email` (case-insensitive), fall back to the raw email/id if not found — never truncate an email to its local-part for display (two suppliers can share a local-part and become indistinguishable)

## Known Limitations & Caveats

- **No backend:** all data in-memory + localStorage; resets on page reload. **This is intentional for now — a real backend is planned "in a few days" (as of 2026-08-01); don't build client-side workarounds for cross-device data sharing (e.g. encoding payloads into URLs) in the meantime.**
- **No tests:** manual testing via UI; `@playwright/test` is available for one-off live-flow verification scripts, not a committed suite
- **Mocks only:** Escrow Agent, ICEGATE, WHL, logistics, banking, e-invoice, doc-extract, RFQ/quote mail are in-memory with latency injection
- **Chaos toggle:** on Integrations board; failures injected when enabled (for resilience testing)
- **No real auth:** mock user auto-loaded (structure in place for future backend)
- **Portal links are single-browser only:** see RFQ Module section above

## For New Developers

1. **Read DOMAIN.md** — business context (masked trade, 1Buy masking, 3-entity model)
2. **Read ARCHITECTURE.md** — system design, data flows, subsystems
3. **Read RULES.md** — coding conventions, patterns, DO/DON'Ts
4. **Run `pnpm dev`** → http://localhost:3000/fulfilment
5. **Click "↺ Reset demo"** to reload seed data (includes a pre-seeded RFQ bundle with 3 competing supplier quotes, ready for the Decide/Approve/PI flow with no manual setup)
6. **Open Integrations board** in a second tab to watch mock API calls in real-time
7. **Read `docs/demo/demo-flow.md`** for a guided walkthrough of a complete order

## GitHub

- **Repo:** https://github.com/pushkar-lead/poc-sourceops-workflow (remote name unchanged by the local folder rename below)
- **Branch:** main
- **Visibility:** private
- **Status:** POC (no deployment pipeline)

## Note on this folder's name

Renamed 2026-08-12: local folder `poc-sourceops-workflow` → `pushkar-poc-ui`
(sibling `escrow-agents` → `pushkar-poc-backend`, with `hkin-rpa` moved
inside it). This is a local rename only — the git remote/repo name above is
untouched. Prose elsewhere in this file may still say
"poc-sourceops-workflow"/"escrow-agents" — same projects.
