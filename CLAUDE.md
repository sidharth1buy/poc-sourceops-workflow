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
│   │   ├── page.tsx                 # "Orders Overview" — the landing page AND the one orders list (rows → order-flow)
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
│   │   ├── order-flow/[orderId]/    # READ-ONLY single-page view of one order's whole fulfilment flow (the landing page links here)
│   │   ├── orders/                  # `[id]` = the tabbed workspace (12 tabs, no Escrow). `orders/page.tsx` just redirects to /fulfilment — the list lives there now, and there is no sidebar item for it
│   │   ├── approvals/               # Order-level approvals (PO_REVIEW/payment) — NOT the RFQ one above
│   │   ├── testing/                 # order-first board (`page.tsx`) + `[orderId]/` = the acting testing workspace
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
│   └── order/                       # order-flow-page.tsx (read-only whole-flow page) + order-workspace.tsx (tabs) + escrow-tab.tsx + testing-tab.tsx (the testing screen) + testing-readonly.tsx + report-repository.tsx + testing-stages.tsx + test-tables.tsx + modals.tsx
│                                     #   (testing-view-tab.tsx is PARKED — unrendered; see its header comment)
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

### Reading surfaces vs acting surfaces
Some screens report state and some change it:

- **Read:** `/fulfilment/order-flow/[orderId]` — one order's **entire** fulfilment flow on a single page (deal → demand → money → testing → logistics → customs → warehouse → evidence). **No Approvals section** (removed 2026-08-20 — order-level approvals are read on the Approvals board) and **no Delivery section** (folded into Logistics the same day, see below), phase-ordered, each section headed by its journey phase's real state + gate reason. The landing page's order rows and its "needs attention" list point here.
- **Act:** `/fulfilment/orders/[id]` — the tabbed workspace (Advance, cancel, add/edit records), including its **Testing tab**, which mounts the same acting `TestingTab` the Testing board opens at `/fulfilment/testing/[orderId]`. One screen, two doors — don't fork it.

**The tabbed workspace is now only reachable from the boards' order columns.** The order-flow page has no door to it at all, and neither do the two per-order acting screens it links out to (the testing route's `Order workspace` button and the escrow detail's `Open full order workspace →` were removed 2026-08-20, along with the flow page's Testing-section link to `/fulfilment/testing/[orderId]`, and then the Testing-board link that briefly replaced it). `/fulfilment/orders/[id]` still holds actions that exist nowhere else — line→client-line **allocation** and the Documents/Overview tabs chief among them — and ~18 links across Logistics, Warehouse, Delivery, Customs, Payments, Approvals and Supplier POs still point at it (Delivery's `Allocate →`, Warehouse's `Open →`, and `supplier-pos`' post-create redirect *depend* on it). Don't sweep those to the flow page until the actions themselves have a board to live on.

**Nav shape:** **Orders Overview** (`/fulfilment`) is the first item of the sidebar's **Supply Chain** group — the orders list, not a separate dashboard. (It used to sit alone in an "Admin" group above; that group was dropped 2026-08-19.) There is no second "Orders" item, because the day-to-day work happens on the per-discipline boards below it (Testing, Logistics, Customs, Warehouse, Delivery, Payments, Escrow, Approvals). An order's own pages hang off `/fulfilment/order-flow/*` and `/fulfilment/orders/*`, and `sidebar.tsx` keeps that item lit while you're inside either (`ORDER_PROCESSING_ROUTES`).

Rules for the read side: it renders the **same selectors and the same components** as the acting screens and never recomputes a number (or re-lays-out a document) of its own; it holds no control that changes the order; and **as of 2026-08-20 it carries no outbound navigation at all** — every section's board link (Testing, Escrow, Logistics, Customs, Warehouse, Delivery, Payments, Approvals, Integrations) was removed along with the `ActLink` helper and `FlowSection`'s `action` prop, and the persona-gate note's inline `escrow board` link is now plain text. `FlowSection` has no slot for a link anymore, which is the point: don't reintroduce one. The only links left on the page are the "Back to Orders Overview" breadcrumb and the in-page section rail.

**The section rail** (`SectionRail`, driven by the `JUMP` const) is that in-page table of contents. It is **sticky** (`top-14` — a few px under the app header's measured 59px so its top edge tucks *behind* the header rather than leaving a sliver of scrolling content in a gap; header is `z-20`, rail `z-10`), each chip carries its section's own icon, and the one chip that stands out is the section currently on screen — filled `bg-primary`, tracked by an `IntersectionObserver` over the section elements (band `-150px 0px -55%`) rather than by scroll maths. Clicking a chip smooth-scrolls and updates the hash via `replaceState`; sections carry `scroll-mt-32` so the heading clears both sticky bars. **The rail is navigation and nothing else** — chips coloured by phase state with ✓/lock glyphs and a `N blocked` counter were built and then cut (2026-08-20) because the journey rail directly above and every section's own heading pill already report that status; don't reintroduce them. `JUMP` is the single source of truth — adding or removing a section means editing that list, not starting a second one. **Where a section maps to a sidebar board, it wears that menu item's icon** (`NAV_GROUPS` in `data/enums.ts`) on both the chip and the section heading: Logistics → `Truck`, Customs → `Stamp`, Testing → `FlaskConical`, Money → `Landmark` (Escrow), Deal → `Users` (Directory). Delivery has no menu item of its own, so it takes `PackageCheck` rather than re-using Logistics' `Truck`.

**Shipments render as the Logistics board renders them, read-only** (the old "Freight" section and its bespoke shipment cards were replaced 2026-08-20; anchor `#freight` → `#logistics`). `ShipmentTable` is the one rendering: a `DataTable` with the board's columns — carrier · AWB (tracking link) · qty · tracking · **stage** · location · customs — off the same `shipmentStage`/`STAGE_META` (`lib/shipment-stage.ts`) and the same `hasCustoms`/`needsCustoms` derivation `allShipments()` applies board-side, so an operator sees one shape in both places. Two one-order adaptations: the board's `Order` column becomes the shipment no., and its `Leg` column is gone because the caller scopes the leg. The per-shipment detail the board defers to `/logistics/shipments/[id]` — route, boxes, weight, dates, MPN lines — expands inline instead, since this page never navigates out.

**All logistics live in the one Logistics section, in two `LegBlock`s** — **Inbound logistics** (supplier → the 1Buy warehouse) and **Outbound logistics** (the warehouse → the client). `ShipmentTable` is mounted once per block. There is deliberately **no separate Delivery section**: dispatching to the client *is* the outbound leg, so the outbound block carries its shipment row **and** its paperwork — GST e-invoice, the `b.deliveries` allocation table (received qty → sales-order line, with PoD) and "available to allocate". Splitting them apart put the same movement on the page twice, which is what this merge undid; don't re-split. Consequence to accept, not to "fix": the outbound block runs *after* Customs and the Warehouse relabel, which render **below** it — the block's own hint says so rather than the page reordering itself. The section's `steps` therefore span `EXPORT`/`IMPORT` **and** `DELIVERY`, so its heading pill reports whichever of those the order is actually at ("part done" is normal mid-flow).

**"Hub" is called "Warehouse" on this page** (renamed 2026-08-20, anchor `#hub` → `#warehouse`, `HubSection` → `WarehouseSection`, icon `Building2` → the sidebar's `Warehouse`), and the page's own copy says "1Buy warehouse" throughout. The **data model is untouched** — `OrderBundle.hubAddress` and the fixtures' `"1Buy hub — New Delhi …"` address strings keep their names, because those strings are shared with shipment `fromLocation`/`toLocation` values and the Logistics/Warehouse boards. The page's "Open order workspace" button and its per-section `?tab=` deep links into `/fulfilment/orders/[id]` had already gone the same way: reading an order must not door back into the old tabbed layout. Other boards still link here (see below). **Reading a document is not "changing the order"** — a report can be opened and downloaded from the flow page, and both write the NDA access-log row there exactly as in the workspace, because that log (not the absence of a button) is the invariant. Persona gates still apply — escrow amounts/fees/wire details stay behind `canAccessEscrow`, matching the escrow board, while escrow *status and triggers* are visible to everyone because the rest of the flow depends on them.

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
- **`escrow-tab.tsx` is 4 tabs, not one long scroll (2026-08-21):** `EscrowTabKey = "action" | "correspondence" | "details" | "documents"`, rendered via the shared `FormTabBar` (`src/components/ui/primitives.tsx`). **Action** = the main status/stepper panel + whichever action panel is currently relevant (`PaymentFlowPanel`/`WhlTestingPanel`/`ReleasePanel`/`PaymentClosurePanel`). **Correspondence** = `AgentInboxPanel` (the email log) on its own — it used to render dead last after every other panel, which meant a full-page scroll just to see recent activity; it's now one click away regardless of how many action/reference panels an order has. **Details** = `PurchaseOrderPanel`, the three `ContactPanel`s, and `InvoicePanel` — read-once-then-rarely-touched reference info. **Documents** (`DocumentsPanel`) = the escrow paper trail's own status — PO/PI (already on file from order setup, sourced from `b.documents`/`b.piNo`), the HKin invoice (`e.invoice`, arrives by mail — its correspondence lives on the Correspondence tab, this just tracks receipt), and the WHL testing report **per lot**, deliberately read from each `Lot`'s own `currentReport()` (`src/store/selectors.ts`) rather than the flat `documents` array, since that's the real source of truth for revisions. No Payment Closure row — that step is only a reference number (`EscrowPaymentClosure.documentNo`), not an actual document. The compose-email and ask-HKin modals stay outside the tab conditionals (they're overlays, not tab content, and can be triggered from the Action tab regardless of which tab is currently showing).
- **"Send email" (2026-08-21)** — a button beside the tab bar opens `SendEscrowEmailModal`, styled like `ComposeWhlEmailModal` on the Testing tab: a **Party** dropdown (HKin/Supplier/Finance) and a **Purpose** dropdown scoped to that party (`optionsFor()`), then the usual To/Cc/Subject/Body fields pre-filled via `draftFor()`. This exists so nobody is blocked from nudging someone just because the state machine hasn't produced a contextual button yet (e.g. HKin never sends the invoice). Purposes not yet due (e.g. "Payment confirmation to HKin" before Finance has confirmed) stay **fully selectable** in the Purpose dropdown (labelled "— not due yet", never HTML-`disabled`) — picking one shows an amber `Notice` explaining why it's unusual but still lets it send, because the entire point of this feature is that nothing is ever hard-blocked. (An earlier pass disabled those options outright, which defeated the purpose and was reverted the same day.) `EscrowSendPurpose` gained 4 ad-hoc values for this (`CHASE_INVOICE_FROM_HKIN`, `GENERAL_INQUIRY_HKIN`/`_SUPPLIER`/`_FINANCE`) — the mock send path (`mockSendEscrowDraft`'s `default:` case) already logs unrecognized purposes with no field mutation, so these needed no mock changes. `EscrowMailOption` is a `kind: "compose" | "decision"` union: **compose** options (the 9 `EscrowSendPurpose`-backed ones above) show the usual To/Cc/Subject/Body fields; **decision** options — Accept All, Accept Partially, Reject All, Request Extension, listed under the HKin party — swap those out for whatever that decision actually needs and call `acceptEscrowGoods`/`rejectEscrowGoods`/`requestEscrowExtension` directly instead of `sendEscrowEmail`, since they're real buyer decisions, not just correspondence. Specifically: **Accept All** shows a read-only "Amount accepted" pre-filled with the full `poAmount` (Send is always enabled). **Accept Partially** requires its own "Amount accepted" (`acceptEscrowGoods`'s `input.amount`, folded into the logged email's snippet) plus an optional note — Send stays disabled until an amount is entered. **Reject All** pre-fills Reason with a stock "the testing report for order {orderNo} has come back as failed" message (`defaultRejectReasonFor()`, shared with the equivalent `WhlTestingPanel` prompt so both doors start from the same wording) and adds an optional testing-report file upload (`rejectEscrowGoods`'s new `reportFileName` param, stored as the logged email's `attachmentFileName` — mock-only, filename captured not real storage, same convention as every other upload in this app) — both fields stay fully editable. `TextPromptModal` (the older per-button prompt inside `WhlTestingPanel`) gained the matching `type: "file"` field kind so its own Accept-Partially/Reject prompts got the same amount/report-upload treatment, keeping both doors in sync. These same decisions are **also** still reachable as their original contextual buttons inside `WhlTestingPanel` during Recipient Inspection (`prompt`/`setPrompt`, unchanged) — the modal is an additional door, not a replacement, matching how "Payment instruction to Finance" already had two doors (`PaymentFlowPanel`'s button and this modal) before decisions were added. An earlier version tried to list every possibility as a giant grouped dropdown-of-buttons hanging off the trigger instead of a modal — it was visually overwhelming and was scrapped in favor of this Party/Purpose-dropdown shape; a version after that excluded the decisions entirely, which undersold "every possibility" and was corrected same-day into what's described here.
- **Request extension now carries a day count** — `TextPromptModal`'s field shape gained an optional `type: "number"` (renders an `Input` instead of a `Textarea`); the "extension" prompt asks for `days` (default 2) alongside the reason. `requestEscrowExtension(orderId, reason, days)` extends `Escrow.inspectionDeadline` by that many days immediately after the email sends — a deliberate POC simplification, since no real HKin approval step is modelled, the request is treated as granted on send rather than waiting on a reply.
- **Accept/Reject now log a correspondence entry** — `acceptEscrowGoods`/`rejectEscrowGoods` previously only flipped `whlVerdict` with zero trace in `agentEmails`; both now also push a `SENT` entry (to HKin, cc the seller) so the Correspondence tab reflects every real decision, not just the emails that went through the compose modal.
- **Release-funds and fund-Finance instructions are approval-gated (2026-08-25)** — these two `EscrowSendPurpose`s move real money, so clicking "Send" on either no longer sends immediately. `sendEscrowEmail` (`store.ts`) checks the purpose against `APPROVAL_GATED_PURPOSES` (`RELEASE_FUNDS_INSTRUCTION` → kind `ESCROW_RELEASE_FUNDS`, `PAYMENT_INSTRUCTION_TO_FINANCE` → kind `ESCROW_FUND_INSTRUCTION`, both role `"Finance"`); if gated, it pushes a `PENDING` `Approval` onto `b.approvals` carrying the composed draft (`Approval.escrowSend: { purpose, milestoneIndex?, draft }`) and returns — nothing is sent yet. The Approvals board (`/fulfilment/approvals`, already fully generic over `kind`) picks it up with zero UI changes. Only once someone clicks **Approve** there does `decideApproval` call `sendEscrowEmail(..., skipApprovalGate: true)` with the parked draft — the same send path every other purpose uses, just deferred. **Reject** just leaves the approval decided; nothing is ever sent. Both compose-review modals (`ComposeEmailModal` and the unified `SendEscrowEmailModal`) relabel their Send button to "Submit for approval" and show a `Notice` for these two purposes, and both entry-point buttons (`PaymentFlowPanel`'s + the invoice panel's "payment instruction to Finance", `ReleasePanel`'s per-milestone "release X%") swap to an `AwaitingApproval` pill (with a link to the Approvals board) while a matching `PENDING` approval exists, so the button doesn't just sit there clickable-but-inert. Pitfall hit and fixed while building this: `decideApproval`'s `set()` callback captured `a.escrowSend` (an immer draft) into an outer variable to use *after* `set()` returned — immer revokes that proxy the instant the producer exits, so reading it afterward threw `Cannot perform 'get' on a proxy that has been revoked`. Fixed by snapshotting into a genuinely plain object (`{ purpose, milestoneIndex, draft: {...draft} }`) inside the producer, not just copying the reference.

### Persona Access Control (2026-08-20)
Four desks are gated to one persona each, all via the same pattern: a `*_ACCESS_ROLES: Role[]` constant in `src/data/enums.ts`, exposed as a `canAccess*` boolean on `useRole()` (`src/lib/role.ts`), checked as an early return rendering the shared `RoleLocked` component (`src/components/ui/primitives.tsx`) wrapped in the page's own `PageHeader`/`Panel`. **Escrow, Testing, Sales Orders (`client-pos`) and Purchase Orders (`supplier-pos`) are all SC-only; Payments is Finance-only** — escrow order handling moved from Finance to SC on 2026-08-20 (Payments itself, the actual money-movement/mark-paid actions, stayed with Finance). The gate lives on each board's top-level page **and** any dedicated per-order route it owns (e.g. `escrow-order-detail.tsx`, `/fulfilment/testing/[orderId]`) — it does **not** reach into components those pages share with the unrestricted order workspace (`TestingTab` is also mounted, ungated, on the workspace's own Testing tab; don't assume gating one door closes the other). When adding a new gated hook call before other hooks in a component, remember React's hook-order rule: the `if (!canAccess...) return …` must come **after** every other hook in the component, not before — several of these gates had to be moved down past a `useMemo`/`useState` during this change because of exactly that.

### Testing Lifecycle (separate from testing verdict — two axes, never conflate)
- **Test slots come before any lot** (2026-08-21). `OrderBundle.testSlots: TestSlot[]` — the desk books a slot **only from inside the order** — the board's `Test slot` column is read-only (a button there could only book "something on this order", and a booking is per-MPN with quantities, samples and a plan). Entry points are the workspace's Test-lots section header and each MPN heading (`Book another test slot`; that header renders before the empty state so an order with no lots can still book, and reads "<slotNo> is still with the lab — one booking at a time" while one is pending) — `BookTestSlotModal` opens with **one row** — an MPN `<Select>` over the order's testable lines plus lot qty / sample qty / date code / an optional per-row **Preferred start** / test checklist — and `+ Add MPN` repeats the block for another part (every row has a `🗑 Delete`, the last one included — an empty booking is recoverable and beats a control that appears with the row count; picking a different MPN re-seeds its quantities off that line; the slot-level preferred start is the default and a row's own is quoted only when it differs; duplicate MPNs are allowed since one line split across two date codes is two lots). It used to render a block per testable line with a tick to exclude — backwards for a booking that is usually one part. **No standard field**: the lab states the standard on its confirmation, which **only mails the lab**. The modal is two steps — details, then a **draft review** (`draftTestSlotMail` builds it from the same `buildSlotMail()` the send uses, so what you see is what goes; subject and body both editable) — and only then `requestTestSlot` writes the outbound `BOOKING_REQUEST` and the `REQUESTED` slot. No outbound mail in this module leaves unseen; don't add a send path that skips the review. **We never quote the lab a reference of ours** — `slotNo` is internal, absent from the mail and its subject; the lab issues the appointment no and a work order per lot, and a re-test cites *those* ("your appointment X, work orders a, b"). Tests go out as a **numbered list** per MPN, not a comma run. **`pendingTestSlot(b)` then blocks the workspace** (`canAct = canEditTests && !pending`) — mail stays open because checking it is the way out. The pending notice's action is `Get <lab>'s reply` (labelled as demo-generated; the real integration polls the mailbox) — `syncWhlInbox` answers a pending slot **first and returns**, filing the inbound `BOOKING_CONFIRMED`, writing each MPN's spec from the plan we asked for, and **creating the lots** at `TEST_BOOKED`. A **re-test** is another slot with `retestOfSlotId`: its lots are stamped straight through to `COMPONENTS_RECEIVED` (the parts never left the lab), are code-prefixed `RT<n>-`, carry a `re-test of <slotNo>` pill, and the modal defaults to only the failed MPNs. `BOOKING_CONFIRMED` is excluded from the match queue — it is order-level by design. The lab issues a **work order per lot when it approves the booking**, so the confirmed slot strip shows them as `WORK ORDERS  <no> <lotCode>` pills (a pending slot says they arrive with the confirmation) — that number is what the lab's invoices and reports quote.
- **`TestingStage`** (where a lot physically is, forward-only, **9 stages**): `TEST_BOOKED → SUPPLIER_DISPATCHING → COMPONENTS_RECEIVED → TESTING_IN_PROGRESS → TESTING_COMPLETED → REPORT_SHARED → WHL_PAYMENT → RETURNED_TO_SELLER → ASSIGNED_TO_LOGISTICS`. **`WHL_PAYMENT` moved behind the report 2026-08-21** — the lab invoices after issuing it, so at index 1 the stage described a billing model WHL doesn't use and left every live lot showing an un-started payment stage for weeks. Request/upload the invoice from that stage's panel. Knock-on: `labFeeBlocking()` still models an unpaid *advance* holding the bench, which can't happen in this order any more; the machinery stays because terms are read off whatever document arrives, never assumed. **The last two were added 2026-08-21** because a shared report is not the end of the lot's physical journey: the samples still leave the lab (`markLotReturnedToSeller`, stamping `returnedToSellerAt`) and the lot still gets handed to the freight desk (`assignLotToLogistics`, whose click *is* stage 9 — the chain now ends on an act of ours, not a document from the lab). Both derive off their own fields in `derivedStage`, and skipping the return is legal since `moveStage` is forward-only. **Every stage is established by an inbound mail**, all of it through `syncWhlInbox()` (`moveStage()` is forward-only): the lab's invoice/receipt/progress/report mails, the *supplier's* dispatch advice relayed onto the same thread, and WHL's payment acknowledgement. `recordSupplierDispatch` / `markLabFeePaid` / `setLotStage` remain as labelled by-hand fallbacks. **`TEST_REQUESTED` was renamed `TEST_BOOKED` (2026-08-21)** — the stage is established by the lab's **booking appointment**, the document that names which lots go in, the sample pulled from each, the work order and the agreed test plan. `uploadBookingAppointment(orderId, file | null)` reads it (`extractBookingAppointment` in doc-extract) and **creates the lots *and* their test trackers in one step**; `file === null` is the demo/auto-fill path. It takes an optional **`lotId`**: the **Add-lot modal** calls it *without* one (that call is what **creates** lots), and every other surface passes one — re-reading an appointment against an existing lot happens on that lot's card action row (`⬆ Booking appointment` picker + `Auto-fill` ghost). Labs book per lot, so applying LOT-B's appointment must not touch LOT-A, and scoping also narrows what reaches the parser to that lot's line so a re-read can't invent lots for unbooked lines. The order-wide header pair and a copy on the lifecycle chain both existed briefly and were removed — don't reintroduce them. **`AddLotModal` is two-mode** (2026-08-21): *From booking appointment* (PDF picker + a sample-data button) or *Enter details by hand*, the latter carrying a `WHL_PROCESSES` test-plan checklist because §9.2 is parked and that form is now the only way a hand-typed plan gets in — ticked tests are written onto the lot **and** onto the MPN's spec (`MANUAL`, audited) so the two can't drift. This **replaced `autofillMpnTests` / "Auto-fill tests from PO"**: the PO says what the buyer requires, the appointment says what the lab agreed to run on which lots, and the tracker mirrors the second — so `TestSource` is now `AUTO_BOOKING | MANUAL` and the pill reads `from booking`. `extractPoTestRequirements` is left in place but wired to nothing; comparing the PO's contractual table against the appointment is the obvious next feature. `TESTING_STARTED` and `REPORT_PREPARATION` were removed deliberately — "in progress" already says the lot is on the bench and "report shared" already says the write-up finished; don't reintroduce them. **The Test-lots section groups by MPN by default** (`Group by MPN` / `Flat list` toggle) and that grouping is **driven by the order's testable lines, not by which MPNs have lots** — a part with nothing booked yet is exactly the one you came to book, so it shows with an empty note and its own **`Book test`** button (opens `BookTestSlotModal` with `onlyMpn`, pre-selecting row 1; the picker and `+ Add MPN` still work). Headings carry the mode pill, make, order qty, lot count, `sampled X of Y` and a verdict roll-up. The section's `Book test slot` header button remains the order-level entry.
- **`TestStatus`** (`PENDING|PASS|FAIL|MAYBE`, the verdict) lives on `Lot.testStatus`, derived from WHL's `conclusion` + any F.A.R. process flag — completely independent of stage. A lot can be `REPORT_SHARED` (stage) with verdict `MAYBE` (an Acceptable report with an F.A.R. process still needs follow-up).
- **Lab payment** is a third, separate track: `Lot.labPayment?.status` (`NOT_REQUESTED→REQUESTED→INVOICE_RECEIVED→SENT_TO_FINANCE→PAID`) — WHL bills for testing itself, separate from the test report and from escrow. The invoice mail also states the **terms** (`LabInvoice.terms`: `ADVANCE` | `CREDIT`) plus the per-process rate, and those terms decide what an unpaid fee *means*: on credit the lab tests on account so it blocks nothing; on advance it holds the lot, so `labFeeBlocking(lot)` is a real gate after `COMPONENTS_RECEIVED`. Terms are never chosen in the app — only read off the lab's document: normally parsed from its mail, or, when that mail never arrives or the bill came by another medium, **read off a PDF the operator uploads** from the lot's fee panel. That control is a plain file picker, **not a modal** (rebuilt 2026-08-21): a hidden `<input type="file" accept=".pdf">` per lot whose handler calls `uploadLabInvoiceFile(orderId, lotId, {name, size})`, which runs `extractLabInvoice` (doc-extract mock) and writes the invoice — amount, tax, rate, terms, due date and all — off the document, still flagged `entered by hand` on the lot and on the finance ledger. It replaced a 13-field hand-entry modal (`uploadLabInvoiceManually` + `UploadLabInvoiceModal`, both deleted): re-keying WHL's own figures was the likeliest way to get `terms` wrong, and `terms` decides whether a lot is held. Don't put the form back. Finance settles it from the **Payments board's "WHL testing" tab** (`/fulfilment/payments?tab=whl`, fed by `allLabFees`) — a third money leg beside client→1Buy, 1Buy→supplier and customs duty — which calls the same `markLabFeePaid` the lot's own panel does.
- **One test list, rendered twice.** The lot tracker (status + the report's process result folded into each row, via `lotTestRows`) and the per-MPN requirements × lots matrix. A third rendering is always a duplicate — the report's processes are rolled onto `lot.tests` on fetch, which is why the report block shows only a count roll-up.
### Testing board & workspace — Logistics-queue idiom (2026-08-21)
`/fulfilment/testing` was rebuilt to read like the Logistics queue, and `src/lib/testing-queue.ts` is its `lib/logistics-order.ts` — pure derivation (no store access) exporting `TestingPressure` (`FAILED → IN_PROGRESS → BOOKED → COMPLETED → PASSED`, worst first and mutually exclusive so chip counts sum to All), `TESTING_PRESSURE_META`, `testingView(b)`, `nextTestingAction(b, v)` and `sortTestingQueue()`. **The order the buckets are tested in is the semantics** (2026-08-21): no lot ⇒ `BOOKED` (an order with nothing at the lab hasn't started, and an unparsed test list is normal for a fresh order — without this precedence 23 of 24 demo orders claimed to need a human) → any lot `FAIL` ⇒ `FAILED` (a decision now, and the escrow refund path hangs off it) → every lot `PASS` ⇒ `PASSED` → open tests or attention ⇒ `IN_PROGRESS` → else `COMPLETED`, the deliberate residual meaning "every result in but not a clean pass" (a MAYBE lot, an F.A.R. close-out). The old `HELD` / `ACTION` buckets were dropped because both describe an order that is *in progress*, so as chips they answered "what kind of problem is it" when the board-level question is "how far along is it"; those signals still drive the row pills, the action sentence, the row accent (red = FAILED / held lot / behind clock, amber = anything else wanting a human) and the `attention` sort tie-break, so the worst in-progress orders stay on top. Don't re-add them as buckets. The board is **one section**: `Orders with testing` — pressure chips + search + pagination, columns order · tests passed · slowest lot's `TestingStageBar` · lab fee · **action to perform** (bucket pill + the `nextTestingAction` sentence), whole row → the workspace — plus board-wide attention cards for unmatched mail and money owed to WHL that no per-order row could show. A second cross-order `Lots at the lab` table was built and removed the same day: an order's lots belong on that order's workspace, so don't re-add it here.

The **workspace** (`testing-tab.tsx`) was rebuilt the same day and then again: the old full-height "WHL testing — MPN × lot × test" panel is gone, and the screen now reads **sections first** — only the order-level controls (lot scope, Check mail, Add lot) sit above the **`SectionSwitcher`**, then the active section. The header's roll-up metrics row (`n/m tests passed` + bar, lots/reports, open / F.A.R. / not-acceptable / fee pills) and the whole third **Testing overview** section were removed 2026-08-21: every number in them is already on the lot rows below where the lot is named, and a section that restates them is a page to scroll past. That removal **parked** the per-MPN surface — `MpnTestMatrix`, `addMpnTest`/`removeMpnTest`, the spec metadata and its audit trail have no mount point now (see `CONTEXT.md` §9.2, kept for whoever brings it back); a lot's tests are still listed and settable per lot via `LotTestTable` in the lot card. The `Needs attention` panel that briefly sat between them was **removed 2026-08-21**: every action on it (`Reconcile to PO on file`, `Chase again`, `Escalate`, and the three "go to that section" links) already existed on the report row, the lot card and the section badges, so it was a second copy of controls sitting between the reader and the work. Don't rebuild it — cross-order attention lives on the board's own cards instead. Don't put another panel between the header and the switcher. The switcher is a **segmented control** — the same pattern the app header uses for personas — sitting on **one row with the order-level controls** (tabs left, controls right, no "WORK THE ORDER" heading). It has been three things: an underlined tab strip (missed entirely), then a grid of icon+description cards (found, but at two sections they read as banners), now this. Each tab is icon + label + an attention badge, hint text demoted to `title`, and the **filled** active tab is the one thing kept through all three. Badge labels arrive ready-pluralised; don't auto-suffix an "s". There are **two**: **Lots · status & actions** and **Communication** (renamed from "WHL mail" 2026-08-21, because it now holds the `Result circulated` block **and one merged correspondence list** — `labEmails` plus every party notification off `lot.notifications` (supplier / buyer / escrow / WHL / finance) in one `ThreadRow` shape, since "what has been communicated?" is one question — that block moved out of every lot card, since circulating a result *is* communication, just aimed at the supplier/buyer/escrow/lab instead of the lab thread; sending is still `Next actions` on the lot, this is the record). The **9-column lot roll-up table was deleted** as a second rendering of the lot cards; its bulk bar moved to the top of the Lots section (and lost its `all`/`with report`/`acceptable`/`not acceptable`/`F.A.R.` quick-select presets 2026-08-21 — the card ticks *are* the selection), its checkboxes onto each `LotCard` title row, and its Progress/scope affordances were already duplicated by the card's stepper and the top toolbar's lot selector. Full spec: `docs/whl-testing-module/CONTEXT.md` §9.0a (board) and §9.1 (workspace).

**Testing calls it a "test lot" in every label** (2026-08-21) — *Test lots · status & actions*, *Add test lot*, *Select test lots*, *All test lots*, *Slowest test lot*, *N test lot(s)*. The **types and fields stay `Lot`/`lots`/`lotCode`**: this was copy, not a model rename, and churning every selector would buy nothing. Long explanatory sentences still say "the lot" where repeating "test lot" reads worse.

**Logistics hand-off.** `Lot.logisticsAssignedAt`/`logisticsAssignedBy` + `assignLotToLogistics(orderId, lotId)` — a **stamp, not a booking**: it moves no stage and creates no shipment. The lot card shows `🚚 Assign to logistics` once `lotStage === "REPORT_SHARED"` (nothing is cleared to move before the report) and it becomes a `✓ Assigned to logistics` pill; the action is idempotent. The Logistics board then lists it in a `Test lots assigned to logistics · N` panel above its order queue (via `assignedTestLots()`), with a `Book freight` button into the existing `?order=&lot=` create-shipment flow. Own panel because it is a lot, not an order, and the freight isn't booked yet.

- **One acting screen, mounted twice; one read-only rendering.** `testing-tab.tsx` (all the WHL mail / report-fetch / stage / fee / verdict / reconcile actions) is what both the order workspace's **Testing tab** and the Testing board's `/fulfilment/testing/[orderId]` render — same component, same actions, either way in. The **order-flow page's Testing section** is the read-only rendering, and it stays deliberately thin: per lot, `testing-readonly.tsx`'s `LotReadOnlyDetail` renders the `readOnly` lifecycle stepper plus `ReportRepository` (read in full + download, both access-logged) — **and nothing else**. A vertical stage list, a per-test table and a requirements-by-MPN roll-up were each tried there and cut as repeats of something already on the page or on the acting screen; don't re-add them (CONTEXT §9.0 keeps the reasoning). `readOnly` **removes** the stepper/fee action rows and a report's reconcile action; that's distinct from `canEdit={false}`, the persona gate. Full spec: `docs/whl-testing-module/CONTEXT.md` §9.0.

### Payments Board — unified worklist + urgency highlighting (2026-08-20, redesigned same day)
`/fulfilment/payments` is a **worklist, not a record browser** — deliberately not modeled on the Escrow board's per-order card pattern, since most rows here need exactly one simple action (attach proof, mark paid), not a multi-step per-order flow. `page.tsx`'s `Leg` type normalizes all four ledgers (client/supplier/customs duty/WHL fee) into one shape so every leg kind renders through the same table, filters and action cell — the grouped-by-order view is a different *cut* of this same `legs` array, never a second implementation.
- **Two views, one dataset:** `view: "worklist" | "byOrder"`. **Worklist** (default) is every leg from every order mixed into one flat, urgency-sorted list — the actual fix for "an urgent item buried in a long per-order scroll": nothing requires picking a leg-type tab first. **By order** keeps the old per-order accordion (collapse/expand a whole order's legs together) for when you genuinely want one order's full picture.
- **Urgency**: `paymentUrgency(mode, dueDate, open)` (client/supplier legs, which carry a `PaymentMode`) and `dateUrgency(dueDate, open)` (WHL fee legs, date-only, no ESCROW rule since there's no `PaymentMode` on a lab fee) — **overdue** (red/`bad`), **due within `URGENT_WITHIN_DAYS`=5** (amber/`warn`), or **ESCROW mode while pending** (amber, regardless of date — funding escrow blocks the order the moment it's needed). Customs duty legs have no due-date field at all yet, so they carry no urgency badge. Shown as: a colored pill next to the due date, the row background (`DataTable`'s `rowAccent` prop), the top `LegSummary` cards ("N urgent" overrides the plain open-count pill), a sticky always-visible "🔴 N urgent" toggle (see below), and the sort order (`openFirst`'s `urgencyRank` param — urgent-first within the open group).
- **Filters**: search (order no./party), leg (`LEG_FILTERS`), status (All/Pending/Settled), and an "urgent only" toggle — all apply identically to both views via one `matchesQuery(leg)` predicate. The old `?tab=customs`/`whl`/`client`/`supplier`/`order` deep-link (still used by the Customs desk's "Pay on Payments" button) is read once on mount and mapped into `view`/`legFilter` initial state, not a separate URL-synced tab system anymore.
- **Sticky control bar** (`sticky top-16`, `top-16` = below the app header's own `sticky top-0` bar) keeps the view toggle, urgent-count badge and filters on-screen no matter how far the list is scrolled — the actual answer to "urgent payments get missed in a long scroll," not just color coding.
- **Inline row actions, no bulk.** Every payable leg gets a compact proof/reference `Input` + "Mark paid" `Button` *directly in its own row* (`ActionCell`, per-row draft state in `proofByRow: Record<legId, string>`) — no expand-a-row-below editor anymore. Deliberately **not** bulk-select-and-pay: proof of payment is mandatory per payment (not one shared reference across a batch), so there's no world where bulk "mark N paid" is correct here even at high order volume. A leg that isn't payable yet (duty not assessed, WHL invoice not in) shows a link to go handle that upstream instead of the action.
- Pagination (`WORKLIST_PAGE_SIZE`=15, `ORDER_PAGE_SIZE`=10, the same `Pagination` component used on Escrow/Orders/PO/SO lists) — the worklist paginates legs, the By-order view paginates order-groups.
- `createOrderFromSupplierPo` seeds a CREDIT payment's `dueDate` as `createdDate + creditDays` (falls back to 30) so the countdown has something to act on from day one; `AddPaymentModal` also collects a due date now (auto-suggested +30d on CREDIT) since it never did before.

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

### 6-Phase Fulfilment Clock (2026-08-20)
`orderPhaseTimings(b)` in `src/store/selectors.ts` measures estimated-vs-actual time across 6 phases of an order's life — built so 1Buy can tell clients where delays happened and commit to dates, not just track current state (which `JourneyStep`/`gateReason()` already do). **Fully derived on read**, same precedent as `gateReason()`/`labFeeBlocking()`/`mpnFeeRollup()` — nothing new is persisted beyond two raw timestamps (below); everything else is computed from fields that already existed.
- **The 6 phases, in order**: Funding → Preparing for Supply → Testing → Inbound Logistics → Warehousing → Outbound Logistics. Testing is tracked as **one interval per order** (aggregated across all its lots via `lotStageEventAt()`, min/max of `Lot.stageHistory` events), not per line/lot, even though the underlying lab data model is per-lot. Confirmed flow: WHL testing **always** round-trips through the supplier afterward (pass or fail) before Inbound Logistics starts — there is no direct WHL→hub path.
- **New fields** (only two): `Escrow.fundedAt` (stamped the instant status reaches `TT_PAYMENT_RECEIVED` — `escrow-mock.ts`'s `simulateInbound()`, backfilled defensively for the real-backend path via `withFundedAtStamp()` in `store.ts`) and `OrderBundle.whlReturnedToSupplierAt` (manual confirmation via the new `markTestingReturnedToSupplier` action, mirroring `markRelabelled()` — this app can't observe the physical handoff itself).
- **Estimated durations**: `PHASE_DEFAULT_DAYS`/`PHASE_LABELS` in `src/data/enums.ts` — mode-aware for Funding (ADVANCE/ESCROW/CREDIT, CREDIT always 0 since there's no funding gate), testing-mode-aware for Preparing for Supply. Placeholder day counts, not derived from real ops data — one constant block, easy to tune later.
- **"At-risk" flagging**: each phase has its own `*AtRisk()` check (private in `selectors.ts`) for whether the phase is stalling on **1Buy's own side** specifically (vs. supplier/client/external waits) — e.g. Funding/ESCROW walks the exact pre-funding sub-steps that are 1Buy-actionable (HKin order creation, instruct Finance, confirm to HKin) and excludes genuinely external waits (seller acceptance, HKin's own confirmation); Testing reuses the existing `outstandingLabFees()`/`overdueUpdateRequests()` selectors plus a new "testing done, not yet marked returned" check; Logistics/Warehousing reuse the same booking-failed/not-booked/customs-stuck conditions their own boards already compute. `RISK_GRACE_DAYS` (`enums.ts`) gates each check with a short grace period shorter than the phase's own estimate, so the alert lands early enough to actually prevent the delay.
- **Where it surfaces**: the Timeline section on the Order Overview page (`order-flow-page.tsx` — the whole-flow read-only page, **not** the `/fulfilment/orders/[id]` workspace route) via the shared `PhaseTimelineList`/`DurationBar` (`src/components/order/phase-timeline.tsx`, `src/components/ui/primitives.tsx`); an "action needed" `Pill` + `rowAccent` on the Escrow board and a `Notice` on the Escrow tab for Funding risk; the same pattern on the Testing board/tab (plus the "Mark returned to supplier" action), Customs board (`customsFilingOverdue()`), Logistics board's existing "Needs attention" panel (new outbound-not-booked rows), and the Warehouse board (which had no urgency styling at all before this).

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
- **Directory-first for party names — except on the Sales/Purchase Order "new" forms:** everywhere else, never add a free-text buyer/supplier name input — wire a dropdown from `src/data/directory.ts` (`BUYERS`/`SUPPLIERS`), resolve display names by matching `email` (case-insensitive), fall back to the raw email/id if not found — never truncate an email to its local-part for display (two suppliers can share a local-part and become indistinguishable). **Exception:** `client-pos/new` and `supplier-pos/new` dropped their `BUYERS`/`SUPPLIERS` dropdowns (2026-08-17) — the client/supplier name field is now a plain text input prefilled by `parse()` (`extractClientPo`/`extractSupplierPo`), same as every other field on those forms; it stays freely editable and is not resolved back against the directory.

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
