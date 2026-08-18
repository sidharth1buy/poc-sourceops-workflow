import type { NotifyParty, TestingStage, LabPaymentStatus, LabPaymentTerms } from "@/types";

export type Tone = "neutral" | "active" | "warn" | "ok" | "bad" | "info";

export const toneClass: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  active: "bg-info-bg text-info",
  warn: "bg-warn-bg text-warn",
  ok: "bg-ok-bg text-ok",
  bad: "bg-bad-bg text-bad",
  info: "bg-accent-soft text-primary",
};

const OK = [
  "DONE", "PASS", "PAID", "RELEASE", "RELEASED", "DELIVERED", "APPROVED", "CLOSED", "ARRIVED", "CONFIRMED",
  "PASSED", "ACCEPTABLE", "REPORT_DELIVERED", "OK", "RELEASED_TO_SELLER",
];
const BAD = [
  "FAIL", "REJECTED", "CANCELLED", "BLOCKED", "ON_HOLD", "REFUND", "REFUNDED", "DECLINED",
  "FAILED", "NOT_ACCEPTABLE", "SUSPECT_COUNTERFEIT", "ESCALATED",
];
const WARN = [
  "PENDING", "PENDING_APPROVAL", "MAYBE", "AT_CUSTOMS", "FUND", "FUNDED", "HOLD", "PLANNED",
  "OPEN", "PARTIALLY_RELEASED", "INITIATED", "SKIPPED", "REQUESTED",
  "FAR", "AWAITING_RESPONSE",
  "SENT_FOR_SELLER_CONFIRMATION", "SELLER_CONFIRMED", "ESCROW_FEE_INVOICED",
];
const ACTIVE = [
  "ACTIVE", "IN_TRANSIT", "DISPATCHED", "IN_PROGRESS", "IN_FULFILMENT", "UPDATE_RECEIVED",
  "TT_PAYMENT_RECEIVED", "GOODS_SHIPPED", "RECIPIENT_INSPECTION",
];

export function statusTone(s?: string): Tone {
  if (!s) return "neutral";
  const S = s.toUpperCase();
  if (OK.includes(S)) return "ok";
  if (BAD.includes(S)) return "bad";
  if (WARN.includes(S)) return "warn";
  if (ACTIVE.includes(S)) return "active";
  return "neutral";
}

export function prettyStatus(s?: string) {
  if (!s) return "-";
  if (s.toUpperCase() === "FAR") return "F.A.R.";
  return s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// Grouped navigation. Each group renders under a heading in the sidebar.
export const NAV_GROUPS = [
  { group: null, items: [
    { href: "/fulfilment", label: "Dashboard", icon: "LayoutDashboard" },
  ] },
  { group: "Create", items: [
    { href: "/fulfilment/client-pos", label: "Sales Orders", icon: "FileText" },
    { href: "/fulfilment/supplier-pos", label: "Purchase Orders", icon: "ClipboardList" },
  ] },
  { group: "Operate", items: [
    { href: "/fulfilment/orders", label: "Orders", icon: "Package" },
    { href: "/fulfilment/testing", label: "Testing", icon: "FlaskConical" },
    { href: "/fulfilment/logistics", label: "Logistics", icon: "Truck" },
    { href: "/fulfilment/customs", label: "Customs", icon: "Stamp" },
    { href: "/fulfilment/warehouse", label: "Warehouse", icon: "Warehouse" },
    { href: "/fulfilment/delivery", label: "Delivery", icon: "PackageCheck" },
  ] },
  { group: "Finance & Tax", items: [
    { href: "/fulfilment/payments", label: "Payments", icon: "Wallet" },
    { href: "/fulfilment/escrow", label: "Escrow", icon: "Landmark" },
  ] },
  { group: "Reference", items: [
    { href: "/fulfilment/directory", label: "Directory", icon: "Users" },
    { href: "/fulfilment/integrations", label: "Integrations", icon: "Webhook" },
    { href: "/fulfilment/guide", label: "Guide", icon: "BookOpen" },
  ] },
] as const;

// Flat list kept for any callers that need every route.
export const NAV: { href: string; label: string; icon: string }[] =
  NAV_GROUPS.flatMap((g) => g.items.map((it) => ({ href: it.href, label: it.label, icon: it.icon })));

export const ROLES = ["SC", "Finance", "Approver", "Mgmt"] as const;
export type Role = (typeof ROLES)[number];

// ---- reference lists (stand in for DB-backed lookups; used to replace free-text inputs) ----
export const CURRENCIES = ["USD", "INR", "EUR", "JPY", "SGD", "TWD", "CNY", "HKD"] as const;
export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DDP"] as const;
export const PAYMENT_METHODS = ["Advance via T/T", "LC at sight", "50% advance / 50% balance", "Net 30 credit", "Net 60 credit", "As agreed"] as const;
export const DISPATCH_MODES = ["DHL", "FedEx", "Delhivery", "UPS", "Sea freight", "Air freight"] as const;
export const LAB_LOCATIONS = ["WHL Shenzhen", "WHL Hong Kong", "WHL Shenzhen & Hong Kong"] as const;
export const DELIVERY_TERMS = ["Test Report Along with Shipment", "Ex-works pickup", "Delivered to hub", "As per PO"] as const;
export const TEST_FAILURE_BEARERS = ["SUPPLIER", "1BUY", "CLIENT"] as const;
export const CREDIT_DAYS = [30, 60, 90] as const;

// Standard supplier-PO terms & conditions - tickboxes; `on` = pre-checked defaults (the usual ones).
export const STANDARD_TNC: { id: string; label: string; on: boolean }[] = [
  { id: "genuine", label: "Goods must be new, genuine & factory-sealed (no refurbished/remarked)", on: true },
  { id: "traceable", label: "Full traceability - Certificate of Conformance / manufacturer lot", on: true },
  { id: "datecode", label: "Date code as specified per line; no mixed date codes without approval", on: true },
  { id: "testreport", label: "Test report / CoA supplied along with the shipment", on: true },
  { id: "failbearer", label: "Supplier bears cost on test FAIL (return + re-test)", on: true },
  { id: "warranty", label: "Warranty: 12 months from delivery against defects", on: true },
  { id: "nopartial", label: "No partial shipment without prior written approval", on: false },
  { id: "rohs", label: "RoHS / REACH compliant; MSD-packed where applicable", on: false },
];

// ---- RFQ Module Enums ----

export const RFQ_BUNDLE_STATUSES = ["DRAFT", "FLOATED", "RECEIVING_QUOTES", "QUOTES_IN", "DECISION_PENDING", "DECIDED", "CLIENT_QUOTE_SENT", "CLIENT_CONFIRMED", "SUPERSEDED", "CANCELLED"] as const;
export const SUPPLIER_QUOTE_STATUSES = ["SUBMITTED", "REJECTED", "WITHDRAWN", "ACCEPTED"] as const;
export const QUOTE_LINE_STATUSES = ["ACTIVE", "COUNTER_PENDING", "COUNTER_RESPONSE", "ACCEPTED", "WITHDRAWN", "DECLINED"] as const;
export const CLIENT_QUOTE_DECISION_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"] as const;
export const CLIENT_QUOTE_STATUSES = ["PENDING", "ACCEPTED", "EXPIRED", "CHANGE_REQUESTED", "WITHDRAWN"] as const;
export const QUOTE_EMAIL_STATUSES = ["UNMATCHED", "MATCHED", "ESCALATED"] as const;

export const SUPPLIER_INVITE_STATUSES = ["PENDING", "SENT", "VIEWED", "QUOTED", "DECLINED"] as const;

// Email templates for RFQ module
export const RFQ_EMAIL_TEMPLATES = {
  RFQ_BUNDLE_INVITE: {
    id: "RFQ_BUNDLE_INVITE",
    subject: (bundleId: string, lines: number) => `Bundle RFQ - ${lines} component(s) · ${bundleId}`,
    body: (bundle: { id: string; lines: { mpn: string; aggregatedQty: number; targetPrice: number }[] }, supplierName: string, portalLink: string, deadline: string) => `
Dear ${supplierName},

We are pleased to request your quotation for the components listed below.

RFQ Bundle: ${bundle.id}
Deadline: ${deadline}

Table Columns:
MPN | Mfr | Desc | Qty | Target | Lead | Type | Pkg | DateCode | Inco | MOQ | SPQ | Pay

${bundle.lines.map((l) => `${l.mpn} | | | ${l.aggregatedQty} | ${l.targetPrice} | | | | | | |`).join("\n")}

Please submit your quote via the supplier portal: ${portalLink}

Best regards,
Sharpbuy (Sourcing Team)
    `.trim(),
  },
};

export const CLIENT_QUOTE_TEMPLATES = {
  QUOTE_SEND: {
    id: "QUOTE_SEND",
    subject: (clientName: string, bundleId: string) => `Quote for your RFQ - Bundle ${bundleId}`,
    body: (clientName: string, total: number, currency: string, expiryDate: string, acceptLink: string) => `
Dear ${clientName},

Thank you for your RFQ. We are pleased to provide you with our quotation below.

Total: ${currency} ${total.toFixed(2)}
Quote Expiry: ${expiryDate}

Please review the attached quotation. To accept this quote, please click here: ${acceptLink}

Best regards,
Sharpbuy (Sales Team)
    `.trim(),
  },
};

// ---- WHL testing reference data ----
// The processes a WHL report breaks its conclusion down by (each independently
// Acceptable / Not Acceptable / F.A.R. / Not Conducted, often with accept-vs-reject qty).
export const WHL_PROCESSES = [
  "Documentation & Packaging Inspection",
  "General Inspection",
  "External Visual Inspection",
  "Electrical Test",
  "X-Ray Inspection",
  "XRF / Solderability",
  "Decapsulation & Die Analysis",
  "Marking Permanency",
  "Solvent Resistance Test",
  "Scanning Acoustic Microscopy",
] as const;

export const TEST_STANDARDS = ["AS6081", "AS6171", "AS5553", "IDEA-STD-1010", "J-STD-033"] as const;
export const WHL_CONCLUSIONS = ["ACCEPTABLE", "NOT_ACCEPTABLE", "SUSPECT_COUNTERFEIT"] as const;
export const TEST_PROCESS_STATUSES = ["PENDING", "IN_PROGRESS", "PASSED", "FAILED", "FAR", "NOT_CONDUCTED"] as const;
export const WHL_CONTACT = "reports@whitehorselabs.example";
export const WHL_SLA_BUSINESS_DAYS = 3; // an unanswered "Request Update" past this is flagged

// ---- testing lifecycle -------------------------------------------------------------
// The internal stage chain a lot walks between "we asked for testing" and "we have a
// result". The per-test tracker answers *what* was tested; this answers *where the lot
// physically is* — which is the question everyone actually asks while it's at the lab.
//
// Ordered, and only ever traversed forward: a later interim mail can't rewind a lot
// that already has a report. Operators can correct a stage by hand (logged as manual).
//
// Every stage here is established by an inbound mail — the lab's invoice and receipt
// confirmations, the supplier's dispatch advice, WHL's progress notes and the report,
// plus the payment acknowledgement that closes the fee. `syncWhlInbox` is the single
// driver; the operator buttons exist for the phone-call case, not as the normal path.
//
// Note the tail: testing finishing and the report landing are separate events, and the
// gap between them can be days — the lab can be done on the bench while the write-up is
// still with its reviewer. So "Testing Completed" sits before "Test Report Shared",
// which is the point we can actually act on.

export const TESTING_STAGES: readonly TestingStage[] = [
  "TEST_REQUESTED",
  "WHL_PAYMENT",
  "SUPPLIER_DISPATCHING",
  "COMPONENTS_RECEIVED",
  "TESTING_IN_PROGRESS",
  "TESTING_COMPLETED",
  "REPORT_SHARED",
] as const;

/** The chain's end state — reaching it is what "done" means for a lot. */
export const TESTING_TERMINAL_STAGE: TestingStage = TESTING_STAGES[TESTING_STAGES.length - 1];

/** Who the chain is waiting on at each stage — drives the "waiting on" pill. */
export type StageOwner = "1BUY" | "SUPPLIER" | "WHL";

export interface TestingStageMeta {
  label: string;
  description: string;
  owner: StageOwner;
  /** what normally moves the lot into this stage (shown on stages not yet reached) */
  trigger: string;
}

export const TESTING_STAGE_META: Record<TestingStage, TestingStageMeta> = {
  TEST_REQUESTED: {
    label: "Test Requested",
    description: "Testing request has been initiated.",
    owner: "1BUY",
    trigger: "Work order raised with WHL for this lot.",
  },
  WHL_PAYMENT: {
    label: "Payment to WHL",
    description: "WHL's testing invoice has been received and settled — on advance terms this is what frees the bench.",
    owner: "1BUY",
    trigger: "Invoice mail states the terms; WHL's payment acknowledgement closes it.",
  },
  SUPPLIER_DISPATCHING: {
    label: "Supplier Dispatching Components",
    description: "Supplier is preparing and shipping the components to WHL.",
    owner: "SUPPLIER",
    trigger: "Supplier's dispatch advice mail (courier / AWB) — or record it by hand.",
  },
  COMPONENTS_RECEIVED: {
    label: "Components Received by WHL",
    description: "WHL has confirmed receipt of the components.",
    owner: "WHL",
    trigger: "Receipt confirmation mail from WHL.",
  },
  TESTING_IN_PROGRESS: {
    label: "Testing In Progress",
    description: "The lot is on the bench — WHL is conducting the required tests and mailing progress.",
    owner: "WHL",
    trigger: "Interim progress mails from WHL — each one updates the test tracker.",
  },
  TESTING_COMPLETED: {
    label: "Testing Completed",
    description: "Every process in the agreed test plan has been run; the write-up is with WHL's reviewer.",
    owner: "WHL",
    trigger: "WHL confirms the bench work is finished.",
  },
  REPORT_SHARED: {
    label: "Test Report Shared",
    description: "WHL has shared the completed test report and results.",
    owner: "WHL",
    trigger: "Report received and parsed onto the lot.",
  },
};

export const stageIdx = (stage?: TestingStage) => (stage ? TESTING_STAGES.indexOf(stage) : -1);
export const stageMeta = (stage: TestingStage) => TESTING_STAGE_META[stage];
export const stageLabel = (stage?: TestingStage) => (stage ? TESTING_STAGE_META[stage].label : "Not started");

// ---- WHL's own invoice for the testing service (separate document from the report) ----
export const LAB_PAYMENT_LABEL: Record<LabPaymentStatus, string> = {
  NOT_REQUESTED: "Invoice not requested",
  REQUESTED: "Invoice requested",
  INVOICE_RECEIVED: "Invoice received — unpaid",
  SENT_TO_FINANCE: "With finance for payment",
  PAID: "Paid",
};

export const LAB_PAYMENT_TONE: Record<LabPaymentStatus, Tone> = {
  NOT_REQUESTED: "neutral",
  REQUESTED: "warn",
  INVOICE_RECEIVED: "warn",
  SENT_TO_FINANCE: "active",
  PAID: "ok",
};

/** Anything short of PAID means the lab fee is still outstanding. */
export const labFeeOutstanding = (s?: LabPaymentStatus) => s !== "PAID";

// ---- how the lab agreed to be paid (stated on its invoice mail, not chosen by us) ----
// The mode changes what an unpaid fee *means*: on ADVANCE the lab holds the lot, so the
// fee gates the bench; on CREDIT it tests on account and the fee is a parallel track.

export const LAB_TERMS: readonly LabPaymentTerms[] = ["ADVANCE", "CREDIT"] as const;

export const LAB_TERMS_LABEL: Record<LabPaymentTerms, string> = {
  ADVANCE: "Advance",
  CREDIT: "Credit",
};

export const LAB_TERMS_TONE: Record<LabPaymentTerms, Tone> = {
  ADVANCE: "warn",    // money has to move before anything happens
  CREDIT: "info",
};

export const LAB_TERMS_HINT: Record<LabPaymentTerms, string> = {
  ADVANCE: "Payable before testing — WHL holds the lot until the transfer clears.",
  CREDIT: "WHL tests on account and bills on terms — the fee never blocks the bench.",
};

/** On advance terms an unpaid fee is a hard stop at the bench, not just an amber flag. */
export const labFeeGates = (terms?: LabPaymentTerms, status?: LabPaymentStatus) =>
  terms === "ADVANCE" && status !== "PAID";

export const FINANCE_CONTACT = "finance@sharpbuy.example";
export const WHL_TEST_FEE_PER_PROCESS = 145;   // USD per process — drives the mock invoice
export const WHL_INVOICE_TAX_PCT = 0.06;       // lab-site service tax on the mock invoice
export const WHL_CREDIT_DAYS = 15;             // days the lab allows on CREDIT terms

export const STAGE_OWNER_LABEL: Record<StageOwner, string> = {
  "1BUY": "1Buy",
  SUPPLIER: "Supplier",
  WHL: "WHL",
};

// Confidentiality: WHL reports carry NDA language — storage/viewing stays internal + access-logged.
export const WHL_CONFIDENTIALITY =
  "CONFIDENTIAL - issued to Sharpbuy Global Solutions under NDA. Internal use only; no redistribution to the client or supplier without WHL's written consent.";

// ---- WHL email templates ----------------------------------------------------------
// Every outbound mail starts from a template with the subject AND body pre-filled from
// the lot's context, so the operator edits a sentence instead of writing from scratch.
export interface WhlMailCtx {
  entity: string;
  mpn?: string;
  lotCode?: string;
  qty?: number;
  sampleQty?: number;
  workOrderNo?: string;
  clientPoNo?: string;
  reportNo?: string;
  lab?: string;
  dateCode?: string;
}

export interface WhlMailTemplate {
  id: string;
  label: string;
  hint: string;
  subject: (c: WhlMailCtx) => string;
  body: (c: WhlMailCtx) => string;
}

const refLine = (c: WhlMailCtx) => [
  c.mpn && `· MPN: ${c.mpn}${c.dateCode ? ` (date code ${c.dateCode})` : ""}`,
  c.lotCode && `· Lot: ${c.lotCode}${c.qty ? ` - qty ${c.qty}${c.sampleQty ? `, sample ${c.sampleQty}` : ""}` : ""}`,
  c.workOrderNo && `· Work order: ${c.workOrderNo}`,
  c.reportNo && `· Report: ${c.reportNo}`,
  c.clientPoNo && `· Sales Order: ${c.clientPoNo}`,
  c.lab && `· Lab site: ${c.lab}`,
].filter(Boolean).join("\n");

const sign = (c: WhlMailCtx) => `Thanks,\nSourcing Ops\n${c.entity}`;
const head = (c: WhlMailCtx) => `Hi WHL team,\n\nReference:\n${refLine(c)}\n\n`;
const tag = (c: WhlMailCtx) => `WO ${c.workOrderNo ?? "(pending)"} / Lot ${c.lotCode ?? "-"} / ${c.mpn ?? "-"}`;

export const WHL_EMAIL_TEMPLATES: WhlMailTemplate[] = [
  {
    id: "STATUS_REQUEST", label: "Status request", hint: "Where is this lot? (also used by “Request Update”)",
    subject: (c) => `Status request - ${tag(c)}`,
    body: (c) => `${head(c)}Could you share the current status of the above lot - which processes are complete, which are in progress, and the expected date for the report?\n\nIf the report is already issued, please attach the latest revision.\n\n${sign(c)}`,
  },
  {
    id: "INVOICE_REQUEST", label: "Invoice request", hint: "Ask WHL for the testing invoice so payment can be raised",
    subject: (c) => `Invoice request — ${tag(c)}`,
    body: (c) => `${head(c)}Could you issue your invoice for the testing booked against the above work order?\n\nSo our finance team can raise the payment without a further exchange, please include:\n1. the invoice number and date,\n2. the processes billed and the amount, with any taxes shown separately,\n3. your bank details and the payment due date, and\n4. this work order and lot code as the payment reference.\n\nWe will confirm once the transfer is initiated.\n\n${sign(c)}`,
  },
  {
    id: "REPORT_REQUEST", label: "Report / latest revision", hint: "Ask for the PDF or the newest revision",
    subject: (c) => `Report request - ${tag(c)}`,
    body: (c) => `${head(c)}Please send the test report for this lot as a PDF. If a revision has been issued since${c.reportNo ? ` ${c.reportNo}` : ""}, share the current version and confirm which report number supersedes which.\n\n${sign(c)}`,
  },
  {
    id: "RETEST_REQUEST", label: "Re-test request (result disputed)", hint: "Supplier disputes a Not-Acceptable result",
    subject: (c) => `Re-test request - ${tag(c)}`,
    body: (c) => `${head(c)}The supplier has disputed the result recorded in${c.reportNo ? ` report ${c.reportNo}` : " your report"} for this lot.\n\nCould you re-test the affected units and issue a revised report? Please confirm:\n1. the units to be re-tested and the method used,\n2. the additional TAT, and\n3. whether any re-test cost applies.\n\n${sign(c)}`,
  },
  {
    id: "FAR_FOLLOWUP", label: "F.A.R. follow-up", hint: "A process came back Further Analysis Recommended",
    subject: (c) => `F.A.R. follow-up - ${tag(c)}`,
    body: (c) => `${head(c)}${c.reportNo ? `Report ${c.reportNo}` : "Your report"} is Acceptable overall, but a process is flagged F.A.R. (Further Analysis Recommended).\n\nBefore we release this lot, please confirm:\n1. which units and which process the F.A.R. applies to,\n2. what further analysis you recommend, with cost and TAT, and\n3. whether the lot can be accepted as-is with a documented caveat.\n\n${sign(c)}`,
  },
  {
    id: "TAT_ESCALATION", label: "TAT escalation", hint: "Past the quoted turnaround / unanswered chase",
    subject: (c) => `Escalation - TAT overdue - ${tag(c)}`,
    body: (c) => `${head(c)}This lot is past the quoted turnaround and our earlier request is still unanswered. The order is held on this result.\n\nPlease confirm today: current stage, blocker, and a committed report date. If the lab site is the constraint, let us know whether the balance testing can be moved.\n\n${sign(c)}`,
  },
  {
    id: "PO_RECONCILE", label: "Reference mismatch", hint: "Report shows “PO Unknown” or the wrong reference",
    subject: (c) => `Reference correction - ${tag(c)}`,
    body: (c) => `${head(c)}The report we received does not carry our reference correctly${c.clientPoNo ? ` - it should read Client P/O ${c.clientPoNo}` : ""}.\n\nPlease re-issue with the correct Client P/O, MPN and lot code so the report reconciles against our PO on file.\n\n${sign(c)}`,
  },
  {
    id: "SAMPLE_QUERY", label: "Sample / test-plan query", hint: "Confirm sample size or a Not-Conducted process",
    subject: (c) => `Test plan query - ${tag(c)}`,
    body: (c) => `${head(c)}Could you confirm the test plan applied to this lot - sample size drawn, standard followed, and the reason any process was recorded as Not Conducted?\n\nOur PO requires the full screen, so please advise if anything is outstanding.\n\n${sign(c)}`,
  },
  {
    id: "NEW_SUBMISSION", label: "New submission / booking", hint: "Tell WHL a lot is on its way",
    subject: (c) => `Incoming submission - ${c.mpn ?? "part"} / Lot ${c.lotCode ?? "-"}`,
    body: (c) => `${head(c)}We are shipping the above lot to you for testing per our PO test plan.\n\nPlease confirm receipt, the work-order number raised against it, and the expected TAT.\n\n${sign(c)}`,
  },
  {
    id: "FREE_TEXT", label: "Blank (free text)", hint: "Context block only - write your own ask",
    subject: (c) => `${tag(c)}`,
    body: (c) => `${head(c)}\n\n${sign(c)}`,
  },
];

export const whlTemplate = (id: string) => WHL_EMAIL_TEMPLATES.find((t) => t.id === id) ?? WHL_EMAIL_TEMPLATES[0];

// ---- "result is in - who do we tell" templates ---------------------------------------
// Masked trade: the supplier mail never names the buyer, the buyer mail never names the
// supplier. Both go out from the masking entity. Escrow gets the release-trigger evidence.
export interface NotifyCtx {
  entity: string;
  orderNo: string;
  mpn: string;
  lotCode: string;
  qty: number;
  sampleQty?: number;
  dateCode?: string;
  reportNo?: string;
  reportDate?: string;
  workOrderNo?: string;
  conclusion?: string;      // ACCEPTABLE / NOT_ACCEPTABLE / SUSPECT_COUNTERFEIT
  anyFar?: boolean;
  clientPoNo?: string;
  supplierPoNo?: string;
  escrowRef?: string;
  releasable?: number;      // A1 still releasable, for the escrow mail
  currency?: string;
  lab?: string;
  // WHL's testing invoice — only the finance mail uses these
  invoiceNo?: string;
  invoiceAmount?: number;
  invoiceTax?: number;
  invoiceCurrency?: string;
  invoiceDueDate?: string;
  invoiceFile?: string;
  /** advance vs credit — finance needs to know when the lot is held on the money */
  invoiceTerms?: LabPaymentTerms;
}

export interface NotifyTemplate {
  party: NotifyParty;
  label: string;
  hint: string;
  to: (c: NotifyCtx) => string;   // mock address; edit before sending
  masking?: string;               // what must NOT appear in this mail
  subject: (c: NotifyCtx) => string;
  body: (c: NotifyCtx) => string;
}

const verdictWord = (c: NotifyCtx) =>
  c.conclusion === "ACCEPTABLE" ? (c.anyFar ? "Acceptable (with one process flagged F.A.R.)" : "Acceptable")
  : c.conclusion === "NOT_ACCEPTABLE" ? "Not Acceptable"
  : c.conclusion === "SUSPECT_COUNTERFEIT" ? "Suspect Counterfeit"
  : "pending";

const lotRef = (c: NotifyCtx) => [
  `· MPN: ${c.mpn}${c.dateCode ? ` (date code ${c.dateCode})` : ""}`,
  `· Lot: ${c.lotCode} - qty ${c.qty}${c.sampleQty ? `, sample ${c.sampleQty}` : ""}`,
  c.reportNo && `· Test report: ${c.reportNo}${c.reportDate ? ` dated ${c.reportDate}` : ""}`,
  c.conclusion && `· Conclusion: ${verdictWord(c)}`,
].filter(Boolean).join("\n");

export const NOTIFY_TEMPLATES: NotifyTemplate[] = [
  {
    party: "SUPPLIER", label: "Notify supplier", hint: "Result + report to the supplier (buyer stays masked)",
    to: () => "quality@supplier.example",
    masking: "The buyer's identity, sales order and sell prices are never included.",
    subject: (c) => `Test result - ${c.mpn} / Lot ${c.lotCode} - ${verdictWord(c)}${c.supplierPoNo ? ` (${c.supplierPoNo})` : ""}`,
    body: (c) => `Dear supplier,\n\nThe independent test on the lot supplied against ${c.supplierPoNo ?? "our PO"} is complete.\n\n${lotRef(c)}\n\n${
      c.conclusion === "ACCEPTABLE"
        ? `The lot is accepted${c.anyFar ? ", subject to closing out the process flagged for further analysis" : ""}. We are proceeding with onward logistics and payment per the agreed terms.`
        : `The lot is NOT accepted. Per the PO, the cost of test failure and return sits with the supplier. Please confirm within 2 business days whether you will (a) replace the lot with fully traceable stock, or (b) accept return and refund.`
    }\n\nThe attached report is issued to us by White Horse Laboratories under NDA and is shared with you solely to evidence this lot's disposition - please do not redistribute it further.\n\nRegards,\nSourcing Ops\n${c.entity}`,
  },
  {
    party: "BUYER", label: "Notify buyer / client", hint: "Result + report to the client (supplier stays masked)",
    to: () => "procurement@client.example",
    masking: "The supplier's identity, buy prices and inbound AWB are never included.",
    subject: (c) => `${c.orderNo} - test result for ${c.mpn} / Lot ${c.lotCode} - ${verdictWord(c)}`,
    body: (c) => `Dear customer,\n\nIndependent testing on your order${c.clientPoNo ? ` against ${c.clientPoNo}` : ""} is complete.\n\n${lotRef(c)}\n${c.lab ? `· Laboratory: ${c.lab}\n` : ""}\n${
      c.conclusion === "ACCEPTABLE"
        ? `The lot has passed the agreed screen${c.anyFar ? ", with one process flagged for further analysis - we are closing that out with the laboratory before dispatch" : " and is cleared for dispatch"}. We will confirm the delivery schedule shortly.`
        : `The lot did not pass the agreed screen and will not be dispatched to you. We are sourcing replacement stock and will confirm the revised schedule; your funds remain protected under the agreed payment terms.`
    }\n\nThe laboratory report is attached for your records. It is issued under NDA - kindly keep it internal to your organisation.\n\nRegards,\nSourcing Ops\n${c.entity}`,
  },
  {
    party: "ESCROW", label: "Notify escrow provider", hint: "Release-trigger evidence to HKIN",
    to: () => "ops@hkin.example",
    masking: "Sent by the masking entity only - counterparties are referenced by escrow token.",
    subject: (c) => `Escrow ${c.escrowRef ?? "(ref)"} - release trigger evidence - Lot ${c.lotCode} ${verdictWord(c)}`,
    body: (c) => `Dear HKIN team,\n\nRe escrow ${c.escrowRef ?? "(ref)"} for ${c.orderNo}:\n\n${lotRef(c)}\n\n${
      c.conclusion === "ACCEPTABLE"
        ? `The release trigger (independent lab PASS) is satisfied for this lot.${c.anyFar ? " Note one process is flagged F.A.R.; we are proceeding on the overall Acceptable conclusion." : ""} Please treat the attached report as the supporting evidence for the tranche release${c.releasable ? ` of up to ${c.currency ?? ""} ${c.releasable}` : ""}.`
        : `The lab result is ${verdictWord(c)} - the release trigger is NOT satisfied. Please hold the funds; a refund instruction may follow once the return is agreed with the seller.`
    }\n\nRegards,\nSourcing Ops\n${c.entity}`,
  },
  {
    party: "WHL", label: "Acknowledge to WHL", hint: "Confirm receipt of the report to the lab",
    to: () => WHL_CONTACT,
    subject: (c) => `Report received - ${c.reportNo ?? "(report)"} / WO ${c.workOrderNo ?? "-"} / Lot ${c.lotCode}`,
    body: (c) => `Hi WHL team,\n\nThank you - report ${c.reportNo ?? ""} for the lot below is received and logged.\n\n${lotRef(c)}\n\n${
      c.anyFar ? "One process is flagged F.A.R. - we will revert separately on the further analysis.\n\n" : ""
    }Please retain the samples until we confirm disposition.\n\nThanks,\nSourcing Ops\n${c.entity}`,
  },
  {
    party: "FINANCE", label: "Send to finance — initiate payment", hint: "Forward WHL's invoice so finance can pay the testing fee",
    to: () => FINANCE_CONTACT,
    masking: "Internal mail. The client's identity and sell prices are not needed to pay a lab fee — leave them out.",
    subject: (c) => `Payment request${c.invoiceTerms === "ADVANCE" ? " (ADVANCE — lot held)" : ""} — WHL invoice ${c.invoiceNo ?? "(awaited)"} — ${c.mpn} / Lot ${c.lotCode}`,
    // the terms line goes near the top: on advance terms this mail is the thing standing
    // between us and a test result, and finance can't know that from an amount and a date
    body: (c) => `Hi Finance,\n\nPlease initiate payment of the independent testing fee below. The invoice is attached.\n\n${lotRef(c)}\n· Laboratory: ${c.lab ?? "White Horse Laboratories"}\n· Invoice: ${c.invoiceNo ?? "awaited"}${c.invoiceDueDate ? ` · due ${c.invoiceDueDate}` : ""}\n· Amount: ${c.invoiceCurrency ?? c.currency ?? "USD"} ${(c.invoiceAmount ?? 0).toLocaleString()}${c.invoiceTax ? ` + tax ${c.invoiceCurrency ?? "USD"} ${c.invoiceTax.toLocaleString()}` : ""}${
      c.invoiceTerms ? `\n· Terms: ${c.invoiceTerms === "ADVANCE" ? "ADVANCE — payable before testing" : "CREDIT — testing is running on account"}` : ""
    }\n\n${
      c.invoiceTerms === "ADVANCE"
        ? "This work order is on advance terms, so the laboratory is holding the lot and has not started testing. The order is waiting on this transfer — please treat it as priority.\n\n"
        : ""
    }Please quote work order ${c.workOrderNo ?? "—"} and lot ${c.lotCode} as the payment reference so the lab can reconcile it, and send us the transfer reference once released.\n\nThis is a testing cost against ${c.supplierPoNo ?? "the purchase order"} — book it to the order, not to the supplier's material payment.\n\nThanks,\nSourcing Ops\n${c.entity}`,
  },
];

export const notifyTemplate = (party: NotifyParty) =>
  NOTIFY_TEMPLATES.find((t) => t.party === party) ?? NOTIFY_TEMPLATES[0];

// ---- digest (many lots, one mail) ----------------------------------------------------
// At 50 lots you don't send 50 mails. A digest lists every selected lot with its verdict
// and splits the disposition paragraph by outcome, so one mail can carry mixed results.
export interface NotifyDigestLot {
  mpn: string;
  lotCode: string;
  qty: number;
  sampleQty?: number;
  dateCode?: string;
  reportNo?: string;
  reportDate?: string;
  conclusion?: string;
  anyFar?: boolean;
  lab?: string;
  workOrderNo?: string;
  // only the finance digest (a payment run over several invoices) uses these
  invoiceNo?: string;
  invoiceAmount?: number;
  invoiceTax?: number;
  invoiceCurrency?: string;
  invoiceDueDate?: string;
  invoiceTerms?: LabPaymentTerms;
}

export interface NotifyDigestCtx {
  entity: string;
  orderNo: string;
  supplierPoNo?: string;
  clientPoNo?: string;
  escrowRef?: string;
  currency?: string;
  releasable?: number;
  lots: NotifyDigestLot[];
}

const lotLine = (l: NotifyDigestLot, i: number) => {
  const verdict = l.conclusion === "ACCEPTABLE" ? (l.anyFar ? "Acceptable (one process F.A.R.)" : "Acceptable")
    : l.conclusion === "NOT_ACCEPTABLE" ? "Not Acceptable"
    : l.conclusion === "SUSPECT_COUNTERFEIT" ? "Suspect Counterfeit"
    : "result pending";
  return `${i + 1}. ${l.mpn}${l.dateCode ? ` (DC ${l.dateCode})` : ""} · Lot ${l.lotCode} · qty ${l.qty}`
    + `${l.reportNo ? ` · report ${l.reportNo}${l.reportDate ? ` (${l.reportDate})` : ""}` : ""} - ${verdict}`;
};

const split = (lots: NotifyDigestLot[]) => ({
  ok: lots.filter((l) => l.conclusion === "ACCEPTABLE" && !l.anyFar),
  far: lots.filter((l) => l.conclusion === "ACCEPTABLE" && l.anyFar),
  bad: lots.filter((l) => l.conclusion === "NOT_ACCEPTABLE" || l.conclusion === "SUSPECT_COUNTERFEIT"),
  pending: lots.filter((l) => !l.conclusion),
});
const codes = (lots: NotifyDigestLot[]) => lots.map((l) => l.lotCode).join(", ");

/** Subject + body for a multi-lot notification to one party. */
export function notifyDigest(party: NotifyParty, c: NotifyDigestCtx): { subject: string; body: string } {
  const n = c.lots.length;
  const list = c.lots.map(lotLine).join("\n");
  const g = split(c.lots);
  const nda = "The attached report(s) are issued to us by White Horse Laboratories under NDA and are shared solely to evidence these lots' disposition - please do not redistribute them further.";
  const sign = `Regards,\nSourcing Ops\n${c.entity}`;
  const mixed = [
    g.ok.length ? `Accepted: ${codes(g.ok)}.` : "",
    g.far.length ? `Accepted subject to F.A.R. close-out: ${codes(g.far)}.` : "",
    g.bad.length ? `Not accepted: ${codes(g.bad)}.` : "",
    g.pending.length ? `Result still pending: ${codes(g.pending)}.` : "",
  ].filter(Boolean).join("\n");

  switch (party) {
    case "SUPPLIER":
      return {
        subject: `Test results - ${n} lot(s) against ${c.supplierPoNo ?? "our PO"}${g.bad.length ? ` - ${g.bad.length} not accepted` : ""}`,
        body: `Dear supplier,\n\nIndependent testing is complete on the following lot(s) supplied against ${c.supplierPoNo ?? "our PO"}:\n\n${list}\n\n${mixed}\n\n${
          g.bad.length ? "For the lots not accepted, the PO places the cost of test failure and return with the supplier. Please confirm within 2 business days whether you will replace with fully traceable stock, or accept return and refund.\n\n" : ""
        }${g.ok.length + g.far.length ? "For the accepted lots we are proceeding with onward logistics and payment per the agreed terms.\n\n" : ""}${nda}\n\n${sign}`,
      };
    case "BUYER":
      return {
        subject: `${c.orderNo} - test results for ${n} lot(s)${c.clientPoNo ? ` (${c.clientPoNo})` : ""}`,
        body: `Dear customer,\n\nIndependent testing on your order${c.clientPoNo ? ` against ${c.clientPoNo}` : ""} is complete for the following lot(s):\n\n${list}\n\n${mixed}\n\n${
          g.ok.length + g.far.length ? "The accepted lots are cleared for dispatch and we will confirm the delivery schedule shortly.\n\n" : ""
        }${g.bad.length ? "The lots not accepted will not be dispatched to you. We are sourcing replacement stock and will confirm the revised schedule; your funds remain protected under the agreed payment terms.\n\n" : ""}The laboratory report(s) are attached for your records. They are issued under NDA - kindly keep them internal to your organisation.\n\n${sign}`,
      };
    case "ESCROW":
      return {
        subject: `Escrow ${c.escrowRef ?? "(ref)"} - release trigger evidence - ${n} lot(s)`,
        body: `Dear HKIN team,\n\nRe escrow ${c.escrowRef ?? "(ref)"} for ${c.orderNo}, the independent lab results for the following lot(s):\n\n${list}\n\n${mixed}\n\n${
          g.ok.length + g.far.length ? `The release trigger (independent lab PASS) is satisfied for ${codes([...g.ok, ...g.far])}. Please treat the attached report(s) as supporting evidence for the tranche release${c.releasable ? ` of up to ${c.currency ?? ""} ${c.releasable}` : ""}.\n\n` : ""
        }${g.bad.length ? `The trigger is NOT satisfied for ${codes(g.bad)} - please hold those funds; a refund instruction may follow once the return is agreed with the seller.\n\n` : ""}${sign}`,
      };
    case "FINANCE": {
      // a payment run: one mail, several lab invoices, one total to release
      const billed = c.lots.filter((l) => l.invoiceNo);
      const cur = billed[0]?.invoiceCurrency ?? c.currency ?? "USD";
      const net = billed.reduce((s, l) => s + (l.invoiceAmount ?? 0), 0);
      const tax = billed.reduce((s, l) => s + (l.invoiceTax ?? 0), 0);
      const lines = billed.map((l, i) =>
        `${i + 1}. ${l.mpn} · Lot ${l.lotCode} · WO ${l.workOrderNo ?? "—"} · invoice ${l.invoiceNo}`
        + `${l.invoiceDueDate ? ` (due ${l.invoiceDueDate})` : ""} — ${l.invoiceCurrency ?? cur} ${(l.invoiceAmount ?? 0).toLocaleString()}`
        + `${l.invoiceTax ? ` + tax ${l.invoiceTax.toLocaleString()}` : ""}`
        + `${l.invoiceTerms ? ` · ${l.invoiceTerms === "ADVANCE" ? "ADVANCE — lot held" : "credit"}` : ""}`).join("\n");
      const missing = c.lots.filter((l) => !l.invoiceNo);
      // an advance invoice in the run isn't just money owed — those lots aren't being tested
      const held = billed.filter((l) => l.invoiceTerms === "ADVANCE");
      return {
        subject: `Payment request — ${billed.length} WHL invoice(s)${held.length ? ` (${held.length} ADVANCE — lots held)` : ""} — ${c.orderNo}`,
        body: `Hi Finance,\n\nPlease initiate payment of the independent testing fees below. The invoices are attached.\n\n${lines}\n\n`
          + `Total: ${cur} ${net.toLocaleString()}${tax ? ` + tax ${cur} ${tax.toLocaleString()} = ${cur} ${(net + tax).toLocaleString()}` : ""}\n\n`
          + (held.length ? `${codes(held)} ${held.length === 1 ? "is" : "are"} on advance terms — the laboratory is holding ${held.length === 1 ? "that lot" : "those lots"} and has not started testing, so please treat ${held.length === 1 ? "it" : "them"} as priority.\n\n` : "")
          + `Please quote each work order and lot code as the payment reference so the lab can reconcile them, and send us the transfer references once released.\n\n`
          + (missing.length ? `No invoice has been received yet for ${codes(missing)} — those are excluded from this run and will follow separately.\n\n` : "")
          + `These are testing costs against ${c.supplierPoNo ?? "the purchase order"} — book them to the order, not to the supplier's material payment.\n\n${sign}`,
      };
    }
    case "WHL":
    default:
      return {
        subject: `Reports received - ${n} lot(s) / ${c.orderNo}`,
        body: `Hi WHL team,\n\nThank you - the following reports are received and logged:\n\n${list}\n\n${
          g.far.length ? `We will revert separately on the further analysis for ${codes(g.far)}.\n\n` : ""
        }Please retain the samples until we confirm disposition.\n\nThanks,\nSourcing Ops\n${c.entity}`,
      };
  }
}

// Access control - only these personas may override auto-filled tests or email WHL on our behalf.
export const TEST_EDIT_ROLES: Role[] = ["SC", "Mgmt"];
export const LAB_EMAIL_ROLES: Role[] = ["SC", "Mgmt"];
// Escrow/payments are money-movement actions — restricted to Finance. Escrow now lives
// only under the Escrow board (/fulfilment/escrow/[id]), not as an order-workspace tab.
export const ESCROW_ACCESS_ROLES: Role[] = ["Finance"];

export const WORKSPACE_TABS = [
  "Overview", "Lines", "Allocations", "Journey", "Testing", "Payments",
  "Shipments", "Customs", "Delivery", "Documents", "Events", "Approvals",
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

// Strict linear progression, Draft → Released to Seller (no backward moves, no branching — see Escrow spec §3).
export const ESCROW_STATUS_ORDER = [
  "DRAFT", "SENT_FOR_SELLER_CONFIRMATION", "SELLER_CONFIRMED", "ESCROW_FEE_INVOICED",
  "TT_PAYMENT_RECEIVED", "GOODS_SHIPPED", "RECIPIENT_INSPECTION", "RELEASED_TO_SELLER",
] as const;
