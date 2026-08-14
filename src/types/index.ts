// Types mirror ~/Downloads/1Source/schema.json (Phase-1 subset). Field names match
// the DDL so these fixtures double as the eventual API contract.

export type OrderStatus =
  | "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ACTIVE" | "ON_HOLD" | "CLOSED" | "CANCELLED";
export type ApprovalStatusField = "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
export type TradeType = "DOMESTIC" | "INTERNATIONAL";
export type PaymentMode = "ADVANCE" | "ESCROW" | "CREDIT";
export type TestingMode = "NONE" | "SUPPLIER_SELF" | "WHL";
export type TestStatus = "PENDING" | "PASS" | "FAIL" | "MAYBE";
// per-test (process) status on a lot — WHL's own vocabulary, incl. F.A.R. (Further Analysis Recommended)
export type TestProcessStatus = "PENDING" | "IN_PROGRESS" | "PASSED" | "FAILED" | "NOT_CONDUCTED" | "FAR";

/**
 * Where a lot sits in the testing lifecycle. Ordered — a lot only ever moves
 * forward through this chain (see TESTING_STAGES in data/enums).
 *
 * Seven stages, and every one of them is established by an inbound mail (the
 * operator buttons are fallbacks, not the primary path). "Testing started" and
 * "report preparation" were dropped deliberately: "in progress" already says the
 * lot is on the bench, and "report shared" already says the write-up is done, so
 * both only added a node the operator had to read past.
 */
export type TestingStage =
  | "TEST_REQUESTED"
  | "WHL_PAYMENT"
  | "SUPPLIER_DISPATCHING"
  | "COMPONENTS_RECEIVED"
  | "TESTING_IN_PROGRESS"
  | "TESTING_COMPLETED"
  | "REPORT_SHARED";
// WHL report verdicts: per-process result and the report's overall conclusion
export type WhlProcessResult = "ACCEPTABLE" | "NOT_ACCEPTABLE" | "FAR" | "NOT_CONDUCTED";
export type WhlConclusion = "ACCEPTABLE" | "NOT_ACCEPTABLE" | "SUSPECT_COUNTERFEIT";
// where a test requirement came from: parsed off the PO, or hand-added by an operator
export type TestSource = "AUTO_PO" | "MANUAL";
export type AutofillState = "PENDING" | "OK" | "FAILED";
export type LabEmailDirection = "OUT" | "IN";
export type LabEmailStatus = "AWAITING_RESPONSE" | "UPDATE_RECEIVED" | "REPORT_DELIVERED" | "ESCALATED" | "SENT";
export type ShipmentLeg = "INBOUND" | "OUTBOUND";
export type ShipmentStatus =
  | "PLANNED" | "DISPATCHED" | "IN_TRANSIT" | "AT_CUSTOMS" | "ARRIVED" | "DELIVERED" | "CANCELLED";
export type JourneyStatus = "PENDING" | "IN_PROGRESS" | "DONE" | "SKIPPED" | "BLOCKED";
export type JourneyPhase =
  | "KICKOFF" | "PAYMENT" | "TESTING" | "EXPORT" | "IMPORT" | "CUSTOMS" | "RELABEL" | "DELIVERY" | "CLOSE";
export type EscrowOrderStatus =
  | "DRAFT" | "SENT_FOR_SELLER_CONFIRMATION" | "SELLER_CONFIRMED"
  | "ESCROW_FEE_INVOICED" | "TT_PAYMENT_RECEIVED" | "GOODS_SHIPPED"
  | "RECIPIENT_INSPECTION" | "RELEASED_TO_SELLER";
export type PaymentDirection = "CLIENT_TO_1BUY" | "1BUY_TO_SUPPLIER";
export type PaymentStatus = "PENDING" | "INITIATED" | "PAID" | "REFUNDED" | "CANCELLED";
export type ApprovalState = "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED";

export interface Party {
  name: string;
  country: string; // ISO-ish label, e.g. "SG", "CN", "IN"
  gstin?: string;
  state?: string;
}

// Structured delivery address (buyer ship-to, 1Buy hub, etc.)
export interface Address {
  name?: string;    // site / company label
  line1?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

// PO-level terms captured off the buyer/supplier POs (payment · logistics · testing)
export interface PoTerms {
  referenceNo?: string;       // PO ref / RFQ bundle ref
  gstNote?: string;           // e.g. "GST extra @ actual"
  paymentMethod?: string;     // e.g. "Advance via T/T", "LC", "Net 30 credit"
  dispatchedThrough?: string; // carrier
  destination?: string;
  deliveryTerms?: string;     // e.g. "Incoterm EXW ex-works pickup"
  testingTerms?: string;      // e.g. "Test report along with shipment" (separate from delivery)
  destinationPort?: string;   // ship-to port, captured when incoterm = CIF
  packing?: string;           // packing / labelling reqs, WHSO# on box
  dateCode?: string;          // e.g. "25+"
  warranty?: string;          // e.g. "1 year"
  testFailureBearer?: string; // who bears cost on FAIL: SUPPLIER / 1BUY / CLIENT
  labLocation?: string;       // e.g. "WHL Shenzhen & Hong Kong"
}

export interface Order {
  id: string;
  orderNo: string;
  operatingMode: "MOR";
  tradeType: TradeType;
  status: OrderStatus;
  approvalStatus: ApprovalStatusField;
  buyer: Party;      // the client (masked from supplier)
  supplier: Party;   // masked from client
  maskingEntity: string;
  currency: string;
  incoterm: string;
  paymentMode: PaymentMode;
  leadTimeDays: number;
  testingTimeDays: number;
  deliveryTimeDays: number;
  testingMode?: TestingMode; // real testing mode carried from the supplier PO (drives journey/customs)
  expectedDispatchDate: string;
  expectedDeliveryDate: string;
  requiredBy: string;
  buyTotal: number;   // 1Buy → supplier
  sellTotal: number;  // client → 1Buy
  createdBy: string;
  createdAt: string;
  terms?: PoTerms;
  supplierPoId?: string;  // the Supplier PO this fulfilment order was spun from
  supplierPoNo?: string;
  piNo?: string;          // supplier proforma-invoice no (received upstream, uploaded onto the order here)
  hubAddress?: Address;   // inbound destination — the 1Buy hub (relabel + re-dispatch)
  buyerAddress?: Address; // outbound destination — the client's delivery address
  creditDays?: number;    // days of credit when we pay the supplier on CREDIT
  termsConditions?: string[]; // agreed T&Cs carried from the supplier PO
  relabelCost?: number;   // cost of relabelling at the hub (feeds landed cost)
}

// A line on our PO to a supplier. Optionally references a client-PO line
// (partial ok, multi-client). Unlinked lines get mapped to buyer demand later.
export interface SupplierPoLine {
  mpn: string;
  make?: string;
  dateCode?: string;
  testing?: TestingMode; // per-line testing — some MPNs need WHL, some self-test, some none
  qty: number;
  buyUnitPrice: number;
  marginPct: number;
  clientPoNo?: string;
  clientLineMpn?: string;
}

export type SupplierPoStatus = "DRAFT" | "ORDERED";

// Our purchasing document to a supplier. Created BEFORE the fulfilment order —
// you select a Supplier PO and "Create order" to start the journey.
export interface SupplierPO {
  id: string;
  poNo: string;
  supplier: Party;
  tradeType: TradeType;
  currency: string;
  incoterm: string;
  paymentMode: PaymentMode;  // how we pay the supplier
  testing: TestingMode;
  leadTimeDays: number;
  testingTimeDays: number;
  deliveryTimeDays: number;
  terms?: PoTerms;
  lines: SupplierPoLine[];
  buyTotal: number;
  createdBy: string;
  createdAt: string;
  status: SupplierPoStatus;
  orderId?: string;  // set once a fulfilment order is created from this PO
  creditDays?: number;         // days of credit when paymentMode = CREDIT
  termsConditions?: string[];  // agreed standard T&Cs (checkboxes) + extras
  relabelCost?: number;        // relabelling cost at the hub
}

export interface OrderLine {
  id: string;
  lineNo: number;
  mpn: string;
  make: string;
  description: string;
  hsnCode: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  dateCode: string;
  coo: string;
  testingRequired: boolean;
  testingMode: TestingMode;
  componentCategory: string;
  lab?: string;
}

// ---- WHL testing: PO → MPN → Lot → Test → status history → report (versioned) → email thread ----

/** One audit row. Every manual test edit and every status change (automated or manual) writes one. */
export interface TestAuditEntry {
  id: string;
  at: string;                 // ISO datetime
  by: string;                 // operator or the automation that did it ("WHL inbox (auto)")
  action: "AUTOFILL" | "ADD" | "DELETE" | "STATUS" | "REPORT" | "RECONCILE" | "EMAIL";
  target?: string;            // test name / report no / lot code the row is about
  before?: string;
  after?: string;
  note?: string;
  sourceEmailId?: string;     // inbound email that triggered an automated change
}

/**
 * One recorded move along the testing lifecycle. Kept as a list rather than a
 * single "current stage" so the tab can show WHEN each step happened and WHAT
 * moved it — an operator, or an inbound WHL mail (with the mail linked).
 */
export interface TestingStageEvent {
  id: string;
  stage: TestingStage;
  at: string;
  by: string;                 // operator, "WHL inbox (auto)", or "Supplier (relayed)"
  note?: string;
  sourceEmailId?: string;     // the inbound mail that moved the stage
  /** set when an operator moved the stage by hand instead of a mail driving it */
  manual?: boolean;
}

/** A required test as parsed off the PO (never hand-typed unless the operator overrides). */
export interface TestRequirement {
  id: string;
  name: string;               // e.g. "External Visual Inspection"
  standard?: string;          // e.g. "AS6081"
  source: TestSource;
  addedBy?: string;
  addedAt?: string;
}

/**
 * Test requirements for ONE MPN on ONE order (i.e. per PO). The same MPN can carry a
 * different list on another PO/lot, so this is keyed by order + mpn, never globally by mpn.
 */
export interface MpnTestSpec {
  id: string;
  mpn: string;
  autofill: AutofillState;    // FAILED → "needs manual review" flag on the MPN
  autofillNote?: string;      // why it failed (bad scan / no test table / unparseable)
  sourceDoc?: string;         // which PO the tests were parsed from
  parsedAt?: string;
  confidence?: number;
  tests: TestRequirement[];
  audit: TestAuditEntry[];
}

/** Live status of one required test on one lot, with its full progression. */
export interface LotTest {
  id: string;
  requirementId?: string;     // links back to the MpnTestSpec entry it was inherited from
  name: string;
  standard?: string;
  source: TestSource;
  status: TestProcessStatus;
  acceptQty?: number;
  rejectQty?: number;
  updatedAt?: string;
  history: TestAuditEntry[];  // timestamped progression, not just the latest state
}

/** One version of a WHL report (WHL revises: 352146.1, 352146.2 …). */
export interface WhlReportProcess {
  name: string;
  result: WhlProcessResult;
  acceptQty?: number;
  rejectQty?: number;
  note?: string;
}

export interface WhlReport {
  id: string;
  reportNo: string;           // incl. revision, e.g. "352146.2"
  revision: number;
  reportDate: string;
  workOrderNo: string;
  fileName: string;
  receivedAt: string;
  current: boolean;           // exactly one current version per lot
  revisionNote?: string;
  // auto-parsed header fields (surfaced on screen — no need to open the PDF)
  partNumber: string;
  manufacturer: string;
  lotQty: number;
  client: string;
  clientPo: string;           // may come back as "PO Unknown" → reconciliation flag
  conclusion: WhlConclusion;
  anyFar: boolean;            // a process came back F.A.R. even if the overall conclusion is Acceptable
  processes: WhlReportProcess[];
  approvedBy: string;
  approverTitle: string;
  standards: string[];        // e.g. ["AS6081", "AS6171"]
  riskClass?: string;         // e.g. "ERAI Low Risk"
  msl?: string;
  packageType?: string;
  confidentialityNote?: string;
  parseFlags: string[];       // missing/placeholder data needing manual reconciliation
  accessLog: { at: string; by: string; action: "VIEW" | "DOWNLOAD" }[];
}

/** One message in the WHL correspondence thread for a lot. */
export interface LabEmail {
  id: string;
  direction: LabEmailDirection;
  lotId?: string;             // undefined = couldn't be matched → manual-match queue
  lotCode?: string;
  mpn?: string;
  workOrderNo?: string;
  poNo?: string;
  subject: string;
  body: string;
  at: string;
  by: string;                 // sender ("You (demo)" / "WHL Reports")
  status: LabEmailStatus;
  kind: "REQUEST_UPDATE" | "CUSTOM" | "STATUS_UPDATE" | "REPORT" | "ESCALATION" | "INVOICE" | "DISPATCH" | "PAYMENT";
  attachments?: string[];
  matchedBy?: string;         // set when an operator resolved it out of the manual-match queue
  matchNote?: string;         // why auto-matching failed
}

/** Who we notify once a lot's result is in. Buyer/supplier mails stay masked from each other. */
export type NotifyParty = "SUPPLIER" | "BUYER" | "ESCROW" | "WHL" | "FINANCE";

/**
 * How WHL agreed to be paid for this work order, as stated on its invoice mail:
 *
 * - `ADVANCE` — the fee clears before the bench starts. The lab holds the lot, so the
 *   fee is a genuine gate on the lifecycle.
 * - `CREDIT`  — the lab tests on account and bills on terms. The fee runs as a parallel
 *   track and must never block dispatch or results.
 *
 * Read off the invoice mail, never chosen by us — which mode applies is the lab's call
 * per work order.
 */
export type LabPaymentTerms = "ADVANCE" | "CREDIT";

/**
 * WHL's own invoice for the testing service — a separate document from the test report,
 * arriving by mail the same way. Kept per lot because the lab invoices per work order.
 */
export interface LabInvoice {
  id: string;
  invoiceNo: string;
  amount: number;             // net of tax
  taxAmount?: number;
  currency: string;
  fileName: string;
  receivedAt: string;
  dueDate?: string;
  note?: string;
  /** payment mode the lab stated on this invoice — drives whether the fee gates testing */
  terms: LabPaymentTerms;
  /** CREDIT only: days the lab allowed from the invoice date */
  creditDays?: number;
  /** what the lab charges per process, so a test row can show its own price */
  ratePerProcess?: number;
  /** processes billed — amount === processCount × ratePerProcess */
  processCount?: number;
  accessLog: { at: string; by: string; action: "VIEW" | "DOWNLOAD" }[];
}

/**
 * How far the lab's fee has got: we ask for the invoice, it arrives, we hand it to
 * finance, finance pays. Distinct from the lifecycle stage — the stage says "settled or
 * not", this says where in the settling we are.
 */
export type LabPaymentStatus = "NOT_REQUESTED" | "REQUESTED" | "INVOICE_RECEIVED" | "SENT_TO_FINANCE" | "PAID";

export interface LabPayment {
  status: LabPaymentStatus;
  invoice?: LabInvoice;
  requestedAt?: string;       // we asked WHL for the invoice
  sentToFinanceAt?: string;   // the finance mail that initiates payment
  sentToFinanceBy?: string;
  paidAt?: string;
  paidRef?: string;           // wire / UTR reference finance came back with
  note?: string;
}

export interface LotNotification {
  id: string;
  party: NotifyParty;
  to: string;
  subject: string;
  body: string;
  attachments?: string[];   // the report PDF when the operator chose to attach it
  reportNo?: string;        // which report version the notification was about
  at: string;
  by: string;
  status: "SENT" | "FAILED";
  note?: string;            // failure reason / masking or NDA caveat recorded at send time
}

/**
 * The supplier → WHL shipment for a lot. The supplier tells us it's on the way
 * (mail / call), we record it here so the lab-side clock is visible before WHL
 * has confirmed anything.
 */
export interface LotDispatch {
  courier?: string;
  awb?: string;
  dispatchedOn?: string;
  expectedArrival?: string;
  note?: string;
  recordedBy: string;
  recordedAt: string;
}

export interface Lot {
  id: string;
  orderLineMpn: string;
  lotCode: string;
  dateCode: string;
  qty: number;
  sampleQty: number;
  testStatus: TestStatus;
  lab?: string;
  workOrderNo?: string;
  reportNo?: string;          // current report no (incl. revision)
  tatDays?: number;
  testedAt?: string;
  clientPoNo?: string;        // client PO this lot's demand belongs to (report reconciliation)
  tests?: LotTest[];          // inherited from the MPN's spec at lot creation
  reports?: WhlReport[];      // all versions; exactly one `current`
  lastUpdateRequestAt?: string; // SLA clock for an unanswered "Request Update"
  stage?: TestingStage;       // where this lot sits in the testing lifecycle
  stageHistory?: TestingStageEvent[]; // timestamped progression through the chain
  dispatch?: LotDispatch;     // supplier → WHL leg, recorded when the supplier tells us
  labPayment?: LabPayment;    // WHL's testing invoice and its settlement
  notifications?: LotNotification[]; // result circulated to supplier / buyer / escrow / WHL / finance
}

export interface JourneyStep {
  id: string;
  seq: number;
  phase: JourneyPhase;
  name: string;
  status: JourneyStatus;
  owner: string;
  isGate: boolean;
}

// Recipient — 1Buy's OWN hub the goods ship to for receipt (and relabelling) — NOT WHL, the
// independent test lab, which is a separate party/signal entirely (see Escrow.whlVerdict etc.).
// Shared contact-card shape — used for Buyer, Seller, AND Recipient (each a distinct party on the escrow order).
export interface EscrowContact {
  company: string;
  registeredAddress: string;
  country: string;
  contactPerson: string;
  email: string;
  phone: string;
  im: string; // instant messaging, e.g. "WeChat: mtl_chen"
}

// Fee line items exactly as printed on the escrow provider's invoice (§5a).
export interface EscrowFeeBreakdown {
  poTotal: number;
  feeToBuyer: number;        // escrow fee to buyer (non-refundable)
  wiringFeeToBuyer: number;  // T/T fee to buyer
  feeToSeller: number;       // escrow fee to seller (non-refundable)
  wiringFeeToSeller: number; // T/T fee to seller
}

// A payment-release milestone as printed on the invoice — e.g. "30% on shipment to WHL", "70% on
// WHL PASS report". SC reads these off the invoice; they're not invented by this app.
export interface ReleaseMilestone {
  percent: number;
  trigger: string;
}

// Escrow Conditions table printed on the same invoice (§5b).
export interface EscrowConditions {
  forwarder: string;           // "Which forwarder will be used?"
  forwarderAccountNo?: string;
  shipWithinDays: string;      // "within how many business days should seller ship after funds are received?"
  inspectionPeriod: string;
  feeSharingLabel: string;     // e.g. "100% Buyer / 0% Seller"
  returnCondition: string;
  releaseMilestones: ReleaseMilestone[];
}

// Wire instructions printed on the invoice — provider's own bank account, not order-specific.
export interface EscrowBankAccount {
  bankName: string;
  bankAddress: string;
  beneficiaryName: string;
  accountNumber: string;
  swiftCode: string;
}

export interface EscrowInvoice {
  invoiceNo: string;
  fees: EscrowFeeBreakdown;
  conditions: EscrowConditions;
  bankAccount: EscrowBankAccount;
  receivedAt: string;
}

export type EmailDirection = "SENT" | "RECEIVED";
export type WhlVerdict = "PASS" | "FAIL";

// One item in the Escrow Agent's simulated inbox — an action library of emails SC can send/receive
// at any time (goods can go seller → WHL → buyer, or seller → WHL → seller on FAIL, then re-test).
// SENT emails always go through a compose/review step before they're logged here — nothing here
// was dispatched by a single click without a human seeing the draft first.
export interface EscrowAgentEmail {
  id: string;
  direction: EmailDirection;
  subject: string;
  from: string;
  to?: string; // mainly for SENT emails
  cc?: string; // mainly for SENT emails
  snippet: string;
  receivedAt: string; // "occurred at" — applies to both directions
  attachmentFileName?: string;
  attachmentUrl?: string; // relative path on the escrow-agents API — real PDF, only set for backend-driven RECEIVED emails
}

// Final settlement receipt once funds reach the seller.
export interface EscrowPaymentClosure {
  documentNo: string;
  releasedAmount: number;
  receivedAt: string;
}

// Tracks the send/confirm lifecycle of ONE release milestone from the invoice's releaseMilestones
// list — a multi-tranche invoice (e.g. 20% on shipment / 50% on WHL PASS / 30% on receipt) needs
// each tranche released independently as its own trigger is met, not one lump-sum release at the end.
export interface MilestoneRelease {
  index: number;        // position in invoice.conditions.releaseMilestones
  instructedAt: string; // SC → HKin: "release this tranche"
  confirmedAt?: string; // HKin confirms this tranche was released
}

// Step before "Step 0" in the Escrow tab: confirm the supplier has (or has opened) an HKin
// account before we bother running the "Create HKin order" RPA against their real site.
export type HkinAccountStatus = "NOT_ASKED" | "ASKED" | "CONFIRMED";

export interface Escrow {
  id: string;
  status: EscrowOrderStatus;
  buyerContact: EscrowContact;   // masking entity — mirrors Order.maskingEntity
  sellerContact: EscrowContact;  // real supplier — mirrors Order.supplier
  poAmount: number;
  currency: string;
  useInspectionService: boolean; // "Escrow/i" — HKin's enhanced-inspection tier
  recipient: EscrowContact;
  hkinAccountStatus?: HkinAccountStatus; // see HkinAccountStatus — gates the "Create HKin order" step
  agreedFeeToBuyer: number; // fee agreed with the provider when the supplier PO was drafted (§7 reconciliation baseline)
  // Full payment-condition profile agreed at PO-drafting time — exists from Draft onward, same as
  // agreedFeeToBuyer above. When the invoice actually arrives, its conditions should match this
  // (that's the whole point of "agreed at PO time") — the Escrow Agent fetch uses this, not a
  // one-size-fits-all default, so different orders can genuinely have different terms.
  agreedConditions?: EscrowConditions;
  invoice?: EscrowInvoice;
  paymentClosure?: EscrowPaymentClosure;

  // Payment communications — SC reviews the invoice, instructs Finance, Finance pays, HKin confirms.
  paymentInstructedAt?: string; // SC → Finance: "pay it like this"
  financeConfirmedAt?: string;  // Finance → SC: payment made, with a SWIFT reference to quote to HKin
  financeSwiftReference?: string; // international wire to HKin (HK) — SWIFT reference, not a UTR (that's for domestic NEFT/RTGS)
  paymentSentToHkinAt?: string; // SC → HKin: "we've made the payment, here's the SWIFT reference"

  // WHL booking, test execution, and the retest/return decision all live on the Testing tab, not
  // here — escrow only needs the one verdict signal (since that's what governs the release
  // milestone) and, on FAIL, whether the client asks for a refund instead of waiting on a retest.
  goodsReceivedAt?: string; // 1Buy's own hub confirms physical receipt — NOT WHL, a separate signal
  whlVerdict?: WhlVerdict;
  whlVerdictAt?: string;
  whlReportRef?: string;       // the detailed test report WHL sends alongside the verdict
  whlWorkOrder?: string;       // the parent work order no. — distinct from whlReportRef
  whlRawConclusion?: string;   // WHL's/the buyer's own terse wording, e.g. "Acceptable" or "Buyer rejected goods — ..."
  refundRequestedAt?: string;  // client → SC: asked for a refund instead of a retest
  refundInstructedAt?: string; // SC → HKin & supplier: initiate the refund

  milestoneReleases: MilestoneRelease[]; // one entry per instructed tranche — see MilestoneRelease

  agentEmails: EscrowAgentEmail[];
  cancelledAt?: string; // buyer/seller can cancel any time before RELEASED_TO_SELLER (real HKin allows this even after T/T — confirmed against a real cancelled order)
  // Set when the HKin order-creation RPA (hkin-rpa, via escrow-agents'
  // /create-on-hkin) was launched — it fills HKin's real form and stops for
  // a human to review + submit, so this only means the attempt was kicked
  // off, not that a real HKin escrow number exists yet.
  hkinRpaStartedAt?: string;

  // Real HKin portal evidence (2026-08-12 session) — see escrow-agents/ARCHITECTURE.md's
  // "Known gaps" for the full write-up of what each of these models.
  applicationRejectedAt?: string; // HKin rejected the whole application before a seller was ever assigned — the earliest possible terminal state
  inspectionDeadline?: string;    // HKin's real "Escrow Reminder of Inspection Period" deadline — silence past it is an implicit accept
  rmaDetails?: string;            // return-address details, once HKin asks for them on a reject
  goodsReturnTracking?: string;   // tracking number for goods shipped back to the seller on a reject
  goodsReturnedAt?: string;       // real gate before HKin will process the refund
  hkinCsContactName?: string;     // real correspondence always comes from a named HKin CS officer, e.g. "Miffy Chen"
  hkinCsContactEmail?: string;
}

// Every outbound email goes through ComposeEmailModal — SC can edit the draft before it's sent.
export type EscrowSendPurpose =
  | "ORDER_TO_SELLER" | "PAYMENT_INSTRUCTION_TO_FINANCE" | "PAYMENT_CONFIRMATION_TO_HKIN"
  | "REFUND_INSTRUCTION" | "RELEASE_FUNDS_INSTRUCTION";

// Inbound emails — internal to the store's checkEscrowInbox "agent"; never picked by the UI
// directly (see checkEscrowInbox in store.ts). Milestone release confirmations are handled
// separately (by index into releaseMilestones), not through this fixed purpose list.
export type EscrowReceivePurpose =
  | "FINANCE_PAYMENT_CONFIRMATION" | "HKIN_PAYMENT_CONFIRMATION" | "SUPPLIER_SHIPMENT_NOTICE"
  | "WHL_GOODS_RECEIVED" | "HUB_GOODS_RECEIVED" | "WHL_PROGRESS_UPDATE" | "CLIENT_REFUND_REQUEST";

export interface Payment {
  id: string;
  direction: PaymentDirection;
  mode: PaymentMode;
  triggerDoc: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  dueDate?: string;
  paidAt?: string;
  providerRef?: string; // bank transfer ref (from the banking adapter)
  utr?: string;         // settlement UTR once cleared
}

// GST e-Invoice / IRP result (from the e-invoice adapter)
export interface EInvoice {
  irn: string;
  ackNo: string;
  signedQRCode: string;
  generatedAt: string;
  supplyType: string;
}

export interface ShipmentLine {
  mpn: string;
  qty: number;
}

export interface Shipment {
  id: string;
  shipmentNo: string;
  leg: ShipmentLeg;
  awb: string;
  carrier: string;
  ewayBill?: string;
  fromLocation: string;
  toLocation: string;
  boxCount: number;
  grossWeightKg: number;
  dispatchDate?: string;
  deliveryDate?: string;
  status: ShipmentStatus;
  lines: ShipmentLine[];
  carrierRef?: string;   // carrier booking ref (from the logistics adapter)
  trackingUrl?: string;
  lastLocation?: string; // latest tracking checkpoint location (incl. origin/away country)
}

export interface CustomsEntry {
  id: string;
  shipmentNo: string;
  beNo?: string;
  beDate?: string;
  portCode?: string;
  chaName?: string;
  totalDuty?: number;
  currency?: string;
  icegateRef?: string;
  filedAt?: string;
}

export interface SourcingAllocation {
  id: string;
  orderLineId: string;   // which supplier-order line this maps FROM
  clientPoNo: string;
  clientLineMpn: string;
  orderLineMpn: string;
  qty: number;
  marginPct: number;
}

export interface DeliveryAllocation {
  id: string;
  fromShipmentNo: string;
  clientPoNo: string;
  clientLineMpn: string;
  qty: number;
  decidedBy: string;
  decidedAt: string;
  pod?: string;
}

export interface DocumentRef {
  id: string;
  subjectType: string;
  docType: string;
  fileName: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Approval {
  id: string;
  subjectType: string;
  kind: string;
  role: string;
  status: ApprovalState;
  decidedBy?: string;
  notes?: string;
}

export interface OrderEvent {
  id: string;
  eventType: string;
  message: string;
  source: string;
  occurredAt: string;
  recordedBy: string;
}

export interface ClientPO {
  id: string;
  clientPoNo: string;
  client: Party;
  paymentMode: PaymentMode;
  status: string;
  terms?: PoTerms;
  deliveryAddress?: Address; // where we deliver to the buyer (outbound destination)
  lines: { mpn: string; make?: string; dateCode?: string; qty: number; unitPrice: number; requiredBy: string; status: string }[];
}

export interface OrderBundle extends Order {
  lines: OrderLine[];
  journey: JourneyStep[];
  lots: Lot[];
  mpnTests?: MpnTestSpec[];   // PO-parsed test requirements per MPN on this order
  labEmails?: LabEmail[];     // full WHL correspondence (incl. unmatched inbound)
  escrow?: Escrow;
  payments: Payment[];
  shipments: Shipment[];
  customs: CustomsEntry[];
  deliveries: DeliveryAllocation[];
  sourcingAllocations: SourcingAllocation[];
  documents: DocumentRef[];
  approvals: Approval[];
  events: OrderEvent[];
  einvoice?: EInvoice;
  relabelledAt?: string; // set when goods are physically received + relabelled to the masking entity at the hub — gates RELABEL
}

// ---- RFQ Module Types ----

export type RfqBundleStatus = "DRAFT" | "FLOATED" | "RECEIVING_QUOTES" | "QUOTES_IN" | "DECISION_PENDING" | "DECIDED" | "CLIENT_QUOTE_SENT" | "CLIENT_CONFIRMED" | "SUPERSEDED" | "CANCELLED";
export type SupplierQuoteStatus = "SUBMITTED" | "REJECTED" | "WITHDRAWN" | "ACCEPTED";
export type QuoteLineStatus = "ACTIVE" | "COUNTER_PENDING" | "COUNTER_RESPONSE" | "ACCEPTED" | "WITHDRAWN" | "DECLINED";
export type ClientQuoteDecisionStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
export type ClientQuoteStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "CHANGE_REQUESTED" | "WITHDRAWN";
export type QuoteEmailStatus = "UNMATCHED" | "MATCHED" | "ESCALATED";

export interface DemandLine {
  id: string;
  mpn: string;
  qty: number;
  targetPrice: number;
  currency: string;
  requiredByDate: string;
  source: "email" | "manual" | "portal";
  clientPoId?: string;
  clientLineId?: string;
  createdAt: string;
}

export interface RfqLine {
  id: string;
  rfqBundleId: string;
  demandLineIds: string[];
  mpn: string;
  alternateGroupId: string;
  aggregatedQty: number;
  targetPrice: number;
  currency: string;
  clientPoId?: string;
  clientLineIds?: string[];
}

export interface RfqBundle {
  id: string;
  lines: RfqLine[];
  invites: SupplierInvite[];
  status: RfqBundleStatus;
  deadline: string;
  dateToleranceDays: number;
  createdAt: string;
}

export interface SupplierQuestion {
  id: string;
  question: string;
  askedAt: string;
  answer?: string;
  answeredAt?: string;
}

export interface SupplierInvite {
  id: string;
  rfqBundleId: string;
  supplierName: string;
  supplierEmail: string;
  status: "PENDING" | "SENT" | "VIEWED" | "QUOTED" | "DECLINED";
  portalToken: string;
  expiresAt: string;
  sentAt?: string;
  viewedAt?: string;
  lastError?: string;
  questions?: SupplierQuestion[];
}

export interface SupplierQuote {
  id: string;
  rfqBundleId: string;
  supplierEmail: string;
  lines: QuoteLine[];
  status: SupplierQuoteStatus;
  submittedAt: string;
  sellerPiNo?: string; // the supplier's own proforma invoice no — required before we cut our PO against it
  sellerPiReceivedAt?: string;
}

export interface QuoteLine {
  id: string;
  rfqLineId: string;
  supplierEmail: string;
  quotedMpn: string;
  stockQty: number;
  unitPrice: number;
  currency: string;
  leadTimeDays: number;
  leadTimeUnit: "days" | "weeks" | "months";
  incoterm: string;
  location: string;
  packaging: string;
  validityDays: number;
  moq: number;
  spq: number;
  dateCode: string;
  termsConditions: string[];
  stockSource: string;
  paymentTerms: string;
  status: QuoteLineStatus;
  requiresApproval?: boolean;
}

export interface QuoteEmail {
  id: string;
  rfqBundleId: string;
  supplierEmail: string;
  rawEmail: string;
  parsed: { lines: Partial<QuoteLine>[] };
  matchedSupplierQuoteId?: string;
  status: QuoteEmailStatus;
  escalationNote?: string;
  createdAt: string;
}

export interface ClientQuoteDecision {
  id: string;
  rfqBundleId: string;
  selectedQuoteLines: { rfqLineId: string; quoteLineId: string }[];
  allocations: { rfqLineId: string; clientPoId: string; qty: number; unitPrice: number }[]; // multi-buyer split
  markupPercent: number;
  status: ClientQuoteDecisionStatus;
  approvalId?: string;
  sentAt?: string;
  decidedBy?: string;
  decidedAt?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface ClientQuote {
  id: string;
  rfqBundleId: string;
  clientQuoteDecisionId: string;
  clientPoId: string;
  piNo: string; // our proforma invoice no — the formal document the buyer's PO is raised against
  clientName: string;
  clientEmail: string;
  token: string;
  lines: { rfqLineId: string; mpn: string; qty: number; unitPrice: number }[];
  totalPrice: number;
  expiresAt: string;
  status: ClientQuoteStatus;
  createdAt: string;
  acceptedAt?: string;
  buyerNotes?: string; // buyer's own note when requesting changes (distinct from a send failure)
  lastError?: string;
}

export interface QuoteAgentNote {
  id: string;
  quoteLineId: string;
  agentName: string;
  note: string;
  clarificationType: "AMBIGUITY" | "MOQ_ISSUE" | "LEAD_TIME" | "PRICE";
  resolution: string;
  createdAt: string;
}

export type DemandLinesMap = Record<string, DemandLine>;
export type RfqBundlesMap = Record<string, RfqBundle>;
export type SupplierQuotesMap = Record<string, SupplierQuote>;
export type ClientQuoteDecisionsMap = Record<string, ClientQuoteDecision>;
export type ClientQuotesMap = Record<string, ClientQuote>;
