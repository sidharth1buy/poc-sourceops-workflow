# 1Source Ops — Demo Flow (~10 min)

**What this is:** the internal, fulfilment-only ops console for 1Buy's masked back-to-back Mode-4 trade. Clients & suppliers never log in. RFQ → quote → PO approval → supplier PI happen upstream on the sourcing platform; **this console picks up an approved order (PI in hand) and runs fulfilment.**

**Before you start:** click **↺ Reset demo** (top-right) to load fresh seed data. It's a POC — dummy data + in-process **mock** external APIs (ICEGATE, HKIN escrow, WHL lab, logistics, banking, e-invoice). Light theme, dark sidebar.

---

## Act 0 — Orient (30s)
- **Order Processing** (the landing page) — KPIs (open orders, approvals, payments due, tests pending, blocked, escrow-to-release), a **Needs attention** list, and **every** order with a status filter. Clicking a row opens that order's single-page flow view.
- Point out the grouped sidebar: **Order Processing** at the top · **Create** (Client/Supplier POs) · **Operate** (Approvals, Testing, Logistics, Customs, Warehouse, Delivery) · **Finance & Tax** (Payments, Escrow) · **Reference** (Directory, Integrations, Guide). There's no separate "Orders" item — the landing page is the list, and the work is done on the boards.
- (Optional) the **persona** switch (SC / Finance / Approver / Mgmt) jumps to that role's home.

## Act 1 — The demand: Client PO (1 min)
- **Client POs** → open **`BEL/26-27/PO/0042`** (Bharat Defence Electronics — **domestic**, pays us **ADVANCE**, GSTIN, **Bengaluru delivery address**). Two lines, each with **MPN + manufacturer + date code**. Status pill: **fully sourced**.
- (Optional) **New Client PO → Upload PO → Parse & pre-fill** — the mock doc-extract fills a GEES sample; note the **tabbed** form (Client & parties / PO terms / Demand lines), the **`*` required** markers, the **buyer delivery address** fields, and the now-**separate free-text *Delivery terms* and *Testing terms*** on the PO-terms tab.

## Act 2 — The buy: Supplier PO (1 min)
- **Supplier POs** → open **`SPO-2026-0221`** (Shenzhen Apex — **international**, we pay on **ESCROW**, FOB, **Ship to: 1Buy hub**). Note **mixed per-line testing**: TMS320 = **WHL**, AD7768 = **supplier self-test**. Both lines are **linked** to the client PO. The card shows **6 T&C** and a **relabel cost**.
- (Optional) **New Supplier PO → Upload PO/PI → Parse** — prefills supplier + terms + **unlinked** lines; show the **per-line Testing** selector, the **Terms & Conditions** tab (tickboxes), the **Credit → 30/60/90** picker (when *We pay = Credit*), the **CIF → Ship-to port** field, and note there's **no margin** on this create form.
- Click **Create order →**.

## Act 3 — The order & the masked model (1 min)
The order lands **ACTIVE** with the **journey stepper**. Walk the tabs:
- **Overview** — the masked chain **Buyer → Sharpbuy (us) → Supplier**; commercials + **margin** + **relabelling cost**; **PO terms** (delivery / testing / destination port); the **Terms & Conditions** panel; **Supplier PI** (Upload PI); **Delivery — inbound (1Buy hub) & outbound (buyer)** addresses.
- **Lines** — per-line make / date code / **testing mode**. **Allocations** — the N:N mapping (consolidate/segregate). **Journey** — the full gated state machine.

## Act 4 — Drive it end-to-end (the escrow path) (4–5 min)
Use the header **Advance** button; each gate blocks with a reason until satisfied. Keep the **Integrations** tab open in another window to watch live API calls.

1. **Fund escrow** (gate) → **Escrow** tab → **Fund** → HKIN mock funds the super-invoice (**A1 + A2 + banking charges + fees**). Point out the **Payment terms**, **Release trigger** (*Per T&C + lab PASS*), and **Window expiry** on the account. *This is the buyer's advance held safely.* → **Advance**.
2. **Testing — WHL** (gate, **per-line**) → the order's **Testing** tab (or sidebar **Testing** → pick this order — same screen either way) → **Add lot** for TMS320 → **Fetch WHL** → PASS; **Add lot** for AD7768 → set/fetch PASS. *Both testable lines must PASS.* Once a lot PASSes, the banner offers **Extend window** (mock email request → response, logged on the escrow) beside **Release escrow**. → **Advance**.
3. **Release escrow on PASS** (gate) → **Escrow** tab → **Release tranche** (only allowed after a PASS; fulfilled per the agreed **T&Cs** — see the Overview panel). → **Advance**.
4. **Ship to India** (gate) → **Shipments** tab → **Create shipment** (leg INBOUND, pick a carrier) → AWB booked by the logistics mock. → **Advance**.
5. **Customs — BOE in ICEGATE** (gate) → **Customs** tab → **File BOE** → ICEGATE mock files → assesses duty → issues the clearance ref. → **Advance**.
6. **Receive + relabel to 1Buy** (the masking step) → **Advance**.
7. **e-Invoice + dispatch to client** (gate: all lines mapped) → (optional) **Delivery** tab → **Generate e-Invoice (IRN)** → **Advance**.
8. **Proof of delivery** → **Reconcile + close** → **Advance** → **CLOSED**. 🎉

## Act 5 — The integration seam & the boards (1–2 min)
- **Integrations** — the systems catalogue (env var, endpoints, priority) + the **live API-call log** with request/response/latency. Flip **Chaos** on, retry one action (e.g. File BOE) → show a simulated **API failure + error handling**, then flip it off.
- **Logistics** (AWB tracking + Refresh tracking) — the **Location** column tracks a shipment **while it's still in the origin/"away" country**, not only after it lands; **Warehouse** (received → relabel → dispatched), **Payments / Escrow / Testing / Delivery / Approvals** — the cross-order views.
- **Guide** — the **conditional flow charts**: three worked flows (Intl·Escrow·WHL / Domestic·Advance·Self / Domestic+WHL A19) + plain-English + what each gate means.

## Optional Act 6 — The advance (non-escrow) path (1 min)
Create a Supplier PO with **We pay supplier = ADVANCE**, **Domestic**, testing **Self** → **Create order**. The order arrives with **two pre-seeded payment tasks**: **Payments** tab → **Initiate T/T** on the client collection, then the supplier payout → self-test PASS → relabel → dispatch → close. (No escrow, no customs.)

---

## Headline talking points
- **Masked back-to-back**: buyer and supplier never see each other; the relabel-to-1Buy is the masking act.
- **Three entities**: Client PO (demand) → Supplier PO (our buy) → Order (fulfilment).
- **N:N spine**: one supplier PO can serve several client POs; one client line can split across supplier POs.
- **Policy-assembled gates**: the journey is built per order from payment mode / testing / route, and each gate blocks with a clear reason.
- **Real integration seams**: every external system is a mock adapter with a visible call log — swap the mock for a real `fetch()` in production.

## Known demo caveats (say them if asked)
- Async steps (fund / fetch-WHL / file-BOE) take ~1–3s — wait for the success toast before hitting Advance.
- WHL verdict is weighted-random; if a lot comes back FAIL/MAYBE, re-lot or use the manual PASS button.
- It's fulfilment-only: sourcing/RFQ/PO-approval are upstream (not shown here).
- Reset demo (↺) restarts from seed; the Chaos toggle injects ~30% API failures.

---

# Demo feedback — backlog (captured 2026-07-28)

Deduplicated from demo notes. Grouped by screen.

## Client PO — create → PO terms
1. **Split "Delivery / testing terms" into two separate fields** — a *Delivery terms* field and a *Testing terms* field — and make them **free text** (remove the dropdowns).

## Supplier PO — create
2. **"We pay supplier" → add Credit with days** — when **Credit** is chosen, show a **30 / 60 / 90 days** picker (days of credit).
3. **Incoterm-driven Ship-to** — when incoterm = **CIF** (carriage/destination variants), show a **Ship-to / destination port** field.
4. **New "Terms & Conditions" tab** — a checklist of the **common/standard conditions** as tickboxes (pre-checked defaults for the usual ones) + free text for extras.
5. **Remove the margin metric** — from the create-form footer (Buy/Sell/**Margin**) and the per-line **Mgn %**. *(scope to confirm: also the order Overview margin?)*

## Escrow
6. **Banking charges** — add a banking-charges component to the escrow super-invoice (A1 material + A2 charges + **banking charges**).
7. **Escrow payment terms** — capture payment terms on the escrow account.
8. **Release per Terms & Conditions** — escrow release is fulfilled according to the agreed T&Cs (not just "PASS").
9. **Extend feature** — request an escrow/testing-window **extension by email** and record the **response**; the **Extend** button appears **only after confirmation**, in the **Testing** context.

## Delivery / Logistics / Warehouse
10. **Delivery — prefill** the allocate/dispatch step from the order's addresses + received lots.
11. **International tracking** — track the shipment while it's still in the **origin ("away") country**, not only after it lands.
12. **Relabelling cost** — capture the relabel cost at the hub (feeds landed cost).

*Status: **IMPLEMENTED (2026-07-28)**. All 12 items shipped. Two forks resolved: margin removed on the **Supplier PO create page only** (kept on the order Overview + Allocations); escrow **Extend** = mock email request → response, surfaced **only after a lab PASS** (Testing + Escrow tabs). tsc / lint / build green; seeded escrow demo (`SPO-2026-0221`) re-traced end-to-end.*

### What changed, by screen
- **Client PO → PO terms:** *Delivery terms* and *Testing terms* are now two free-text fields (no dropdown).
- **Supplier PO → Supplier & terms:** *We pay supplier = Credit* reveals a **30 / 60 / 90** day picker.
- **Supplier PO → PO terms:** incoterm **CIF** reveals a *Ship to (destination port)* field; new *Relabelling cost at hub* field.
- **Supplier PO → Terms & Conditions (new tab):** standard clauses as tickboxes (usual ones pre-checked) + free-text extras; the count carries to the order.
- **Supplier PO → Lines:** the **Mgn %** column and the footer **Margin** figure are gone (Buy / Sell only).
- **Escrow tab:** shows **Banking charges**, **Payment terms**, **Release trigger**, **Window expiry**; super-invoice = A1 + A2 + banking + fees; **Extend window** button (after a PASS) + an extensions log.
- **Testing tab:** the post-PASS banner now offers **Extend window** alongside **Release escrow**.
- **Delivery (Allocate modal):** qty is **prefilled** to the owed cap for the picked MPN / client PO.
- **Logistics board + order Shipments:** a **Location** column / "Currently at" line — a shipment is trackable while still in the **origin (away) country**.
- **Order Overview:** new **Terms & Conditions** panel, **Relabelling cost** line, credit-days on the payment mode, testing terms + destination port in the terms panel.
