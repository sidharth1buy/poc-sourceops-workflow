/**
 * Hardcoded per-order demo detail (POC — no backend yet).
 *
 * Every order below is a deliberately different *state* so each screen and each
 * feature has something real to look at:
 *
 *   ord-148  ACTIVE   · INTL · ESCROW · WHL          → the hero: 3 lots, report revisions, F.A.R., unmatched mail
 *   ord-151  ACTIVE   · INTL · ADVANCE · WHL         → suspect-counterfeit FAIL, escalated thread, re-test asked
 *   ord-149  ACTIVE   · DOM  · CREDIT · SELF-TEST    → supplier self-test (no WHL report), CoC on file
 *   ord-153  ON_HOLD  · INTL · ESCROW · WHL          → not-acceptable report, refund path, chase past SLA, unmatched mail
 *   ord-144  CLOSED   · INTL · ESCROW · WHL          → everything green: all tests passed, escrow released, PoD + e-invoice
 *   ord-155  DRAFT    · DOM  · ADVANCE · NO TESTING  → "PO specifies no incoming test" path
 *
 * The hero (ord-148) keeps its own richer seed in fixtures.ts; the rest live here.
 */
import type {
  OrderLine, Lot, LotTest, MpnTestSpec, WhlReport, LabEmail, Payment, Shipment,
  CustomsEntry, DeliveryAllocation, SourcingAllocation, DocumentRef, Approval, OrderEvent, EInvoice,
  TestProcessStatus, TestSource, WhlProcessResult, WhlConclusion, TestAuditEntry, Address,
  LotNotification, NotifyParty,
} from "@/types";
import { WHL_CONFIDENTIALITY } from "@/data/enums";

// ---- tiny builders (keep the seed readable instead of 2 000 lines of literals) ----

let _n = 0;
const nid = (p: string) => `${p}-${++_n}`;

const line = (
  id: string, no: number, mpn: string, make: string, desc: string, qty: number, price: number, currency: string,
  o: { hsn?: string; dc?: string; coo?: string; mode?: OrderLine["testingMode"]; cat?: string; lab?: string; forPo?: string } = {},
): OrderLine => ({
  id, lineNo: no, mpn, make, description: o.forPo ? `For ${o.forPo}` : desc, hsnCode: o.hsn ?? "85423900",
  quantity: qty, unitPrice: price, currency, dateCode: o.dc ?? "24+", coo: o.coo ?? "—",
  testingRequired: (o.mode ?? "WHL") !== "NONE", testingMode: o.mode ?? "WHL",
  componentCategory: o.cat ?? "—", lab: o.lab,
});

const audit = (by: string, action: TestAuditEntry["action"], at: string, o: Partial<TestAuditEntry> = {}): TestAuditEntry =>
  ({ id: nid("aud"), at, by, action, ...o });

/** A PO-parsed test list for one MPN. `manual` names are marked as operator overrides. */
const spec = (
  mpn: string, doc: string, parsedAt: string,
  o: { tests?: [string, string?][]; manual?: string[]; autofill?: MpnTestSpec["autofill"]; note?: string; conf?: number },
): MpnTestSpec => {
  const rows = (o.tests ?? []).map(([name, std]) => ({
    id: nid("req"), name, standard: std,
    source: (o.manual?.includes(name) ? "MANUAL" : "AUTO_PO") as TestSource,
    addedBy: o.manual?.includes(name) ? "A. Sharma" : undefined,
    addedAt: o.manual?.includes(name) ? parsedAt : undefined,
  }));
  return {
    id: nid("spec"), mpn, autofill: o.autofill ?? "OK", autofillNote: o.note, sourceDoc: doc, parsedAt,
    confidence: o.conf ?? 0.95, tests: rows,
    audit: [
      audit("Doc extraction (auto)", "AUTOFILL", parsedAt, {
        target: mpn, before: "—",
        after: o.autofill === "FAILED" ? "auto-fill failed" : `${rows.filter((r) => r.source === "AUTO_PO").length} test(s) from ${doc}`,
        note: o.note ?? `Confidence ${Math.round((o.conf ?? 0.95) * 100)}%.`,
      }),
      ...(o.manual ?? []).map((m) => audit("A. Sharma", "ADD", parsedAt, { target: m, before: "—", after: "manual test", note: "Manual override of the auto-filled list." })),
    ],
  };
};

/** One row of a lot's status tracker, with a short but real progression. */
const lt = (
  name: string, status: TestProcessStatus,
  o: { std?: string; a?: number; r?: number; src?: TestSource; raised?: string; at?: string; by?: string; note?: string } = {},
): LotTest => ({
  id: nid("lt"), name, standard: o.std, source: o.src ?? "AUTO_PO", status,
  acceptQty: o.a, rejectQty: o.r, updatedAt: o.at,
  history: [
    audit(o.src === "MANUAL" ? "A. Sharma" : "Doc extraction (auto)", "STATUS", o.raised ?? "2026-07-20 09:20",
      { target: name, after: "PENDING", note: "Inherited from the PO test list when the lot was raised." }),
    ...(status === "PENDING" ? [] : [
      audit(o.by ?? "WHL inbox (auto)", status === "PASSED" || status === "FAILED" || status === "FAR" ? "REPORT" : "STATUS",
        o.at ?? "2026-07-26 12:00", { target: name, before: "PENDING", after: status, note: o.note ?? "Updated from WHL correspondence." }),
    ]),
  ],
});

type Proc = [string, WhlProcessResult, number?, number?, string?];

const report = (
  reportNo: string, revision: number, wo: string, date: string, received: string, current: boolean,
  head: { mpn: string; make: string; lotQty: number; clientPo: string; conclusion: WhlConclusion; msl?: string; pkg?: string; risk?: string; standards?: string[] },
  procs: Proc[],
  o: { flags?: string[]; revNote?: string; approver?: [string, string] } = {},
): WhlReport => ({
  id: nid("rep"), reportNo, revision, reportDate: date, workOrderNo: wo,
  fileName: `WHL-${reportNo}.pdf`, receivedAt: received, current, revisionNote: o.revNote,
  partNumber: head.mpn, manufacturer: head.make, lotQty: head.lotQty,
  client: "Sharpbuy Global Solutions", clientPo: head.clientPo,
  conclusion: head.conclusion, anyFar: procs.some(([, r]) => r === "FAR"),
  processes: procs.map(([name, result, a, r, note]) => ({ name, result, acceptQty: a, rejectQty: r, note })),
  approvedBy: o.approver?.[0] ?? "K. Ng", approverTitle: o.approver?.[1] ?? "Laboratory Manager",
  standards: head.standards ?? ["AS6081"], riskClass: head.risk ?? "ERAI Low Risk",
  msl: head.msl ?? "MSL 3", packageType: head.pkg ?? "—",
  confidentialityNote: WHL_CONFIDENTIALITY, parseFlags: o.flags ?? [],
  accessLog: [{ at: received, by: "A. Sharma", action: "VIEW" }],
});

const mail = (
  direction: LabEmail["direction"], kind: LabEmail["kind"], status: LabEmail["status"],
  at: string, subject: string, body: string,
  o: { lot?: Lot; attachments?: string[]; by?: string; matchNote?: string } = {},
): LabEmail => ({
  id: nid("em"), direction, kind, status, at, subject, body,
  by: o.by ?? (direction === "OUT" ? "A. Sharma" : "WHL Reports"),
  lotId: o.lot?.id, lotCode: o.lot?.lotCode, mpn: o.lot?.orderLineMpn,
  workOrderNo: o.lot?.workOrderNo, poNo: o.lot?.clientPoNo,
  attachments: o.attachments, matchNote: o.matchNote,
});

const pay = (
  direction: Payment["direction"], mode: Payment["mode"], amount: number, currency: string,
  status: Payment["status"], triggerDoc: string, o: { due?: string; paid?: string; utr?: string; ref?: string } = {},
): Payment => ({ id: nid("pay"), direction, mode, triggerDoc, amount, currency, status, dueDate: o.due, paidAt: o.paid, utr: o.utr, providerRef: o.ref });

const ship = (
  shipmentNo: string, leg: Shipment["leg"], awb: string, carrier: string, from: string, to: string,
  status: Shipment["status"], lines: { mpn: string; qty: number }[],
  o: { boxes?: number; kg?: number; dispatch?: string; delivery?: string; at?: string; ewb?: string } = {},
): Shipment => ({
  id: nid("shp"), shipmentNo, leg, awb, carrier, fromLocation: from, toLocation: to,
  boxCount: o.boxes ?? 2, grossWeightKg: o.kg ?? 12, status, lines,
  dispatchDate: o.dispatch, deliveryDate: o.delivery, lastLocation: o.at, ewayBill: o.ewb,
  carrierRef: `${carrier.toUpperCase()}-${shipmentNo}`, trackingUrl: `https://track.example/${awb.replace(/\s/g, "")}`,
});

/** A circulated result — who was told, when, and whether the report rode along. */
const ntf = (
  party: NotifyParty, to: string, at: string, subject: string, body: string,
  o: { reportNo?: string; attach?: string; by?: string; status?: LotNotification["status"]; note?: string } = {},
): LotNotification => ({
  id: nid("ntf"), party, to, at, by: o.by ?? "A. Sharma", status: o.status ?? "SENT",
  subject, body, reportNo: o.reportNo, attachments: o.attach ? [o.attach] : [],
  note: o.note ?? (party === "SUPPLIER" ? "Masked — buyer identity, sales order and sell price withheld."
    : party === "BUYER" ? "Masked — supplier identity, buy price and inbound AWB withheld."
    : party === "ESCROW" ? "Release-trigger evidence for the escrow provider."
    : "Acknowledgement to the laboratory."),
});

const doc = (subjectType: string, docType: string, fileName: string, by: string, at: string): DocumentRef =>
  ({ id: nid("doc"), subjectType, docType, fileName, uploadedBy: by, uploadedAt: at });

const ev = (eventType: string, message: string, at: string, by = "A. Sharma", source = "SC_MANUAL"): OrderEvent =>
  ({ id: nid("ev"), eventType, message, source, occurredAt: at, recordedBy: by });

const appr = (kind: string, role: string, status: Approval["status"], o: { by?: string; notes?: string; subject?: string } = {}): Approval =>
  ({ id: nid("ap"), subjectType: o.subject ?? "ORDER", kind, role, status, decidedBy: o.by, notes: o.notes });

const alloc = (orderLineId: string, mpn: string, clientPoNo: string, qty: number, marginPct: number): SourcingAllocation =>
  ({ id: nid("sa"), orderLineId, clientPoNo, clientLineMpn: mpn, orderLineMpn: mpn, qty, marginPct });

const deliv = (fromShipmentNo: string, clientPoNo: string, mpn: string, qty: number, at: string, pod?: string): DeliveryAllocation =>
  ({ id: nid("da"), fromShipmentNo, clientPoNo, clientLineMpn: mpn, qty, decidedBy: "A. Sharma", decidedAt: at, pod });

export interface OrderDetail {
  lines: OrderLine[];
  mpnTests: MpnTestSpec[];
  lots: Lot[];
  labEmails: LabEmail[];
  // Escrow itself is built entirely in fixtures.ts (8-state machine, milestone-based release,
  // agreedConditions) — not seeded per-order here, so there's no escrow field on this shape.
  payments: Payment[];
  shipments: Shipment[];
  customs: CustomsEntry[];
  deliveries: DeliveryAllocation[];
  sourcingAllocations: SourcingAllocation[];
  documents: DocumentRef[];
  approvals: Approval[];
  events: OrderEvent[];
  einvoice?: EInvoice;
  buyerAddress?: Address;
}

// =====================================================================================
// ord-151 — Northwind GmbH / Taiwan Semi · INTL · ADVANCE · WHL
// Story: FPGA lot came back SUSPECT COUNTERFEIT. Second lot still on the bench.
// =====================================================================================

const L151 = [
  line("ord-151-l1", 1, "XC7A35T-2FGG484I", "AMD (Xilinx)", "Artix-7 FPGA 484-FBGA", 120, 260, "USD",
    { dc: "24+", coo: "TW", mode: "WHL", cat: "FPGA", lab: "WHL Hong Kong", forPo: "NW-4402" }),
];

const LOT151_A: Lot = {
  id: "lot-151a", orderLineMpn: "XC7A35T-2FGG484I", lotCode: "LOT-NW-1", dateCode: "2408", qty: 70, sampleQty: 10,
  testStatus: "FAIL", lab: "WHL Hong Kong", workOrderNo: "352166", reportNo: "352166.1", tatDays: 7,
  testedAt: "2026-07-27", clientPoNo: "NW-4402",
  tests: [
    lt("Documentation & Packaging Inspection", "PASSED", { std: "AS6081", a: 10, r: 0, raised: "2026-07-21 09:00", at: "2026-07-27 11:30", note: "Report 352166.1 — packaging consistent." }),
    lt("General Inspection", "PASSED", { std: "AS6081", a: 10, r: 0, raised: "2026-07-21 09:00", at: "2026-07-27 11:30" }),
    lt("External Visual Inspection", "FAILED", { std: "AS6081", a: 4, r: 6, raised: "2026-07-21 09:00", at: "2026-07-27 11:30", note: "Report 352166.1 — resurfacing + laser re-marking on 6 of 10 units." }),
    lt("X-Ray Inspection", "FAILED", { std: "AS6081", a: 6, r: 4, raised: "2026-07-21 09:00", at: "2026-07-27 11:30", note: "Report 352166.1 — internal die geometry differs from reference." }),
    lt("Decapsulation & Die Analysis", "FAILED", { std: "AS6171", a: 0, r: 3, raised: "2026-07-21 09:00", at: "2026-07-27 11:30", note: "Report 352166.1 — die marking does not match AMD reference." }),
    lt("Electrical Test", "NOT_CONDUCTED", { std: "AS6081", raised: "2026-07-21 09:00", at: "2026-07-27 11:30", note: "Stopped after the counterfeit determination." }),
  ],
  reports: [
    report("352166.1", 1, "352166", "2026-07-27", "2026-07-27 11:30", true,
      { mpn: "XC7A35T-2FGG484I", make: "AMD (Xilinx)", lotQty: 70, clientPo: "NW-4402", conclusion: "SUSPECT_COUNTERFEIT", msl: "MSL 4", pkg: "FBGA-484", risk: "ERAI High Risk", standards: ["AS6081", "AS6171"] },
      [
        ["Documentation & Packaging Inspection", "ACCEPTABLE", 10, 0],
        ["General Inspection", "ACCEPTABLE", 10, 0],
        ["External Visual Inspection", "NOT_ACCEPTABLE", 4, 6, "Resurfacing and laser re-marking evident."],
        ["X-Ray Inspection", "NOT_ACCEPTABLE", 6, 4, "Internal geometry inconsistent with reference device."],
        ["Decapsulation & Die Analysis", "NOT_ACCEPTABLE", 0, 3, "Die marking does not match the manufacturer reference."],
        ["Electrical Test", "NOT_CONDUCTED", undefined, undefined, "Not conducted — counterfeit determination reached."],
      ],
      { approver: ["S. Lau", "Senior Failure Analyst"] }),
  ],
  notifications: [
    ntf("SUPPLIER", "quality@taiwansemi.example", "2026-07-27 12:05",
      "Test result — XC7A35T-2FGG484I / Lot LOT-NW-1 — Suspect Counterfeit (SPO-2026-0151)",
      "Dear supplier,\n\nThe independent test on the lot supplied against SPO-2026-0151 is complete.\n\n· MPN: XC7A35T-2FGG484I (date code 2408)\n· Lot: LOT-NW-1 — qty 70, sample 10\n· Test report: 352166.1 dated 2026-07-27\n· Conclusion: Suspect Counterfeit\n\nThe lot is NOT accepted. Per the PO, the cost of test failure and return sits with the supplier. Please confirm within 2 business days whether you will (a) replace the lot with fully traceable stock, or (b) accept return and refund.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "352166.1", attach: "WHL-352166.1.pdf" }),
    ntf("BUYER", "procurement@northwind.example", "2026-07-27 12:20",
      "ORD-2026-000151 — test result for XC7A35T-2FGG484I / Lot LOT-NW-1 — Suspect Counterfeit",
      "Dear customer,\n\nIndependent testing on your order against NW-4402 is complete.\n\n· MPN: XC7A35T-2FGG484I (date code 2408)\n· Lot: LOT-NW-1 — qty 70, sample 10\n· Test report: 352166.1 dated 2026-07-27\n· Conclusion: Suspect Counterfeit\n· Laboratory: WHL Hong Kong\n\nThe lot did not pass the agreed screen and will not be dispatched to you. We are sourcing replacement stock and will confirm the revised schedule; your funds remain protected under the agreed payment terms.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "352166.1", attach: "WHL-352166.1.pdf" }),
  ],
};

const LOT151_B: Lot = {
  id: "lot-151b", orderLineMpn: "XC7A35T-2FGG484I", lotCode: "LOT-NW-2", dateCode: "2412", qty: 50, sampleQty: 8,
  testStatus: "PENDING", lab: "WHL Hong Kong", workOrderNo: "352178", tatDays: 6, clientPoNo: "NW-4402",
  tests: [
    lt("Documentation & Packaging Inspection", "PASSED", { std: "AS6081", a: 8, r: 0, raised: "2026-07-28 09:00", at: "2026-07-29 10:10", note: "Interim mail — intake and paperwork clear." }),
    lt("General Inspection", "IN_PROGRESS", { std: "AS6081", raised: "2026-07-28 09:00", at: "2026-07-29 10:10", note: "Interim mail — on the bench." }),
    lt("External Visual Inspection", "IN_PROGRESS", { std: "AS6081", raised: "2026-07-28 09:00", at: "2026-07-29 10:10" }),
    lt("X-Ray Inspection", "PENDING", { std: "AS6081", raised: "2026-07-28 09:00" }),
    lt("Decapsulation & Die Analysis", "PENDING", { std: "AS6171", src: "MANUAL", raised: "2026-07-28 09:05" }),
    lt("Electrical Test", "PENDING", { std: "AS6081", raised: "2026-07-28 09:00" }),
  ],
  reports: [],
  lastUpdateRequestAt: "2026-07-29",
};

const D151: OrderDetail = {
  lines: L151,
  mpnTests: [spec("XC7A35T-2FGG484I", "Purchase Order SPO-2026-0151", "2026-07-20 09:20", {
    tests: [["Documentation & Packaging Inspection", "AS6081"], ["General Inspection", "AS6081"], ["External Visual Inspection", "AS6081"],
      ["X-Ray Inspection", "AS6081"], ["Decapsulation & Die Analysis", "AS6171"], ["Electrical Test", "AS6081"]],
    manual: ["Decapsulation & Die Analysis"], conf: 0.94,
  })],
  lots: [LOT151_A, LOT151_B],
  labEmails: [
    mail("OUT", "CUSTOM", "AWAITING_RESPONSE", "2026-07-29 09:40",
      "Re-test request — WO 352166 / Lot LOT-NW-1 / XC7A35T-2FGG484I",
      "Hi WHL team,\n\nThe supplier disputes the counterfeit determination in report 352166.1. Please confirm the die-analysis photographs and whether an independent second opinion is possible.\n\nThanks,\nSourcing Ops\nSharpbuy Global Solutions",
      { lot: LOT151_A }),
    mail("IN", "REPORT", "REPORT_DELIVERED", "2026-07-27 11:30",
      "WHL Report 352166.1 — XC7A35T-2FGG484I (Lot LOT-NW-1)",
      "Report 352166.1 attached. Overall conclusion: SUSPECT COUNTERFEIT. Visual, X-Ray and die analysis all non-conforming; electrical testing was not conducted.",
      { lot: LOT151_A, attachments: ["WHL-352166.1.pdf"] }),
    mail("IN", "STATUS_UPDATE", "UPDATE_RECEIVED", "2026-07-29 10:10",
      "Interim status — WO 352178 / Lot LOT-NW-2",
      "LOT-NW-2 intake complete, documentation clear. General and external visual inspection underway; X-Ray tomorrow.",
      { lot: LOT151_B }),
    mail("OUT", "REQUEST_UPDATE", "AWAITING_RESPONSE", "2026-07-29 09:45",
      "Status request — WO 352178 / Lot LOT-NW-2 / XC7A35T-2FGG484I",
      "Hi WHL team,\n\nReference:\n· MPN: XC7A35T-2FGG484I (date code 2412)\n· Lot: LOT-NW-2 — qty 50, sample 8\n· Work order: 352178\n· Sales Order: NW-4402\n\nGiven the outcome on LOT-NW-1, please prioritise this lot and confirm the expected report date.\n\nThanks,\nSourcing Ops\nSharpbuy Global Solutions",
      { lot: LOT151_B }),
  ],
  payments: [
    pay("CLIENT_TO_1BUY", "ADVANCE", 35580, "USD", "PAID", "Our PI", { due: "2026-07-22", paid: "2026-07-22", utr: "UTR8830142" }),
    pay("1BUY_TO_SUPPLIER", "ADVANCE", 31200, "USD", "INITIATED", "Supplier PI", { due: "2026-07-24", ref: "TT-77120934" }),
  ],
  shipments: [
    ship("SHP-IN-151-1", "INBOUND", "FDX 7741 9930 221", "FEDEX", "Hsinchu, TW", "WHL Hong Kong", "ARRIVED",
      [{ mpn: "XC7A35T-2FGG484I", qty: 120 }], { boxes: 3, kg: 8.4, dispatch: "2026-07-19", delivery: "2026-07-21", at: "Hong Kong SAR" }),
  ],
  customs: [
    { id: nid("ce"), shipmentNo: "SHP-IN-151-1", beNo: "—", portCode: "INBOM4", chaName: "Pearl Logistics CHA", totalDuty: undefined, currency: "INR" },
  ],
  deliveries: [],
  sourcingAllocations: [alloc("ord-151-l1", "XC7A35T-2FGG484I", "NW-4402", 120, 12)],
  documents: [
    doc("ORDER", "PO", "buyer-po-NW-4402.pdf", "A. Sharma", "2026-07-20"),
    doc("ORDER", "PI", "supplier-pi-taiwan-semi.pdf", "A. Sharma", "2026-07-21"),
    doc("LOT", "WHL_REPORT", "WHL-352166.1.pdf", "WHL (email)", "2026-07-27"),
    doc("ORDER", "PACKING_LIST", "packing-list-SHP-IN-151-1.pdf", "A. Sharma", "2026-07-19"),
  ],
  approvals: [
    appr("PO_REVIEW", "Finance", "APPROVED", { by: "R. Menon (Finance)", notes: "Margin 12% — ok." }),
    appr("QUALITY_HOLD", "Approver", "PENDING", { notes: "LOT-NW-1 suspect counterfeit — decide reject & claim vs. re-test." }),
  ],
  events: [
    ev("DELAY", "LOT-NW-1 declared SUSPECT COUNTERFEIT by WHL — lot quarantined at the lab, supplier claim opened.", "2026-07-27"),
    ev("SUPPLIER_NOTE", "Taiwan Semi disputes the determination; asked WHL for die photographs.", "2026-07-29"),
    ev("GENERAL", "LOT-NW-2 (balance 50 pcs) submitted to WHL Hong Kong under WO 352178.", "2026-07-28"),
  ],
};

// =====================================================================================
// ord-149 — Bharat Elec / Delhi Components · DOMESTIC · CREDIT · SUPPLIER SELF-TEST
// Story: no WHL involvement — supplier tests and ships a CoC. Shows the self-test path.
// =====================================================================================

const L149 = [
  line("ord-149-l1", 1, "LM317T", "TI", "Adjustable linear regulator", 2000, 380, "INR",
    { dc: "25+", coo: "IN", mode: "SUPPLIER_SELF", cat: "Power", hsn: "85423100", forPo: "BEL-DOM/26/PO/77" }),
  line("ord-149-l2", 2, "IRF540NPBF", "Infineon", "N-channel MOSFET 100V", 3000, 140, "INR",
    { dc: "25+", coo: "IN", mode: "SUPPLIER_SELF", cat: "Discrete", hsn: "85412900", forPo: "BEL-DOM/26/PO/77" }),
];

const LOT149_A: Lot = {
  id: "lot-149a", orderLineMpn: "LM317T", lotCode: "LOT-DC-1", dateCode: "2521", qty: 2000, sampleQty: 32,
  testStatus: "PASS", lab: "Delhi Components QA (self-test)", workOrderNo: "DC-SELF-4471", reportNo: "DC-COC-4471",
  tatDays: 2, testedAt: "2026-07-24", clientPoNo: "BEL-DOM/26/PO/77",
  tests: [
    lt("Documentation & Packaging Inspection", "PASSED", { a: 32, r: 0, raised: "2026-07-22 10:00", at: "2026-07-24 12:00", by: "Delhi Components QA", note: "Self-test CoC DC-COC-4471 — reels sealed, MSD bags intact." }),
    lt("General Inspection", "PASSED", { a: 32, r: 0, raised: "2026-07-22 10:00", at: "2026-07-24 12:00", by: "Delhi Components QA" }),
    lt("Electrical Test", "PASSED", { a: 31, r: 1, raised: "2026-07-22 10:00", at: "2026-07-24 12:00", by: "Delhi Components QA", note: "1 unit outside Vref band — within the agreed AQL." }),
  ],
  reports: [],
};

const LOT149_B: Lot = {
  id: "lot-149b", orderLineMpn: "IRF540NPBF", lotCode: "LOT-DC-2", dateCode: "2519", qty: 3000, sampleQty: 32,
  testStatus: "MAYBE", lab: "Delhi Components QA (self-test)", workOrderNo: "DC-SELF-4472", tatDays: 2,
  clientPoNo: "BEL-DOM/26/PO/77",
  tests: [
    lt("Documentation & Packaging Inspection", "PASSED", { a: 32, r: 0, raised: "2026-07-22 10:00", at: "2026-07-25 09:30", by: "Delhi Components QA" }),
    lt("General Inspection", "FAR", { a: 30, r: 2, raised: "2026-07-22 10:00", at: "2026-07-25 09:30", by: "Delhi Components QA", note: "2 units with bent leads — supplier to re-inspect the full reel." }),
    lt("Electrical Test", "IN_PROGRESS", { raised: "2026-07-22 10:00", at: "2026-07-25 09:30", by: "Delhi Components QA", note: "Rds(on) sweep pending on the remaining sample." }),
  ],
  reports: [],
  lastUpdateRequestAt: "2026-07-25",
};

const D149: OrderDetail = {
  lines: L149,
  mpnTests: [
    spec("LM317T", "Purchase Order SPO-2026-0149", "2026-07-21 15:05", {
      tests: [["Documentation & Packaging Inspection"], ["General Inspection"], ["Electrical Test"]], conf: 0.97,
    }),
    spec("IRF540NPBF", "Purchase Order SPO-2026-0149", "2026-07-21 15:05", {
      tests: [["Documentation & Packaging Inspection"], ["General Inspection"], ["Electrical Test"]], conf: 0.96,
    }),
  ],
  lots: [LOT149_A, LOT149_B],
  labEmails: [
    mail("OUT", "CUSTOM", "AWAITING_RESPONSE", "2026-07-25 11:00",
      "Self-test report request — LOT-DC-2 / IRF540NPBF",
      "Hi team,\n\nReference:\n· MPN: IRF540NPBF (date code 2519)\n· Lot: LOT-DC-2 — qty 3000, sample 32\n· Work order: DC-SELF-4472\n· Sales Order: BEL-DOM/26/PO/77\n\nPlease share the signed CoC once the Rds(on) sweep is complete, and confirm the disposition of the 2 bent-lead units.\n\nThanks,\nSourcing Ops\nSharpbuy Global Solutions",
      { lot: LOT149_B }),
    mail("IN", "STATUS_UPDATE", "UPDATE_RECEIVED", "2026-07-25 09:30",
      "LOT-DC-2 interim — 2 units flagged on visual",
      "Visual inspection on LOT-DC-2 found 2 units with bent leads; we are re-inspecting the full reel. Electrical sweep continues today.",
      { lot: LOT149_B, by: "Delhi Components QA" }),
    mail("IN", "REPORT", "REPORT_DELIVERED", "2026-07-24 12:00",
      "CoC DC-COC-4471 — LM317T (Lot LOT-DC-1)",
      "Certificate of Conformance attached for LOT-DC-1. Sample 32/2000, all parameters within specification (1 unit inside AQL).",
      { lot: LOT149_A, attachments: ["DC-COC-4471.pdf"], by: "Delhi Components QA" }),
  ],
  payments: [
    pay("CLIENT_TO_1BUY", "CREDIT", 1310000, "INR", "PENDING", "Our tax invoice", { due: "2026-08-15" }),
    pay("1BUY_TO_SUPPLIER", "CREDIT", 1180000, "INR", "PENDING", "Supplier invoice", { due: "2026-08-25" }),
  ],
  shipments: [
    ship("SHP-IN-149-1", "INBOUND", "DLV 4471 8823", "DELHIVERY", "Delhi Components, New Delhi", "1Buy hub — New Delhi", "DELIVERED",
      [{ mpn: "LM317T", qty: 2000 }], { boxes: 4, kg: 18, dispatch: "2026-07-26", delivery: "2026-07-27", at: "New Delhi", ewb: "EWB-2611-4471" }),
  ],
  customs: [],
  deliveries: [deliv("SHP-IN-149-1", "BEL-DOM/26/PO/77", "LM317T", 2000, "2026-07-28")],
  sourcingAllocations: [
    alloc("ord-149-l1", "LM317T", "BEL-DOM/26/PO/77", 2000, 11),
    alloc("ord-149-l2", "IRF540NPBF", "BEL-DOM/26/PO/77", 3000, 10),
  ],
  documents: [
    doc("ORDER", "PO", "buyer-po-BEL-DOM-77.pdf", "P. Nair", "2026-07-19"),
    doc("ORDER", "PI", "supplier-pi-delhi-components.pdf", "P. Nair", "2026-07-21"),
    doc("LOT", "TEST_REPORT", "DC-COC-4471.pdf", "Supplier (email)", "2026-07-24"),
    doc("ORDER", "PACKING_LIST", "packing-list-SHP-IN-149-1.pdf", "P. Nair", "2026-07-26"),
  ],
  approvals: [
    appr("PO_REVIEW", "Finance", "APPROVED", { by: "R. Menon (Finance)", notes: "Domestic credit deal — 10% margin." }),
    appr("CREDIT_LIMIT", "Finance", "APPROVED", { by: "R. Menon (Finance)", notes: "Client inside ₹15L credit limit." }),
  ],
  events: [
    ev("GENERAL", "Supplier self-test agreed in lieu of WHL — CoC required with each lot (PO clause 4).", "2026-07-21", "P. Nair"),
    ev("PARTIAL_READY", "LM317T lot ready and dispatched to the hub; MOSFET lot follows after re-inspection.", "2026-07-26", "P. Nair"),
    ev("DELAY", "IRF540NPBF: 2 units flagged on visual — supplier re-inspecting the full reel.", "2026-07-25", "P. Nair"),
  ],
};

// =====================================================================================
// ord-153 — Kestrel Robotics / Osaka Parts · INTL · ESCROW · WHL · ON_HOLD
// Story: report NOT ACCEPTABLE → refund path armed; chase unanswered past SLA; 1 unmatched mail.
// =====================================================================================

const L153 = [
  line("ord-153-l1", 1, "ADSP-21489KSWZ-4B", "Analog Devices", "SHARC DSP 400MHz", 400, 96.25, "USD",
    { dc: "24+", coo: "JP", mode: "WHL", cat: "DSP", lab: "WHL Shenzhen", forPo: "KES-2026-0114" }),
  line("ord-153-l2", 2, "MAX3232ECPE+", "Analog Devices", "RS-232 line driver/receiver", 800, 25.5, "USD",
    { dc: "24+", coo: "JP", mode: "WHL", cat: "Interface", lab: "WHL Shenzhen", forPo: "KES-2026-0114" }),
];

const LOT153_A: Lot = {
  id: "lot-153a", orderLineMpn: "ADSP-21489KSWZ-4B", lotCode: "LOT-KS-1", dateCode: "2405", qty: 400, sampleQty: 20,
  testStatus: "FAIL", lab: "WHL Shenzhen", workOrderNo: "352158", reportNo: "352158.1", tatDays: 7,
  testedAt: "2026-07-26", clientPoNo: "KES-2026-0114",
  tests: [
    lt("Documentation & Packaging Inspection", "FAILED", { std: "AS6081", a: 14, r: 6, raised: "2026-07-20 08:40", at: "2026-07-26 17:10", note: "Report 352158.1 — CoC does not trace to the manufacturer lot." }),
    lt("General Inspection", "PASSED", { std: "AS6081", a: 20, r: 0, raised: "2026-07-20 08:40", at: "2026-07-26 17:10" }),
    lt("External Visual Inspection", "PASSED", { std: "AS6081", a: 19, r: 1, raised: "2026-07-20 08:40", at: "2026-07-26 17:10" }),
    lt("Electrical Test", "FAILED", { std: "AS6081", a: 15, r: 5, raised: "2026-07-20 08:40", at: "2026-07-26 17:10", note: "Report 352158.1 — 5 of 20 units fail the core-clock margin test." }),
    lt("X-Ray Inspection", "FAR", { std: "AS6081", a: 18, r: 2, raised: "2026-07-20 08:40", at: "2026-07-26 17:10", note: "Report 352158.1 — voids on 2 units; further analysis recommended." }),
  ],
  reports: [
    report("352158.1", 1, "352158", "2026-07-26", "2026-07-26 17:10", true,
      { mpn: "ADSP-21489KSWZ-4B", make: "Analog Devices", lotQty: 400, clientPo: "PO Unknown", conclusion: "NOT_ACCEPTABLE", msl: "MSL 3", pkg: "LQFP-176", standards: ["AS6081"] },
      [
        ["Documentation & Packaging Inspection", "NOT_ACCEPTABLE", 14, 6, "CoC does not trace to the manufacturer lot."],
        ["General Inspection", "ACCEPTABLE", 20, 0],
        ["External Visual Inspection", "ACCEPTABLE", 19, 1, "1 unit with minor handling mark."],
        ["Electrical Test", "NOT_ACCEPTABLE", 15, 5, "5 of 20 units fail core-clock margin."],
        ["X-Ray Inspection", "FAR", 18, 2, "Voids observed on 2 units — further analysis recommended."],
      ],
      { flags: ["Client P/O came back as “PO Unknown” — reconcile against the PO on file.", "One or more processes were Not Conducted or inconclusive — confirm the agreed test plan was run in full."] }),
  ],
  notifications: [
    ntf("SUPPLIER", "quality@osakaparts.example", "2026-07-26 18:00",
      "Test result — ADSP-21489KSWZ-4B / Lot LOT-KS-1 — Not Acceptable (SPO-2026-0153)",
      "Dear supplier,\n\nThe independent test on the lot supplied against SPO-2026-0153 is complete.\n\n· MPN: ADSP-21489KSWZ-4B (date code 2405)\n· Lot: LOT-KS-1 — qty 400, sample 20\n· Test report: 352158.1 dated 2026-07-26\n· Conclusion: Not Acceptable\n\nThe lot is NOT accepted (traceability + electrical margin). Per the PO, the cost of test failure and return sits with the supplier. Please confirm replacement or return/refund within 2 business days.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "352158.1", attach: "WHL-352158.1.pdf" }),
    ntf("ESCROW", "ops@hkin.example", "2026-07-26 18:15",
      "Escrow ES2607-6120 — release trigger NOT satisfied — Lot LOT-KS-1 Not Acceptable",
      "Dear HKIN team,\n\nRe escrow ES2607-6120 for ORD-2026-000153:\n\n· MPN: ADSP-21489KSWZ-4B\n· Lot: LOT-KS-1 — qty 400, sample 20\n· Test report: 352158.1 dated 2026-07-26\n· Conclusion: Not Acceptable\n\nThe release trigger is NOT satisfied. Please hold the funds; a refund instruction may follow once the return is agreed with the seller.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "352158.1", attach: "WHL-352158.1.pdf", by: "R. Menon" }),
  ],
};

const LOT153_B: Lot = {
  id: "lot-153b", orderLineMpn: "MAX3232ECPE+", lotCode: "LOT-KS-2", dateCode: "2410", qty: 800, sampleQty: 20,
  testStatus: "PENDING", lab: "WHL Shenzhen", workOrderNo: "352159", tatDays: 7, clientPoNo: "KES-2026-0114",
  tests: [
    lt("Documentation & Packaging Inspection", "PASSED", { std: "AS6081", a: 20, r: 0, raised: "2026-07-20 08:45", at: "2026-07-23 14:00", note: "Interim mail — paperwork accepted." }),
    lt("General Inspection", "IN_PROGRESS", { std: "AS6081", raised: "2026-07-20 08:45", at: "2026-07-23 14:00" }),
    lt("External Visual Inspection", "PENDING", { std: "AS6081", raised: "2026-07-20 08:45" }),
    lt("Electrical Test", "PENDING", { std: "AS6081", raised: "2026-07-20 08:45" }),
    lt("X-Ray Inspection", "NOT_CONDUCTED", { std: "AS6081", raised: "2026-07-20 08:45", at: "2026-07-23 14:00", note: "Descoped by WHL — X-Ray bench under maintenance; awaiting our instruction." }),
  ],
  reports: [],
  lastUpdateRequestAt: "2026-07-23",
};

const D153: OrderDetail = {
  lines: L153,
  mpnTests: [
    spec("ADSP-21489KSWZ-4B", "Purchase Order SPO-2026-0153", "2026-07-19 16:20", {
      tests: [["Documentation & Packaging Inspection", "AS6081"], ["General Inspection", "AS6081"], ["External Visual Inspection", "AS6081"],
        ["Electrical Test", "AS6081"], ["X-Ray Inspection", "AS6081"]], conf: 0.93,
    }),
    spec("MAX3232ECPE+", "Purchase Order SPO-2026-0153", "2026-07-19 16:20", {
      autofill: "FAILED", note: "Test table for this MPN sits in an image-only annexe — columns could not be resolved.",
      tests: [["Documentation & Packaging Inspection", "AS6081"], ["General Inspection", "AS6081"], ["External Visual Inspection", "AS6081"],
        ["Electrical Test", "AS6081"], ["X-Ray Inspection", "AS6081"]],
      manual: ["Documentation & Packaging Inspection", "General Inspection", "External Visual Inspection", "Electrical Test", "X-Ray Inspection"],
      conf: 0.28,
    }),
  ],
  lots: [LOT153_A, LOT153_B],
  labEmails: [
    mail("IN", "STATUS_UPDATE", "AWAITING_RESPONSE", "2026-07-29 08:05",
      "Re: your lots — one more day",
      "Hello, the bench schedule slipped by a day for one of your lots. We will send the paperwork once complete. Regards, WHL",
      { matchNote: "Subject line carries no work order, lot or report number — match it manually." }),
    mail("OUT", "CUSTOM", "ESCALATED", "2026-07-28 09:15",
      "Escalation — TAT overdue — WO 352159 / Lot LOT-KS-2 / MAX3232ECPE+",
      "Hi WHL team,\n\nReference:\n· MPN: MAX3232ECPE+ (date code 2410)\n· Lot: LOT-KS-2 — qty 800, sample 20\n· Work order: 352159\n· Sales Order: KES-2026-0114\n\nThis lot is past the quoted turnaround and our earlier request is unanswered. The order is held on this result. Please confirm today: current stage, blocker, and a committed report date.\n\nThanks,\nSourcing Ops\nSharpbuy Global Solutions",
      { lot: LOT153_B }),
    mail("OUT", "REQUEST_UPDATE", "AWAITING_RESPONSE", "2026-07-23 15:30",
      "Status request — WO 352159 / Lot LOT-KS-2 / MAX3232ECPE+",
      "Hi WHL team,\n\nReference:\n· MPN: MAX3232ECPE+ (date code 2410)\n· Lot: LOT-KS-2 — qty 800, sample 20\n· Work order: 352159\n· Sales Order: KES-2026-0114\n\nCould you share the current status of the above lot — which processes are complete, which are in progress, and the expected date for the report?\n\nThanks,\nSourcing Ops\nSharpbuy Global Solutions",
      { lot: LOT153_B }),
    mail("IN", "REPORT", "REPORT_DELIVERED", "2026-07-26 17:10",
      "WHL Report 352158.1 — ADSP-21489KSWZ-4B (Lot LOT-KS-1)",
      "Report 352158.1 attached. Overall conclusion NOT ACCEPTABLE: documentation traceability and electrical margin failures; X-Ray flagged F.A.R. on 2 units.",
      { lot: LOT153_A, attachments: ["WHL-352158.1.pdf"] }),
    mail("IN", "STATUS_UPDATE", "UPDATE_RECEIVED", "2026-07-23 14:00",
      "Interim status — WO 352159 / Lot LOT-KS-2",
      "Documentation accepted for LOT-KS-2; general inspection underway. Note our X-Ray bench is under maintenance this week — advise whether to hold or descope.",
      { lot: LOT153_B }),
  ],
  payments: [
    pay("CLIENT_TO_1BUY", "ESCROW", 67200, "USD", "PAID", "Our PI", { due: "2026-07-17", paid: "2026-07-17", utr: "UTR9911207" }),
    pay("1BUY_TO_SUPPLIER", "ESCROW", 58900, "USD", "PENDING", "Supplier PI", { due: "2026-08-05" }),
  ],
  shipments: [
    ship("SHP-IN-153-1", "INBOUND", "DHL 88420117733", "DHL", "Osaka, JP", "WHL Shenzhen", "ARRIVED",
      [{ mpn: "ADSP-21489KSWZ-4B", qty: 400 }, { mpn: "MAX3232ECPE+", qty: 800 }],
      { boxes: 5, kg: 26.5, dispatch: "2026-07-17", delivery: "2026-07-19", at: "Shenzhen, CN" }),
  ],
  customs: [
    { id: nid("ce"), shipmentNo: "SHP-IN-153-1", beNo: "filing…", beDate: "2026-07-29", portCode: "INMAA4", chaName: "Speedwing CHA", currency: "INR" },
  ],
  deliveries: [],
  sourcingAllocations: [
    alloc("ord-153-l1", "ADSP-21489KSWZ-4B", "KES-2026-0114", 400, 14),
    alloc("ord-153-l2", "MAX3232ECPE+", "KES-2026-0114", 800, 13),
  ],
  documents: [
    doc("ORDER", "PO", "buyer-po-KES-2026-0114.pdf", "A. Sharma", "2026-07-16"),
    doc("ORDER", "PI", "supplier-pi-osaka-parts.pdf", "A. Sharma", "2026-07-17"),
    doc("ESCROW", "ESCROW_INVOICE", "ES2607-6120.pdf", "R. Menon", "2026-07-18"),
    doc("LOT", "WHL_REPORT", "WHL-352158.1.pdf", "WHL (email)", "2026-07-26"),
  ],
  approvals: [
    appr("PO_REVIEW", "Finance", "APPROVED", { by: "R. Menon (Finance)", notes: "Margin 12.4%." }),
    appr("PAYMENT_RELEASE", "Finance", "PENDING", { subject: "PAYMENT", notes: "Do not release — LOT-KS-1 not acceptable; refund/return decision pending." }),
    appr("QUALITY_HOLD", "Approver", "PENDING", { notes: "Decide: reject LOT-KS-1 and refund, or accept the passing balance." }),
  ],
  events: [
    ev("DELAY", "Order on hold — BOE filing pending and LOT-KS-1 returned NOT ACCEPTABLE.", "2026-07-29"),
    ev("SUPPLIER_NOTE", "Osaka Parts offered replacement stock with full traceability at the same price.", "2026-07-28"),
    ev("GENERAL", "WHL X-Ray bench under maintenance — LOT-KS-2 X-Ray recorded as Not Conducted pending our instruction.", "2026-07-23"),
  ],
};

// =====================================================================================
// ord-144 — Acme Pte / Shenzhen Micro · INTL · ESCROW · WHL · CLOSED
// Story: the happy path end-to-end — all tests passed, escrow released, PoD + e-invoice.
// =====================================================================================

const L144 = [
  line("ord-144-l1", 1, "STM32F407VGT6", "STMicro", "32-bit ARM Cortex-M4 MCU", 1000, 21.5, "USD",
    { dc: "2318", coo: "CN", mode: "WHL", cat: "MCU", lab: "WHL Shenzhen", forPo: "ACME-PO-3210" }),
  line("ord-144-l2", 2, "TPS54560DDAR", "TI", "Step-down DC-DC converter", 3000, 2.0, "USD",
    { dc: "2402", coo: "CN", mode: "WHL", cat: "Power", lab: "WHL Shenzhen", forPo: "ACME-PO-3210" }),
];

const LOT144_A: Lot = {
  id: "lot-144a", orderLineMpn: "STM32F407VGT6", lotCode: "LOT-J1", dateCode: "2318", qty: 1000, sampleQty: 32,
  testStatus: "PASS", lab: "WHL Shenzhen", workOrderNo: "351902", reportNo: "351902.1", tatDays: 5,
  testedAt: "2026-06-24", clientPoNo: "ACME-PO-3210",
  tests: [
    lt("Documentation & Packaging Inspection", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:00", at: "2026-06-24 11:00", note: "Report 351902.1." }),
    lt("General Inspection", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:00", at: "2026-06-24 11:00", note: "Report 351902.1." }),
    lt("External Visual Inspection", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:00", at: "2026-06-24 11:00", note: "Report 351902.1." }),
    lt("Electrical Test", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:00", at: "2026-06-24 11:00", note: "Report 351902.1." }),
    lt("X-Ray Inspection", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:00", at: "2026-06-24 11:00", note: "Report 351902.1." }),
  ],
  reports: [
    report("351902.1", 1, "351902", "2026-06-24", "2026-06-24 11:00", true,
      { mpn: "STM32F407VGT6", make: "STMicroelectronics", lotQty: 1000, clientPo: "ACME-PO-3210", conclusion: "ACCEPTABLE", msl: "MSL 3", pkg: "LQFP-100", standards: ["AS6081"] },
      [
        ["Documentation & Packaging Inspection", "ACCEPTABLE", 32, 0],
        ["General Inspection", "ACCEPTABLE", 32, 0],
        ["External Visual Inspection", "ACCEPTABLE", 32, 0],
        ["Electrical Test", "ACCEPTABLE", 32, 0],
        ["X-Ray Inspection", "ACCEPTABLE", 32, 0],
      ]),
  ],
  notifications: [
    ntf("SUPPLIER", "quality@shenzhenmicro.example", "2026-06-24 12:10",
      "Test result — STM32F407VGT6 / Lot LOT-J1 — Acceptable (SPO-2026-0144)",
      "Dear supplier,\n\nThe lot supplied against SPO-2026-0144 has passed the independent screen (report 351902.1, all five processes acceptable). We are proceeding with onward logistics and the escrow release per the agreed terms.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "351902.1", attach: "WHL-351902.1.pdf" }),
    ntf("BUYER", "procurement@acme.example", "2026-06-24 12:20",
      "ORD-2026-000144 — test result for STM32F407VGT6 / Lot LOT-J1 — Acceptable",
      "Dear customer,\n\nIndependent testing against ACME-PO-3210 is complete — report 351902.1, conclusion Acceptable. The lot is cleared for dispatch; the delivery schedule follows separately.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "351902.1", attach: "WHL-351902.1.pdf" }),
    ntf("ESCROW", "ops@hkin.example", "2026-06-24 15:40",
      "Escrow ES2606-4417 — release trigger evidence — Lot LOT-J1 Acceptable",
      "Dear HKIN team,\n\nThe release trigger (independent lab PASS) is satisfied for LOT-J1 under ORD-2026-000144. Report 351902.1 attached as supporting evidence for the tranche release.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "351902.1", attach: "WHL-351902.1.pdf", by: "R. Menon" }),
    ntf("WHL", "reports@whitehorselabs.example", "2026-06-24 12:00",
      "Report received — 351902.1 / WO 351902 / Lot LOT-J1",
      "Hi WHL team,\n\nThank you — report 351902.1 is received and logged. Please retain the samples until we confirm disposition.\n\nThanks,\nSourcing Ops\nSharpbuy Global Solutions",
      { reportNo: "351902.1" }),
  ],
};

const LOT144_B: Lot = {
  id: "lot-144b", orderLineMpn: "TPS54560DDAR", lotCode: "LOT-J2", dateCode: "2402", qty: 3000, sampleQty: 32,
  testStatus: "PASS", lab: "WHL Shenzhen", workOrderNo: "351903", reportNo: "351903.1", tatDays: 5,
  testedAt: "2026-06-24", clientPoNo: "ACME-PO-3210",
  tests: [
    lt("Documentation & Packaging Inspection", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:05", at: "2026-06-24 11:20", note: "Report 351903.1." }),
    lt("General Inspection", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:05", at: "2026-06-24 11:20", note: "Report 351903.1." }),
    lt("External Visual Inspection", "PASSED", { std: "AS6081", a: 32, r: 0, raised: "2026-06-18 09:05", at: "2026-06-24 11:20", note: "Report 351903.1." }),
    lt("Electrical Test", "PASSED", { std: "AS6081", a: 31, r: 1, raised: "2026-06-18 09:05", at: "2026-06-24 11:20", note: "Report 351903.1 — 1 unit marginal, inside AQL." }),
  ],
  reports: [
    report("351903.1", 1, "351903", "2026-06-24", "2026-06-24 11:20", true,
      { mpn: "TPS54560DDAR", make: "Texas Instruments", lotQty: 3000, clientPo: "ACME-PO-3210", conclusion: "ACCEPTABLE", msl: "MSL 1", pkg: "SO PowerPAD-8", standards: ["AS6081"] },
      [
        ["Documentation & Packaging Inspection", "ACCEPTABLE", 32, 0],
        ["General Inspection", "ACCEPTABLE", 32, 0],
        ["External Visual Inspection", "ACCEPTABLE", 32, 0],
        ["Electrical Test", "ACCEPTABLE", 31, 1, "1 unit marginal but within AQL."],
      ]),
  ],
};

const D144: OrderDetail = {
  lines: L144,
  mpnTests: [
    spec("STM32F407VGT6", "Purchase Order SPO-2026-0144", "2026-06-12 10:00", {
      tests: [["Documentation & Packaging Inspection", "AS6081"], ["General Inspection", "AS6081"], ["External Visual Inspection", "AS6081"],
        ["Electrical Test", "AS6081"], ["X-Ray Inspection", "AS6081"]], conf: 0.98,
    }),
    spec("TPS54560DDAR", "Purchase Order SPO-2026-0144", "2026-06-12 10:00", {
      tests: [["Documentation & Packaging Inspection", "AS6081"], ["General Inspection", "AS6081"], ["External Visual Inspection", "AS6081"],
        ["Electrical Test", "AS6081"]], conf: 0.97,
    }),
  ],
  lots: [LOT144_A, LOT144_B],
  labEmails: [
    mail("IN", "REPORT", "REPORT_DELIVERED", "2026-06-24 11:20",
      "WHL Report 351903.1 — TPS54560DDAR (Lot LOT-J2)",
      "Report 351903.1 attached. Overall conclusion Acceptable; no F.A.R. items.",
      { lot: LOT144_B, attachments: ["WHL-351903.1.pdf"] }),
    mail("IN", "REPORT", "REPORT_DELIVERED", "2026-06-24 11:00",
      "WHL Report 351902.1 — STM32F407VGT6 (Lot LOT-J1)",
      "Report 351902.1 attached. Overall conclusion Acceptable; all five processes acceptable.",
      { lot: LOT144_A, attachments: ["WHL-351902.1.pdf"] }),
    mail("OUT", "REQUEST_UPDATE", "UPDATE_RECEIVED", "2026-06-23 09:00",
      "Status request — WO 351902 / Lot LOT-J1 / STM32F407VGT6",
      "Hi WHL team,\n\nReference:\n· MPN: STM32F407VGT6 (date code 2318)\n· Lot: LOT-J1 — qty 1000, sample 32\n· Work order: 351902\n· Sales Order: ACME-PO-3210\n\nCould you confirm the report date? The shipment is booked for the 26th.\n\nThanks,\nSourcing Ops\nSharpbuy Global Solutions",
      { lot: LOT144_A }),
  ],
  payments: [
    pay("CLIENT_TO_1BUY", "ESCROW", 31600, "USD", "PAID", "Our PI", { due: "2026-06-12", paid: "2026-06-12", utr: "UTR7710021" }),
    pay("1BUY_TO_SUPPLIER", "ESCROW", 27500, "USD", "PAID", "Supplier PI", { due: "2026-06-25", paid: "2026-06-25", utr: "UTR7719987" }),
  ],
  shipments: [
    ship("SHP-IN-144-1", "INBOUND", "DHL 77510098221", "DHL", "Shenzhen, CN", "1Buy hub — New Delhi", "DELIVERED",
      [{ mpn: "STM32F407VGT6", qty: 1000 }, { mpn: "TPS54560DDAR", qty: 3000 }],
      { boxes: 6, kg: 41.2, dispatch: "2026-06-26", delivery: "2026-06-30", at: "New Delhi" }),
    ship("SHP-OUT-144-1", "OUTBOUND", "DHL 77510114882", "DHL", "1Buy hub — New Delhi", "Acme Pte, Singapore", "DELIVERED",
      [{ mpn: "STM32F407VGT6", qty: 1000 }, { mpn: "TPS54560DDAR", qty: 3000 }],
      { boxes: 6, kg: 42.0, dispatch: "2026-07-04", delivery: "2026-07-08", at: "Singapore" }),
  ],
  customs: [
    { id: nid("ce"), shipmentNo: "SHP-IN-144-1", beNo: "BE-4471902", beDate: "2026-06-29", portCode: "INDEL4",
      chaName: "Speedwing CHA", totalDuty: 214500, currency: "INR", icegateRef: "ICE-2606-88210", filedAt: "2026-06-30" },
  ],
  deliveries: [
    deliv("SHP-OUT-144-1", "ACME-PO-3210", "STM32F407VGT6", 1000, "2026-07-04", "2026-07-08"),
    deliv("SHP-OUT-144-1", "ACME-PO-3210", "TPS54560DDAR", 3000, "2026-07-04", "2026-07-08"),
  ],
  sourcingAllocations: [
    alloc("ord-144-l1", "STM32F407VGT6", "ACME-PO-3210", 1000, 14),
    alloc("ord-144-l2", "TPS54560DDAR", "ACME-PO-3210", 3000, 10),
  ],
  documents: [
    doc("ORDER", "PO", "buyer-po-ACME-PO-3210.pdf", "A. Sharma", "2026-06-10"),
    doc("ORDER", "PI", "supplier-pi-shenzhen-micro-june.pdf", "A. Sharma", "2026-06-11"),
    doc("ESCROW", "ESCROW_INVOICE", "ES2606-4417.pdf", "R. Menon", "2026-06-14"),
    doc("LOT", "WHL_REPORT", "WHL-351902.1.pdf", "WHL (email)", "2026-06-24"),
    doc("LOT", "WHL_REPORT", "WHL-351903.1.pdf", "WHL (email)", "2026-06-24"),
    doc("ORDER", "BOE", "BE-4471902.pdf", "Speedwing CHA", "2026-06-30"),
    doc("ORDER", "TAX_INVOICE", "e-invoice-AKN2606771.pdf", "IRP (mock)", "2026-07-04"),
    doc("ORDER", "POD", "pod-acme-2026-07-08.pdf", "DHL", "2026-07-08"),
  ],
  approvals: [
    appr("PO_REVIEW", "Finance", "APPROVED", { by: "R. Menon (Finance)", notes: "Margin 13% — ok." }),
    appr("PAYMENT_RELEASE", "Finance", "APPROVED", { subject: "PAYMENT", by: "R. Menon (Finance)", notes: "Both lots PASSED — full A1 released." }),
    appr("CLOSURE", "Mgmt", "APPROVED", { by: "V. Iyer (Mgmt)", notes: "Reconciled; margin realised 13.0%." }),
  ],
  events: [
    ev("GENERAL", "Both lots PASSED at WHL — escrow released in full to Shenzhen Micro.", "2026-06-25", "R. Menon"),
    ev("GENERAL", "Relabelled to 1Buy at the hub and re-dispatched to Acme Pte.", "2026-07-04"),
    ev("GENERAL", "PoD received; order reconciled and closed.", "2026-07-08"),
  ],
  einvoice: {
    irn: "a3f1c9d84b7e2650f1aa9c73b25d1188e4a76c0f92d3b5417e8c6a2f9b0d4e771",
    ackNo: "AKN2606771", signedQRCode: "eyJhbGciOiJSUzI1NiJ9.mock-signed-qr", generatedAt: "2026-07-04", supplyType: "EXPWOP",
  },
};

// =====================================================================================
// ord-155 — Bharat Elec / Pune Traders · DOMESTIC · ADVANCE · NO TESTING · DRAFT
// Story: the "PO specifies no incoming test" path — tracker deliberately empty.
// =====================================================================================

const L155 = [
  line("ord-155-l1", 1, "IRLZ44NPBF", "Infineon", "Logic-level N-channel MOSFET", 4000, 160, "INR",
    { dc: "25+", coo: "IN", mode: "NONE", cat: "Discrete", hsn: "85412900", forPo: "BEL-DOM/26/PO/81" }),
];

const D155: OrderDetail = {
  lines: L155,
  mpnTests: [spec("IRLZ44NPBF", "Purchase Order SPO-2026-0155", "2026-07-25 12:10", {
    tests: [], note: "PO specifies no incoming test for this MPN (client waived screening in writing).", conf: 0.99,
  })],
  lots: [],
  labEmails: [],
  payments: [
    pay("CLIENT_TO_1BUY", "ADVANCE", 712000, "INR", "PENDING", "Our PI", { due: "2026-07-31" }),
    pay("1BUY_TO_SUPPLIER", "ADVANCE", 640000, "INR", "PENDING", "Supplier PI", { due: "2026-08-02" }),
  ],
  shipments: [],
  customs: [],
  deliveries: [],
  sourcingAllocations: [alloc("ord-155-l1", "IRLZ44NPBF", "BEL-DOM/26/PO/81", 4000, 11)],
  documents: [doc("ORDER", "PO", "buyer-po-BEL-DOM-81.pdf", "P. Nair", "2026-07-25")],
  approvals: [appr("PO_REVIEW", "Finance", "PENDING", { notes: "Draft order — awaiting review before we commit to Pune Traders." })],
  events: [
    ev("GENERAL", "Draft order raised from SPO-2026-0155; client waived incoming testing in writing.", "2026-07-25", "P. Nair"),
  ],
};

export const ORDER_DETAILS: Record<string, OrderDetail> = {
  "ord-151": D151,
  "ord-149": D149,
  "ord-153": D153,
  "ord-144": D144,
  "ord-155": D155,
};
