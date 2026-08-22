// THE TESTING QUEUE — how one order's testing stands, and what to do about it next.
//
// Deliberately modelled on `lib/logistics-order.ts`: a `*View` derived per order, a
// pressure bucket to filter by, a `nextAction()` sentence, and an urgency sort. The
// Testing board renders exactly those four things, the same way the Logistics queue
// does, so the two desks read alike.
//
// Nothing here mutates state or reads the store — pure derivation off an OrderBundle,
// so the board, the workspace and any future surface can share one answer.
import type { OrderBundle, TestingStage } from "@/types";
import {
  testingSummary, labFeeOutstandingTotal, overdueUpdateRequests, unmatchedEmails,
  testAutofillGaps, orderPhaseTimings, lotStage, type PhaseAtRisk,
} from "@/store/selectors";
import { stageIdx, TESTING_STAGE_META } from "@/data/enums";

/**
 * Where the order is on the testing pipeline, and how it came out. Five buckets, **mutually
 * exclusive** — an order lands in exactly one, so the chip counts always sum to the queue
 * length, which is what makes them trustworthy as a filter row.
 *
 * `FAILED` / `PASSED` split the finished end by verdict (added 2026-08-21), which leaves
 * `COMPLETED` meaning "every result is in, but it is not a clean pass" — a `MAYBE` lot, an
 * F.A.R. closed out, a not-conducted process accepted. That residual is deliberate: an order
 * whose lots are neither all-PASS nor any-FAIL is a real state someone has to look at, and
 * folding it into either of the other two would hide it.
 *
 * Cut down from five *problem* buckets first (`HELD`, `ACTION`), because those described what
 * kind of trouble an in-progress order was in, and the board-level question is how far along it
 * is. Those signals still drive the row's pills, `nextTestingAction`, the row accent and the
 * `attention` tie-break in the sort — don't re-add them as buckets.
 */
export type TestingPressure = "FAILED" | "IN_PROGRESS" | "BOOKED" | "COMPLETED" | "PASSED";

/** Worst first — also the chip order, so the row reads left-to-right as "most urgent first". */
export const TESTING_PRESSURE_ORDER: TestingPressure[] = ["FAILED", "IN_PROGRESS", "BOOKED", "COMPLETED", "PASSED"];

export const TESTING_PRESSURE_META: Record<TestingPressure, {
  label: string; tone: "bad" | "warn" | "info" | "ok" | "neutral"; what: string;
}> = {
  FAILED:      { label: "Failed",               tone: "bad",     what: "At least one lot's verdict is FAIL — someone has to decide retest or return, and the escrow refund path hangs off it." },
  IN_PROGRESS: { label: "In progress",          tone: "info",    what: "Lots are at the lab with results still open, or something needs a human (mail to match, a chase past SLA, an unpaid advance holding a lot)." },
  BOOKED:      { label: "Booked — not started", tone: "neutral", what: "The order has a testable line but no test lot has been raised at the lab yet." },
  COMPLETED:   { label: "Completed",            tone: "warn",    what: "Every result is in but it is not a clean pass — a MAYBE lot, an F.A.R. close-out or an accepted not-conducted process." },
  PASSED:      { label: "Passed",               tone: "ok",      what: "Every lot's verdict is PASS — the testing gate is satisfied and the escrow release condition is met." },
};

export interface TestingView {
  pressure: TestingPressure;
  /** Lot / test tallies (order-wide, never lot-scoped — that's the workspace's job). */
  lots: number;
  tests: number;
  passed: number;
  open: number;
  far: number;
  failed: number;
  reports: number;
  /** Attention signals, each individually worth surfacing on a row. */
  unmatched: number;
  overdue: number;
  gaps: number;
  /** Lab-fee position: what is owed, and which lots the lab is holding for it. */
  feeCurrency: string;
  feeGross: number;
  feeCount: number;
  held: string[];
  /** The least-advanced lot's lifecycle stage — the order moves at the speed of its slowest lot. */
  slowestStage?: TestingStage;
  slowestLotCode?: string;
  atRisk?: PhaseAtRisk;
  /** 0–100, share of tracked tests that passed. */
  pct: number;
  /** How many separate things want attention — the tie-break in the sort. */
  attention: number;
}

export function testingView(b: OrderBundle): TestingView {
  const sum = testingSummary(b);
  const fees = labFeeOutstandingTotal(b);
  const overdue = overdueUpdateRequests(b).length;
  const unmatched = unmatchedEmails(b).length;
  const gaps = testAutofillGaps(b).length;
  const atRisk = orderPhaseTimings(b).find((p) => p.phase === "TESTING")?.atRisk;

  // the order moves at the speed of its slowest lot, so that's the stage the row reports
  const slowest = b.lots.reduce<{ stage?: TestingStage; code?: string; idx: number } | null>((acc, l) => {
    const idx = stageIdx(lotStage(l));
    return acc === null || idx < acc.idx ? { stage: lotStage(l), code: l.lotCode, idx } : acc;
  }, null);

  const attention = unmatched + overdue + gaps + sum.failed + sum.far + fees.blocking.length + (atRisk ? 1 : 0);

  // the verdict axis, off `Lot.testStatus` — independent of how far the lifecycle has moved
  const anyFail = b.lots.some((l) => l.testStatus === "FAIL");
  const allPass = b.lots.length > 0 && b.lots.every((l) => l.testStatus === "PASS");

  // Order of these tests is the whole semantics:
  //  · no lot raised ⇒ BOOKED whatever else is true — nothing is at the lab, and an unparsed
  //    test list is the normal state of a fresh order, so an untouched order must never claim
  //    to be in progress;
  //  · a FAIL outranks open tests — it needs a decision now, not when the rest finishes;
  //  · all-PASS is terminal and good;
  //  · anything still open or wanting a human is in progress;
  //  · what's left is finished-but-not-clean.
  const pressure: TestingPressure =
    b.lots.length === 0 ? "BOOKED"
      : anyFail ? "FAILED"
      : allPass ? "PASSED"
      : sum.open > 0 || attention > 0 ? "IN_PROGRESS"
      : "COMPLETED";

  return {
    pressure,
    lots: sum.lots, tests: sum.tests, passed: sum.passed, open: sum.open,
    far: sum.far, failed: sum.failed, reports: sum.reports,
    unmatched, overdue, gaps,
    feeCurrency: fees.currency, feeGross: fees.gross, feeCount: fees.count, held: fees.blocking,
    slowestStage: slowest?.stage, slowestLotCode: slowest?.code,
    atRisk,
    pct: sum.tests ? Math.round((sum.passed / sum.tests) * 100) : 0,
    attention,
  };
}

/**
 * The one thing to do next, as a sentence. Ordered by what actually blocks the order:
 * money the lab is waiting on, then mail nobody has filed, then a lab that has gone
 * quiet, then results that need a decision, then paperwork.
 */
export function nextTestingAction(b: OrderBundle, v: TestingView): string {
  if (v.held.length > 0) return `Pay WHL's advance invoice — ${v.held.join(", ")} held, not on the bench`;
  // booking lives inside the order, so the sentence sends them there rather than implying the
  // queue row can do it
  if (v.lots === 0) return "Open the order and book a test slot with the lab";
  if (v.unmatched > 0) return `Match ${v.unmatched} inbound WHL email${v.unmatched === 1 ? "" : "s"} to a test lot`;
  if (v.overdue > 0) return `Chase WHL — ${v.overdue} update request${v.overdue === 1 ? "" : "s"} past SLA`;
  if (v.failed > 0) return `Decide retest or return — ${v.failed} not-acceptable result${v.failed === 1 ? "" : "s"}`;
  if (v.far > 0) return `Close out ${v.far} F.A.R. process${v.far === 1 ? "" : "es"}`;
  if (v.gaps > 0) return `Parse the test list — ${v.gaps} MPN${v.gaps === 1 ? "" : "s"} never auto-filled`;
  if (v.feeCount > 0) return `Send ${v.feeCount} WHL invoice${v.feeCount === 1 ? "" : "s"} to finance (${v.feeCurrency} ${v.feeGross.toLocaleString()})`;
  if (v.tests === 0) return "No tests on file yet — auto-fill them off the PO";
  if (v.open > 0) {
    const at = v.slowestStage ? TESTING_STAGE_META[v.slowestStage].label.toLowerCase() : "the lab";
    return `Awaiting WHL — ${v.open} test${v.open === 1 ? "" : "s"} open, slowest test lot at ${at}`;
  }
  return "Nothing pending — every result is in";
}

/** Worst first: bucket severity (`TESTING_PRESSURE_ORDER`), then how many things want attention, then newest order. */
export function sortTestingQueue<T extends { b: OrderBundle; view: TestingView }>(rows: T[]): T[] {
  const rank = (p: TestingPressure) => TESTING_PRESSURE_ORDER.indexOf(p);
  return [...rows].sort((x, y) =>
    rank(x.view.pressure) - rank(y.view.pressure)
    || y.view.attention - x.view.attention
    || (x.b.orderNo < y.b.orderNo ? 1 : -1));
}
