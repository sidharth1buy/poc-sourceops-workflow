# PROMPT — build the WHL testing section in this codebase

Copy everything between the rulers into Claude Code in the target repo, after placing `CONTEXT.md`
somewhere in that repo (e.g. `docs/whl-testing-module/CONTEXT.md`). Fill in the four bracketed lines in
§0 if you know the answers; delete them if you'd rather Claude discovers them.

---

Read `docs/whl-testing-module/CONTEXT.md` in full before writing any code. It is the specification for a
**WHL (White Horse Laboratories) testing section** — a per-order screen that tracks every MPN's test
requirements and results from PO upload, through the lot's journey at the lab, through paying the lab's
own testing invoice, to report receipt and follow-through. Build that module in this codebase.

## 0. Host specifics

- Target screen / route: **[e.g. the Testing tab of the order workspace at src/…]**
- State layer to use: **[e.g. the existing Zustand store / Redux slice / …]**
- UI primitives to reuse: **[e.g. src/components/ui/*]**
- Permission source: **[e.g. the persona switch in the header / useAuth()]**

If any line above is blank, discover it from the codebase before starting and tell me what you chose.

## 1. Ground rules

1. **Frontend only.** No backend, no real email, no real OCR. Every external system is an in-memory mock
   adapter behind this repo's existing mock/fixture layer, with latency and injectable failures, and each
   call must be visible wherever this repo already logs mock calls. If no such layer exists, create a small
   one — the seam matters more than the mock.
2. **Match this codebase, don't import another one's style.** Reuse the existing state layer, router, UI
   primitives, formatters, toast system and file/naming conventions. Read neighbouring files first. Do not
   add a dependency without telling me why.
3. **Do not change the host's lot logic or its payment/escrow state machine.** Lot creation, numbering and
   association stay as they are; `lot.testStatus` keeps driving escrow exactly as it does today. This module
   only *adds* fields and reads them. If the host has no lot concept at all, stop and ask.
4. **The §10 invariants in CONTEXT.md are requirements, not suggestions.** In particular: never leave a
   failed parse blank, never drop unroutable inbound mail, keep every report revision, treat F.A.R. and
   Not-Conducted as unfinished, keep the buyer and supplier masked from each other, log every change, keep
   the lifecycle forward-only, keep the lifecycle stage separate from the per-test status — they answer
   different questions and must not be collapsed into one field — and treat the lab's fee as a parallel
   track that never gates testing.
5. **Product copy is verbatim.** The email/notification templates in §8 and the on-screen sentences quoted
   in §9 are the deliverable, not placeholders. Do not paraphrase them.
6. **Comment only what isn't obvious from the code** — the domain rules (masking, F.A.R., release trigger,
   why a queue exists). No narration of what a line does. Match the surrounding comment density.

## 2. Build order

Work in this sequence and keep the tree compiling at each step.

1. **Types** — §3 verbatim (adapt only the enclosing order/lot aggregate to this repo's names). Extend the
   existing lot type with `clientPoNo`, `tests`, `reports`, `lastUpdateRequestAt`, `notifications`,
   `stage`, `stageHistory`, `dispatch`, `labPayment`; add `mpnTests` and `labEmails` to the order
   aggregate.
2. **Reference data + copy** — §4 constants, the §3 status→tone mapping wired into this repo's badge
   component (render `FAR` as “F.A.R.”), §8 templates as pure functions of a context object. Both the store
   action and the compose UI must build mails from the *same* template source.
3. **Permissions** — a single `useRole()`-style hook exposing `canEditTests` / `canEmailLab` from this
   repo's permission source. Gate in one place, never inline per component.
4. **Mock adapters** — §7.1–7.5 with the stated latencies, failure codes and probability weights. The
   weights are deliberate: they produce Acceptable-with-F.A.R. reports, `PO Unknown` references and
   unroutable emails without anyone staging them.
5. **Derived state** — §5 as pure functions/selectors. `testingSummary(bundle, lotId?)` must scope every
   number except `unmatched`.
6. **Actions** — §6, in the host's state layer, with the exact semantics, audit writes and guards. Optimistic
   where an adapter is called; roll back or mark FAILED with a retry note on error. Route every automatic
   lifecycle move through the single `moveStage` helper and read its warning about which stage value to
   compare against — getting that wrong silently swallows history rows.
7. **Screen** — §9.1–9.7: the roll-up panel with lot scope selector + lot-wise results table + bulk bar,
   the alert stack, the three sub-tabs, the lifecycle stepper (§9.3a), the invoice & payment block
   (§9.3b), both action menus, the six modals, and the collapse/density rules (§9.7 — build them in
   from the start, they are not a polish pass).
8. **Logistics hand-off** — §9.8: extend the host's logistics/shipment screen to accept
   `?order=&lot=` and `?order=&lots=a,b,c`, show the tested-lot panel, and auto-open the host's
   create-shipment modal pre-filled with merged, capped quantities.
9. **Demo seed** — §13. Hardcode it in this repo's fixture layer, including the shipment headroom note
   (without it every logistics prefill is ×0 and looks broken). If persisted local state could hide the new
   seed, bump the store version / migration so it can't.

## 3. Verify before reporting back

- Typecheck, lint and a production build must all be clean.
- Actually render the screen (dev server + a real page fetch, or a browser/screenshot tool if this repo has
  one) and confirm: the three seeded lots show their different states; the revision switcher works; the
  F.A.R. report is flagged; the "Not Available" lot offers Request Update; the reconciliation and SLA
  banners appear; the manual-match queue lists the unroutable mail; the lot selector scopes the tiles;
  the bulk bar's quick filters select; both logistics deep links pre-fill with non-zero quantities.
  Verify **collapsed and expanded** states separately — a card that renders its body while collapsed
  defeats the whole density rule, and you cannot see that from the collapsed screenshot alone.
- Drive the lifecycle end to end rather than eyeballing it: from a fresh lot, poll the inbox repeatedly
  until the report lands — **touching nothing else**, since every stage is meant to arrive by mail —
  asserting that **all 7 stages are visited in order**, that none is skipped, that nothing moves
  backwards, and that a completed lot is left untouched by further polls. The stage-advance path is
  probabilistic, so **run it several times**: the ordering bugs called out in §7.3 were each
  reproducible only across repeated runs, and the advance-vs-credit branch only fires on ~45% of lots,
  so a single run will miss the held state entirely.
- Drive the fee path too: the invoice must arrive on booking **carrying its terms**, be attachable to a
  finance mail, and only a recorded payment may close the payment stage. Check both terms:
  - `CREDIT` — the payment node stays **amber** on a lot whose chain has run past it unpaid; that is the
    case index-based rendering gets wrong.
  - `ADVANCE` — the lot reads **held**, the chain stops after `COMPONENTS_RECEIVED` no matter how many
    times you poll, and sending the invoice to finance then polling once produces WHL's payment
    acknowledgement, which releases it. A lot that stays held after payment means branch ordering in
    §7.3 is wrong and the lot is deadlocked.
- Walk the §14 acceptance checklist and report any box you could not tick, with the reason.
- Then summarise: what you built, where each piece lives, what you seeded, and anything you deliberately
  deviated from in CONTEXT.md because this codebase required it.

Do not ask me to confirm the plan — the spec *is* the plan. Ask only if the host has no lot/order concept
to attach to, or if two host conventions genuinely conflict with a §10 invariant.

---

## Optional follow-up prompts

Use these only if you want the work split into sessions rather than one pass.

**Phase 1 — data + logic only**
> Read `docs/whl-testing-module/CONTEXT.md`. Implement §3 types, §4 reference data, §8 templates, §7 mock
> adapters, §5 selectors and §6 actions in this codebase's conventions. No UI yet. Keep the host's lot and
> escrow logic untouched. Then show me the action list with a one-line semantic each, and confirm typecheck
> and lint are clean.

**Phase 2 — the screen**
> Continue from the data layer already built. Implement §9.1–9.7 of `CONTEXT.md`: the roll-up panel (lot
> scope selector, six stat tiles, progress, alert stack, bulk bar, lot-wise results table with the Progress
> column), the three sub-tabs (MPNs & tests · Lots/status/reports · WHL correspondence), the per-lot
> lifecycle stepper (§9.3a), the invoice & payment block (§9.3b), the per-lot and bulk "Next actions"
> menus, the compose / notify / bulk-notify / match / record-dispatch / mark-paid modals, and the
> collapse rules in §9.7. Copy the quoted on-screen sentences
> verbatim.

**Phase 3 — logistics hand-off + seed**
> Implement §9.8 (logistics deep link `?order=&lot=` / `&lots=`, tested-lot panel, pre-filled shipment with
> merged and capped quantities) and the §13 demo seed — including the lifecycle seed rules. Verify with a
> real render that both deep links pre-fill non-zero quantities, then walk the §14 checklist.

**Audit an existing implementation**
> Read `docs/whl-testing-module/CONTEXT.md` and audit our testing section against it. Report, as a table:
> every §10 invariant that is violated, every §14 checklist item that fails, and every §8 template whose
> copy has drifted. Do not fix anything yet — just tell me what's missing, worst first.
