import { mockCall, ref, pickWeighted } from "@/integrations/mock-client";
import {
  WHL_PROCESSES, WHL_CONTACT, WHL_CONFIDENTIALITY, stageIdx,
  WHL_TEST_FEE_PER_PROCESS, WHL_INVOICE_TAX_PCT, WHL_CREDIT_DAYS,
} from "@/data/enums";
import type {
  TestStatus, WhlConclusion, WhlProcessResult, TestProcessStatus, TestingStage, LabPaymentTerms,
} from "@/types";

const SYS = "whl";
const LABEL = "WHL Lab";

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export interface WhlSubmitReq { clientRef: string; mpn: string; dateCode: string; lotCode: string; lotQty: number; sampleQty: number; testPlan: string; labSite: string; }
export interface WhlSubmitRes { workOrderNo: string; status: "RECEIVED"; labSite: string; estimatedTatDays: number; }
export type WhlVerdict = "PASS" | "FAIL" | "INCONCLUSIVE";
export interface WhlReportRes { workOrderNo: string; status: "IN_PROGRESS" | "COMPLETED"; verdict: WhlVerdict | null; reportNo?: string; tatDays?: number; }

export const mapVerdict = (v: WhlVerdict): TestStatus => (v === "INCONCLUSIVE" ? "MAYBE" : v);

/** Report conclusion → the lot-level TestStatus the escrow/journey gates already run on. */
export const conclusionToLotStatus = (c: WhlConclusion, anyFar: boolean): TestStatus =>
  c === "ACCEPTABLE" ? (anyFar ? "MAYBE" : "PASS") : "FAIL";

/** Per-process report result → the per-test status shown in the tracker. */
export const processToTestStatus = (r: WhlProcessResult): TestProcessStatus =>
  r === "ACCEPTABLE" ? "PASSED" : r === "NOT_ACCEPTABLE" ? "FAILED" : r === "FAR" ? "FAR" : "NOT_CONDUCTED";

export function whlSubmitTestJob(req: WhlSubmitReq) {
  return mockCall<WhlSubmitRes>(SYS, LABEL, "POST /work-orders", req,
    () => ({ workOrderNo: ref("WO"), status: "RECEIVED", labSite: req.labSite, estimatedTatDays: 5 + Math.floor(Math.random() * 3) }),
    { latencyMs: [400, 1200], failError: { code: "LAB_QUEUE_FULL", message: "Lab intake queue full", status: 503 } });
}

// Weighted verdict (~70% PASS / 20% MAYBE / 10% FAIL) — the demo can also force via the console chaos toggle.
export function whlPollTestReport(workOrderNo: string) {
  return mockCall<WhlReportRes>(SYS, LABEL, `GET /work-orders/${workOrderNo}/report`, { workOrderNo },
    () => {
      const verdict = pickWeighted<WhlVerdict>([["PASS", 70], ["INCONCLUSIVE", 20], ["FAIL", 10]]);
      return { workOrderNo, status: "COMPLETED", verdict, reportNo: `${workOrderNo}.1`, tatDays: 5 + Math.floor(Math.random() * 3) };
    },
    { latencyMs: [400, 1400] });
}

// ---- report fetch + parse (stands in for "PDF arrived by email, OCR + extract") ----

export interface WhlParsedProcess { name: string; result: WhlProcessResult; acceptQty?: number; rejectQty?: number; note?: string }
export interface WhlParsedReport {
  reportNo: string; revision: number; reportDate: string; workOrderNo: string; fileName: string;
  partNumber: string; manufacturer: string; lotQty: number; client: string; clientPo: string;
  conclusion: WhlConclusion; anyFar: boolean; processes: WhlParsedProcess[];
  approvedBy: string; approverTitle: string; standards: string[]; riskClass: string; msl: string; packageType: string;
  confidentialityNote: string; revisionNote?: string; parseFlags: string[];
}

export interface WhlFetchReportReq {
  workOrderNo: string; mpn: string; manufacturer: string; lotQty: number;
  client: string; clientPo?: string; revision: number; testNames: string[];
}

/**
 * Fetch + parse the WHL report for a work order. The mock builds a realistic
 * process-level matrix (so a report can be ACCEPTABLE overall with one process
 * F.A.R.) and occasionally returns WHL's "PO Unknown" placeholder, which the
 * platform must flag for reconciliation rather than accept as-is.
 */
export function whlFetchReport(req: WhlFetchReportReq) {
  return mockCall<WhlParsedReport>(SYS, LABEL, `GET /work-orders/${req.workOrderNo}/report/pdf+parse`, req,
    () => {
      const names = req.testNames.length ? req.testNames : [...WHL_PROCESSES].slice(0, 5);
      const conclusion = pickWeighted<WhlConclusion>([["ACCEPTABLE", 72], ["NOT_ACCEPTABLE", 18], ["SUSPECT_COUNTERFEIT", 10]]);
      const sample = Math.max(1, Math.min(req.lotQty, 20));
      const processes: WhlParsedProcess[] = names.map((name, i) => {
        // one process is deliberately allowed to come back F.A.R. / not conducted even on an Acceptable report
        const result: WhlProcessResult = conclusion === "ACCEPTABLE"
          ? pickWeighted<WhlProcessResult>([["ACCEPTABLE", 80], ["FAR", 12], ["NOT_CONDUCTED", 8]])
          : i === 0
          ? "ACCEPTABLE"
          : pickWeighted<WhlProcessResult>([["NOT_ACCEPTABLE", 55], ["FAR", 25], ["ACCEPTABLE", 20]]);
        const rejectQty = result === "NOT_ACCEPTABLE" ? Math.max(1, Math.round(sample * 0.15)) : result === "FAR" ? 1 : 0;
        return {
          name,
          result,
          acceptQty: result === "NOT_CONDUCTED" ? undefined : sample - rejectQty,
          rejectQty: result === "NOT_CONDUCTED" ? undefined : rejectQty,
          note: result === "FAR" ? "Further analysis recommended — anomaly on sampled unit." : undefined,
        };
      });
      const anyFar = processes.some((p) => p.result === "FAR");
      // WHL sometimes issues the report without a resolvable client P/O
      const poUnknown = !req.clientPo || Math.random() < 0.25;
      const parseFlags: string[] = [];
      if (poUnknown) parseFlags.push("Client P/O came back as “PO Unknown” — reconcile against the PO on file.");
      if (processes.some((p) => p.result === "NOT_CONDUCTED")) parseFlags.push("One or more processes were Not Conducted — confirm the agreed test plan was run in full.");
      return {
        reportNo: `${req.workOrderNo}.${req.revision}`, revision: req.revision,
        reportDate: new Date().toISOString().slice(0, 10), workOrderNo: req.workOrderNo,
        fileName: `WHL-${req.workOrderNo}.${req.revision}.pdf`,
        partNumber: req.mpn, manufacturer: req.manufacturer || "—", lotQty: req.lotQty,
        client: "Sharpbuy Global Solutions", clientPo: poUnknown ? "PO Unknown" : req.clientPo!,
        conclusion, anyFar, processes,
        approvedBy: "K. Ng", approverTitle: "Laboratory Manager",
        standards: ["AS6081", "AS6171"], riskClass: "ERAI Low Risk", msl: "MSL 3", packageType: "LQFP-100",
        confidentialityNote: WHL_CONFIDENTIALITY,
        revisionNote: req.revision > 1 ? `Revision ${req.revision} — supersedes ${req.workOrderNo}.${req.revision - 1} (electrical re-test on the flagged units).` : undefined,
        parseFlags,
      };
    },
    { latencyMs: [600, 1800], failError: { code: "REPORT_NOT_READY", message: "Report not yet issued for this work order", status: 404 } });
}

// ---- outbound mail ----

export interface WhlSendMailReq { to: string; subject: string; body: string; workOrderNo?: string; lotCode?: string; mpn?: string; poNo?: string }
export interface WhlSendMailRes { messageId: string; to: string; queuedAt: string }

/** In-app send (so the message stays attached to the lot instead of living in someone's Sent items). */
export function whlSendMail(req: WhlSendMailReq) {
  return mockCall<WhlSendMailRes>(SYS, LABEL, "POST /messages", req,
    () => ({ messageId: ref("MSG"), to: req.to || WHL_CONTACT, queuedAt: new Date().toISOString().slice(0, 16).replace("T", " ") }),
    { latencyMs: [300, 900], failError: { code: "MAIL_RELAY_DOWN", message: "Mail relay unavailable — retry", status: 503 } });
}

// ---- inbound mail (status updates, delay notices, revised reports) ----

export type WhlInboundKind =
  | "STATUS_UPDATE" | "REPORT" | "DELAY" | "AMBIGUOUS" | "RECEIPT" | "INVOICE" | "DISPATCH" | "PAYMENT_ACK";
export interface WhlInboundMail {
  messageId: string;
  kind: WhlInboundKind;
  subject: string;
  body: string;
  receivedAt: string;
  from: string;
  // matching keys the platform uses to route the mail; AMBIGUOUS mails carry none
  workOrderNo?: string;
  lotCode?: string;
  reportNo?: string;
  /** the lifecycle stage this mail moves the lot into (absent = no stage change) */
  stage?: TestingStage;
  // per-test status updates carried by the mail
  testUpdates?: { name: string; status: TestProcessStatus; note?: string }[];
  attachments?: string[];
  /** set on INVOICE mails — the lab's own bill for the testing service */
  invoice?: WhlInvoiceLine;
  /** set on DISPATCH mails — the supplier's advice that the samples are on their way */
  dispatch?: WhlDispatchLine;
  /** set on PAYMENT_ACK mails — the lab confirming our transfer landed */
  payment?: WhlPaymentAckLine;
}

/** WHL's invoice as it arrives on the mail, before we store it against the lot. */
export interface WhlInvoiceLine {
  invoiceNo: string;
  amount: number;
  taxAmount: number;
  currency: string;
  dueDate: string;
  fileName: string;
  processCount: number;
  /** how the lab wants paying for this work order — advance clears before the bench starts */
  terms: LabPaymentTerms;
  /** CREDIT only: the days allowed from the invoice date */
  creditDays?: number;
  ratePerProcess: number;
}

/** The supplier's dispatch advice, relayed onto the lot's thread. */
export interface WhlDispatchLine {
  courier: string;
  awb: string;
  dispatchedOn: string;
  expectedArrival: string;
}

/** WHL confirming the testing fee landed — this is what closes the payment stage. */
export interface WhlPaymentAckLine {
  invoiceNo: string;
  paidRef: string;
  paidAt: string;
}

export interface WhlPollInboxReq {
  /**
   * `stage` lets the mock answer with the mail that plausibly comes next for that lot.
   * The fee flags keep the money thread coherent: don't re-issue an invoice already sent,
   * acknowledge a transfer once it's with finance, chase it while it's owed, and hold the
   * bench when the lab is on advance terms and hasn't been paid.
   */
  workOrders: {
    workOrderNo: string; lotCode: string; mpn: string; testNames: string[];
    stage?: TestingStage;
    hasInvoice?: boolean; feePaid?: boolean; feeWithFinance?: boolean;
    terms?: LabPaymentTerms;
  }[];
}

/**
 * Poll the WHL mailbox. Returns interim status notes, delay notices and report
 * notifications. ~15% of the time a mail comes back with an unusable subject line
 * (no work order / lot) — the platform routes those to a manual-match queue.
 */
export function whlPollInbox(req: WhlPollInboxReq) {
  return mockCall<{ messages: WhlInboundMail[] }>(SYS, LABEL, "GET /messages?unread=1", req,
    () => {
      const now = new Date().toISOString().slice(0, 16).replace("T", " ");
      if (req.workOrders.length === 0) return { messages: [] };
      const messages: WhlInboundMail[] = [];
      for (const wo of req.workOrders) {
        // ~15% of real lab mail arrives with a subject line nothing can be matched on.
        // Keep producing those regardless of stage — the manual-match queue exists for them.
        if (Math.random() < 0.15) {
          messages.push({
            messageId: ref("IN"), kind: "AMBIGUOUS", from: WHL_CONTACT, receivedAt: now,
            subject: "RE: Testing update", // no WO / lot / report no → cannot be routed
            body: "Hi, quick update on the parts you sent through — one of the lots needs another day on the electrical bench. Will revert with the report. Regards, WHL",
          });
          continue;
        }
        const mail = nextStageMail(wo, now);
        if (mail) messages.push(mail);
      }
      return { messages };
    },
    { latencyMs: [500, 1500] });
}

/** Couriers the mock supplier ships samples with. */
const COURIERS = ["DHL Express", "FedEx IP", "UPS Worldwide Saver"] as const;

/**
 * The mail that would plausibly arrive *next* for this lot, given where it already is.
 * This is what makes the lifecycle demoable: polling the inbox repeatedly walks a lot
 * along invoice → payment → dispatch → receipt → in progress → complete → report, one
 * step at a time, instead of firing a random status mail at a lot that's already done.
 *
 * Every stage has a mail behind it — including the two that don't originate with the
 * lab. The supplier's dispatch advice is relayed onto the same thread, and WHL's own
 * payment acknowledgement is what closes the fee.
 */
function nextStageMail(wo: WhlPollInboxReq["workOrders"][number], now: string): WhlInboundMail | null {
  const base = {
    messageId: ref("IN"), from: WHL_CONTACT, receivedAt: now,
    workOrderNo: wo.workOrderNo, lotCode: wo.lotCode,
  };
  const ref0 = `WO ${wo.workOrderNo} / Lot ${wo.lotCode}`;
  const picks = wo.testNames.length ? wo.testNames.slice(0, 2) : ["Electrical Test"];
  const at = stageIdx(wo.stage ?? undefined);
  const invoiceNo = `WHL-INV-${wo.workOrderNo}`;
  const feeUnpaid = !wo.feePaid;
  // on advance terms the lab won't put the lot on the bench until the transfer clears
  const advanceHold = wo.terms === "ADVANCE" && feeUnpaid;

  // The lab bills on booking, so its invoice is the first thing back after the work
  // order — before the samples have even shipped. Issued once; we own it after that.
  // The mail is also where the payment mode comes from: advance or credit is the lab's
  // call per work order, so it can only be read off the invoice, never chosen by us.
  if (!wo.hasInvoice) {
    const processCount = Math.max(1, wo.testNames.length || 5);
    const amount = processCount * WHL_TEST_FEE_PER_PROCESS;
    const taxAmount = Math.round(amount * WHL_INVOICE_TAX_PCT);
    const terms = pickWeighted<LabPaymentTerms>([["CREDIT", 55], ["ADVANCE", 45]]);
    const gross = amount + taxAmount;
    const termsLine = terms === "ADVANCE"
      ? `This work order is on ADVANCE terms: USD ${gross.toLocaleString()} is payable before testing begins. The lot will be held in our bonded store until the transfer clears — please share the remittance advice so we can release it to the bench.`
      : `This work order is on CREDIT terms: USD ${gross.toLocaleString()} is due within ${WHL_CREDIT_DAYS} days of the invoice date. Testing proceeds on account in the meantime.`;
    return {
      ...base, kind: "INVOICE",
      subject: `Invoice ${invoiceNo} — testing services (${terms === "ADVANCE" ? "advance" : "credit"}) — ${ref0}`,
      body: `Please find attached our invoice ${invoiceNo} for the testing booked against work order ${wo.workOrderNo} (${wo.mpn}, Lot ${wo.lotCode}).\n\n${processCount} process(es) at USD ${WHL_TEST_FEE_PER_PROCESS} each — USD ${amount.toLocaleString()} plus service tax USD ${taxAmount.toLocaleString()}.\n\n${termsLine}\n\nPlease quote the work order and lot code as the payment reference so we can reconcile it.`,
      attachments: [`${invoiceNo}.pdf`],
      invoice: {
        invoiceNo, amount, taxAmount, currency: "USD",
        dueDate: addDaysIso(now.slice(0, 10), terms === "ADVANCE" ? 3 : WHL_CREDIT_DAYS),
        fileName: `${invoiceNo}.pdf`,
        processCount, terms,
        creditDays: terms === "CREDIT" ? WHL_CREDIT_DAYS : undefined,
        ratePerProcess: WHL_TEST_FEE_PER_PROCESS,
      },
    };
  }

  // The transfer is with finance → the lab confirms it landed. This is the mail that
  // closes the payment stage; nothing on our side of the wire can establish it.
  if (feeUnpaid && wo.feeWithFinance) {
    const paidRef = ref("UTR");
    return {
      ...base, kind: "PAYMENT_ACK", stage: "WHL_PAYMENT",
      subject: `Payment received — invoice ${invoiceNo} — ${ref0}`,
      body: `We confirm receipt of your transfer against invoice ${invoiceNo} for ${wo.mpn} (Lot ${wo.lotCode}), reference ${paidRef}. The invoice is settled in full and our receipt is attached.${wo.terms === "ADVANCE" ? "\n\nThe lot is released from hold and goes to the bench on the next available slot." : ""}`,
      attachments: [`WHL-RCPT-${wo.workOrderNo}.pdf`],
      payment: { invoiceNo, paidRef, paidAt: now.slice(0, 10) },
    };
  }

  // Nothing dispatched yet. The lab can't confirm a shipment it hasn't received, so the
  // stage comes from the supplier's own advice relayed onto this thread — with the lab
  // occasionally chasing us for it in the meantime.
  if (at < stageIdx("SUPPLIER_DISPATCHING")) {
    if (Math.random() < 0.25) {
      return {
        ...base, kind: "STATUS_UPDATE",
        subject: `Awaiting samples — ${ref0}`,
        body: `We have your work order ${wo.workOrderNo} on file but the samples for ${wo.mpn} (Lot ${wo.lotCode}) have not reached us yet. Please share the dispatch details so we can book the lot in on arrival.`,
      };
    }
    const courier = COURIERS[Math.floor(Math.random() * COURIERS.length)];
    const awb = `${1000 + Math.floor(Math.random() * 8999)}-${1000 + Math.floor(Math.random() * 8999)}-${10 + Math.floor(Math.random() * 89)}`;
    const dispatchedOn = now.slice(0, 10);
    const expectedArrival = addDaysIso(dispatchedOn, 2);
    return {
      ...base, kind: "DISPATCH", stage: "SUPPLIER_DISPATCHING", from: "logistics@supplier.example",
      subject: `Dispatch advice — samples to ${wo.lotCode ? "WHL" : "lab"} — ${ref0}`,
      body: `Samples for ${wo.mpn} (Lot ${wo.lotCode}) have been handed to ${courier} today under AWB ${awb}, consigned to the laboratory against work order ${wo.workOrderNo}. Expected arrival ${expectedArrival}.\n\nUnits were drawn from the same date-code reel as the balance stock.`,
      dispatch: { courier, awb, dispatchedOn, expectedArrival },
    };
  }

  // In transit → WHL confirms receipt.
  if (at < stageIdx("COMPONENTS_RECEIVED")) {
    return {
      ...base, kind: "RECEIPT", stage: "COMPONENTS_RECEIVED",
      subject: `Receipt confirmation — ${ref0}`,
      body: `This is to confirm receipt of ${wo.mpn} (Lot ${wo.lotCode}) against work order ${wo.workOrderNo}. Quantity and packaging match the submission note; the lot is booked in and queued for the agreed test plan.${advanceHold ? "\n\nPer the advance terms on invoice " + invoiceNo + ", the lot is held pending payment and has not been scheduled." : ""}`,
    };
  }

  // Advance terms, still unpaid → the lab holds the lot. The fee is a real gate here, so
  // nothing downstream can move until a payment acknowledgement lands.
  if (advanceHold) {
    return {
      ...base, kind: "INVOICE",
      subject: `Lot held — advance payment pending — ${ref0}`,
      body: `${wo.mpn} (Lot ${wo.lotCode}) is booked in but remains on hold: invoice ${invoiceNo} is on advance terms and we have not yet received the transfer. Testing will not be scheduled until it clears.\n\nPlease share the remittance advice, quoting work order ${wo.workOrderNo}.`,
    };
  }

  // Credit terms and the fee is owed — the lab chases occasionally. Testing still runs
  // (they work on account), so this never blocks the physical chain.
  if (feeUnpaid && Math.random() < 0.2) {
    return {
      ...base, kind: "INVOICE",
      subject: `Payment reminder — invoice ${invoiceNo} — ${ref0}`,
      body: `Our invoice ${invoiceNo} for the testing on ${wo.mpn} (Lot ${wo.lotCode}) is still showing as outstanding on our ledger. Could you confirm when the transfer was or will be released, and share the reference so we can reconcile it?`,
    };
  }

  const progressMail = (): WhlInboundMail => ({
    ...base, kind: "STATUS_UPDATE", stage: "TESTING_IN_PROGRESS",
    subject: `Interim status — ${ref0}`,
    body: `${picks.join(" and ")} now underway for ${wo.mpn} (Lot ${wo.lotCode}). No adverse findings to report at this point.`,
    testUpdates: picks.map((name) => ({ name, status: "IN_PROGRESS" as TestProcessStatus, note: "Test in progress at WHL" })),
  });
  const delayMail = (): WhlInboundMail => ({
    ...base, kind: "DELAY", stage: "TESTING_IN_PROGRESS",
    subject: `Delay notice — ${ref0}`,
    body: `Decapsulation bench is backed up; expect ${wo.mpn} (Lot ${wo.lotCode}) to run 2 days past the quoted TAT.`,
    testUpdates: picks.map((name) => ({ name, status: "PENDING" as TestProcessStatus, note: "Delayed — bench backlog at WHL" })),
  });

  // Booked in and paid for → the lot goes on the bench, and the first interim update is
  // what says so. No separate "testing commenced" beat: it told us nothing the per-test
  // progress on this mail doesn't already say.
  if (at < stageIdx("TESTING_IN_PROGRESS")) {
    return Math.random() < 0.2 ? delayMail() : progressMail();
  }

  // Underway → more interim updates (no stage change, but the tracker still moves), an
  // occasional delay, and eventually the bench work wraps up.
  if (at < stageIdx("TESTING_COMPLETED")) {
    const beat = pickWeighted<"PROGRESS" | "DELAY" | "DONE">([["PROGRESS", 30], ["DELAY", 10], ["DONE", 60]]);
    if (beat === "DELAY") return delayMail();
    if (beat === "PROGRESS") return progressMail();
    return {
      ...base, kind: "STATUS_UPDATE", stage: "TESTING_COMPLETED",
      subject: `Testing complete — ${ref0}`,
      body: `All processes in the agreed test plan have now been conducted on ${wo.mpn} (Lot ${wo.lotCode}). Results are with our reviewer; the report follows separately.`,
    };
  }

  // Bench done, write-up with the reviewer → the signed report arrives. The lag between
  // the two shows as the gap between these stages' timestamps, which is what mattered
  // about it — it never needed a stage of its own.
  if (at < stageIdx("REPORT_SHARED")) {
    return {
      ...base, kind: "REPORT", stage: "REPORT_SHARED", reportNo: `${wo.workOrderNo}.1`,
      subject: `WHL Report ${wo.workOrderNo} — ${wo.mpn} (Lot ${wo.lotCode})`,
      body: `Please find attached our report for work order ${wo.workOrderNo}. Conclusion and process breakdown are in the attached PDF. Use "Fetch report" in the portal to parse the results onto the lot.`,
      attachments: [`WHL-${wo.workOrderNo}.1.pdf`],
    };
  }

  // Report already in hand — nothing further unless we ask (re-test, F.A.R. follow-up).
  return null;
}
