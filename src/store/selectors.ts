import type {
  OrderBundle, JourneyStep, ClientPO, SupplierPO, Lot, LotTest, WhlReport, TestingStage,
  EscrowFeeBreakdown, EscrowOrderStatus,
  LabPayment, LabPaymentStatus,
} from "@/types";
import { toUSD } from "@/lib/fx";
import { WHL_SLA_BUSINESS_DAYS, TESTING_STAGES, TESTING_STAGE_META, TESTING_TERMINAL_STAGE, stageIdx, ESCROW_STATUS_ORDER } from "@/data/enums";

export type OrdersMap = Record<string, OrderBundle>;

// ---- per-order allocation math (the N:N guards) ----
export const lineQty = (b: OrderBundle, mpn: string) =>
  b.lines.filter((l) => l.mpn === mpn).reduce((a, l) => a + l.quantity, 0);

// leg-aware: INBOUND (supplier→us) vs OUTBOUND (us→client) are separate pools
export const shippedForLeg = (b: OrderBundle, mpn: string, leg: "INBOUND" | "OUTBOUND") =>
  b.shipments.filter((s) => s.leg === leg).flatMap((s) => s.lines)
    .filter((l) => l.mpn === mpn).reduce((a, l) => a + l.qty, 0);

export const receivedForMpn = (b: OrderBundle, mpn: string) => shippedForLeg(b, mpn, "INBOUND");

export const allocatedForMpn = (b: OrderBundle, mpn: string) =>
  b.deliveries.filter((d) => d.clientLineMpn === mpn).reduce((a, d) => a + d.qty, 0);

// how much of an order line still needs to move on a given leg:
//   INBOUND  = ordered qty − already inbound-shipped
//   OUTBOUND = received (inbound) − already outbound-shipped
export const remainingToShipLeg = (b: OrderBundle, mpn: string, leg: "INBOUND" | "OUTBOUND") =>
  leg === "INBOUND" ? lineQty(b, mpn) - shippedForLeg(b, mpn, "INBOUND")
                    : receivedForMpn(b, mpn) - shippedForLeg(b, mpn, "OUTBOUND");
export const remainingToShip = (b: OrderBundle, mpn: string) => remainingToShipLeg(b, mpn, "INBOUND");
export const remainingToAllocate = (b: OrderBundle, mpn: string) => receivedForMpn(b, mpn) - allocatedForMpn(b, mpn);

// delivery caps tied to what THIS order actually sourced for a client line (segregation guard)
export const orderSourcedForClient = (b: OrderBundle, clientPoNo: string, clientLineMpn: string) =>
  b.sourcingAllocations.filter((a) => a.clientPoNo === clientPoNo && a.clientLineMpn === clientLineMpn).reduce((s, a) => s + a.qty, 0);
export const deliveredForClientLine = (b: OrderBundle, clientPoNo: string, clientLineMpn: string) =>
  b.deliveries.filter((d) => d.clientPoNo === clientPoNo && d.clientLineMpn === clientLineMpn).reduce((s, d) => s + d.qty, 0);

// Index into the strict 8-state escrow progression (higher = further along).
export const escrowStatusIndex = (status: EscrowOrderStatus) => ESCROW_STATUS_ORDER.indexOf(status);

export function escrowInvoiceTotals(fees: EscrowFeeBreakdown) {
  const totalFees = fees.feeToBuyer + fees.wiringFeeToBuyer + fees.feeToSeller + fees.wiringFeeToSeller;
  const totalDisbursedToSeller = fees.poTotal - fees.feeToSeller - fees.wiringFeeToSeller;
  const totalBuyerTT = fees.poTotal + fees.feeToBuyer + fees.wiringFeeToBuyer;
  return { totalFees, totalDisbursedToSeller, totalBuyerTT };
}

// Whether the real-world condition agreed at PO time has actually been met — the thing escrow is
// meant to protect, not just a manual click-through. Re-derived from data already on the order
// (line-level testingMode, lots, inbound shipments), same signals gateReason()'s TESTING phase
// already uses, so this can't drift from what the PO actually promised:
//   - lines that need testing (WHL or supplier self-test) → every one needs a PASS lot, OR a PASS
//     recorded via the Escrow tab's own WHL-verdict email action (a parallel signal — WHL is
//     commissioned directly by 1buy, so this doesn't touch the Testing tab at all)
//   - lines needing no testing at all → release once the supplier's inbound AWB is in (goods shipped)
export function escrowReleaseReadiness(b: OrderBundle): { ready: boolean; reason: string } {
  const need = b.lines.filter((l) => l.testingMode !== "NONE");
  if (need.length > 0) {
    const lotsPass = need.every((l) => b.lots.some((lot) => lot.orderLineMpn === l.mpn && lot.testStatus === "PASS"));
    const emailVerdictPass = b.escrow?.whlVerdict === "PASS";
    if (lotsPass || emailVerdictPass) return { ready: true, reason: "" };
    const whl = need.some((l) => l.testingMode === "WHL");
    return { ready: false, reason: whl ? "Waiting on WHL lab PASS result (Testing tab, or record the WHL verdict via email actions below)." : "Waiting on supplier self-test PASS result (see the Testing tab)." };
  }
  const inbound = b.shipments.some((s) => s.leg === "INBOUND" && s.awb && s.awb !== "booking…" && s.awb !== "booking failed");
  return inbound ? { ready: true, reason: "" } : { ready: false, reason: "No testing was agreed for this PO — waiting on the supplier's inbound AWB (see the Shipments tab)." };
}

// Whether ONE specific release milestone's own trigger has been met — a multi-tranche invoice has
// milestones that fire at different points (e.g. 20% on shipment, 50% on PASS), so this can't just
// reuse the single all-up escrowReleaseReadiness gate for every row. Trigger text is free-form (read
// off the invoice, not invented by this app — see EscrowConditions), so this matches on the small
// set of real-world checkpoints it actually uses, falling back to the strongest signal if unrecognized.
export function escrowMilestoneTriggerMet(b: OrderBundle, trigger: string): boolean {
  const e = b.escrow; if (!e) return false;
  const t = trigger.toLowerCase();
  if (t.includes("ship")) return escrowStatusIndex(e.status) >= escrowStatusIndex("GOODS_SHIPPED");
  if (t.includes("pass") || t.includes("report")) return escrowReleaseReadiness(b).ready;
  if (t.includes("receiv")) return !!e.goodsReceivedAt;
  return escrowReleaseReadiness(b).ready;
}

// Compares the invoice's buyer-side fee against what was agreed when the supplier PO was drafted (§7).
export function escrowFeeReconciliation(b: OrderBundle) {
  const e = b.escrow;
  if (!e?.invoice) return null;
  const invoiceFee = e.invoice.fees.feeToBuyer;
  const agreedFee = e.agreedFeeToBuyer;
  return { invoiceFee, agreedFee, match: invoiceFee === agreedFee };
}

export const journeyPct = (b: OrderBundle) =>
  b.journey.length ? Math.round((b.journey.filter((s) => s.status === "DONE").length / b.journey.length) * 100) : 0;

// A19: WHL lab is abroad → an India-origin part 1Buy tests still crosses customs (both legs)
export const customsApplies = (b: OrderBundle) =>
  b.tradeType === "INTERNATIONAL" || b.lines.some((l) => l.testingMode === "WHL");

/** Why the current gate can't be passed yet (null = ok to advance). */
export function gateReason(b: OrderBundle, step: JourneyStep): string | null {
  if (!step.isGate) return null;
  const n = step.name.toLowerCase();
  if (n.includes("approved")) {
    const a = b.approvals.find((x) => x.kind === "PO_REVIEW");
    return a && a.status === "APPROVED" ? null : "PO review not approved yet.";
  }
  if (n.includes("release escrow")) {
    return b.escrow?.status === "RELEASED_TO_SELLER" ? null : "Escrow hasn't reached Released to Seller yet (see the Escrow tab).";
  }
  if (n.includes("collect")) { // collect-before-pay for non-escrow orders
    return b.payments.some((p) => p.direction === "CLIENT_TO_1BUY" && (p.status === "INITIATED" || p.status === "PAID"))
      ? null : "No client collection recorded yet - secure buyer funds before paying the supplier.";
  }
  if (step.phase === "PAYMENT") {
    if (b.escrow) {
      if (b.escrow.cancelledAt) return "Escrow order was cancelled (see the Escrow tab).";
      return escrowStatusIndex(b.escrow.status) >= escrowStatusIndex("TT_PAYMENT_RECEIVED") ? null : "Escrow T/T payment not received yet (see the Escrow tab).";
    }
    return b.payments.some((p) => p.direction === "1BUY_TO_SUPPLIER" && (p.status === "INITIATED" || p.status === "PAID")) ? null : "Supplier payment not initiated yet.";
  }
  if (step.phase === "TESTING") {
    const need = b.lines.filter((l) => l.testingMode !== "NONE");
    if (need.length === 0) return null; // nothing on this order needs testing
    return need.every((l) => b.lots.some((lot) => lot.orderLineMpn === l.mpn && lot.testStatus === "PASS"))
      ? null : "Every line that needs testing must have a PASS lot (see the Testing tab).";
  }
  if (step.phase === "EXPORT") return b.shipments.some((s) => s.leg === "INBOUND" && s.status !== "PLANNED") ? null : "Supplier hasn't dispatched (export cleared) the inbound shipment yet.";
  if (step.phase === "IMPORT") return b.shipments.some((s) => s.leg === "INBOUND" && ["ARRIVED", "DELIVERED"].includes(s.status)) ? null : "No inbound shipment arrival recorded yet - update status on the Shipments tab.";
  if (step.phase === "CUSTOMS") return b.customs.some((c) => !!c.icegateRef) ? null : "BOE not filed in ICEGATE yet.";
  if (step.phase === "RELABEL") return b.relabelledAt ? null : "Goods not yet marked as received + relabelled to 1Buy (Journey tab).";
  if (step.phase === "DELIVERY" && n.includes("dispatch")) { // can't dispatch to client until every line is mapped to demand
    return b.lines.every((l) => unmappedForOrderLine(b, l) === 0) ? null : "Not all order lines are mapped to a client PO yet (Allocations tab).";
  }
  if (step.phase === "CLOSE") return b.approvals.every((a) => a.status === "APPROVED") ? null : "Not all approvals are resolved yet (Approvals tab).";
  return null; // manual gate (e.g. Supplier ACK + PI)
}

// ---- WHL testing: per-MPN specs, per-lot trackers, reports, correspondence ----

export const specForMpn = (b: OrderBundle, mpn: string) => (b.mpnTests ?? []).find((s) => s.mpn === mpn);

/** Tests done / total on a lot (F.A.R. and Not Conducted are NOT done - they need follow-up). */
export function lotTestProgress(lot: Lot) {
  const tests = lot.tests ?? [];
  const settled = tests.filter((t) => t.status === "PASSED").length;
  return { total: tests.length, settled, far: tests.filter((t) => t.status === "FAR").length,
    failed: tests.filter((t) => t.status === "FAILED").length,
    open: tests.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS").length,
    notConducted: tests.filter((t) => t.status === "NOT_CONDUCTED").length };
}

export const currentReport = (lot: Lot): WhlReport | undefined =>
  (lot.reports ?? []).find((r) => r.current) ?? (lot.reports ?? []).slice().sort((a, c) => c.revision - a.revision)[0];

// ---- testing lifecycle -------------------------------------------------------------

/**
 * Stage inferred purely from what's on the lot. Used as a floor under the stored
 * stage so a lot that already has a report can never *display* as "awaiting
 * dispatch" — and so lots created before the chain existed still read correctly.
 *
 * Report preparation is deliberately not derivable: it's a state inside the lab that
 * nothing on our side of the wire implies. It only ever comes from WHL telling us.
 */
function derivedStage(lot: Lot): TestingStage | undefined {
  const p = lotTestProgress(lot);
  // the report is the last thing to arrive, so having one settles the whole chain
  if ((lot.reports ?? []).length > 0) return "REPORT_SHARED";
  // every process conducted, nothing still running → the lab is done on the bench
  if (p.total > 0 && p.open === 0) return "TESTING_COMPLETED";
  if ((lot.tests ?? []).some((t) => t.status !== "PENDING")) return "TESTING_IN_PROGRESS";
  if (lot.dispatch) return "SUPPLIER_DISPATCHING";
  if (lot.labPayment?.status === "PAID") return "WHL_PAYMENT";
  if (lot.workOrderNo) return "TEST_REQUESTED";
  return undefined;
}

// ---- WHL's testing fee ----
// The fee is a parallel track: the lab works on account, so testing proceeds whether or
// not we've paid. That means the chain can legitimately run past the payment stage with
// the fee still outstanding — which is why the stepper reads the record below for that
// one node instead of trusting its index, and why this is surfaced as its own alert.

export const labPaymentOf = (lot: Lot): LabPayment => lot.labPayment ?? { status: "NOT_REQUESTED" };

export const labFeeUnpaid = (lot: Lot) => labPaymentOf(lot).status !== "PAID";

/** Lots whose lab invoice is still unpaid, worst first (received > requested > not asked). */
export function outstandingLabFees(b: OrderBundle) {
  const rank: Record<LabPaymentStatus, number> = {
    SENT_TO_FINANCE: 0, INVOICE_RECEIVED: 1, REQUESTED: 2, NOT_REQUESTED: 3, PAID: 4,
  };
  return b.lots
    .filter((l) => !!l.workOrderNo && labFeeUnpaid(l))
    .map((lot) => {
      const p = labPaymentOf(lot);
      return {
        lot,
        status: p.status,
        invoiceNo: p.invoice?.invoiceNo,
        gross: (p.invoice?.amount ?? 0) + (p.invoice?.taxAmount ?? 0),
        currency: p.invoice?.currency ?? "USD",
        dueDate: p.invoice?.dueDate,
      };
    })
    .sort((a, c) => rank[a.status] - rank[c.status]);
}

/** Total lab fee still owed on an order, by currency (mock only ever issues one). */
export function labFeeOutstandingTotal(b: OrderBundle) {
  const rows = outstandingLabFees(b).filter((r) => !!r.invoiceNo);
  return { count: rows.length, gross: rows.reduce((s, r) => s + r.gross, 0), currency: rows[0]?.currency ?? "USD" };
}

/** The stage to show for a lot: the furthest of what's stored and what's implied. */
export function lotStage(lot: Lot): TestingStage | undefined {
  const stored = stageIdx(lot.stage);
  const derived = stageIdx(derivedStage(lot));
  const i = Math.max(stored, derived);
  return i < 0 ? undefined : TESTING_STAGES[i];
}

/** Everything the stage chain UI needs for one lot. */
export function lotStageProgress(lot: Lot) {
  const stage = lotStage(lot);
  const idx = stageIdx(stage);
  const total = TESTING_STAGES.length;
  const history = lot.stageHistory ?? [];
  const complete = stage === TESTING_TERMINAL_STAGE;
  return {
    stage,
    idx,
    total,
    complete,
    done: idx + 1,
    pct: Math.round(((idx + 1) / total) * 100),
    /** what the chain is waiting on next, or null once the report is in */
    next: idx + 1 < total ? TESTING_STAGES[idx + 1] : null,
    waitingOn: idx < 0 ? "1BUY" as const : complete ? null : TESTING_STAGE_META[TESTING_STAGES[Math.min(idx + 1, total - 1)]].owner,
    /** last recorded move, for "x days at this stage" style copy */
    lastEvent: history.length ? history[history.length - 1] : undefined,
    /** stage → the event that recorded it (stages reached by a skip have none) */
    eventFor: (s: TestingStage) => history.filter((e) => e.stage === s).slice(-1)[0],
  };
}

/** Lots whose chain is parked on someone else — the "who owes us something" view. */
export function stageWaiting(b: OrderBundle) {
  return b.lots
    .map((lot) => ({ lot, ...lotStageProgress(lot) }))
    .filter((r) => !r.complete);
}

export const lotEmails = (b: OrderBundle, lotId: string) =>
  (b.labEmails ?? []).filter((m) => m.lotId === lotId);

/** Inbound mail the platform couldn't route to a lot - must be matched by hand, never dropped. */
export const unmatchedEmails = (b: OrderBundle) => (b.labEmails ?? []).filter((m) => m.direction === "IN" && !m.lotId);

/** MPNs whose PO parse failed or was never run - "needs manual review". */
export function testAutofillGaps(b: OrderBundle) {
  const testable = b.lines.filter((l) => l.testingMode !== "NONE");
  return testable
    .map((l) => ({ mpn: l.mpn, spec: specForMpn(b, l.mpn) }))
    .filter((x) => !x.spec || x.spec.autofill === "FAILED" || x.spec.tests.length === 0);
}

const businessDaysSince = (iso: string) => {
  const from = new Date(`${iso}T00:00:00`);
  const to = new Date();
  let d = 0;
  for (const t = new Date(from); t < to; t.setDate(t.getDate() + 1)) {
    const day = t.getDay();
    if (day !== 0 && day !== 6) d++;
  }
  return Math.max(0, d - 1);
};

/** "Request Update" sent and still unanswered past the SLA → chase / escalate. */
export function overdueUpdateRequests(b: OrderBundle) {
  return b.lots
    .filter((l) => !!l.lastUpdateRequestAt)
    .map((l) => ({ lot: l, days: businessDaysSince(l.lastUpdateRequestAt!) }))
    .filter((x) => x.days >= WHL_SLA_BUSINESS_DAYS);
}

/** Report-vs-order mismatches surfaced automatically (MPN, client PO, missing data). */
export function reconciliationAlerts(b: OrderBundle) {
  const out: { lotId: string; lotCode: string; reportNo: string; reportId: string; message: string; kind: "PO" | "MPN" | "DATA" }[] = [];
  for (const lot of b.lots) {
    for (const r of lot.reports ?? []) {
      if (!r.current) continue;
      for (const f of r.parseFlags) {
        const kind = f.toLowerCase().includes("client p/o") ? "PO" : f.toLowerCase().includes("mpn") ? "MPN" : "DATA";
        out.push({ lotId: lot.id, lotCode: lot.lotCode, reportNo: r.reportNo, reportId: r.id, message: f, kind });
      }
    }
  }
  return out;
}

/**
 * Roll-up for the tab header. Pass a lotId to scope every number to one lot
 * (the "view this lot's result" filter); omit it for the order-wide total.
 * Unmatched inbound mail stays order-wide - it isn't attached to a lot yet.
 */
export function testingSummary(b: OrderBundle, lotId?: string) {
  const lots = lotId ? b.lots.filter((l) => l.id === lotId) : b.lots;
  const mpns = new Set(lots.map((l) => l.orderLineMpn));
  const tests = lots.flatMap((l) => l.tests ?? []) as LotTest[];
  const emails = (b.labEmails ?? []).filter((m) => (lotId ? m.lotId === lotId : true));
  return {
    lots: lots.length,
    tests: tests.length,
    passed: tests.filter((t) => t.status === "PASSED").length,
    far: tests.filter((t) => t.status === "FAR").length,
    failed: tests.filter((t) => t.status === "FAILED").length,
    notConducted: tests.filter((t) => t.status === "NOT_CONDUCTED").length,
    open: tests.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS").length,
    reports: lots.reduce((a, l) => a + (l.reports?.length ?? 0), 0),
    awaiting: emails.filter((m) => m.status === "AWAITING_RESPONSE").length,
    unmatched: unmatchedEmails(b).length,
    gaps: testAutofillGaps(b).filter((g) => !lotId || mpns.has(g.mpn)).length,
    overdue: overdueUpdateRequests(b).filter((o) => !lotId || o.lot.id === lotId).length,
    // lab fees still owed, scoped like everything else except `unmatched`
    feesUnpaid: lots.filter((l) => !!l.workOrderNo && labFeeUnpaid(l)).length,
    feesToPay: lots.filter((l) => labPaymentOf(l).status === "INVOICE_RECEIVED").length,
  };
}

/** One row per lot for the lot-wise results table: verdict, test tally, current report. */
export function lotResults(b: OrderBundle) {
  return b.lots.map((lot) => {
    const p = lotTestProgress(lot);
    const report = currentReport(lot);
    const overdue = overdueUpdateRequests(b).find((o) => o.lot.id === lot.id);
    return {
      lot,
      progress: p,
      pct: p.total ? Math.round((p.settled / p.total) * 100) : 0,
      report,
      revisions: lot.reports?.length ?? 0,
      awaiting: lotEmails(b, lot.id).filter((m) => m.direction === "OUT" && m.status === "AWAITING_RESPONSE").length,
      overdueDays: overdue?.days ?? 0,
      // what still blocks this lot from being releasable, in one phrase
      blocker: p.failed > 0 ? "not-acceptable result"
        : p.far > 0 ? "F.A.R. - needs follow-up"
        : p.notConducted > 0 ? "process not conducted"
        : p.total === 0 ? "no tests on file"
        : p.open > 0 ? `${p.open} test(s) still open`
        : null,
    };
  });
}

// ---- cross-order rollups (queues + boards) ----
export const allApprovals = (o: OrdersMap) =>
  Object.values(o).flatMap((b) => b.approvals.map((a) => ({ ...a, orderId: b.id, orderNo: b.orderNo, party: b.buyer.name })));

export const allPayments = (o: OrdersMap) =>
  Object.values(o).flatMap((b) => b.payments.map((p) => ({
    ...p, orderId: b.id, orderNo: b.orderNo,
    party: p.direction === "CLIENT_TO_1BUY" ? b.buyer.name : b.supplier.name,
  })));

export const allLots = (o: OrdersMap) =>
  Object.values(o).flatMap((b) => b.lots.map((l) => ({ ...l, orderId: b.id, orderNo: b.orderNo })));

export const allEscrow = (o: OrdersMap) =>
  Object.values(o).filter((b) => b.escrow).map((b) => ({
    orderId: b.id, orderNo: b.orderNo, e: b.escrow!,
  }));

export const allShipments = (o: OrdersMap) =>
  Object.values(o).flatMap((b) => b.shipments.map((s) => ({
    ...s, orderId: b.id, orderNo: b.orderNo,
    hasCustoms: b.customs.some((c) => c.shipmentNo === s.shipmentNo && !!c.icegateRef),
    needsCustoms: customsApplies(b), // A19: domestic + WHL-abroad still needs a BOE
  })));

// shipped-but-unallocated, for the delivery queue
export const deliveryWork = (o: OrdersMap) =>
  Object.values(o).flatMap((b) =>
    Array.from(new Set(b.shipments.flatMap((s) => s.lines).map((l) => l.mpn))).map((mpn) => ({
      orderId: b.id, orderNo: b.orderNo, mpn,
      received: receivedForMpn(b, mpn), allocated: allocatedForMpn(b, mpn),
      remaining: remainingToAllocate(b, mpn),
    })).filter((r) => r.received > 0),
  );

export function kpis(o: OrdersMap) {
  const bundles = Object.values(o);
  const open = bundles.filter((b) => !["CLOSED", "CANCELLED"].includes(b.status)).length;
  const pendingApprovals = allApprovals(o).filter((a) => a.status === "PENDING").length;
  const paymentsDue = allPayments(o).filter((p) => p.status === "PENDING" || p.status === "INITIATED").length;
  const testsPending = allLots(o).filter((l) => l.testStatus === "PENDING" || l.testStatus === "MAYBE").length;
  const blocked = bundles.filter((b) => b.status === "ON_HOLD" || b.journey.some((s) => s.status === "BLOCKED")).length;
  const escrowToRelease = bundles.reduce((a, b) => {
    if (!b.escrow) return a;
    const idx = escrowStatusIndex(b.escrow.status);
    const parked = idx >= escrowStatusIndex("TT_PAYMENT_RECEIVED") && idx < escrowStatusIndex("RELEASED_TO_SELLER");
    return a + (parked ? toUSD(b.escrow.poAmount, b.currency) : 0);
  }, 0);
  return { open, pendingApprovals, paymentsDue, testsPending, blocked, escrowToRelease };
}

// ---- sourcing coverage: how much of a client-PO line is committed to suppliers ----
// A supplier PO is the sourcing commitment. Each PO contributes ONCE:
//   ORDERED → via its fulfilment order's live allocations (reflects map-later edits)
//   DRAFT   → via its own linked lines (order not created yet)
// The two branches are disjoint (a PO is one or the other) so no double-count.
export const sourcedForClientLine = (
  supplierPos: SupplierPO[], o: OrdersMap, clientPoNo: string, clientLineMpn: string,
) =>
  supplierPos.reduce((total, spo) => {
    if (spo.orderId && o[spo.orderId]) {
      return total + o[spo.orderId].sourcingAllocations
        .filter((a) => a.clientPoNo === clientPoNo && a.clientLineMpn === clientLineMpn)
        .reduce((s, a) => s + a.qty, 0);
    }
    return total + spo.lines
      .filter((l) => l.clientPoNo === clientPoNo && l.clientLineMpn === clientLineMpn)
      .reduce((s, l) => s + l.qty, 0);
  }, 0);

// how much of a supplier-order line has been mapped to client demand (falls back to mpn for legacy rows)
export const mappedForOrderLine = (b: OrderBundle, line: { id: string; mpn: string }) =>
  b.sourcingAllocations
    .filter((a) => (a.orderLineId ? a.orderLineId === line.id : a.orderLineMpn === line.mpn))
    .reduce((s, a) => s + a.qty, 0);
export const unmappedForOrderLine = (b: OrderBundle, line: { id: string; mpn: string; quantity: number }) =>
  line.quantity - mappedForOrderLine(b, line);

export function clientPoStatus(supplierPos: SupplierPO[], o: OrdersMap, cpo: ClientPO): "UNSOURCED" | "PARTIALLY_SOURCED" | "FULLY_SOURCED" {
  let anySourced = false, allFull = true;
  for (const l of cpo.lines) {
    const s = sourcedForClientLine(supplierPos, o, cpo.clientPoNo, l.mpn);
    if (s > 0) anySourced = true;
    if (s < l.qty) allFull = false;
  }
  if (allFull && cpo.lines.length > 0) return "FULLY_SOURCED";
  return anySourced ? "PARTIALLY_SOURCED" : "UNSOURCED";
}

export const usdRollup = (b: OrderBundle) => ({
  buyUSD: toUSD(b.buyTotal, b.currency),
  sellUSD: toUSD(b.sellTotal, b.currency),
  marginUSD: toUSD(b.sellTotal - b.buyTotal, b.currency),
});

// ---- RFQ Module Selectors ----

import type {
  DemandLinesMap, RfqBundlesMap, SupplierQuotesMap, ClientQuoteDecisionsMap, ClientQuotesMap,
  DemandLine, RfqBundle, RfqLine, SupplierQuote, QuoteLine, ClientQuoteDecision, ClientQuote, QuoteEmail,
} from "@/types";
import type { Approval } from "@/types";

// Demand ledger: aggregated qty in open RFQ bundles (no stored counter; computed)
export const demandAggregatedForLine = (rfqBundles: RfqBundlesMap, demandLineId: string): number => {
  let total = 0;
  for (const bundle of Object.values(rfqBundles)) {
    if (["DRAFT", "FLOATED", "RECEIVING_QUOTES", "QUOTES_IN", "DECISION_PENDING"].includes(bundle.status)) {
      for (const line of bundle.lines) {
        if (line.demandLineIds.includes(demandLineId)) {
          total += line.aggregatedQty;
        }
      }
    }
  }
  return total;
};

// How much of a demand line still needs RFQ'd (can be negative if over-sourced)
export const demandRemaining = (demand: DemandLine, rfqBundles: RfqBundlesMap): number =>
  demand.qty - demandAggregatedForLine(rfqBundles, demand.id);

// All RFQ bundles in open status (not SUPERSEDED/CANCELLED/decided)
export const allOpenRfqs = (rfqBundles: RfqBundlesMap): RfqBundle[] =>
  Object.values(rfqBundles).filter((b) => ["DRAFT", "FLOATED", "RECEIVING_QUOTES", "QUOTES_IN", "DECISION_PENDING"].includes(b.status));

// All quotes for one RfqLine
export const quotesForLine = (supplierQuotes: SupplierQuotesMap, rfqLineId: string): QuoteLine[] => {
  const quotes: QuoteLine[] = [];
  for (const quote of Object.values(supplierQuotes)) {
    for (const line of quote.lines) {
      if (line.rfqLineId === rfqLineId) quotes.push(line);
    }
  }
  return quotes;
};

// Cheapest quote for one RfqLine (ignores WITHDRAWN/DECLINED)
export const bestQuotePerLine = (supplierQuotes: SupplierQuotesMap, rfqLineId: string): QuoteLine | null => {
  const quotes = quotesForLine(supplierQuotes, rfqLineId)
    .filter((q) => !["WITHDRAWN", "DECLINED"].includes(q.status));
  return quotes.length ? quotes.sort((a, b) => a.unitPrice - b.unitPrice)[0] : null;
};

// Quotes visible to a supplier (isolation: only their own)
export const quotesForSupplierOnBundle = (supplierQuotes: SupplierQuotesMap, rfqBundleId: string, supplierEmail: string): SupplierQuote | null => {
  const quote = Object.values(supplierQuotes).find((q) => q.rfqBundleId === rfqBundleId && q.supplierEmail === supplierEmail);
  return quote ?? null;
};

// Unmatched supplier emails (manual-match queue)
export const unassignedQuoteEmails = (rfqBundles: RfqBundlesMap, rfqBundleId: string): QuoteEmail[] => {
  const bundle = rfqBundles[rfqBundleId];
  if (!bundle) return [];
  // Note: QuoteEmail stored separately in store; this is a placeholder for selector pattern
  return [];
};

// Approvals filtered by kind (for QUOTE_REVIEW)
export const approvalsByKind = (allApprovals: Approval[], kind: string): Approval[] =>
  allApprovals.filter((a) => a.kind === kind);

// P&L calculation: cost → markup → revenue
export const calculateLineMargin = (
  suppliedUnitPrice: number,
  suppliedQty: number,
  markupPercent: number,
): { vendorCost: number; clientUnitPrice: number; clientRevenue: number; grossMarginDollar: number; grossMarginPercent: number } => {
  const vendorCost = suppliedUnitPrice * suppliedQty;
  const clientUnitPrice = suppliedUnitPrice * (1 + markupPercent / 100);
  const clientRevenue = clientUnitPrice * suppliedQty;
  const grossMarginDollar = clientRevenue - vendorCost;
  const grossMarginPercent = vendorCost > 0 ? (grossMarginDollar / vendorCost) * 100 : 0;
  return { vendorCost, clientUnitPrice, clientRevenue, grossMarginDollar, grossMarginPercent };
};

// Alt-group validation: same group = auto-accept, different group = flag
export const validateQuoteLineSubstitution = (rfqLineAltGroupId: string, quoteLineAlternateAltGroupId: string): { valid: boolean; requiresApproval: boolean } => {
  if (rfqLineAltGroupId === quoteLineAlternateAltGroupId) {
    return { valid: true, requiresApproval: false };
  }
  return { valid: true, requiresApproval: true };
};

// Client-viewable quote (cost/margin/supplier stripped for masking)
export const clientViewableQuote = (clientQuote: ClientQuote): Omit<ClientQuote, "vendorCost" | "supplierEmail" | "marginPercent"> => {
  const { ...viewable } = clientQuote;
  return viewable;
};
