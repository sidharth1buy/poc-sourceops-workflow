// THE ESCROW QUEUE — where one order's money stands, and whose move it is.
//
// Third in the family, and deliberately built like the other two: a `*View`
// derived per order, a pressure bucket to filter by, a `nextAction()` sentence
// and an urgency sort — the same shape as `lib/logistics-order.ts` and
// `lib/testing-queue.ts`, so a desk that has learned one board can read this
// one without being taught again.
//
// Nothing here reads the store or mutates anything — pure derivation off an
// OrderBundle, so the board, the order page and anything later share one answer.
//
// THE AXIS HERE IS THE MONEY, NOT THE GOODS. An escrow order is only ever in
// one of five situations: the money has to come back, a deadline is running
// against us, we owe the next step before it can be funded, it is funded and
// riding along, or it is released and done. Everything else — which of the 8
// HKin states it sits in, which milestone is next — is detail you read once
// you have decided which order to pick up.

import type { OrderBundle, Escrow, EscrowOrderStatus } from "@/types";
import { escrowStatusIndex, escrowReleaseReadiness, orderPhaseTimings, type PhaseAtRisk } from "@/store/selectors";

/**
 * Five buckets, **mutually exclusive** — an order lands in exactly one, so the
 * chip counts always sum to the queue length, which is what makes them
 * trustworthy as a filter row. Worst first, and that is also the chip order.
 */
export type EscrowPressure = "REFUND" | "INSPECTION" | "FUNDING" | "IN_FLIGHT" | "RELEASED";

export const ESCROW_PRESSURE_ORDER: EscrowPressure[] = ["REFUND", "INSPECTION", "FUNDING", "IN_FLIGHT", "RELEASED"];

export const ESCROW_PRESSURE_META: Record<EscrowPressure, {
  label: string; tone: "bad" | "warn" | "info" | "ok" | "neutral"; what: string;
}> = {
  REFUND:     { label: "Money to recover", tone: "bad",     what: "Cancelled, rejected by HKin, or the client asked for a refund — funds have to come back and somebody has to drive it." },
  INSPECTION: { label: "Inspection open",  tone: "warn",    what: "The inspection window is running. Silence past the deadline is an implicit accept, so a decision is due before the clock runs out." },
  FUNDING:    { label: "Not funded yet",   tone: "info",    what: "Before T/T received — the steps here are mostly ours: create the order on HKin, chase the invoice, instruct Finance, confirm the payment." },
  IN_FLIGHT:  { label: "Funded — running", tone: "neutral", what: "The money is held and the goods are moving. Nothing to do here until they land and inspection opens." },
  RELEASED:   { label: "Released",         tone: "ok",      what: "Every tranche is released to the seller and the escrow order is closed out." },
};

export interface EscrowView {
  pressure: EscrowPressure;
  status: EscrowOrderStatus;
  statusIndex: number;
  /** Terminal-bad states, which read differently from an ordinary stage. */
  cancelled: boolean;
  rejected: boolean;
  /** Days until HKin's inspection deadline. Negative means it has passed. */
  daysToDeadline: number | null;
  deadline?: string;
  /** Money under escrow, and what has actually been let go. */
  poAmount: number;
  currency: string;
  releasedPct: number;
  /** Release position — the gate the last tranche waits behind. */
  releaseReady: boolean;
  releaseReason: string;
  milestonesTotal: number;
  milestonesDone: number;
  /** The invoice's fee against what was agreed at PO time — a mismatch is a real dispute. */
  feeMismatch: boolean;
  atRisk?: PhaseAtRisk;
  /** How many separate things want attention — the tie-break in the sort. */
  attention: number;
}

const DAY = 86_400_000;

/** Days between today and a date string, tolerant of the formats the fixtures use. */
function daysUntil(date: string | undefined, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.round((t - now.getTime()) / DAY);
}

export function escrowView(b: OrderBundle, now = new Date()): EscrowView | null {
  const e: Escrow | undefined = b.escrow;
  if (!e) return null;

  const statusIndex = escrowStatusIndex(e.status);
  const cancelled = Boolean(e.cancelledAt);
  const rejected = Boolean(e.applicationRejectedAt);
  const refundWanted = Boolean(e.refundRequestedAt) || e.whlVerdict === "FAIL";

  const release = escrowReleaseReadiness(b);
  const milestonesTotal = e.invoice?.conditions.releaseMilestones.length ?? e.agreedConditions?.releaseMilestones.length ?? 0;
  const milestonesDone = e.milestoneReleases.filter((m) => m.confirmedAt).length;
  const releasedPct = milestonesTotal
    ? Math.round((milestonesDone / milestonesTotal) * 100)
    : e.status === "RELEASED_TO_SELLER" ? 100 : 0;

  const feeMismatch = Boolean(e.invoice && e.agreedFeeToBuyer && e.invoice.fees.feeToBuyer !== e.agreedFeeToBuyer);
  const atRisk = orderPhaseTimings(b).find((p) => p.phase === "FUNDING")?.atRisk;
  const daysToDeadline = daysUntil(e.inspectionDeadline, now);

  const attention =
    (feeMismatch ? 1 : 0)
    + (atRisk ? 1 : 0)
    + (refundWanted ? 1 : 0)
    + (e.status === "RECIPIENT_INSPECTION" && daysToDeadline !== null && daysToDeadline <= 2 ? 1 : 0)
    + (e.status === "RECIPIENT_INSPECTION" && release.ready && milestonesDone < milestonesTotal ? 1 : 0);

  /*
   * Order of these tests is the whole semantics:
   *  · money that has to come back outranks everything — it is the only state
   *    where the amount is at risk rather than merely parked;
   *  · a running inspection window is next, because silence releases the money
   *    whether or not anyone looked;
   *  · released is terminal and good;
   *  · anything before T/T is ours to push;
   *  · what is left is funded and simply travelling.
   */
  const pressure: EscrowPressure =
    cancelled || rejected || refundWanted ? "REFUND"
      : e.status === "RELEASED_TO_SELLER" ? "RELEASED"
      : e.status === "RECIPIENT_INSPECTION" ? "INSPECTION"
      : statusIndex < escrowStatusIndex("TT_PAYMENT_RECEIVED") ? "FUNDING"
      : "IN_FLIGHT";

  return {
    pressure, status: e.status, statusIndex, cancelled, rejected,
    daysToDeadline, deadline: e.inspectionDeadline,
    poAmount: e.poAmount, currency: e.currency, releasedPct,
    releaseReady: release.ready, releaseReason: release.reason,
    milestonesTotal, milestonesDone, feeMismatch, atRisk, attention,
  };
}

/**
 * The one thing to do next, as a sentence. Ordered by what actually blocks the
 * money: recover it, decide before the clock runs, then walk the funding chain
 * step by step, then wait.
 */
export function nextEscrowAction(b: OrderBundle, v: EscrowView): string {
  const e = b.escrow!;
  if (v.cancelled) return "Cancelled — chase HKin for the refund of what was held";
  if (v.rejected) return "HKin rejected the application — reopen it or take the order off escrow";
  if (e.whlVerdict === "FAIL" && !e.refundRequestedAt) return "Testing failed — decide with the client: retest or refund";
  if (e.refundRequestedAt && !e.refundInstructedAt) return "Send the refund instruction to HKin and the supplier";
  if (e.refundInstructedAt && !v.cancelled) return "Refund instructed — chase HKin for the credit";

  switch (e.status) {
    case "DRAFT":
      return e.hkinRpaStartedAt
        ? "Send the order to the seller for confirmation"
        : "Create the escrow order on HKin";
    case "SENT_FOR_SELLER_CONFIRMATION":
      return "Waiting on the seller to confirm — check the inbox, or chase them";
    case "SELLER_CONFIRMED":
      return "Waiting on HKin's fee invoice — check the inbox, or chase it";
    case "ESCROW_FEE_INVOICED":
      if (v.feeMismatch) return "Invoice fee does not match what was agreed — query it with HKin before paying";
      if (!e.paymentInstructedAt) return "Review the invoice, then instruct Finance to pay";
      if (!e.financeConfirmedAt) return "Waiting on Finance to confirm the wire";
      if (!e.paymentSentToHkinAt) return "Send the payment confirmation and SWIFT reference to HKin";
      return "Waiting on HKin to confirm the funds landed";
    case "TT_PAYMENT_RECEIVED":
      return "Funds held — waiting on the supplier to ship within the agreed window";
    case "GOODS_SHIPPED":
      return "In transit — inspection opens when the goods are received";
    case "RECIPIENT_INSPECTION": {
      if (!e.whlVerdict) return "Record the testing verdict — the release milestone hangs off it";
      if (!v.releaseReady) return v.releaseReason || "Waiting on the release condition";
      const next = v.milestonesDone + 1;
      return v.milestonesTotal > 1
        ? `Instruct HKin to release tranche ${next} of ${v.milestonesTotal}`
        : "Instruct HKin to release the funds to the seller";
    }
    case "RELEASED_TO_SELLER":
      return "Nothing pending — released to the seller";
  }
}

/** Worst first: bucket severity, then how many things want attention, then the nearest deadline. */
export function sortEscrowQueue<T extends { view: EscrowView }>(rows: T[]): T[] {
  const rank = (p: EscrowPressure) => ESCROW_PRESSURE_ORDER.indexOf(p);
  return [...rows].sort((a, z) =>
    rank(a.view.pressure) - rank(z.view.pressure)
    || z.view.attention - a.view.attention
    || (a.view.daysToDeadline ?? 9999) - (z.view.daysToDeadline ?? 9999));
}
