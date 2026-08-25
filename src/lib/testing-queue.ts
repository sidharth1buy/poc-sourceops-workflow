// THE TESTING QUEUE — how one order's testing stands, and what to do about it next.
//
// Deliberately modelled on `lib/logistics-order.ts`: a `*View` derived per order, a
// pressure bucket to filter by, a `nextAction()` sentence, and an urgency sort. The
// Testing board renders exactly those four things, the same way the Logistics queue
// does, so the two desks read alike.
//
// Nothing here mutates state or reads the store — pure derivation off an OrderBundle,
// so the board, the workspace and any future surface can share one answer.
import type {
  OrderBundle, Lot, TestSlotLine, TestingStage, TestSlotStatus, TestStatus, TestingMode,
  LabPaymentStatus, LabPaymentTerms,
} from "@/types";
import {
  testingSummary, labFeeOutstandingTotal, labFeeBilledTotal, labFeeUnpaid, labPaymentOf,
  labFeeBlocking, labFeeGross, overdueUpdateRequests, unmatchedEmails,
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
export type TestingPressure = "FAILED" | "IN_PROGRESS" | "NOT_BOOKED" | "COMPLETED" | "PASSED";

/** Worst first — also the chip order, so the row reads left-to-right as "most urgent first". */
export const TESTING_PRESSURE_ORDER: TestingPressure[] = ["FAILED", "IN_PROGRESS", "NOT_BOOKED", "COMPLETED", "PASSED"];

export const TESTING_PRESSURE_META: Record<TestingPressure, {
  label: string; tone: "bad" | "warn" | "info" | "ok" | "neutral"; what: string;
}> = {
  FAILED:      { label: "Failed",               tone: "bad",     what: "At least one lot's verdict is FAIL — someone has to decide retest or return, and the escrow refund path hangs off it." },
  IN_PROGRESS: { label: "In progress",          tone: "info",    what: "Lots are at the lab with results still open, or something needs a human (mail to match, a chase past SLA, an unpaid advance holding a lot)." },
  NOT_BOOKED:  { label: "Not booked",           tone: "neutral", what: "The order has a testable line but no test slot has been booked with the lab yet." },
  COMPLETED:   { label: "Completed",            tone: "warn",    what: "Every result is in — the lab has finished with it. Includes passed and failed submissions, which also have their own chips, plus the ones that are neither (a MAYBE lot, an F.A.R. close-out, an accepted not-conducted process)." },
  PASSED:      { label: "Passed",               tone: "ok",      what: "Every lot's verdict is PASS — the testing gate is satisfied and the escrow release condition is met." },
};

/**
 * One booked slot, summarised **on its own**.
 *
 * Two slots on the same order — even for the same MPN — are independent submissions: different
 * samples, different work orders, their own results. Adding their tests together and reporting one
 * "8/14 passed" says nothing true about either, which is why the board counts *slots*, not tests.
 */
export interface SlotSummary {
  id: string;
  slotNo: string;
  status: TestSlotStatus;
  lab: string;
  appointmentNo?: string;
  isRetest: boolean;
  /** the slot's own outcome: any lot FAIL ⇒ failed, all lots PASS ⇒ passed, otherwise pending */
  verdict: "PASSED" | "FAILED" | "PENDING";
  lotCodes: string[];
  workOrders: string[];
}

export interface TestingView {
  pressure: TestingPressure;
  /** Every MPN on the order that needs testing — the board's own column. */
  mpns: string[];
  /** Per-slot summaries, newest first, each judged on its own. */
  slots: SlotSummary[];
  slotsPassed: number;
  slotsFailed: number;
  /** Lot / test tallies, kept for the buckets and the sort — NOT for display. */
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
  /**
   * Lab-fee position on two axes, because they answer different questions and a single figure
   * could only answer one: `feeBilled*` is what the lab has invoiced across this order (paid or
   * not) — the cost; `fee*` is what is still owed — the worklist. A fully settled order therefore
   * reads as billed with nothing due, not as never billed.
   */
  feeBilledCurrency: string;
  feeBilledGross: number;
  feeBilledCount: number;
  feeCurrency: string;
  feeGross: number;
  feeCount: number;
  /**
   * Test lots at the lab that carry no invoice yet. The lab bills after it issues the report, so
   * this is the normal state for most of a lot's life — and it is NOT the same as "none due":
   * a fee is coming, we just cannot state it. Only a lot that never had one and never will
   * (nothing at the lab, or every invoice settled) leaves both this and `feeCount` at 0.
   */
  feeAwaiting: number;
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
  const billed = labFeeBilledTotal(b);
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

  // each slot judged alone — see SlotSummary for why they are never added together
  const slots: SlotSummary[] = (b.testSlots ?? []).map((sl) => {
    const lots = b.lots.filter((l) => l.testSlotId === sl.id);
    const verdict = lots.some((l) => l.testStatus === "FAIL") ? "FAILED" as const
      : lots.length > 0 && lots.every((l) => l.testStatus === "PASS") ? "PASSED" as const
      : "PENDING" as const;
    return {
      id: sl.id, slotNo: sl.slotNo, status: sl.status, lab: sl.lab,
      appointmentNo: sl.appointmentNo, isRetest: !!sl.retestOfSlotNo, verdict,
      lotCodes: lots.map((l) => l.lotCode),
      workOrders: lots.map((l) => l.workOrderNo).filter((x): x is string => !!x),
    };
  });

  // the verdict axis, off `Lot.testStatus` — independent of how far the lifecycle has moved
  const anyFail = b.lots.some((l) => l.testStatus === "FAIL");
  const allPass = b.lots.length > 0 && b.lots.every((l) => l.testStatus === "PASS");

  // Order of these tests is the whole semantics:
  //  · no lot raised ⇒ NOT_BOOKED whatever else is true — nothing is at the lab, and an unparsed
  //    test list is the normal state of a fresh order, so an untouched order must never claim
  //    to be in progress;
  //  · a FAIL outranks open tests — it needs a decision now, not when the rest finishes;
  //  · all-PASS is terminal and good;
  //  · anything still open or wanting a human is in progress;
  //  · what's left is finished-but-not-clean.
  const pressure: TestingPressure =
    b.lots.length === 0 ? "NOT_BOOKED"
      : anyFail ? "FAILED"
      : allPass ? "PASSED"
      : sum.open > 0 || attention > 0 ? "IN_PROGRESS"
      : "COMPLETED";

  return {
    pressure,
    mpns: b.lines.filter((l) => l.testingMode !== "NONE").map((l) => l.mpn),
    slots,
    slotsPassed: slots.filter((x) => x.verdict === "PASSED").length,
    slotsFailed: slots.filter((x) => x.verdict === "FAILED").length,
    lots: sum.lots, tests: sum.tests, passed: sum.passed, open: sum.open,
    far: sum.far, failed: sum.failed, reports: sum.reports,
    unmatched, overdue, gaps,
    feeBilledCurrency: billed.currency, feeBilledGross: billed.gross, feeBilledCount: billed.count,
    feeCurrency: fees.currency, feeGross: fees.gross, feeCount: fees.count,
    feeAwaiting: b.lots.filter((l) => labFeeUnpaid(l) && !labPaymentOf(l).invoice).length,
    held: fees.blocking,
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
  if (v.unmatched > 0) return `Match ${v.unmatched} inbound WHL email${v.unmatched === 1 ? "" : "s"} to a test slot`;
  if (v.overdue > 0) return `Chase WHL — ${v.overdue} update request${v.overdue === 1 ? "" : "s"} past SLA`;
  if (v.failed > 0) return `Decide retest or return — ${v.failed} not-acceptable result${v.failed === 1 ? "" : "s"}`;
  if (v.far > 0) return `Close out ${v.far} F.A.R. process${v.far === 1 ? "" : "es"}`;
  if (v.gaps > 0) return `Parse the test list — ${v.gaps} MPN${v.gaps === 1 ? "" : "s"} never auto-filled`;
  if (v.feeCount > 0) return `Send ${v.feeCount} WHL invoice${v.feeCount === 1 ? "" : "s"} to finance (${v.feeCurrency} ${v.feeGross.toLocaleString()})`;
  if (v.tests === 0) return "No tests on file yet — auto-fill them off the PO";
  if (v.open > 0) {
    const at = v.slowestStage ? TESTING_STAGE_META[v.slowestStage].label.toLowerCase() : "the lab";
    return `Awaiting WHL — ${v.open} test${v.open === 1 ? "" : "s"} open, slowest slot at ${at}`;
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

// ===================================================================================
// PER-SLOT ROWS — the board's own unit since 2026-08-24
//
// The board used to list ORDERS. But an order is not what the lab tests: it tests one
// MPN's samples against one work order, and the whole record — stage, verdict, report,
// invoice — already hangs off that submission. An order row therefore had to merge
// several of them into one cell (`2 test slots · 1 failed`) and the reader still had to
// open the order to learn which part failed.
//
// So a row is now ONE MPN'S SUBMISSION. Every field on it is that submission's own.
// Two exceptions are order-level by nature and marked as such below: `atRisk` (the
// order's Testing phase clock) and the unmatched-mail count, which belongs to no lot
// yet by definition — that one stays on the board's attention card, not on a row.
// ===================================================================================

/** One MPN's submission to the lab: a slot line, the lot it became, and how it stands. */
export interface TestingSlotRow {
  /** stable across renders — slot+mpn, or the bare line when nothing is booked */
  key: string;
  // ---- who and where (the new columns: an operator scanning the lab's work needs the party) ----
  orderId: string;
  orderNo: string;
  supplierPoNo?: string;
  buyer: string;
  supplier: string;
  // ---- the part ----
  mpn: string;
  make?: string;
  testingMode: TestingMode;
  /** order-line quantity, so a sample count has something to be a share of */
  lineQty?: number;
  // ---- the slot: absent only for a testable MPN nobody has booked yet ----
  slotId?: string;
  slotNo?: string;
  slotStatus?: TestSlotStatus;
  lab?: string;
  appointmentNo?: string;
  requestedAt?: string;
  isRetest: boolean;
  retestOfSlotNo?: string;
  /** a later slot re-tests this one — so this row's FAIL has already been answered */
  rebooked: boolean;
  // ---- the lot the lab's confirmation created: absent while the slot is REQUESTED ----
  lotId?: string;
  lotCode?: string;
  workOrderNo?: string;
  qty?: number;
  sampleQty?: number;
  stage?: TestingStage;
  verdict?: TestStatus;
  // ---- results, this submission's own ----
  tests: number;
  passed: number;
  open: number;
  far: number;
  failedTests: number;
  reports: number;
  /** business days since we last chased the lab, once past SLA */
  overdueDays: number;
  // ---- money, this work order's own (the lab bills per work order, so one row = one invoice) ----
  feeCurrency: string;
  /** invoiced on this lot, paid or not — 0 while no invoice has arrived */
  feeBilled: number;
  /** still owed on this lot */
  feeDue: number;
  invoiceNo?: string;
  labTerms?: LabPaymentTerms;
  labStatus: LabPaymentStatus;
  /** the invoice has arrived and nobody has passed it to Finance yet */
  feeToSend: boolean;
  /** unpaid advance ⇒ the lab is sitting on the parts */
  held: boolean;
  /** no invoice yet, and one is coming — the lab bills after it issues the report */
  feeAwaiting: boolean;
  // ---- verdicts of the whole ----
  pressure: TestingPressure;
  /** ORDER-level: the Testing phase clock, shared by every row of the order */
  atRisk?: PhaseAtRisk;
  attention: number;
}

/**
 * Every submission on one order, as board rows.
 *
 * A testable line with nothing booked still gets a row: "which of my parts is not at the lab"
 * is the question the `Not booked` chip answers, and a list that only showed booked work could
 * never answer it. Same reasoning as the workspace's grouped view being driven by the order's
 * lines rather than by which MPNs happen to have lots.
 */
export function testingSlotRows(b: OrderBundle): TestingSlotRow[] {
  const atRisk = orderPhaseTimings(b).find((p) => p.phase === "TESTING")?.atRisk;
  const overdue = overdueUpdateRequests(b);
  const slots = b.testSlots ?? [];
  const rows: TestingSlotRow[] = [];

  const base = (mpn: string) => {
    const line = b.lines.find((l) => l.mpn === mpn);
    return {
      orderId: b.id, orderNo: b.orderNo, supplierPoNo: b.supplierPoNo,
      buyer: b.buyer.name, supplier: b.supplier.name,
      mpn, make: line?.make, testingMode: (line?.testingMode ?? "WHL") as TestingMode, lineQty: line?.quantity,
      atRisk,
    };
  };

  for (const slot of slots) {
    /** re-run per PART, not per slot: two lots can share a submission, and re-running one says
     *  nothing about the other, so a slot-wide flag hid a re-test the second part still needed */
    const rebookedFor = (mpn: string) => slots.some((x) =>
      x.retestOfSlotId === slot.id && x.lines.some((l) => l.mpn === mpn));
    /*
     * Once the lab confirms, the LOTS are the submissions — not the slot's lines. One line can
     * become two lots (the same MPN split across two date codes is two samples, two work orders
     * and two verdicts), and matching a line back to "the lot with this MPN" would collapse them
     * into one row and report the first lot's result twice. Lines are only the source before a
     * confirmation exists, when there is no lot to speak of yet.
     */
    const slotLots = b.lots.filter((l) => l.testSlotId === slot.id);
    const units: { mpn: string; line?: TestSlotLine; lot?: Lot }[] = slotLots.length > 0
      ? slotLots.map((lot) => ({
        mpn: lot.orderLineMpn,
        line: slot.lines.find((x) => x.lotCode === lot.lotCode) ?? slot.lines.find((x) => x.mpn === lot.orderLineMpn),
        lot,
      }))
      : slot.lines.map((line) => ({ mpn: line.mpn, line, lot: undefined }));

    for (const { mpn, line, lot } of units) {
      const pay = lot ? labPaymentOf(lot) : undefined;
      const inv = pay?.invoice;
      const gross = lot ? labFeeGross(lot) : 0;
      const sum = lot ? testingSummary(b, lot.id) : undefined;
      const row: TestingSlotRow = {
        key: lot ? `${slot.id}:${lot.id}` : `${slot.id}:${mpn}:${line?.lotCode ?? "line"}`,
        ...base(mpn),
        slotId: slot.id, slotNo: slot.slotNo, slotStatus: slot.status, lab: slot.lab,
        appointmentNo: slot.appointmentNo, requestedAt: slot.requestedAt,
        isRetest: !!slot.retestOfSlotNo, retestOfSlotNo: slot.retestOfSlotNo, rebooked: rebookedFor(mpn),
        lotId: lot?.id, lotCode: lot?.lotCode ?? line?.lotCode, workOrderNo: lot?.workOrderNo,
        qty: lot?.qty ?? line?.qty, sampleQty: lot?.sampleQty ?? line?.sampleQty,
        stage: lot ? lotStage(lot) : undefined,
        verdict: lot?.testStatus,
        tests: sum?.tests ?? line?.tests.length ?? 0,
        passed: sum?.passed ?? 0,
        open: sum?.open ?? 0,
        far: sum?.far ?? 0,
        failedTests: sum?.failed ?? 0,
        reports: lot?.reports?.length ?? 0,
        overdueDays: (lot ? overdue.find((o) => o.lot.id === lot.id)?.days : 0) ?? 0,
        feeCurrency: inv?.currency ?? "USD",
        feeBilled: inv ? gross : 0,
        feeDue: inv && labFeeUnpaid(lot!) ? gross : 0,
        invoiceNo: inv?.invoiceNo,
        labTerms: inv?.terms,
        labStatus: pay?.status ?? "NOT_REQUESTED",
        feeToSend: pay?.status === "INVOICE_RECEIVED",
        held: !!lot && labFeeBlocking(lot),
        feeAwaiting: !!lot && !inv && labFeeUnpaid(lot),
        pressure: "IN_PROGRESS",
        attention: 0,
      };
      /*
       * This submission's OWN signals only. `atRisk` is deliberately excluded even though it is on
       * the row: it belongs to the order's Testing phase, so counting it here made every row of a
       * behind-clock order claim attention — including the ones that had already passed, which the
       * board then painted red. It still shows as a pill, which is what it is: context, not work.
       */
      row.attention = (row.held ? 1 : 0) + (row.overdueDays > 0 ? 1 : 0) + row.failedTests + row.far
        + (row.feeToSend ? 1 : 0);
      row.pressure = slotRowPressure(row);
      rows.push(row);
    }
  }

  // parts with nothing at the lab — the `Not booked` bucket, and the only rows with no slot
  const booked = new Set(rows.map((r) => r.mpn));
  for (const line of b.lines.filter((l) => l.testingMode !== "NONE")) {
    if (booked.has(line.mpn)) continue;
    rows.push({
      key: `${b.id}:${line.mpn}:unbooked`,
      ...base(line.mpn),
      isRetest: false, rebooked: false,
      tests: 0, passed: 0, open: 0, far: 0, failedTests: 0, reports: 0, overdueDays: 0,
      feeCurrency: "USD", feeBilled: 0, feeDue: 0, labStatus: "NOT_REQUESTED",
      feeToSend: false, held: false, feeAwaiting: false,
      pressure: "NOT_BOOKED",
      attention: 0,
    });
  }
  return rows;
}

/**
 * Which bucket one submission is in — the same precedence the order-level buckets use, read at
 * the altitude the record actually lives at. A slot the lab has not confirmed is `IN_PROGRESS`,
 * not `NOT_BOOKED`: it *is* booked, we are waiting on the lab.
 */
function slotRowPressure(r: TestingSlotRow): TestingPressure {
  if (!r.slotId) return "NOT_BOOKED";
  if (!r.lotId) return "IN_PROGRESS";
  if (r.verdict === "FAIL") return "FAILED";
  if (r.verdict === "PASS") return "PASSED";
  if (r.open > 0 || r.attention > 0) return "IN_PROGRESS";
  return "COMPLETED";
}

/**
 * What this submission is waiting on, as a sentence — the `Status / updates` column.
 *
 * Same ordering principle as `nextTestingAction`, one altitude down: money the lab is holding
 * parts over, then a lab gone quiet, then a result that needs a decision, then paperwork.
 */
export function slotStatusLine(r: TestingSlotRow): string {
  if (!r.slotId) return "Not at the lab — open the order and book a test slot";
  if (r.slotStatus === "REQUESTED") {
    return `Awaiting ${r.lab ?? "the lab"}'s booking confirmation — requested ${r.requestedAt ?? "—"}`;
  }
  if (r.held) return `Pay ${r.lab?.split(" ")[0] ?? "the lab"}'s advance invoice — this lot is off the bench until it clears`;
  if (r.overdueDays > 0) return `Chase the lab — the update request is ${r.overdueDays} business days old`;
  if (r.verdict === "FAIL") {
    return r.rebooked ? "Not acceptable — a re-test is already booked" : "Not acceptable — decide re-test or return";
  }
  if (r.far > 0) return `Close out ${r.far} F.A.R. process${r.far === 1 ? "" : "es"}`;
  if (r.feeToSend) return `Send the lab's invoice to Finance (${r.feeCurrency} ${r.feeDue.toLocaleString()})`;
  if (r.tests === 0) return "No test list on this lot — the confirmation should have written one";
  if (r.open > 0) {
    const at = r.stage ? TESTING_STAGE_META[r.stage].label.toLowerCase() : "the lab";
    return `Awaiting the lab — ${r.open} test${r.open === 1 ? "" : "s"} open, lot at ${at}`;
  }
  if (r.verdict === "PASS") return r.feeDue > 0 ? "Passed — only the lab fee is still owed" : "Passed — nothing pending";
  if (r.verdict === "MAYBE") return "Acceptable with follow-up — read the report and close it out";
  return "Every result in — not a clean pass, needs a look";
}

/**
 * Does a row belong under a given chip?
 *
 * Every bucket matches its own rows **except `COMPLETED`, which is a superset** (2026-08-25): a
 * finished submission is completed whether it passed or failed, and reading `Completed 0` next to
 * `Failed 2` and `Passed 4` was the board contradicting itself. So `COMPLETED` matches `FAILED` and
 * `PASSED` too, and the residual — every result in, neither a clean pass nor a FAIL — keeps the
 * label for its own rows.
 *
 * The cost is deliberate and worth stating: **the chip counts no longer sum to `All`.** They did
 * while every bucket was mutually exclusive, which made them trustworthy as a partition; one chip
 * now answers "how far along" at a coarser grain than the others, and the row pills still say
 * exactly which of the three a row is. Don't "fix" the arithmetic by narrowing `Completed` again.
 */
export function pressureMatches(chip: TestingPressure, rowPressure: TestingPressure): boolean {
  if (chip === "COMPLETED") return rowPressure === "COMPLETED" || rowPressure === "FAILED" || rowPressure === "PASSED";
  return rowPressure === chip;
}

/** Worst first, same as the order queue: bucket, then how much wants attention, then newest. */
export function sortSlotRows(rows: TestingSlotRow[]): TestingSlotRow[] {
  const rank = (p: TestingPressure) => TESTING_PRESSURE_ORDER.indexOf(p);
  return [...rows].sort((x, y) =>
    rank(x.pressure) - rank(y.pressure)
    || y.attention - x.attention
    || (x.orderNo < y.orderNo ? 1 : -1)
    || (x.slotNo ?? "").localeCompare(y.slotNo ?? "")
    || x.mpn.localeCompare(y.mpn));
}
