import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { toast } from "sonner";
import type {
  Order, OrderBundle, OrderLine, ClientPO, SupplierPO, SupplierPoLine, PoTerms, Address, JourneyPhase, TestStatus, TestingMode, PaymentMode, PaymentDirection,
  PaymentStatus, ShipmentLeg, ShipmentStatus, ShipmentPackage, TradeType, ApprovalState,
  LotTest, MpnTestSpec, TestAuditEntry, TestProcessStatus, WhlReport, LabEmail, NotifyParty,
  Lot, TestingStage, LotDispatch, LabPaymentTerms,
  DemandLine, RfqBundle, SupplierQuote, ClientQuoteDecision, ClientQuote, QuoteEmail, RfqBundleStatus,
  DemandLinesMap, RfqBundlesMap, SupplierQuotesMap, ClientQuoteDecisionsMap, ClientQuotesMap,
} from "@/types";
import { ORDERS, CLIENT_POS, SUPPLIER_POS, ONEBUY_HUB, getOrderBundle, buildJourney } from "@/data/fixtures";
import { remainingToShipLeg, remainingToAllocate, gateReason, sourcedForClientLine, mappedForOrderLine, orderSourcedForClient, deliveredForClientLine, lotStage, currentReport } from "@/store/selectors";
import type { OrdersMap } from "@/store/selectors";
import { ESCROW_STATUS_ORDER, HKIN_EMAIL } from "@/data/enums";
// ---- mock external-API adapters (swap for real fetch() in production) ----
import { fileBillOfEntry, getAssessment, getClearanceStatus, getIgmEntry } from "@/integrations/customs-icegate";
import { bookShipment, getTracking, dhlCreatePickup, dhlUpdatePickup, dhlCancelPickup, dhlGetInvoices, dhlUploadImage, sendLogisticsMail, fetchLogisticsReplies, LOGISTICS_PARTY_LABEL, type Carrier, type LogisticsParty } from "@/integrations/logistics";
import { requestSupplierShippingDocs, extractSupplierShippingDocs, notifyCustomsTeamToFileBoe, sendAwbToChaMail, shippingDocList } from "@/integrations/shipping-docs";
import { weClearImportCustoms } from "@/lib/incoterm";
import { money } from "@/lib/utils";
import {
  whlSubmitTestJob, whlPollTestReport, mapVerdict, whlFetchReport, whlSendMail, whlPollInbox,
  conclusionToLotStatus, processToTestStatus,
} from "@/integrations/lab-whl";
import { extractLabInvoice, extractBookingAppointment } from "@/integrations/doc-extract";
import { WHL_CONTACT, whlTemplate, WHL_EMAIL_TEMPLATES, TESTING_STAGE_META, stageIdx, LAB_TERMS_LABEL } from "@/data/enums";
import { escrowAgentFetchPoPi, escrowAgentFetchPaymentClosure } from "@/integrations/escrow-agent";
import { bankInitiateTransfer, bankGetTransferStatus } from "@/integrations/banking";
import { generateIrn } from "@/integrations/einvoice-irp";
import { sendPartyNotification } from "@/integrations/notify";
import type { EscrowFeeBreakdown, EscrowConditions, EscrowContact, Escrow, WhlVerdict, EscrowSendPurpose } from "@/types";
// Real escrow-agents backend (Python/FastAPI/Postgres/Ollama) — see src/lib/escrow-api.ts.
// Everything escrow-related below calls this instead of simulating state locally; the PO/PI
// fetch, payment-closure fetch, and payment-closure upload below stay on the old in-memory mock
// (escrow-agent.ts) since escrow-agents doesn't have an agent for those yet.
import {
  createEscrowOrder, tickEscrowOrder, listEscrowDrafts, sendEscrowDraft,
  cancelEscrowOrder as cancelEscrowOrderApi, uploadEscrowInvoiceManually as uploadEscrowInvoiceManuallyApi,
  simulateNextInbound, createOnHkin,
  markApplicationRejected, recordRma, acceptGoods as acceptGoodsApi, rejectGoods as rejectGoodsApi, requestExtension,
  simulateDeadlineReminder,
} from "@/lib/escrow-api";
import { sendRfqInvite } from "@/integrations/rfq-send";
import { isEscrowMockMode } from "@/lib/escrow-mode";
import { BUYERS, SUPPLIERS } from "@/data/directory";

export interface EscrowEmailDraft { to: string; cc?: string; subject: string; body: string; }

const SHARPBUY_GSTIN = "27AASCS1234A1Z5"; // masking entity's GSTIN - the only seller GSTIN sent to the IRP

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

let _n = 0;
const uid = (p = "id") => `${p}-${Date.now().toString(36)}-${(_n++).toString(36)}`;
// Clean 4-char alphanumeric suffix for document/invoice numbers — plain uid() embeds hyphens
// (`prefix-ts36-n36`), which reads as garbled when sliced into a doc-number string.
const shortRef = () => (_n++).toString(36).toUpperCase().padStart(4, "0").slice(-4);
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " "); // audit rows are datetime-precise

// Defensive backfill for the funding-clock's Escrow.fundedAt field: the local mock path
// (escrow-mock.ts) always stamps it on the DRAFT.../ESCROW_FEE_INVOICED → TT_PAYMENT_RECEIVED
// transition, but the real escrow-agents backend response (src/lib/escrow-api.ts) doesn't know
// about this app-local field, so a response landing already at TT_PAYMENT_RECEIVED+ needs a
// same-day fallback rather than leaving the Funding phase clock stuck open forever.
const withFundedAtStamp = (e: Escrow): Escrow =>
  !e.fundedAt && ESCROW_STATUS_ORDER.indexOf(e.status) >= ESCROW_STATUS_ORDER.indexOf("TT_PAYMENT_RECEIVED")
    ? { ...e, fundedAt: today() } : e;

// Every manual test edit and every status change (automated or manual) writes one of these.
const auditRow = (a: Omit<TestAuditEntry, "id" | "at">): TestAuditEntry => ({ id: uid("aud"), at: stamp(), ...a });

const ME = "You (demo)";

// The logistics desk's counterparty mailboxes. Party records carry no email and
// the transport is a mock, so these are synthesized — but stable per order, so
// the thread reads like a real one.
export const logisticsContact = (b: OrderBundle, p: LogisticsParty): string => {
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "party";
  const leg = b.shipments.find((x) => x.leg === "INBOUND");
  switch (p) {
    case "SUPPLIER": return `docs@${slug(b.supplier.name)}.com`;
    case "CARRIER": return `bookings@${slug(leg?.carrier ?? "dhl")}.com`;
    case "CHA": return `filing@${slug(b.customs[0]?.chaName ?? "cha-desk")}.in`;
    case "WAREHOUSE": return "dock@1buy-hub.in";
    case "CLIENT": return `orders@${slug(b.buyer.name)}.com`;
    case "INSURER": return "claims@marine-cover.in";
    case "FINANCE": return "finance@1buy.ai";
    case "OTHER": return "";
  }
};

/*
 * Who a typed address belongs to. Exact known mailboxes first, then plain
 * heuristics on the address text; anything unrecognised is OTHER — which
 * files under Others until somebody says better.
 */
export const inferLogisticsParty = (b: OrderBundle, email: string): LogisticsParty => {
  const e = email.trim().toLowerCase();
  if (!e) return "OTHER";
  const known: LogisticsParty[] = ["SUPPLIER", "CARRIER", "CHA", "WAREHOUSE", "CLIENT", "INSURER", "FINANCE"];
  for (const p of known) if (logisticsContact(b, p).toLowerCase() === e) return p;
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (/dhl|fedex|delhivery|carrier|booking|freight/.test(e)) return "CARRIER";
  if (/cha|clearing|filing|customs|broker/.test(e)) return "CHA";
  if (/dock|warehouse|hub/.test(e)) return "WAREHOUSE";
  if (/finance|accounts|payable/.test(e)) return "FINANCE";
  if (/claim|insur|cover/.test(e)) return "INSURER";
  if (e.includes(slug(b.supplier.name).slice(0, 8))) return "SUPPLIER";
  if (e.includes(slug(b.buyer.name).slice(0, 8))) return "CLIENT";
  return "OTHER";
};

// Real-world API provider names per carrier — shown in the "calling …" loading popups so the
// mock booking/tracking reads like a live integration (swap for real endpoints in production).
const CARRIER_API: Record<string, string> = {
  DHL: "DHL Global Forwarding",
  FEDEX: "FedEx Web Services",
  DELHIVERY: "Delhivery Ship API",
};

// Operational journey phases that mirror the physical shipment/customs state (as opposed to
// manual/finance decisions like PAYMENT, TESTING, DELIVERY, CLOSE).
const OPERATIONAL_PHASES = new Set(["EXPORT", "IMPORT", "CUSTOMS", "RELABEL"]);
// Advance the journey through operational milestones (ship → customs → received) whose gates are
// now satisfied by the real shipment/customs state, so the progress bar reflects reality without a
// manual click. Stops at the first non-operational step or an unsatisfied gate. (Mutates the draft.)
function autoAdvanceOperational(bb: OrderBundle) {
  let advanced = false;
  for (let guard = 0; guard < bb.journey.length + 2; guard++) {
    const idx = bb.journey.findIndex((x) => x.status === "IN_PROGRESS" || x.status === "BLOCKED");
    if (idx < 0) break;
    const step = bb.journey[idx];
    if (!OPERATIONAL_PHASES.has(step.phase) || gateReason(bb, step)) break;
    step.status = "DONE";
    advanced = true;
    if (idx + 1 < bb.journey.length) bb.journey[idx + 1].status = "IN_PROGRESS";
    else { bb.status = "CLOSED"; break; }
  }
  if (advanced && bb.status === "ON_HOLD") bb.status = "ACTIVE";
}
const WHL_BOT = "WHL inbox (auto)";
const SUPPLIER_RELAY = "Supplier (relayed)";

/**
 * Move a lot forward along the testing lifecycle. Forward-only: a stale interim mail
 * arriving after the report can't rewind a lot, and re-polling the same stage is a
 * no-op rather than a duplicate history row. Returns true if the stage actually moved.
 *
 * Compares against the *recorded* stage, not the displayed one. The displayed stage
 * (`lotStage`) is floored by what the lot's tests/report imply, and that floor can run
 * ahead of what the lab has actually told us — e.g. applying a mail's per-test updates
 * implies "in progress" before the same mail's "testing has started" is recorded. Using
 * the floor here silently swallowed those rows, so a stage the lab genuinely reported
 * never got a timestamp.
 */
/**
 * The booking-request mail for a test slot: subject + body + the slot reference it quotes.
 *
 * Split out of `requestTestSlot` so the modal can **show the draft for review before anything is
 * sent** and still send exactly what was shown. Same rule the escrow module follows — no outbound
 * mail leaves this app without a human seeing it first.
 */
/**
 * The booking-request mail for a test slot: subject + body + the slot reference **we** keep.
 *
 * Split out of `requestTestSlot` so the modal can show the draft for review before anything is sent
 * and still send exactly what was shown. Same rule the escrow module follows — no outbound mail
 * leaves this app without a human seeing it first.
 *
 * `slotNo` is **ours and stays ours**: it is never quoted to the lab (2026-08-21). We do not issue
 * the lab a booking reference — the lab issues *us* one, in its confirmation, and its appointment no
 * plus the work orders are the references both sides then use. A re-test therefore cites the lab's
 * own appointment and work orders, not our earlier slot number.
 */
function buildSlotMail(
  b: OrderBundle,
  input: {
    lab: string; preferredDate?: string; note?: string;
    lines: { mpn: string; qty: number; sampleQty: number; dateCode: string; tests: { name: string; standard?: string }[]; preferredDate?: string }[];
    retestOfSlotId?: string; retestReason?: string;
  },
) {
  const prior = input.retestOfSlotId ? (b.testSlots ?? []).find((x) => x.id === input.retestOfSlotId) : undefined;
  const slotNo = `TS-${b.orderNo.replace(/\D/g, "").slice(-4)}-${(b.testSlots ?? []).length + 1}`;

  // what the LAB calls the earlier submission — its appointment, and the work orders it issued
  const priorWos = prior
    ? b.lots.filter((l) => l.testSlotId === prior.id).map((l) => l.workOrderNo).filter(Boolean)
    : [];
  const priorRef = prior
    ? [prior.appointmentNo ? `appointment ${prior.appointmentNo}` : null,
       priorWos.length ? `work order${priorWos.length === 1 ? "" : "s"} ${priorWos.join(", ")}` : null]
      .filter(Boolean).join(", ")
    : "";

  const subject = prior
    ? `Re-test request${priorRef ? ` — ${priorRef}` : ""} — ${input.lines.map((l) => l.mpn).join(", ")}`
    : `Test slot request — ${input.lines.map((l) => l.mpn).join(", ")}`;

  const body = [
    `Hi ${input.lab} team,`,
    "",
    prior
      ? `We would like to book a RE-TEST slot against your ${priorRef || "earlier submission for these parts"}.${input.retestReason ? ` Reason: ${input.retestReason.replace(/[.\s]+$/, "")}.` : ""} The components are already with you from that submission.`
      : "We would like to book a testing slot for the lots below.",
    "",
    `Client P/O: ${b.supplierPoNo ?? b.orderNo}`,
    input.preferredDate ? `Preferred start: ${input.preferredDate}${input.lines.some((l) => l.preferredDate) ? " (unless stated per MPN below)" : ""}` : "",
    "",
    // one block per MPN, tests as a numbered list — a comma-run of ten process names is
    // unreadable on the lab's side and is exactly the part they have to work from
    ...input.lines.flatMap((l) => [
      `MPN ${l.mpn}`,
      `  Lot qty: ${l.qty}`,
      `  Sample qty: ${l.sampleQty}`,
      ...(l.dateCode ? [`  Date code: ${l.dateCode}`] : []),
      // a per-MPN start only earns a line when it differs from what the header already said
      ...(l.preferredDate && l.preferredDate !== input.preferredDate ? [`  Preferred start: ${l.preferredDate}`] : []),
      l.tests.length ? "  Tests requested:" : "  Tests requested: as per your standard AS6081 screen",
      ...l.tests.map((t, i) => `    ${i + 1}. ${t.name}${t.standard ? ` (${t.standard})` : ""}`),
      "",
    ]),
    input.note ? `${input.note}\n` : "",
    "Please confirm the slot with your booking appointment — work order numbers, sample quantities and the agreed test plan — and we will action it from there.",
    "",
    "Thanks,",
    "Sourcing Ops",
  ].filter((x) => x !== "" || true).join("\n").replace(/\n{3,}/g, "\n\n");

  return { subject, body, slotNo };
}

function moveStage(
  lot: Lot,
  stage: TestingStage,
  by: string,
  o: { note?: string; sourceEmailId?: string; manual?: boolean } = {},
): boolean {
  const from = stageIdx(lot.stage);
  const to = stageIdx(stage);
  if (to <= from) return false;
  lot.stage = stage;
  recordStageEvent(lot, stage, by, o);
  return true;
}

/**
 * Append a lifecycle history row WITHOUT moving the cursor. For the one stage whose truth
 * is a record rather than a position: `WHL_PAYMENT`.
 *
 * The fee is a parallel track, so it routinely settles *after* the chain has moved past
 * index 1 — on credit terms because the lab tests on account, and on advance terms because
 * the lot ships and books in before the transfer clears (the hold bites at the bench, not
 * at the loading dock). By then `moveStage(WHL_PAYMENT)` is a backwards move and no-ops,
 * which silently dropped the payment's timestamp, author and source mail — the very bug the
 * comment above warns about, on the one stage most likely to hit it.
 *
 * So: record the event either way, and only advance the cursor if it's genuinely forward.
 */
function recordStageEvent(
  lot: Lot,
  stage: TestingStage,
  by: string,
  o: { note?: string; sourceEmailId?: string; manual?: boolean } = {},
): void {
  (lot.stageHistory ??= []).push({
    id: uid("stg"), stage, at: stamp(), by,
    note: o.note, sourceEmailId: o.sourceEmailId, manual: o.manual,
  });
}

/** Settle a stage that may already be behind the cursor — see `recordStageEvent`. */
function settleStage(
  lot: Lot,
  stage: TestingStage,
  by: string,
  o: { note?: string; sourceEmailId?: string; manual?: boolean } = {},
): boolean {
  if (moveStage(lot, stage, by, o)) return true;
  // already past it: keep the audit row, leave the cursor where the lab has actually got to
  if ((lot.stageHistory ?? []).some((e) => e.stage === stage)) return false;
  recordStageEvent(lot, stage, by, o);
  return false;
}


function freshSeed(): { orders: OrdersMap; clientPos: typeof CLIENT_POS; supplierPos: SupplierPO[]; demandLines: DemandLinesMap; rfqBundles: RfqBundlesMap; supplierQuotes: SupplierQuotesMap; clientQuoteDecisions: ClientQuoteDecisionsMap; clientQuotes: ClientQuotesMap; quoteEmails: Record<string, QuoteEmail> } {
  const orders: OrdersMap = {};
  for (const o of ORDERS) { const b = getOrderBundle(o.id); if (b) orders[o.id] = b; }

  // Sample client RFQs for demo (10 diverse requests)
  const demandLines: DemandLinesMap = {
    "dem-001": {
      id: "dem-001",
      mpn: "STM32F407VG",
      qty: 500,
      targetPrice: 8.50,
      currency: "USD",
      requiredByDate: "2026-08-31",
      source: "email",
      clientPoId: "buyer-001",
      createdAt: today(),
    },
    "dem-002": {
      id: "dem-002",
      mpn: "STM32H745ZIT6",
      qty: 300,
      targetPrice: 12.00,
      currency: "USD",
      requiredByDate: "2026-08-25",
      source: "email",
      clientPoId: "buyer-002",
      createdAt: today(),
    },
    "dem-003": {
      id: "dem-003",
      mpn: "NXP IMXRT1062DVJ6A",
      qty: 200,
      targetPrice: 9.75,
      currency: "USD",
      requiredByDate: "2026-09-10",
      source: "manual",
      clientPoId: "buyer-003",
      createdAt: today(),
    },
    "dem-004": {
      id: "dem-004",
      mpn: "TI CC3235MODASF",
      qty: 150,
      targetPrice: 15.50,
      currency: "USD",
      requiredByDate: "2026-08-28",
      source: "email",
      clientPoId: "buyer-004",
      createdAt: today(),
    },
    "dem-005": {
      id: "dem-005",
      mpn: "EFM32GG11B820F1024GL120",
      qty: 250,
      targetPrice: 11.25,
      currency: "USD",
      requiredByDate: "2026-09-05",
      source: "email",
      clientPoId: "buyer-005",
      createdAt: today(),
    },
    "dem-006": {
      id: "dem-006",
      mpn: "MCP2515-I/P",
      qty: 400,
      targetPrice: 3.25,
      currency: "USD",
      requiredByDate: "2026-09-15",
      source: "manual",
      clientPoId: "buyer-001",
      createdAt: today(),
    },
    "dem-007": {
      id: "dem-007",
      mpn: "LM7812CT",
      qty: 600,
      targetPrice: 2.10,
      currency: "USD",
      requiredByDate: "2026-08-22",
      source: "email",
      clientPoId: "buyer-002",
      createdAt: today(),
    },
    "dem-008": {
      id: "dem-008",
      mpn: "ATmega328P-AU",
      qty: 350,
      targetPrice: 4.50,
      currency: "USD",
      requiredByDate: "2026-09-20",
      source: "manual",
      clientPoId: "buyer-003",
      createdAt: today(),
    },
    "dem-009": {
      id: "dem-009",
      mpn: "INA219AIDEBT",
      qty: 180,
      targetPrice: 5.75,
      currency: "USD",
      requiredByDate: "2026-09-08",
      source: "email",
      clientPoId: "buyer-004",
      createdAt: today(),
    },
    "dem-010": {
      id: "dem-010",
      mpn: "SSD1306",
      qty: 220,
      targetPrice: 6.80,
      currency: "USD",
      requiredByDate: "2026-09-12",
      source: "manual",
      clientPoId: "buyer-005",
      createdAt: today(),
    },
  };

  // Demo RFQ bundle already floated + quoted, so Compare/Decide/Approve is demoable
  // without first walking the supplier portal by hand.
  const rfqBundles: RfqBundlesMap = {
    "rfq-demo-001": {
      id: "rfq-demo-001",
      lines: [
        { id: "rlin-demo-1", rfqBundleId: "rfq-demo-001", demandLineIds: ["dem-001"], mpn: "STM32F407VG", alternateGroupId: "alt-STM32F407VG", aggregatedQty: 500, targetPrice: 8.50, currency: "USD", clientPoId: "buyer-001", clientLineIds: [] },
        { id: "rlin-demo-2", rfqBundleId: "rfq-demo-001", demandLineIds: ["dem-002"], mpn: "STM32H745ZIT6", alternateGroupId: "alt-STM32H745ZIT6", aggregatedQty: 300, targetPrice: 12.00, currency: "USD", clientPoId: "buyer-002", clientLineIds: [] },
      ],
      invites: [
        { id: "inv-demo-1", rfqBundleId: "rfq-demo-001", supplierName: "Shanghai Electronics Co.", supplierEmail: "export@shanghai-elec.com", status: "QUOTED", portalToken: "tok-demo-shanghai", expiresAt: "2026-08-20", sentAt: "2026-08-01" },
        { id: "inv-demo-2", rfqBundleId: "rfq-demo-001", supplierName: "Bangalore IC Systems", supplierEmail: "sales@bangalore-ic.com", status: "QUOTED", portalToken: "tok-demo-bangalore", expiresAt: "2026-08-20", sentAt: "2026-08-01" },
        { id: "inv-demo-3", rfqBundleId: "rfq-demo-001", supplierName: "Vietnam Manufacturing Ltd", supplierEmail: "export@vnmanufacture.com", status: "QUOTED", portalToken: "tok-demo-vietnam", expiresAt: "2026-08-20", sentAt: "2026-08-01" },
      ],
      status: "QUOTES_IN",
      deadline: "2026-08-15",
      dateToleranceDays: 7,
      createdAt: "2026-08-01",
    },
  };

  const supplierQuotes: SupplierQuotesMap = {
    "quote-demo-shanghai": {
      id: "quote-demo-shanghai", rfqBundleId: "rfq-demo-001", supplierEmail: "export@shanghai-elec.com", status: "SUBMITTED", submittedAt: "2026-08-05",
      lines: [
        { id: "ql-demo-sh-1", rfqLineId: "rlin-demo-1", supplierEmail: "export@shanghai-elec.com", quotedMpn: "STM32F407VG", stockQty: 500, unitPrice: 7.85, currency: "USD", leadTimeDays: 12, leadTimeUnit: "days", incoterm: "EXW", location: "Shanghai, CN", packaging: "Tape & Reel", validityDays: 30, moq: 100, spq: 100, dateCode: "25+", termsConditions: [], stockSource: "warehouse", paymentTerms: "Advance via T/T", status: "ACTIVE" },
        { id: "ql-demo-sh-2", rfqLineId: "rlin-demo-2", supplierEmail: "export@shanghai-elec.com", quotedMpn: "STM32H745ZIT6", stockQty: 300, unitPrice: 11.20, currency: "USD", leadTimeDays: 15, leadTimeUnit: "days", incoterm: "EXW", location: "Shanghai, CN", packaging: "Tape & Reel", validityDays: 30, moq: 50, spq: 50, dateCode: "25+", termsConditions: [], stockSource: "warehouse", paymentTerms: "Advance via T/T", status: "ACTIVE" },
      ],
    },
    "quote-demo-bangalore": {
      id: "quote-demo-bangalore", rfqBundleId: "rfq-demo-001", supplierEmail: "sales@bangalore-ic.com", status: "SUBMITTED", submittedAt: "2026-08-06",
      lines: [
        { id: "ql-demo-ba-1", rfqLineId: "rlin-demo-1", supplierEmail: "sales@bangalore-ic.com", quotedMpn: "STM32F407VG", stockQty: 500, unitPrice: 8.10, currency: "USD", leadTimeDays: 8, leadTimeUnit: "days", incoterm: "FOB", location: "Bangalore, IN", packaging: "Tray", validityDays: 21, moq: 50, spq: 50, dateCode: "25+", termsConditions: [], stockSource: "warehouse", paymentTerms: "Net 30 credit", status: "ACTIVE" },
        { id: "ql-demo-ba-2", rfqLineId: "rlin-demo-2", supplierEmail: "sales@bangalore-ic.com", quotedMpn: "STM32H745ZIT6", stockQty: 300, unitPrice: 11.75, currency: "USD", leadTimeDays: 10, leadTimeUnit: "days", incoterm: "FOB", location: "Bangalore, IN", packaging: "Tray", validityDays: 21, moq: 25, spq: 25, dateCode: "25+", termsConditions: [], stockSource: "warehouse", paymentTerms: "Net 30 credit", status: "ACTIVE" },
      ],
    },
    "quote-demo-vietnam": {
      id: "quote-demo-vietnam", rfqBundleId: "rfq-demo-001", supplierEmail: "export@vnmanufacture.com", status: "SUBMITTED", submittedAt: "2026-08-07",
      lines: [
        { id: "ql-demo-vn-1", rfqLineId: "rlin-demo-1", supplierEmail: "export@vnmanufacture.com", quotedMpn: "STM32F407VG", stockQty: 500, unitPrice: 7.60, currency: "USD", leadTimeDays: 18, leadTimeUnit: "days", incoterm: "EXW", location: "Ho Chi Minh City, VN", packaging: "Tube", validityDays: 30, moq: 100, spq: 100, dateCode: "25+", termsConditions: [], stockSource: "warehouse", paymentTerms: "Advance via T/T", status: "ACTIVE" },
        { id: "ql-demo-vn-2", rfqLineId: "rlin-demo-2", supplierEmail: "export@vnmanufacture.com", quotedMpn: "STM32H745ZIT6", stockQty: 300, unitPrice: 11.50, currency: "USD", leadTimeDays: 20, leadTimeUnit: "days", incoterm: "EXW", location: "Ho Chi Minh City, VN", packaging: "Tube", validityDays: 30, moq: 50, spq: 50, dateCode: "25+", termsConditions: [], stockSource: "warehouse", paymentTerms: "Advance via T/T", status: "ACTIVE" },
      ],
    },
  };

  return JSON.parse(JSON.stringify({
    orders, clientPos: CLIENT_POS, supplierPos: SUPPLIER_POS,
    demandLines, rfqBundles, supplierQuotes, clientQuoteDecisions: {}, clientQuotes: {}, quoteEmails: {},
  }));
}

export interface ClientPoInput {
  clientName: string; clientPoNo: string; paymentMode: PaymentMode;
  clientGstin?: string; clientState?: string; terms?: PoTerms; deliveryAddress?: Address;
  lines: { mpn: string; make?: string; dateCode?: string; qty: number; unitPrice: number; requiredBy: string }[];
}

export interface SupplierPoInput {
  supplier: string; supplierCountry?: string; supplierGstin?: string; supplierState?: string;
  tradeType: TradeType; incoterm: string; currency: string; sellerPaymentMode: PaymentMode;
  lead: number; testDays: number; delivery: number; testing: TestingMode; terms?: PoTerms;
  creditDays?: number; termsConditions?: string[]; relabelCost?: number;
  // lines may be LINKED to a client-PO line (partial ok, multi-client) or UNLINKED (client ref omitted - map later)
  lines: { mpn: string; make?: string; dateCode?: string; testing?: TestingMode; clientPoNo?: string; clientLineMpn?: string; qty: number; buyUnitPrice: number; marginPct: number }[];
}

/** Fallback contact email for a party this app never actually collects an email for
 * (Party/SupplierPO carry no email field) — must never be the literal placeholder
 * strings ("—"/"-"/"") escrow-agents' create-on-hkin guard rejects before opening
 * a browser (see escrow-agents/api.py's _is_placeholder_email). */
function fallbackContactEmail(company: string): string {
  const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24);
  return `contact@${slug || "party"}.example`;
}

/** Standard bundle scaffold used by both create paths. */
function scaffoldBundle(order: Order, lines: OrderLine[], createdEvent: string): OrderBundle {
  const labCompany = order.terms?.labLocation ?? "Independent Test Laboratory";
  return {
    ...order, lines, journey: buildJourney(order), lots: [], mpnTests: [], labEmails: [],
    escrow: order.paymentMode === "ESCROW"
      ? { id: uid("esc"), status: "DRAFT", hkinAccountStatus: "NOT_ASKED",
          buyerContact: { company: order.maskingEntity, registeredAddress: "New Delhi, India (on file)", country: "India", contactPerson: "SC Ops Desk", email: "scops@sharpbuy.demo", phone: "—", im: "—" },
          sellerContact: { company: order.supplier.name, registeredAddress: "Address on file", country: order.supplier.country, contactPerson: "Sales Team", email: fallbackContactEmail(order.supplier.name), phone: "—", im: "—" },
          poAmount: order.buyTotal, currency: order.currency,
          useInspectionService: (order.testingMode ?? "NONE") === "WHL",
          recipient: { company: labCompany, registeredAddress: "Address on file", country: order.supplier.country, contactPerson: "Lab Coordinator", email: fallbackContactEmail(labCompany), phone: "—", im: "—" },
          agreedFeeToBuyer: Math.round(order.buyTotal * 0.00856), // matches escrow-agent's base fee rate — a first (non-revised) fetch reconciles cleanly
          milestoneReleases: [], agentEmails: [] }
      : undefined,
    payments: [], shipments: [], customs: [], deliveries: [], sourcingAllocations: [], documents: [],
    approvals: [], // PO review happens on the upstream sourcing platform; fulfilment approvals (payment/escrow release) are added later
    events: [{ id: uid("ev"), eventType: "GENERAL", message: createdEvent, source: "SC_MANUAL", occurredAt: today(), recordedBy: "You (demo)" }],
  };
}

interface Store {
  orders: OrdersMap;
  clientPos: typeof CLIENT_POS;
  supplierPos: SupplierPO[];
  // ---- RFQ Module State ----
  demandLines: DemandLinesMap;
  rfqBundles: RfqBundlesMap;
  supplierQuotes: SupplierQuotesMap;
  clientQuoteDecisions: ClientQuoteDecisionsMap;
  clientQuotes: ClientQuotesMap;
  quoteEmails: Record<string, QuoteEmail>;

  resetDemo: () => void;
  createClientPo: (input: ClientPoInput) => string;
  createSupplierPo: (input: SupplierPoInput) => string | null;
  createOrderFromSupplierPo: (supplierPoId: string) => string | null;
  // Escrow tab, step before "Step 0": confirm the supplier has (or has opened) an HKin
  // account before running the real "Create HKin order" RPA. askSupplierHkinAccount
  // composes/sends the ask; confirmSupplierHkinAccount simulates the supplier's reply
  // landing (mirrors checkEscrowInbox's manual-trigger pattern).
  askSupplierHkinAccount: (orderId: string) => void;
  confirmSupplierHkinAccount: (orderId: string) => void;

  advanceStep: (orderId: string) => void;
  addStep: (orderId: string, step: { phase: string; name: string; owner: string; isGate: boolean }) => void;
  markRelabelled: (orderId: string) => void;
  markTestingReturnedToSupplier: (orderId: string) => void;

  /**
   * Raise a lot by hand. `tests` is the plan typed in on the Add-lot form: with the per-MPN
   * requirements surface parked, an operator who has no booking appointment needs *some* way to
   * say what the lab is running, so the form asks and this writes it onto the lot **and** onto
   * the MPN's spec (source `MANUAL`, audited) so the two never disagree. Omitted ⇒ the lot
   * inherits whatever the MPN's spec already carries, as before.
   */
  addLot: (orderId: string, lot: { orderLineMpn: string; lotCode: string; dateCode: string; qty: number; sampleQty: number; lab?: string; tests?: { name: string; standard?: string }[] }) => void;
  setLotStatus: (orderId: string, lotId: string, status: TestStatus) => void;
  fetchLabResult: (orderId: string, lotId: string) => void; // WHL adapter - poll the report

  // ---- WHL testing platform ----
  /**
   * Read the lab's **booking appointment** and let it create the lots and their test plans.
   *
   * `file === null` is the demo/auto-fill path: same parse, no document to file against the
   * order. This is what "Auto-fill tests from PO" used to be — the PO says what the buyer
   * requires, the appointment says what the lab agreed to run, and the tracker mirrors the
   * second. Real backend integration later; the adapter seam is unchanged.
   *
   * `lotId` scopes it to **one lot**: labs book per lot, so an operator with the appointment
   * for LOT-B must be able to apply it to LOT-B without touching the others (and without a
   * re-read inventing lots for lines that have not been booked yet). Order-wide when omitted.
   */
  uploadBookingAppointment: (orderId: string, file: { name: string; size: number } | null, lotId?: string) => Promise<void>;
  addMpnTest: (orderId: string, mpn: string, t: { name: string; standard?: string }) => void;  // audited manual override
  removeMpnTest: (orderId: string, mpn: string, testId: string) => void;                        // audited manual override
  setLotTestStatus: (orderId: string, lotId: string, lotTestId: string, status: TestProcessStatus, note?: string) => void;
  // ---- testing lifecycle (the stage chain a lot walks while it's at the lab) ----
  recordSupplierDispatch: (orderId: string, lotId: string, d: Omit<LotDispatch, "recordedBy" | "recordedAt">) => void;
  setLotStage: (orderId: string, lotId: string, stage: TestingStage, note?: string) => void;
  // ---- WHL's testing fee: ask for the invoice, hand it to finance, record the payment ----
  requestWhlInvoice: (orderId: string, lotId: string) => void;
  // fallback for when the lab's invoice never arrives by mail (or came by another medium)
  /**
   * "Upload invoice" is exactly that: the operator picks WHL's PDF off their device and this
   * reads the invoice out of it (`extractLabInvoice`) — no form, because every field on that
   * document is the lab's, and the terms in particular decide whether the lot is held. Still
   * flagged `source: "MANUAL"` / "entered by hand": the record didn't come off the lab's mail.
   */
  uploadLabInvoiceFile: (orderId: string, lotId: string, file: { name: string; size: number }) => Promise<void>;
  markLabFeePaid: (orderId: string, lotId: string, d: { paidRef?: string; paidAt?: string; note?: string }) => void;
  /**
   * WHL has returned the samples to the seller — the stage between the report landing and the
   * freight hand-off. Normally the lab's own confirmation mail; this is the by-hand fallback.
   */
  /**
   * Ask the lab for a test slot. Records the outbound booking-request mail on the WHL thread and
   * creates the slot as `REQUESTED` — **no lots yet**. Nothing about a lot exists until the lab
   * confirms, because acting on lots the lab has not agreed to test is how a tracker starts lying.
   * `retestOf` makes it a re-test of an earlier slot.
   */
  requestTestSlot: (orderId: string, input: {
    lab: string; preferredDate?: string; note?: string;
    lines: { mpn: string; qty: number; sampleQty: number; dateCode: string; tests: { name: string; standard?: string }[]; preferredDate?: string }[];
    retestOfSlotId?: string; retestReason?: string;
    /** the reviewed draft. Omitted only by callers that have no UI — the modal always sends both. */
    subject?: string; body?: string;
  }) => void;
  /**
   * The draft this order's booking request would send, so the modal can show it for review before
   * anything leaves. Pure — builds the same subject/body `requestTestSlot` would.
   */
  draftTestSlotMail: (orderId: string, input: {
    lab: string; preferredDate?: string; note?: string;
    lines: { mpn: string; qty: number; sampleQty: number; dateCode: string; tests: { name: string; standard?: string }[]; preferredDate?: string }[];
    retestOfSlotId?: string; retestReason?: string;
  }) => { subject: string; body: string; slotNo: string };
  markLotReturnedToSeller: (orderId: string, lotId: string) => void;
  /**
   * Hand a tested lot to the logistics desk. Only meaningful once its report is shared — the
   * testing screen gates the control on that. It is a **stamp, not a booking**: no stage moves,
   * no shipment is created; the lot simply appears on the Logistics board's "assigned test lots"
   * queue for that desk to pick up. Idempotent — assigning twice changes nothing. The click does
   * **complete the `ASSIGNED_TO_LOGISTICS` stage**, which is the end of the chain.
   */
  assignLotToLogistics: (orderId: string, lotId: string) => void;
  logInvoiceAccess: (orderId: string, lotId: string, action: "VIEW" | "DOWNLOAD") => void;
  fetchWhlReport: (orderId: string, lotId: string) => void;           // pull (or revise) the report + parse it on screen
  requestWhlUpdate: (orderId: string, lotId: string) => void;         // pre-mapped outbound chase
  sendLabEmail: (orderId: string, m: { lotId?: string; subject: string; body: string }) => void;
  syncWhlInbox: (orderId: string) => void;                            // inbound status mails → test statuses / reports
  matchLabEmail: (orderId: string, emailId: string, lotId: string) => void; // resolve the manual-match queue
  escalateLabEmail: (orderId: string, emailId: string) => void;
  logReportAccess: (orderId: string, lotId: string, reportId: string, action: "VIEW" | "DOWNLOAD") => void;
  reconcileReportPo: (orderId: string, lotId: string, reportId: string) => void;
  // circulate a lot's result: supplier / buyer (masked from each other) / escrow / lab
  notifyLotResult: (orderId: string, lotId: string, m: { party: NotifyParty; to: string; subject: string; body: string; attachReport: boolean }) => void;
  // one digest mail covering many lots - logged against every lot it covered
  notifyLotsResult: (orderId: string, lotIds: string[], m: { party: NotifyParty; to: string; subject: string; body: string; attachReports: boolean }) => void;

  addSourcingAllocation: (orderId: string, a: { orderLineId: string; orderLineMpn: string; clientPoNo: string; clientLineMpn: string; qty: number; marginPct: number }) => boolean;

  simulateEscrowInvoiceEmail: (orderId: string) => void; // Escrow Agent adapter — poll the provider inbox
  uploadEscrowInvoiceManually: (orderId: string, input: { invoiceNo: string; fees: EscrowFeeBreakdown; conditions: EscrowConditions }) => void;
  cancelEscrowOrder: (orderId: string) => void; // allowed any time before RELEASED_TO_SELLER (real HKin evidence)
  // Launches the hkin-rpa RPA (escrow-agents' /create-on-hkin) to fill HKin's real order-creation
  // form from this order's existing buyer/seller/recipient/lines — the very first Escrow-tab action,
  // before any of the email-action-library steps below. Stops at HKin's own Confirmation screen for
  // a human to review + submit; this only starts it, never waits for that human step.
  createHkinOrder: (orderId: string) => void;
  // Real HKin portal evidence (2026-08-12 session) — see Escrow's fields in @/types for the write-up.
  markEscrowApplicationRejected: (orderId: string) => void;
  recordEscrowRma: (orderId: string, input: { rmaDetails?: string; goodsReturnTracking?: string; markReturned?: boolean }) => void;
  acceptEscrowGoods: (orderId: string, input: { partial?: boolean; note?: string; amount?: number }) => void;
  rejectEscrowGoods: (orderId: string, reason: string, reportFileName?: string) => void;
  requestEscrowExtension: (orderId: string, reason: string, days: number) => void;
  // Demo/dev button — simulates HKin's real deadline-reminder email arriving (an independent
  // signal, not something Check inbox's awaiting-purpose mechanism can produce on its own).
  simulateEscrowDeadlineReminder: (orderId: string) => void;

  simulateEscrowPoPiFetch: (orderId: string) => void;
  simulatePaymentClosureFetch: (orderId: string) => void;
  uploadPaymentClosureManually: (orderId: string, input: { documentNo: string; releasedAmount: number }) => void;

  // Email action library — every SENT email goes through a compose/review step in the UI first
  // (see EscrowEmailDraft); nothing here fires from a single click without a human seeing the draft.
  // Inbound mail is handled by escrow-agents' orchestrator, not chosen purpose-by-purpose from the
  // UI — checkEscrowInbox is the one "check inbox" action the UI calls (see src/lib/escrow-api.ts).
  checkEscrowInbox: (orderId: string) => void;
  // Real-mailbox sync — for use after scripts/poll_gmail_inbox.py has already ingested a genuine
  // inbound email (invoice/WHL-report/finance-confirmation) into escrow-agents. Unlike
  // checkEscrowInbox, this never fabricates anything — it only ticks the real backend so the
  // orchestrator can react to what's already on file.
  syncRealInbox: (orderId: string) => void;
  recordWhlVerdict: (orderId: string, verdict: WhlVerdict) => void; // real-world lab outcome — the one thing a human still has to report, not "receive"
  sendEscrowEmail: (orderId: string, purpose: EscrowSendPurpose, draft: EscrowEmailDraft, milestoneIndex?: number) => void;

  addPayment: (orderId: string, p: { direction: PaymentDirection; mode: PaymentMode; amount: number; triggerDoc: string; dueDate?: string }) => void;
  setPaymentStatus: (orderId: string, payId: string, status: PaymentStatus, attachment?: string) => void;
  initiatePaymentTransfer: (orderId: string, payId: string) => void; // banking adapter - T/T

  createShipment: (orderId: string, s: { leg: ShipmentLeg; carrier: string; fromLocation: string; toLocation: string; boxCount: number; grossWeightKg: number; lines: { mpn: string; qty: number }[]; awb?: string; dimensions?: string; goodsDescription?: string; hsCode?: string; declaredValue?: number; declaredCurrency?: string; pickupReadyDate?: string; bookingDocs?: string[]; packages?: ShipmentPackage[]; notifyCustomsBoe?: boolean; productCode?: string; productName?: string; rateAmount?: number; rateCurrency?: string; estimatedDelivery?: string; bookingMode?: "COMBINED" | "SEPARATE"; pickupDate?: string; pickupCloseTime?: string }) => string | null;
  // Pre-booking: ask the supplier for the Packing List / Commercial Invoice / COO, then parse the reply.
  requestShippingDocs: (orderId: string, body?: string) => void;
  receiveShippingDocs: (orderId: string) => void;
  setShipmentStatus: (orderId: string, shipId: string, status: ShipmentStatus) => void;
  pollShipmentTracking: (orderId: string, shipId: string) => void; // logistics adapter - advance from carrier tracking
  reschedulePickup: (orderId: string, shipId: string, date: string, closeTime: string) => void;
  cancelPickup: (orderId: string, shipId: string) => void;
  retrieveCarrierDocs: (orderId: string, shipId: string) => void; // DHL /invoices → waybill + CI
  correctCarrierInvoice: (orderId: string, shipId: string) => void; // DHL /upload-image

  // ICEGATE core clearance stepper: file → assess → pay duty → out-of-charge.
  fileBOE: (orderId: string, e: { shipmentNo: string; portCode: string; chaName: string; assessableValue: number; boeType: "PRIOR" | "ON_ARRIVAL"; docs?: string[]; awb?: string; mode: "ICEGATE" | "CHA" }) => void;
  sendAwbToCha: (orderId: string, customsId: string) => void;
  linkIgm: (orderId: string, customsId: string) => void;
  assessCustoms: (orderId: string, customsId: string) => void;
  respondCustomsQuery: (orderId: string, customsId: string) => void;
  payCustomsDuty: (orderId: string, customsId: string, invoice?: string) => void;
  clearCustoms: (orderId: string, customsId: string) => void;

  allocateDelivery: (orderId: string, a: { fromShipmentNo: string; clientPoNo: string; clientLineMpn: string; qty: number }) => boolean;
  recordPoD: (orderId: string, deliveryId: string) => void;
  /** The warehouse counts the consignment in and issues its receipt. */
  issueGrn: (orderId: string, lines: { mpn: string; expectedQty: number; receivedQty: number }[], discrepancy?: string) => void;
  /** The carrier's proof of delivery for the inbound leg. With the GRN, this is what makes the order delivered. */
  recordInboundPod: (orderId: string, podRef?: string) => void;

  // ---- logistics desk correspondence + outbound documents ----
  sendLogisticsMessage: (orderId: string, m: { toEmail: string; withParty?: LogisticsParty; subject: string; body: string; cc?: string[]; bcc?: string[]; categories?: string[]; threadId?: string }) => void;
  /** Poll for replies to whatever we sent and have not heard back on. */
  checkLogisticsInbox: (orderId: string) => void;
  /** Produce one of the desk's own documents and send it to its named recipients in one act. */
  createLogisticsDoc: (orderId: string, doc: { docId: string; name: string; to: LogisticsParty[]; body: string }) => void;
  /** Demo: load a realistic mid-flow inbound state onto this order — cleared customs, at the door of delivery — so the end-to-end flow can be read and then finished by hand. */
  seedLogisticsDemo: (orderId: string) => void;
  /** Demo: strip this order's inbound flow back to the start, to run the whole journey by hand. */
  resetLogisticsFlow: (orderId: string) => void;
  /** Demo: load a realistic mid-flight testing state — one lot passed and reported, one still on the bench. */
  seedTestingDemo: (orderId: string) => void;
  /** Demo: strip this order's testing back to the start, before any slot is booked. */
  resetTestingFlow: (orderId: string) => void;
  /** File a thread email under its set of categories — several at once is the point; empty means Others. */
  setLogisticsEmailCategories: (orderId: string, itemId: string, categories: string[]) => void;

  generateEInvoice: (orderId: string) => void; // GST e-Invoice / IRP adapter
  cancelOrder: (orderId: string) => void;

  addEvent: (orderId: string, e: { eventType: string; message: string }) => void;
  addDocument: (orderId: string, d: { subjectType: string; docType: string; fileName: string }) => void;
  attachPI: (orderId: string, p: { piNo: string; fileName: string }) => void; // upload the supplier PI (received upstream) onto the order
  decideApproval: (orderId: string, approvalId: string, status: ApprovalState) => void;

  // ---- RFQ Module Actions ----
  createDemandLine: (input: { mpn: string; qty: number; targetPrice: number; currency: string; requiredByDate: string; source: string; clientPoId?: string; clientLineId?: string }) => string;
  createRfqBundle: (input: { demandLineIds: string[]; supplierEmails: string[]; deadline: string; dateToleranceDays: number }) => string | null;
  floatRfqToSuppliers: (bundleId: string) => Promise<boolean>;
  submitSupplierQuote: (input: { rfqBundleId: string; supplierEmail: string; lines: any[] }) => string | null;
  matchQuoteEmail: (bundleId: string, emailId: string, rfqLineId: string) => boolean;
  syncQuoteInbox: (bundleId: string) => Promise<{ matched: number; unmatched: number }>;
  createClientQuoteDecision: (input: { rfqBundleId: string; selectedQuoteLineIds: string[]; markupPercent: number }) => string | null;
  submitQuoteForApproval: (bundleId: string) => string;
  submitCounterOffer: (bundleId: string, quoteLineId: string, price: number, notes?: string) => boolean;
  recordSupplierCounter: (bundleId: string, quoteLineId: string, price: number) => void;
  requestQuoteClarification: (bundleId: string, quoteLineId: string, ambiguityType: string) => Promise<void>;
  sendClientQuote: (bundleId: string) => Promise<boolean>;
  acceptClientQuote: (clientQuoteId: string) => Promise<void>;
  declineClientQuote: (clientQuoteId: string) => void;
  requestQuoteChanges: (clientQuoteId: string, notes: string) => void;
  recordSellerPi: (supplierQuoteId: string, piNo: string) => void;
  finalizeRfqToSupplierPos: (bundleId: string) => { poIds: string[]; pending: string[] } | null;

  approveQuoteDecision: (decisionId: string) => Promise<void>;
  rejectQuoteDecision: (decisionId: string, reason: string) => void;
  resendSupplierInvite: (bundleId: string, inviteId: string) => Promise<boolean>;
  markInviteViewed: (bundleId: string, portalToken: string) => void;
  askSupplierQuestion: (bundleId: string, portalToken: string, question: string) => void;
  answerSupplierQuestion: (bundleId: string, inviteId: string, questionId: string, answer: string) => void;
}

// Legacy escrow shapes carried a plain buyerEntity/sellerEntity string instead of a full contact
// card, and an older reworkRounds/superInvoice-era shape before the email-action-library rebuild.
type LegacyEscrow = Partial<Escrow> & { buyerEntity?: string; sellerEntity?: string; reworkRounds?: number };

function normalizeContact(raw: unknown, fallbackCompany = "—"): EscrowContact {
  const r = (raw ?? {}) as Partial<EscrowContact>;
  return {
    company: r.company ?? fallbackCompany,
    registeredAddress: r.registeredAddress ?? "—",
    country: r.country ?? "—",
    contactPerson: r.contactPerson ?? "—",
    email: r.email ?? "—",
    phone: r.phone ?? "—",
    im: r.im ?? "—",
  };
}

/** Guarantee every array/contact field exists — tolerates older persisted shapes (schema drift). */
function normalizeBundle(raw: unknown): OrderBundle {
  const b = (raw ?? {}) as Partial<OrderBundle>;
  const legacyEscrow = b.escrow as unknown as LegacyEscrow | undefined;
  return {
    ...b,
    lines: b.lines ?? [],
    journey: b.journey ?? [],
    lots: (b.lots ?? []).map((l) => ({ ...l, tests: l.tests ?? [], reports: l.reports ?? [], notifications: l.notifications ?? [] })),
    mpnTests: (b.mpnTests ?? []).map((s) => ({ ...s, tests: s.tests ?? [], audit: s.audit ?? [] })),
    labEmails: b.labEmails ?? [],
    payments: b.payments ?? [],
    shipments: b.shipments ?? [],
    customs: b.customs ?? [],
    deliveries: b.deliveries ?? [],
    sourcingAllocations: b.sourcingAllocations ?? [],
    documents: b.documents ?? [],
    approvals: b.approvals ?? [],
    events: b.events ?? [],
    escrow: legacyEscrow ? {
      ...legacyEscrow,
      status: legacyEscrow.status ?? "DRAFT",
      buyerContact: normalizeContact(legacyEscrow.buyerContact, legacyEscrow.buyerEntity),
      sellerContact: normalizeContact(legacyEscrow.sellerContact, legacyEscrow.sellerEntity),
      recipient: normalizeContact(legacyEscrow.recipient),
      poAmount: legacyEscrow.poAmount ?? 0,
      currency: legacyEscrow.currency ?? "USD",
      useInspectionService: legacyEscrow.useInspectionService ?? false,
      agreedFeeToBuyer: legacyEscrow.agreedFeeToBuyer ?? 0,
      milestoneReleases: legacyEscrow.milestoneReleases ?? [],
      agentEmails: (legacyEscrow.agentEmails ?? []).map((m) => ({ ...m, direction: m.direction ?? "RECEIVED" })),
    } as Escrow : undefined,
  } as OrderBundle;
}

const seed = freshSeed();

export const useStore = create<Store>()(
  persist(
    immer((set, get) => ({
      orders: seed.orders,
      clientPos: seed.clientPos,
      supplierPos: seed.supplierPos,
      demandLines: seed.demandLines,
      rfqBundles: seed.rfqBundles,
      supplierQuotes: seed.supplierQuotes,
      clientQuoteDecisions: seed.clientQuoteDecisions,
      clientQuotes: seed.clientQuotes,
      quoteEmails: seed.quoteEmails,

      resetDemo: () => {
        const s = freshSeed();
        set((st) => {
          st.orders = s.orders; st.clientPos = s.clientPos; st.supplierPos = s.supplierPos;
          st.demandLines = s.demandLines; st.rfqBundles = s.rfqBundles; st.supplierQuotes = s.supplierQuotes;
          st.clientQuoteDecisions = s.clientQuoteDecisions; st.clientQuotes = s.clientQuotes; st.quoteEmails = s.quoteEmails;
        });
        toast.success("Demo data reset");
      },

      createClientPo: (input) => {
        const st = get();
        let clientPoNo = input.clientPoNo.trim();
        if (clientPoNo && st.clientPos.some((c) => c.clientPoNo === clientPoNo)) {
          toast.error(`Sales Order ${clientPoNo} already exists - use a unique number.`);
          return "";
        }
        if (!clientPoNo) { // collision-safe fallback
          let n = st.clientPos.length + 1;
          while (st.clientPos.some((c) => c.clientPoNo === `CPO-${n}`)) n++;
          clientPoNo = `CPO-${n}`;
        }
        const cpo: ClientPO = {
          id: uid("cpo"), clientPoNo, client: { name: input.clientName || "-", country: "-", gstin: input.clientGstin, state: input.clientState },
          paymentMode: input.paymentMode, status: "RECEIVED", terms: input.terms, deliveryAddress: input.deliveryAddress,
          lines: input.lines.map((l) => ({ mpn: l.mpn, make: l.make, dateCode: l.dateCode, qty: l.qty, unitPrice: l.unitPrice, requiredBy: l.requiredBy, status: "OPEN" })),
        };
        set((s) => { s.clientPos.unshift(cpo); });
        toast.success(`Sales Order ${clientPoNo} created`);
        return clientPoNo;
      },

      // STEP 2 - create the Supplier PO document (no fulfilment order yet)
      createSupplierPo: (input) => {
        const st = get();
        if (input.lines.length === 0) { toast.error("Add at least one line."); return null; }
        if (input.lines.some((l) => l.qty <= 0 || !l.mpn.trim())) { toast.error("Every line needs an MPN and qty."); return null; }
        const linked = input.lines.filter((l) => l.clientPoNo && l.clientLineMpn);
        // coverage guard for LINKED lines: committed-so-far (all supplier POs) + this draft ≤ client demand
        const draft = new Map<string, number>();
        for (const l of linked) { const k = `${l.clientPoNo}|${l.clientLineMpn}`; draft.set(k, (draft.get(k) ?? 0) + l.qty); }
        for (const [k, q] of draft) {
          const [poNo, mpn] = k.split("|");
          const demand = st.clientPos.find((c) => c.clientPoNo === poNo)?.lines.find((l) => l.mpn === mpn)?.qty ?? 0;
          const already = sourcedForClientLine(st.supplierPos, st.orders, poNo, mpn);
          if (already + q > demand) { toast.error(`${mpn} · ${poNo} exceeds remaining to source (${Math.max(0, demand - already)}).`); return null; }
        }
        const id = uid("spo");
        const poNo = `SPO-2026-0${201 + st.supplierPos.length}`;
        const created = today();
        const buyTotal = input.lines.reduce((a, l) => a + l.qty * l.buyUnitPrice, 0);
        const spo: SupplierPO = {
          id, poNo,
          supplier: { name: input.supplier || "-", country: input.supplierCountry || "-", gstin: input.supplierGstin, state: input.supplierState },
          tradeType: input.tradeType, currency: input.currency, incoterm: input.incoterm, paymentMode: input.sellerPaymentMode,
          testing: input.testing, leadTimeDays: input.lead, testingTimeDays: input.testDays, deliveryTimeDays: input.delivery,
          terms: input.terms, creditDays: input.creditDays, termsConditions: input.termsConditions, relabelCost: input.relabelCost,
          lines: input.lines.map((l) => ({ mpn: l.mpn, make: l.make, dateCode: l.dateCode, testing: l.testing, qty: l.qty, buyUnitPrice: l.buyUnitPrice, marginPct: l.marginPct, clientPoNo: l.clientPoNo, clientLineMpn: l.clientLineMpn })),
          buyTotal: Math.round(buyTotal), createdBy: "You (demo)", createdAt: created, status: "DRAFT",
        };
        set((s) => { s.supplierPos.unshift(spo); });
        toast.success(`Purchase Order ${poNo} created${linked.length < input.lines.length ? " - some lines unlinked" : ""}`);
        return id;
      },

      // STEP 3 - select a Supplier PO and spin up its fulfilment order (the journey)
      createOrderFromSupplierPo: (supplierPoId) => {
        const st = get();
        const spo = st.supplierPos.find((s) => s.id === supplierPoId);
        if (!spo) { toast.error("Purchase Order not found."); return null; }
        if (spo.orderId && st.orders[spo.orderId]) { toast(`Order already created for ${spo.poNo}`); return spo.orderId; }
        const linked = spo.lines.filter((l) => l.clientPoNo && l.clientLineMpn);
        const sellFor = (l: SupplierPoLine) =>
          l.clientPoNo && l.clientLineMpn ? (st.clientPos.find((c) => c.clientPoNo === l.clientPoNo)?.lines.find((x) => x.mpn === l.clientLineMpn)?.unitPrice ?? l.buyUnitPrice) : l.buyUnitPrice;
        const clientNames = new Set(linked.map((l) => st.clientPos.find((c) => c.clientPoNo === l.clientPoNo)?.client.name ?? "-"));
        const buyerName = clientNames.size === 0 ? "Unlinked (map later)" : clientNames.size === 1 ? [...clientNames][0] : "Multiple clients";
        // per-line testing (fallback to the PO default); the order's summary mode drives the journey label + A19 customs
        const lineTesting = (l: SupplierPoLine): TestingMode => l.testing ?? spo.testing;
        const aggTesting: TestingMode = spo.lines.some((l) => lineTesting(l) === "WHL") ? "WHL"
          : spo.lines.some((l) => lineTesting(l) === "SUPPLIER_SELF") ? "SUPPLIER_SELF" : "NONE";
        const buyerAddr = linked.length ? st.clientPos.find((c) => c.clientPoNo === linked[0].clientPoNo)?.deliveryAddress : undefined;
        const id = uid("ord");
        // Next order number = one above the highest existing (seeds run up to 202). The old
        // `156 + count` collided with seeded numbers (180–202) once the order count landed there,
        // producing two different orders that print the same ORD-2026-000xxx.
        const no = Math.max(202, ...Object.values(st.orders).map((o) => parseInt(o.orderNo.match(/(\d+)$/)?.[1] ?? "0", 10) || 0)) + 1;
        const created = today();
        const dispatch = addDays(created, spo.leadTimeDays + spo.testingTimeDays);
        const delivery = addDays(dispatch, spo.deliveryTimeDays);
        const buyTotal = spo.lines.reduce((a, l) => a + l.qty * l.buyUnitPrice, 0);
        const sellTotal = spo.lines.reduce((a, l) => a + l.qty * sellFor(l), 0);
        const order: Order = {
          id, orderNo: `ORD-2026-000${no}`, operatingMode: "MOR", tradeType: spo.tradeType,
          status: "ACTIVE", approvalStatus: "APPROVED", // approved upstream on the sourcing platform
          buyer: { name: buyerName, country: "-" }, supplier: spo.supplier,
          maskingEntity: "Sharpbuy Global Solutions", currency: spo.currency, incoterm: spo.incoterm,
          paymentMode: spo.paymentMode, leadTimeDays: spo.leadTimeDays, testingTimeDays: spo.testingTimeDays,
          deliveryTimeDays: spo.deliveryTimeDays, testingMode: aggTesting,
          expectedDispatchDate: dispatch, expectedDeliveryDate: delivery,
          requiredBy: addDays(delivery, 3), buyTotal: Math.round(buyTotal), sellTotal: Math.round(sellTotal),
          createdBy: "You (demo)", createdAt: created, terms: spo.terms, supplierPoId: spo.id, supplierPoNo: spo.poNo,
          hubAddress: ONEBUY_HUB, buyerAddress: buyerAddr,
          creditDays: spo.creditDays, termsConditions: spo.termsConditions, relabelCost: spo.relabelCost,
        };
        const dcOf = (l: SupplierPoLine) => l.dateCode
          ?? (l.clientPoNo && l.clientLineMpn ? st.clientPos.find((c) => c.clientPoNo === l.clientPoNo)?.lines.find((x) => x.mpn === l.clientLineMpn)?.dateCode : undefined)
          ?? "-";
        const orderLines: OrderLine[] = spo.lines.map((l, i) => {
          const t = lineTesting(l);
          return {
            id: uid("l"), lineNo: i + 1, mpn: l.mpn, make: l.make ?? "-", description: l.clientPoNo ? `For ${l.clientPoNo}` : "Unlinked - map later", hsnCode: "-",
            quantity: l.qty, unitPrice: l.buyUnitPrice, currency: spo.currency, dateCode: dcOf(l),
            coo: spo.tradeType === "INTERNATIONAL" ? "-" : "IN", testingRequired: t !== "NONE",
            testingMode: t, componentCategory: "-", lab: t === "WHL" ? "WHL Shenzhen" : undefined,
          };
        });
        const bundle = scaffoldBundle(order, orderLines, `Order created from ${spo.poNo} - ${spo.lines.length} line(s)${linked.length ? `, ${linked.length} linked` : " (unlinked - map later)"}.`);
        spo.lines.forEach((l, i) => {
          if (l.clientPoNo && l.clientLineMpn) bundle.sourcingAllocations.push({ id: uid("sa"), orderLineId: orderLines[i].id, clientPoNo: l.clientPoNo, clientLineMpn: l.clientLineMpn, orderLineMpn: l.mpn, qty: l.qty, marginPct: l.marginPct });
        });
        const t = spo.terms;
        if (t) {
          const bits = [t.paymentMethod, t.deliveryTerms, t.dateCode && `date code ${t.dateCode}`, t.warranty && `warranty ${t.warranty}`, t.packing].filter(Boolean);
          if (bits.length) bundle.events.unshift({ id: uid("ev"), eventType: "SUPPLIER_NOTE", message: `Terms: ${bits.join(" · ")}`, source: "SC_MANUAL", occurredAt: created, recordedBy: "You (demo)" });
        }
        // fulfilment starts here: step 0 (received) done, step 1 (first fulfilment gate) in progress
        bundle.journey.forEach((s, i) => { s.status = i === 0 ? "DONE" : i === 1 ? "IN_PROGRESS" : "PENDING"; });
        // non-escrow orders collect from the client and pay the supplier via T/T - seed both tasks so the payment gates are immediately actionable
        if (order.paymentMode !== "ESCROW") {
          // CREDIT terms have a real due date (days from order creation); ADVANCE is due now, so no countdown applies
          const dueDate = order.paymentMode === "CREDIT" ? addDays(created, order.creditDays ?? 30) : undefined;
          bundle.payments.push(
            { id: uid("pay"), direction: "CLIENT_TO_1BUY", mode: order.paymentMode, triggerDoc: "Our PI", amount: order.sellTotal, currency: order.currency, status: "PENDING", dueDate },
            { id: uid("pay"), direction: "1BUY_TO_SUPPLIER", mode: order.paymentMode, triggerDoc: "Supplier PI", amount: order.buyTotal, currency: order.currency, status: "PENDING", dueDate },
          );
        }
        set((s) => {
          s.orders[id] = bundle;
          const target = s.supplierPos.find((x) => x.id === supplierPoId);
          if (target) { target.status = "ORDERED"; target.orderId = id; }
        });
        toast.success(`Order ${order.orderNo} created from ${spo.poNo} - ready for fulfilment`);
        // Register the matching escrow order with escrow-agents in the background — the local
        // `bundle.escrow` above is still what renders immediately; this just gives the real
        // backend a row to track state in from here on. Failure (e.g. backend not running) is
        // swallowed, not surfaced — escrow just won't be backend-driven for this order yet, and
        // every escrow action already handles that gracefully via its own try/catch.
        if (bundle.escrow && !isEscrowMockMode()) {
          const esc = bundle.escrow;
          void createEscrowOrder({
            orderId: id, poAmount: esc.poAmount, currency: esc.currency, useInspectionService: esc.useInspectionService,
            agreedFeeToBuyer: esc.agreedFeeToBuyer,
            buyerContact: esc.buyerContact, sellerContact: esc.sellerContact, recipient: esc.recipient,
          }).catch(() => {});
        }
        return id;
      },

      advanceStep: (orderId) => {
        const b = get().orders[orderId]; if (!b) return;
        const idx = b.journey.findIndex((x) => x.status === "IN_PROGRESS" || x.status === "BLOCKED");
        if (idx < 0) return;
        const step = b.journey[idx];
        const reason = gateReason(b, step);
        if (reason) {
          set((s) => { const bb = s.orders[orderId]; if (bb) { bb.journey[idx].status = "BLOCKED"; if (bb.status === "ACTIVE") bb.status = "ON_HOLD"; } });
          toast.error(`Blocked: ${reason}`);
          return;
        }
        set((s) => {
          const bb = s.orders[orderId]; if (!bb) return;
          bb.journey[idx].status = "DONE";
          if (idx + 1 < bb.journey.length) bb.journey[idx + 1].status = "IN_PROGRESS";
          else bb.status = "CLOSED";
          if (bb.status === "ON_HOLD") bb.status = "ACTIVE";
          autoAdvanceOperational(bb); // cascade through any now-satisfied operational steps
        });
        toast.success(`Step done: ${step.name}`);
      },

      addStep: (orderId, step) => { set((s) => {
        const b = s.orders[orderId]; if (!b) return;
        const seq = b.journey.reduce((m, x) => Math.max(m, x.seq), 0) + 1;
        b.journey.push({ id: uid("j"), seq, phase: step.phase as JourneyPhase, name: step.name, owner: step.owner, isGate: step.isGate, status: "PENDING" });
      }); toast.success("Step added"); },

      markRelabelled: (orderId) => {
        set((s) => { const b = s.orders[orderId]; if (b) { b.relabelledAt = today(); autoAdvanceOperational(b); } });
        toast.success("Goods marked as received at 1Buy");
      },

      // Manual confirmation, like markRelabelled above — this app can't observe the physical
      // handoff back to the supplier itself, so an operator confirms it happened.
      markTestingReturnedToSupplier: (orderId) => {
        set((s) => { const b = s.orders[orderId]; if (b) b.whlReturnedToSupplierAt = today(); });
        toast.success("Goods marked as returned to the supplier after testing");
      },

      addLot: (orderId, lot) => {
        const lotId = uid("lot");
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          b.mpnTests ??= [];
          let spec = b.mpnTests.find((x) => x.mpn === lot.orderLineMpn);

          // a plan typed on the form is the operator's own: record it as the MPN's requirements
          // too, so the lot's tracker and the MPN's spec can't drift apart
          if (lot.tests?.length) {
            const doc = `Entered by hand with lot ${lot.lotCode}`;
            if (!spec) {
              spec = {
                id: uid("spec"), mpn: lot.orderLineMpn, autofill: "OK", sourceDoc: doc,
                parsedAt: stamp(), tests: [], audit: [],
              };
              b.mpnTests.push(spec);
            }
            for (const t of lot.tests) {
              if (spec.tests.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) continue;
              const reqId = uid("req");
              spec.tests.push({ id: reqId, name: t.name, standard: t.standard, source: "MANUAL", addedBy: ME, addedAt: stamp() });
              spec.audit.push(auditRow({
                by: ME, action: "ADD", target: t.name, before: "-",
                after: `manual test${t.standard ? ` (${t.standard})` : ""}`,
                note: `Typed on the Add-lot form for ${lot.lotCode}.`,
              }));
            }
          }

          // the lot's tracker: the plan just typed, else whatever the MPN's spec already carries
          const source = lot.tests?.length
            ? lot.tests.map((t) => ({ ...(spec!.tests.find((x) => x.name.toLowerCase() === t.name.toLowerCase())!) }))
            : (spec?.tests ?? []);
          const tests: LotTest[] = source.map((t) => ({
            id: uid("lt"), requirementId: t.id, name: t.name, standard: t.standard, source: t.source, status: "PENDING",
            history: [auditRow({ by: ME, action: "STATUS", target: t.name, after: "PENDING", note: `${lot.tests?.length ? "Entered by hand" : `Inherited from ${spec?.sourceDoc ?? "the MPN's plan"}`} when lot ${lot.lotCode} was raised.` })],
          }));
          const clientPoNo = b.sourcingAllocations.find((a) => a.orderLineMpn === lot.orderLineMpn)?.clientPoNo;
          b.lots.push({
            id: lotId, orderLineMpn: lot.orderLineMpn, lotCode: lot.lotCode, dateCode: lot.dateCode, qty: lot.qty,
            sampleQty: lot.sampleQty, testStatus: "PENDING", lab: lot.lab, clientPoNo, tests, reports: [],
          });
        });
        toast.message("Lot added - submitting to WHL…");
        // WHL adapter: register the test job, stamp the work-order no back onto the lot
        void (async () => {
          try {
            const wo = await whlSubmitTestJob({ clientRef: `${orderId}:${lot.lotCode}`, mpn: lot.orderLineMpn, dateCode: lot.dateCode, lotCode: lot.lotCode, lotQty: lot.qty, sampleQty: lot.sampleQty, testPlan: "AS6081", labSite: lot.lab?.includes("Hong") ? "HONGKONG" : "SHENZHEN" });
            set((s) => {
              const l = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (!l) return;
              l.workOrderNo = wo.workOrderNo; l.tatDays = wo.estimatedTatDays; l.lab = lot.lab ?? "WHL Shenzhen";
              moveStage(l, "TEST_BOOKED", ME, { note: `Test slot booked with ${l.lab} — work order ${wo.workOrderNo}, quoted TAT ${wo.estimatedTatDays} days.` });
            });
            toast.success(`WHL work order ${wo.workOrderNo}`);
          } catch (e) { toast.error(`WHL: ${errMsg(e)}`); }
        })();
      },
      setLotStatus: (orderId, lotId, status) => {
        // The verdict is a call on the *result*, not a lifecycle move — the chain ends when
        // the report arrives, which any lot with a verdict has already passed.
        set((s) => {
          const l = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (!l) return;
          l.testStatus = status; l.testedAt = today();
        });
        if (status === "PASS") toast.success("Lot PASSED — you can release the escrow tranche");
        else if (status === "FAIL") toast.error("Lot FAILED — start the return / refund path");
        else toast(`Lot set ${status}`);
      },
      fetchLabResult: (orderId, lotId) => {
        const lot = get().orders[orderId]?.lots.find((x) => x.id === lotId);
        if (!lot) return;
        if (!lot.workOrderNo) { toast.error("No WHL work order yet for this lot."); return; }
        toast.message("Fetching WHL report…");
        void (async () => {
          try {
            const rep = await whlPollTestReport(lot.workOrderNo!);
            if (rep.status !== "COMPLETED" || !rep.verdict) { toast("WHL still in progress - try again shortly."); return; }
            const st = mapVerdict(rep.verdict);
            set((s) => { const l = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (l) { l.testStatus = st; l.reportNo = rep.reportNo; l.tatDays = rep.tatDays; l.testedAt = today(); } });
            if (st === "PASS") toast.success(`WHL PASS - report ${rep.reportNo}`);
            else if (st === "FAIL") toast.error(`WHL FAIL - report ${rep.reportNo}`);
            else toast(`WHL inconclusive - report ${rep.reportNo}`);
          } catch (e) { toast.error(`WHL: ${errMsg(e)}`); }
        })();
      },

      // ---- WHL testing platform ----------------------------------------------------
      // Test requirements already exist in the PO, so they're parsed from it rather than
      // typed. An MPN whose table can't be read is flagged for manual review, never blank.
      uploadBookingAppointment: async (orderId, file, lotId) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const target = lotId ? b0.lots.find((l) => l.id === lotId) : undefined;
        if (lotId && !target) return;
        // scoped to one lot ⇒ only that lot's own line goes to the parser, so a re-read can
        // never invent lots for lines nobody has booked yet
        const lines = (target ? b0.lines.filter((l) => l.mpn === target.orderLineMpn) : b0.lines)
          .map((l) => ({ mpn: l.mpn, qty: l.quantity, testingMode: l.testingMode }));
        if (!lines.some((l) => l.testingMode !== "NONE")) {
          toast.error(target
            ? `${target.lotCode}'s line needs no incoming test, so there is nothing to book.`
            : "No line on this order needs testing, so there is nothing to book.");
          return;
        }
        const fileName = file?.name ?? `booking-appointment-${b0.orderNo}.pdf`;
        toast.message(file ? `Reading ${file.name}…` : "Filling from a sample booking appointment…");

        let res;
        try {
          res = await extractBookingAppointment({
            fileName, bytesLen: file?.size ?? 0, orderNo: b0.orderNo,
            lab: target?.lab ?? b0.lots[0]?.lab, lines,
          });
        } catch (e) {
          toast.error(errMsg(e));
          return;
        }

        let createdLots = 0, updatedLots = 0, specCount = 0;
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          b.mpnTests ??= [];
          const doc = `Booking appointment ${res.appointmentNo}`;

          // scoped run: the appointment row for this lot — matched on its code, else on its MPN,
          // and its own lotCode wins so the row is applied to the lot the operator picked
          const rows = target
            ? res.lots
              .filter((r) => r.lotCode === target.lotCode || r.mpn === target.orderLineMpn)
              .slice(0, 1)
              .map((r) => ({ ...r, lotCode: target.lotCode }))
            : res.lots;

          for (const bl of rows) {
            // ---- the MPN's test plan, as the lab agreed to run it ----
            const prev = b.mpnTests.find((x) => x.mpn === bl.mpn);
            // a manual addition is a human correction, not appointment data — keep it across a re-read
            const manual = prev?.tests.filter((t) => t.source === "MANUAL") ?? [];
            const spec: MpnTestSpec = {
              id: prev?.id ?? uid("spec"), mpn: bl.mpn, autofill: "OK",
              autofillNote: undefined, sourceDoc: doc, parsedAt: stamp(), confidence: res.overallConfidence,
              tests: [
                ...bl.tests.map((t) => ({ id: uid("req"), name: t.name, standard: t.standard, source: "AUTO_BOOKING" as const })),
                ...manual,
              ],
              audit: [
                ...(prev?.audit ?? []),
                auditRow({
                  by: "Doc extraction (auto)", action: "AUTOFILL", target: bl.mpn,
                  before: prev ? `${prev.tests.length} test(s)` : "-",
                  after: `${bl.tests.length} test(s) from ${doc}`,
                  note: `Confidence ${Math.round(res.overallConfidence * 100)}%.`,
                }),
              ],
            };
            if (prev) Object.assign(prev, spec); else b.mpnTests.push(spec);
            specCount++;
            const effective = prev ?? spec;

            // ---- the lot itself: the appointment says which lots are going in ----
            const lotTests: LotTest[] = effective.tests.map((t) => ({
              id: uid("lt"), requirementId: t.id, name: t.name, standard: t.standard, source: t.source,
              status: "PENDING" as const,
              history: [auditRow({ by: "Doc extraction (auto)", action: "ADD", target: t.name, after: "PENDING", note: `Read off ${doc}.` })],
            }));
            const existing = b.lots.find((l) => l.lotCode === bl.lotCode || (l.orderLineMpn === bl.mpn && l.workOrderNo === bl.workOrderNo));
            if (existing) {
              // don't clobber a lot mid-flight: top up its tracker, refresh the booking facts
              existing.tests ??= [];
              for (const t of lotTests) if (!existing.tests.some((x) => x.name === t.name)) existing.tests.push(t);
              existing.workOrderNo ||= bl.workOrderNo;
              existing.tatDays ||= bl.estimatedTatDays;
              existing.lab ||= bl.lab;
              updatedLots++;
            } else {
              const lot: Lot = {
                id: uid("lot"), orderLineMpn: bl.mpn, lotCode: bl.lotCode, dateCode: bl.dateCode,
                qty: bl.qty, sampleQty: bl.sampleQty, testStatus: "PENDING",
                lab: bl.lab, workOrderNo: bl.workOrderNo, tatDays: bl.estimatedTatDays,
                clientPoNo: b.sourcingAllocations.find((a) => a.orderLineMpn === bl.mpn)?.clientPoNo,
                tests: lotTests, reports: [],
              };
              // the appointment IS the booking, so the lot starts at TEST_BOOKED
              moveStage(lot, "TEST_BOOKED", ME, {
                note: `Test slot booked with ${bl.lab} — appointment ${res.appointmentNo}, work order ${bl.workOrderNo}, quoted TAT ${bl.estimatedTatDays} days.`,
              });
              b.lots.push(lot);
              createdLots++;
            }
          }

          if (file) {
            b.documents.push({
              id: uid("doc"), subjectType: "ORDER", docType: "OTHER",
              fileName: file.name, uploadedBy: ME, uploadedAt: today(),
            });
          }
          b.events.unshift({
            id: uid("ev"), eventType: "GENERAL",
            message: `Booking appointment ${res.appointmentNo} (${res.lab}) read${file ? ` off ${file.name}` : " from a sample"}${target ? ` for ${target.lotCode}` : ""} — ${createdLots} lot(s) created, ${updatedLots} updated, ${specCount} test plan(s) filled.`,
            source: "WHL", occurredAt: today(), recordedBy: ME,
          });
        });

        toast.success(target
          ? `${res.appointmentNo} applied to ${target.lotCode} — test plan filled`
          : `${res.appointmentNo}: ${createdLots} lot(s) created${updatedLots ? `, ${updatedLots} updated` : ""} — test plans filled`);
      },

      addMpnTest: (orderId, mpn, t) => {
        if (!t.name.trim()) return;
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          b.mpnTests ??= [];
          let spec = b.mpnTests.find((x) => x.mpn === mpn);
          if (!spec) { spec = { id: uid("spec"), mpn, autofill: "PENDING", tests: [], audit: [] }; b.mpnTests.push(spec); }
          if (spec.tests.some((x) => x.name.toLowerCase() === t.name.trim().toLowerCase())) return;
          const reqId = uid("req");
          spec.tests.push({ id: reqId, name: t.name.trim(), standard: t.standard, source: "MANUAL", addedBy: ME, addedAt: stamp() });
          spec.audit.push(auditRow({ by: ME, action: "ADD", target: t.name.trim(), before: "-", after: `manual test${t.standard ? ` (${t.standard})` : ""}`, note: "Manual override of the auto-filled list." }));
          if (spec.autofill === "FAILED") spec.autofill = "PENDING"; // reviewed by a human now
          for (const lot of b.lots.filter((l) => l.orderLineMpn === mpn)) {
            lot.tests ??= [];
            if (lot.tests.some((x) => x.name.toLowerCase() === t.name.trim().toLowerCase())) continue;
            lot.tests.push({ id: uid("lt"), requirementId: reqId, name: t.name.trim(), standard: t.standard, source: "MANUAL", status: "PENDING",
              history: [auditRow({ by: ME, action: "ADD", target: t.name.trim(), after: "PENDING", note: "Added manually to this lot's tracker." })] });
          }
        });
        toast.success(`Test added - ${t.name}`);
      },

      removeMpnTest: (orderId, mpn, testId) => {
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const spec = (b.mpnTests ?? []).find((x) => x.mpn === mpn); if (!spec) return;
          const t = spec.tests.find((x) => x.id === testId); if (!t) return;
          spec.tests = spec.tests.filter((x) => x.id !== testId);
          spec.audit.push(auditRow({ by: ME, action: "DELETE", target: t.name, before: `${t.source === "AUTO_BOOKING" ? "auto-filled" : "manual"} test`, after: "-", note: "Removed by operator." }));
          for (const lot of b.lots.filter((l) => l.orderLineMpn === mpn)) {
            const lt = (lot.tests ?? []).find((x) => x.name === t.name);
            if (lt) lot.tests = (lot.tests ?? []).filter((x) => x.id !== lt.id);
          }
        });
        toast.success("Test removed (logged)");
      },

      setLotTestStatus: (orderId, lotId, lotTestId, status, note) => {
        set((s) => {
          const lot = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (!lot) return;
          const t = (lot.tests ?? []).find((x) => x.id === lotTestId); if (!t) return;
          const before = t.status;
          if (before === status) return;
          t.status = status; t.updatedAt = stamp();
          t.history.push(auditRow({ by: ME, action: "STATUS", target: t.name, before, after: status, note: note ?? "Set manually." }));
        });
      },

      /**
       * The supplier tells us the parts are on their way to WHL. This is the one stage
       * no mail from the lab can establish — WHL only learns of the shipment when it
       * lands — so it's an explicit operator input, and it starts the lab-side clock.
       */
      recordSupplierDispatch: (orderId, lotId, d) => {
        let moved = false;
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const lot = b.lots.find((x) => x.id === lotId); if (!lot) return;
          lot.dispatch = { ...d, recordedBy: ME, recordedAt: stamp() };
          const detail = [d.courier, d.awb && `AWB ${d.awb}`, d.dispatchedOn && `dispatched ${d.dispatchedOn}`, d.expectedArrival && `ETA ${d.expectedArrival}`]
            .filter(Boolean).join(" · ");
          moved = moveStage(lot, "SUPPLIER_DISPATCHING", SUPPLIER_RELAY, {
            note: [detail || "Supplier confirmed dispatch to WHL.", d.note].filter(Boolean).join(" — "),
          });
          b.events.unshift({
            id: uid("ev"), eventType: "GENERAL",
            message: `${lot.lotCode} (${lot.orderLineMpn}) dispatched by the supplier to ${lot.lab ?? "WHL"}${detail ? ` — ${detail}` : ""}.`,
            source: "WHL", occurredAt: today(), recordedBy: ME,
          });
        });
        toast.success(moved ? "Dispatch recorded — waiting on WHL to confirm receipt" : "Dispatch details saved");
      },

      /**
       * Ask WHL for its testing invoice. Uses the same template source as the compose
       * modal, and starts the fee clock so the roll-up can chase it.
       */
      requestWhlInvoice: (orderId, lotId) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const lot = b0.lots.find((x) => x.id === lotId); if (!lot) return;
        const tpl = WHL_EMAIL_TEMPLATES.find((t) => t.id === "INVOICE_REQUEST"); if (!tpl) return;
        const ctx = {
          entity: b0.maskingEntity, mpn: lot.orderLineMpn, lotCode: lot.lotCode, dateCode: lot.dateCode,
          qty: lot.qty, sampleQty: lot.sampleQty, workOrderNo: lot.workOrderNo, clientPoNo: lot.clientPoNo, lab: lot.lab,
        };
        set((s) => {
          const l = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (!l) return;
          l.labPayment ??= { status: "NOT_REQUESTED" };
          // don't walk a received/paid invoice backwards just because we chased again
          if (l.labPayment.status === "NOT_REQUESTED") l.labPayment.status = "REQUESTED";
          l.labPayment.requestedAt = stamp();
        });
        get().sendLabEmail(orderId, { lotId, subject: tpl.subject(ctx), body: tpl.body(ctx) });
      },

      /**
       * The lab's invoice, entered by hand. The mail sync is the normal source, but a fee that
       * arrived by WhatsApp, on a call, or on a mail that never parsed still has to be payable —
       * without this the fee track dead-ends at "invoice requested" and, on advance terms, the
       * lot stays held with nothing anyone can do about it.
       *
       * The operator transcribes the lab's document; they don't invent its terms. That's why the
       * invoice records `source: "MANUAL"`, who entered it and how it arrived, and the UI labels
       * it as transcribed wherever the terms are shown.
       */
      uploadLabInvoiceFile: async (orderId, lotId, file) => {
        const lot0 = get().orders[orderId]?.lots.find((x) => x.id === lotId);
        if (!lot0) return;
        let parsed;
        try {
          parsed = await extractLabInvoice({
            fileName: file.name, bytesLen: file.size,
            workOrderNo: lot0.workOrderNo, lotCode: lot0.lotCode,
            processCount: lot0.tests?.length || undefined,
          });
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not read that file");
          return;
        }
        let replaced = false;
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const lot = b.lots.find((x) => x.id === lotId); if (!lot) return;
          lot.labPayment ??= { status: "NOT_REQUESTED" };
          replaced = !!lot.labPayment.invoice;
          lot.labPayment.invoice = {
            id: uid("inv"), invoiceNo: parsed.invoiceNo,
            amount: parsed.amount, taxAmount: parsed.taxAmount, currency: parsed.currency,
            // the operator's actual file name, so the document row points at what they uploaded
            fileName: file.name, receivedAt: stamp(), dueDate: parsed.dueDate,
            terms: parsed.terms, creditDays: parsed.terms === "CREDIT" ? parsed.creditDays : undefined,
            ratePerProcess: parsed.ratePerProcess, processCount: parsed.processCount,
            note: `Uploaded by hand from ${file.name} — fields read off the document.`,
            source: "MANUAL", enteredBy: ME, receivedVia: "uploaded PDF",
            accessLog: [],
          };
          // a paid fee stays paid; otherwise this invoice is now ours to settle
          if (lot.labPayment.status !== "PAID") lot.labPayment.status = "INVOICE_RECEIVED";
          b.documents.push({
            id: uid("doc"), subjectType: "LOT", docType: "WHL_INVOICE",
            fileName: file.name, uploadedBy: `${ME} (by hand)`, uploadedAt: today(),
          });
          b.events.unshift({
            id: uid("ev"), eventType: "GENERAL",
            message: `WHL testing invoice ${parsed.invoiceNo} uploaded by hand for ${lot.lotCode} (${lot.orderLineMpn}) — ${LAB_TERMS_LABEL[parsed.terms].toLowerCase()} terms, from ${file.name}.`,
            source: "WHL", occurredAt: today(), recordedBy: ME,
          });
        });
        toast.success(
          `${replaced ? "Invoice replaced" : "Invoice recorded"} — ${parsed.invoiceNo}, ${parsed.currency} ${(parsed.amount + parsed.taxAmount).toLocaleString()} on ${LAB_TERMS_LABEL[parsed.terms].toLowerCase()} terms`,
        );
      },

      draftTestSlotMail: (orderId, input) => {
        const b0 = get().orders[orderId];
        if (!b0) return { subject: "", body: "", slotNo: "" };
        return buildSlotMail(b0, input);
      },

      requestTestSlot: (orderId, input) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        if (input.lines.length === 0) { toast.error("Add at least one MPN to the booking request."); return; }
        const prior = input.retestOfSlotId ? (b0.testSlots ?? []).find((x) => x.id === input.retestOfSlotId) : undefined;
        const built = buildSlotMail(b0, input);
        const slotNo = built.slotNo;
        const emailId = uid("lm");
        const slotId = uid("slot");
        // the modal sends the reviewed draft; a caller without UI falls back to the generated one
        const subject = input.subject?.trim() || built.subject;
        const body = input.body ?? built.body;

        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          b.labEmails ??= [];
          b.testSlots ??= [];
          b.labEmails.unshift({
            id: emailId, direction: "OUT", subject, body,
            at: stamp(), by: ME, status: "AWAITING_RESPONSE", kind: "BOOKING_REQUEST",
            poNo: b.supplierPoNo,
          });
          b.testSlots.unshift({
            id: slotId, slotNo, lab: input.lab, status: "REQUESTED",
            preferredDate: input.preferredDate, lines: input.lines, note: input.note,
            requestedAt: stamp(), requestedBy: ME, requestEmailId: emailId,
            retestOfSlotId: prior?.id, retestOfSlotNo: prior?.slotNo, retestReason: input.retestReason,
          });
          b.events.unshift({
            id: uid("ev"), eventType: "GENERAL",
            message: `${prior ? "Re-test" : "Test"} slot ${slotNo} requested from ${input.lab} for ${input.lines.map((l) => l.mpn).join(", ")}${prior ? ` (re-test of ${prior.slotNo})` : ""}.`,
            source: "WHL", occurredAt: today(), recordedBy: ME,
          });
        });
        toast.success(`${slotNo} requested — awaiting ${input.lab}'s confirmation`);
      },

      markLotReturnedToSeller: (orderId, lotId) => {
        let moved = false, code = "";
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const lot = b.lots.find((x) => x.id === lotId); if (!lot) return;
          code = lot.lotCode;
          lot.returnedToSellerAt ??= stamp();
          lot.returnedToSellerBy ??= ME;
          moved = moveStage(lot, "RETURNED_TO_SELLER", ME, {
            note: `${lot.lab ?? "WHL"} returned the samples to the seller.`, manual: true,
          });
          if (moved) {
            b.events.unshift({
              id: uid("ev"), eventType: "GENERAL",
              message: `Test lot ${lot.lotCode} (${lot.orderLineMpn}) returned to the seller by ${lot.lab ?? "WHL"}.`,
              source: "WHL", occurredAt: today(), recordedBy: ME,
            });
          }
        });
        if (moved) toast.success(`${code} returned to seller`);
        else if (code) toast.message(`${code} is already past that stage`);
      },

      assignLotToLogistics: (orderId, lotId) => {
        let done = false, code = "";
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const lot = b.lots.find((x) => x.id === lotId); if (!lot) return;
          code = lot.lotCode;
          if (lot.logisticsAssignedAt) return;      // idempotent
          lot.logisticsAssignedAt = stamp();
          lot.logisticsAssignedBy = ME;
          done = true;
          // the click is the stage: this is the last node on the chain
          moveStage(lot, "ASSIGNED_TO_LOGISTICS", ME, {
            note: `Handed to the logistics desk — report ${currentReport(lot)?.reportNo ?? "—"} shared, goods cleared to move.`,
            manual: true,
          });
          b.events.unshift({
            id: uid("ev"), eventType: "GENERAL",
            message: `Test lot ${lot.lotCode} (${lot.orderLineMpn}) assigned to logistics — report ${currentReport(lot)?.reportNo ?? "—"} shared, goods ready to move.`,
            source: "WHL", occurredAt: today(), recordedBy: ME,
          });
        });
        if (done) toast.success(`${code} assigned to logistics`);
        else if (code) toast.message(`${code} is already assigned to logistics`);
      },

      /** Finance confirms the transfer — this is what closes the Payment-to-WHL stage. */
      markLabFeePaid: (orderId, lotId, d) => {
        let moved = false;
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const lot = b.lots.find((x) => x.id === lotId); if (!lot) return;
          const inv = lot.labPayment?.invoice;
          lot.labPayment ??= { status: "NOT_REQUESTED" };
          lot.labPayment.status = "PAID";
          lot.labPayment.paidAt = d.paidAt ?? stamp();
          lot.labPayment.paidRef = d.paidRef;
          if (d.note) lot.labPayment.note = d.note;
          // settleStage, not moveStage: the fee often clears after the chain has moved past
          // the payment node, and the row must survive that (see recordStageEvent)
          moved = settleStage(lot, "WHL_PAYMENT", ME, {
            note: `Testing fee paid${inv ? ` — invoice ${inv.invoiceNo}, ${inv.currency} ${(inv.amount + (inv.taxAmount ?? 0)).toLocaleString()}` : ""}${d.paidRef ? ` · ref ${d.paidRef}` : ""}.`,
            manual: true,
          });
          b.events.unshift({
            id: uid("ev"), eventType: "GENERAL",
            message: `WHL testing fee paid for ${lot.lotCode} (${lot.orderLineMpn})${inv ? ` — invoice ${inv.invoiceNo}` : ""}${d.paidRef ? ` · ref ${d.paidRef}` : ""}.`,
            source: "WHL", occurredAt: today(), recordedBy: ME,
          });
        });
        toast.success(moved ? "Fee paid — Payment to WHL recorded" : "Fee marked paid");
      },

      /** NDA-style access log on the invoice, mirroring the report's. */
      logInvoiceAccess: (orderId, lotId, action) => {
        set((s) => {
          const inv = s.orders[orderId]?.lots.find((x) => x.id === lotId)?.labPayment?.invoice; if (!inv) return;
          (inv.accessLog ??= []).unshift({ at: stamp(), by: ME, action });
        });
        if (action === "DOWNLOAD") toast.success("Invoice downloaded (logged)");
      },

      /** Manual stage correction — a phone call, or fixing a mis-step. Always logged. */
      setLotStage: (orderId, lotId, stage, note) => {
        set((s) => {
          const lot = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (!lot) return;
          const before = lotStage(lot);
          if (before === stage) return;
          const back = stageIdx(stage) < stageIdx(before);
          lot.stage = stage;
          (lot.stageHistory ??= []).push({
            id: uid("stg"), stage, at: stamp(), by: ME, manual: true,
            note: note ?? (back
              ? `Corrected back from ${before ? TESTING_STAGE_META[before].label : "—"} by the operator.`
              : `Set manually${before ? ` from ${TESTING_STAGE_META[before].label}` : ""}.`),
          });
        });
        toast.success(`Stage → ${TESTING_STAGE_META[stage].label}`);
      },

      // Pull the report for a lot's work order and parse it on screen. Called again → next revision.
      fetchWhlReport: (orderId, lotId) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const lot = b0.lots.find((x) => x.id === lotId); if (!lot) return;
        if (!lot.workOrderNo) { toast.error("No WHL work order for this lot yet."); return; }
        const line = b0.lines.find((l) => l.mpn === lot.orderLineMpn);
        const revision = (lot.reports ?? []).reduce((m, r) => Math.max(m, r.revision), 0) + 1;
        toast.message(revision > 1 ? `Fetching revision ${revision} of ${lot.workOrderNo}…` : "Fetching WHL report…");
        void (async () => {
          try {
            const rep = await whlFetchReport({
              workOrderNo: lot.workOrderNo!, mpn: lot.orderLineMpn, manufacturer: line?.make ?? "-", lotQty: lot.qty,
              client: b0.maskingEntity, clientPo: lot.clientPoNo, revision,
              testNames: (lot.tests ?? []).map((t) => t.name),
            });
            set((s) => {
              const b = s.orders[orderId]; if (!b) return;
              const l = b.lots.find((x) => x.id === lotId); if (!l) return;
              l.reports ??= [];
              l.reports.forEach((r) => { r.current = false; });
              const stored: WhlReport = {
                id: uid("rep"), reportNo: rep.reportNo, revision: rep.revision, reportDate: rep.reportDate,
                workOrderNo: rep.workOrderNo, fileName: rep.fileName, receivedAt: stamp(), current: true,
                revisionNote: rep.revisionNote, partNumber: rep.partNumber, manufacturer: rep.manufacturer,
                lotQty: rep.lotQty, client: rep.client, clientPo: rep.clientPo, conclusion: rep.conclusion,
                anyFar: rep.anyFar, processes: rep.processes, approvedBy: rep.approvedBy, approverTitle: rep.approverTitle,
                standards: rep.standards, riskClass: rep.riskClass, msl: rep.msl, packageType: rep.packageType,
                confidentialityNote: rep.confidentialityNote, parseFlags: [...rep.parseFlags], accessLog: [],
              };
              // reconciliation: the report must agree with the lot it was raised for
              if (rep.partNumber !== l.orderLineMpn) stored.parseFlags.push(`Report MPN ${rep.partNumber} ≠ lot MPN ${l.orderLineMpn} - verify before acting on this report.`);
              if (l.clientPoNo && rep.clientPo !== "PO Unknown" && rep.clientPo !== l.clientPoNo) stored.parseFlags.push(`Report Client P/O ${rep.clientPo} ≠ ${l.clientPoNo} on file - reconcile.`);
              l.reports.push(stored);
              l.reportNo = stored.reportNo;
              l.testedAt = stored.reportDate;
              l.testStatus = conclusionToLotStatus(stored.conclusion, stored.anyFar);
              // roll the process matrix onto the per-test tracker (with history)
              l.tests ??= [];
              for (const p of stored.processes) {
                const next = processToTestStatus(p.result);
                let t = l.tests.find((x) => x.name === p.name);
                if (!t) {
                  t = { id: uid("lt"), name: p.name, source: "AUTO_BOOKING", status: "PENDING", history: [] };
                  l.tests.push(t);
                }
                const before = t.status;
                t.status = next; t.acceptQty = p.acceptQty; t.rejectQty = p.rejectQty; t.updatedAt = stamp();
                t.history.push(auditRow({ by: WHL_BOT, action: "REPORT", target: p.name, before, after: next, note: `From report ${stored.reportNo}${p.note ? ` - ${p.note}` : ""}` }));
              }
              b.labEmails ??= [];
              b.labEmails.unshift({
                id: uid("em"), direction: "IN", lotId, lotCode: l.lotCode, mpn: l.orderLineMpn,
                workOrderNo: l.workOrderNo, poNo: l.clientPoNo, subject: `WHL Report ${stored.reportNo} - ${l.orderLineMpn} (Lot ${l.lotCode})`,
                body: `Report ${stored.reportNo} issued. Overall conclusion: ${stored.conclusion.replace(/_/g, " ")}${stored.anyFar ? " (one or more processes F.A.R.)" : ""}.`,
                at: stamp(), by: "WHL Reports", status: "REPORT_DELIVERED", kind: "REPORT", attachments: [stored.fileName],
              });
              b.documents.push({ id: uid("doc"), subjectType: "LOT", docType: "WHL_REPORT", fileName: stored.fileName, uploadedBy: "WHL (email)", uploadedAt: today() });
              // an unanswered chase is now answered
              l.lastUpdateRequestAt = undefined;
              const pending = b.labEmails.filter((m) => m.lotId === lotId && m.direction === "OUT" && m.status === "AWAITING_RESPONSE");
              pending.forEach((m) => { m.status = "UPDATE_RECEIVED"; });
              // lifecycle: the report landing is the end of the chain
              moveStage(l, "REPORT_SHARED", WHL_BOT, {
                note: `Report ${stored.reportNo} received — ${stored.conclusion.replace(/_/g, " ").toLowerCase()}${stored.anyFar ? " (a process came back F.A.R.)" : ""}.`,
              });
            });
            const st = conclusionToLotStatus(rep.conclusion, rep.anyFar);
            if (st === "PASS") toast.success(`${rep.reportNo} - Acceptable`);
            else if (st === "FAIL") toast.error(`${rep.reportNo} - ${rep.conclusion.replace(/_/g, " ").toLowerCase()}`);
            else toast.warning(`${rep.reportNo} - Acceptable, but a process came back F.A.R.`);
          } catch (e) { toast.error(`WHL: ${errMsg(e)}`); }
        })();
      },

      // Pre-mapped chase - no looking up WHL's address or the work-order number by hand.
      requestWhlUpdate: (orderId, lotId) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const lot = b0.lots.find((x) => x.id === lotId); if (!lot) return;
        const tpl = whlTemplate("STATUS_REQUEST");
        const ctx = {
          entity: b0.maskingEntity, mpn: lot.orderLineMpn, lotCode: lot.lotCode, qty: lot.qty, sampleQty: lot.sampleQty,
          workOrderNo: lot.workOrderNo, clientPoNo: lot.clientPoNo, reportNo: lot.reportNo, lab: lot.lab, dateCode: lot.dateCode,
        };
        get().sendLabEmail(orderId, { lotId, subject: tpl.subject(ctx), body: tpl.body(ctx) });
        set((s) => { const l = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (l) l.lastUpdateRequestAt = today(); });
      },

      sendLabEmail: (orderId, m) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const lot = m.lotId ? b0.lots.find((x) => x.id === m.lotId) : undefined;
        const emId = uid("em");
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          b.labEmails ??= [];
          b.labEmails.unshift({
            id: emId, direction: "OUT", lotId: m.lotId, lotCode: lot?.lotCode, mpn: lot?.orderLineMpn,
            workOrderNo: lot?.workOrderNo, poNo: lot?.clientPoNo, subject: m.subject, body: m.body,
            at: stamp(), by: ME, status: "AWAITING_RESPONSE", kind: m.subject.startsWith("Status request") ? "REQUEST_UPDATE" : "CUSTOM",
          });
        });
        toast.message(`Sending to ${WHL_CONTACT}…`);
        void (async () => {
          try {
            await whlSendMail({ to: WHL_CONTACT, subject: m.subject, body: m.body, workOrderNo: lot?.workOrderNo, lotCode: lot?.lotCode, mpn: lot?.orderLineMpn, poNo: lot?.clientPoNo });
            toast.success("Email sent to WHL - logged against the lot");
          } catch (e) {
            set((s) => { const em = s.orders[orderId]?.labEmails?.find((x) => x.id === emId); if (em) { em.status = "ESCALATED"; em.matchNote = `Send failed - ${errMsg(e)}. Retry.`; } });
            toast.error(`Mail: ${errMsg(e)}`);
          }
        })();
      },

      // Inbound mail drives the tracker. Mails that can't be matched go to a manual-match queue.
      syncWhlInbox: (orderId) => {
        const b0 = get().orders[orderId]; if (!b0) return;

        // A slot awaiting confirmation is answered FIRST and the poll stops there. Nothing about
        // a lot exists until the lab agrees to test it, so there is nothing else this mailbox
        // could usefully say — and the confirmation is the mail that creates the lots.
        const pending = (b0.testSlots ?? []).find((x) => x.status === "REQUESTED");
        if (pending) {
          toast.message(`Checking the WHL mailbox for ${pending.slotNo}…`);
          void (async () => {
            // the lab reads our request and answers with its booking appointment
            let parsed;
            try {
              parsed = await extractBookingAppointment({
                fileName: `${pending.slotNo}-confirmation.pdf`, bytesLen: 0, orderNo: b0.orderNo,
                lab: pending.lab,
                lines: pending.lines.map((l) => ({ mpn: l.mpn, qty: l.qty, testingMode: "WHL" })),
              });
            } catch (e) { toast.error(errMsg(e)); return; }

            const created: string[] = [];
            set((s) => {
              const b = s.orders[orderId]; if (!b) return;
              const slot = (b.testSlots ?? []).find((x) => x.id === pending.id); if (!slot) return;
              const prior = slot.retestOfSlotId ? (b.testSlots ?? []).find((x) => x.id === slot.retestOfSlotId) : undefined;
              const confirmId = uid("lm");
              b.mpnTests ??= [];

              slot.lines.forEach((line, i) => {
                const appt = parsed!.lots[i] ?? parsed!.lots[0];
                // the test plan we asked for wins — the lab confirmed it; fall back to its own
                const plan = line.tests.length ? line.tests : (appt?.tests ?? []);
                const doc = `Booking appointment ${parsed!.appointmentNo} (slot ${slot.slotNo})`;

                let spec = b.mpnTests!.find((x) => x.mpn === line.mpn);
                if (!spec) {
                  spec = { id: uid("spec"), mpn: line.mpn, autofill: "OK", sourceDoc: doc, parsedAt: stamp(), tests: [], audit: [] };
                  b.mpnTests!.push(spec);
                } else { spec.sourceDoc = doc; spec.parsedAt = stamp(); }
                for (const t of plan) {
                  if (spec.tests.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) continue;
                  spec.tests.push({ id: uid("req"), name: t.name, standard: t.standard, source: "AUTO_BOOKING" });
                }
                spec.audit.push(auditRow({
                  by: `${slot.lab} (confirmation)`, action: "AUTOFILL", target: line.mpn,
                  before: "-", after: `${plan.length} test(s) from ${doc}`,
                }));

                const lotCode = prior
                  ? `${(prior.createdLotIds ?? []).length ? "" : ""}RT${(b.testSlots ?? []).filter((x) => x.retestOfSlotId).length}-${appt?.lotCode ?? `L${i + 1}`}`
                  : appt?.lotCode ?? `LOT-${String.fromCharCode(65 + b.lots.length)}`;
                const lotId = uid("lot");
                const lot: Lot = {
                  id: lotId, orderLineMpn: line.mpn, lotCode, dateCode: line.dateCode || (appt?.dateCode ?? ""),
                  qty: line.qty, sampleQty: line.sampleQty, testStatus: "PENDING",
                  lab: slot.lab, workOrderNo: appt?.workOrderNo, tatDays: appt?.estimatedTatDays,
                  clientPoNo: b.sourcingAllocations.find((a) => a.orderLineMpn === line.mpn)?.clientPoNo,
                  testSlotId: slot.id, testSlotNo: slot.slotNo,
                  retestOfSlotNo: slot.retestOfSlotNo,
                  tests: plan.map((t) => {
                    const req = spec!.tests.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
                    return {
                      id: uid("lt"), requirementId: req?.id, name: t.name, standard: t.standard,
                      source: req?.source ?? "AUTO_BOOKING", status: "PENDING" as const,
                      history: [auditRow({ by: `${slot.lab} (confirmation)`, action: "ADD", target: t.name, after: "PENDING", note: `Confirmed on ${doc}.` })],
                    };
                  }),
                  reports: [],
                };
                moveStage(lot, "TEST_BOOKED", `${slot.lab} (confirmation)`, {
                  note: `${slot.lab} confirmed slot ${slot.slotNo} — appointment ${parsed!.appointmentNo}, work order ${appt?.workOrderNo ?? "—"}.`,
                  sourceEmailId: confirmId,
                });
                // a re-test re-uses components already sitting at the lab, so the dispatch and
                // receipt stages happened on the original submission — recording them again
                // would claim a shipment that never left
                if (prior) {
                  moveStage(lot, "SUPPLIER_DISPATCHING", `${slot.lab} (confirmation)`, {
                    note: `Carried over from ${prior.slotNo} — components already dispatched for the original test.`,
                    sourceEmailId: confirmId,
                  });
                  moveStage(lot, "COMPONENTS_RECEIVED", `${slot.lab} (confirmation)`, {
                    note: `Carried over from ${prior.slotNo} — components already at ${slot.lab}.`,
                    sourceEmailId: confirmId,
                  });
                }
                b.lots.push(lot);
                created.push(lotCode);
                slot.createdLotIds = [...(slot.createdLotIds ?? []), lotId];
              });

              slot.status = "CONFIRMED";
              slot.confirmedAt = stamp();
              slot.appointmentNo = parsed!.appointmentNo;
              slot.confirmEmailId = confirmId;

              const req = (b.labEmails ?? []).find((m) => m.id === slot.requestEmailId);
              if (req) req.status = "UPDATE_RECEIVED";
              b.labEmails ??= [];
              b.labEmails.unshift({
                id: confirmId, direction: "IN",
                subject: `Booking confirmed — ${parsed!.appointmentNo}${slot.retestOfSlotNo ? " (re-test)" : ""} — ${slot.lines.map((l) => l.mpn).join(", ")}`,
                body: [
                  `Hi Sourcing Ops,`, "",
                  `We confirm the ${slot.retestOfSlotNo ? "re-test " : ""}slot for ${slot.lines.map((l) => l.mpn).join(", ")}.`,
                  `Our booking appointment: ${parsed!.appointmentNo}${slot.retestOfSlotNo ? " (re-test — components already held here)" : ""}`,
                  "",
                  ...created.map((c) => `  ${c}`),
                  "",
                  `The agreed test plan and work orders are on the attached appointment.`,
                  "", `Regards,`, `${slot.lab}`,
                ].join("\n"),
                at: stamp(), by: `${slot.lab} Bookings`, status: "UPDATE_RECEIVED", kind: "BOOKING_CONFIRMED",
                attachments: [`${parsed!.appointmentNo}.pdf`],
              });
              b.events.unshift({
                id: uid("ev"), eventType: "GENERAL",
                message: `${slot.lab} confirmed slot ${slot.slotNo} (${parsed!.appointmentNo}) — ${created.length} test lot(s) created: ${created.join(", ")}.`,
                source: "WHL", occurredAt: today(), recordedBy: slot.lab,
              });
            });
            toast.success(`${pending.slotNo} confirmed — ${created.length} test lot(s) created`);
          })();
          return;
        }

        // the lot's current stage goes with the request so the lab answers with the
        // mail that plausibly comes next, rather than one for a stage already passed
        const wos = b0.lots.filter((l) => !!l.workOrderNo).map((l) => ({
          workOrderNo: l.workOrderNo!, lotCode: l.lotCode, mpn: l.orderLineMpn, testNames: (l.tests ?? []).map((t) => t.name),
          stage: lotStage(l),
          // the money thread: issue the invoice once, acknowledge a transfer that's with
          // finance, chase it while it's owed, and hold the bench on unpaid advance terms
          hasInvoice: !!l.labPayment?.invoice,
          feePaid: l.labPayment?.status === "PAID",
          feeWithFinance: l.labPayment?.status === "SENT_TO_FINANCE",
          terms: l.labPayment?.invoice?.terms,
        }));
        if (wos.length === 0) { toast.error("No WHL work orders on this order yet."); return; }
        toast.message("Checking the WHL mailbox…");
        void (async () => {
          try {
            const res = await whlPollInbox({ workOrders: wos });
            let matched = 0, unmatched = 0;
            const advanced: string[] = [];
            const invoiced: string[] = [];
            const settled: string[] = [];
            set((s) => {
              const b = s.orders[orderId]; if (!b) return;
              b.labEmails ??= [];
              for (const msg of res.messages) {
                const lot = msg.lotCode ? b.lots.find((l) => l.lotCode === msg.lotCode)
                  : msg.workOrderNo ? b.lots.find((l) => l.workOrderNo === msg.workOrderNo) : undefined;
                const em: LabEmail = {
                  id: uid("em"), direction: "IN", lotId: lot?.id, lotCode: lot?.lotCode, mpn: lot?.orderLineMpn,
                  workOrderNo: msg.workOrderNo, poNo: lot?.clientPoNo, subject: msg.subject, body: msg.body,
                  at: msg.receivedAt,
                  by: msg.kind === "DISPATCH" ? SUPPLIER_RELAY
                    : msg.kind === "INVOICE" || msg.kind === "PAYMENT_ACK" ? "WHL Accounts"
                    : "WHL Reports",
                  status: !lot ? "AWAITING_RESPONSE" : msg.kind === "REPORT" ? "REPORT_DELIVERED" : "UPDATE_RECEIVED",
                  kind: msg.kind === "REPORT" ? "REPORT"
                    : msg.kind === "INVOICE" ? "INVOICE"
                    : msg.kind === "PAYMENT_ACK" ? "PAYMENT"
                    : msg.kind === "DISPATCH" ? "DISPATCH"
                    : "STATUS_UPDATE",
                  attachments: msg.attachments,
                  matchNote: lot ? undefined : "Subject line carries no work order, lot or report number — match it manually.",
                };
                b.labEmails.unshift(em);
                if (!lot) { unmatched++; continue; }
                matched++;
                // refresh the per-test tracker from the mail's interim statuses
                for (const u of msg.testUpdates ?? []) {
                  lot.tests ??= [];
                  let t = lot.tests.find((x) => x.name === u.name);
                  if (!t) { t = { id: uid("lt"), name: u.name, source: "AUTO_BOOKING", status: "PENDING", history: [] }; lot.tests.push(t); }
                  const before = t.status;
                  if (before === "PASSED" || before === "FAILED") continue; // a report already settled this test
                  t.status = u.status; t.updatedAt = msg.receivedAt;
                  t.history.push(auditRow({ by: WHL_BOT, action: "STATUS", target: u.name, before, after: u.status, note: u.note ?? msg.subject, sourceEmailId: em.id }));
                }
                if (msg.kind === "REPORT") lot.lastUpdateRequestAt = undefined;
                // the lab's own invoice for the testing service — store it and file the
                // PDF. The mail is also where the payment mode comes from: advance or
                // credit is the lab's call per work order, so it's read, never chosen.
                if (msg.invoice) {
                  lot.labPayment ??= { status: "NOT_REQUESTED" };
                  if (!lot.labPayment.invoice) {
                    lot.labPayment.invoice = {
                      id: uid("inv"), invoiceNo: msg.invoice.invoiceNo, amount: msg.invoice.amount,
                      taxAmount: msg.invoice.taxAmount, currency: msg.invoice.currency,
                      fileName: msg.invoice.fileName, receivedAt: msg.receivedAt,
                      dueDate: msg.invoice.dueDate,
                      terms: msg.invoice.terms, creditDays: msg.invoice.creditDays,
                      ratePerProcess: msg.invoice.ratePerProcess, processCount: msg.invoice.processCount,
                      note: `${msg.invoice.processCount} process(es) billed against WO ${msg.workOrderNo ?? "—"} at ${msg.invoice.currency} ${msg.invoice.ratePerProcess} each.`,
                      accessLog: [],
                    };
                    // a paid fee stays paid; otherwise the invoice is now ours to settle
                    if (lot.labPayment.status !== "PAID") lot.labPayment.status = "INVOICE_RECEIVED";
                    b.documents.push({
                      id: uid("doc"), subjectType: "LOT", docType: "WHL_INVOICE",
                      fileName: msg.invoice.fileName, uploadedBy: "WHL (email)", uploadedAt: today(),
                    });
                    invoiced.push(`${lot.lotCode} → ${LAB_TERMS_LABEL[msg.invoice.terms].toLowerCase()} invoice ${msg.invoice.invoiceNo}`);
                  }
                }
                // the supplier's dispatch advice, relayed onto this thread — the lab can't
                // report a shipment it hasn't received, so this is where the stage comes from
                if (msg.dispatch && !lot.dispatch) {
                  lot.dispatch = { ...msg.dispatch, recordedBy: "Supplier (mail)", recordedAt: msg.receivedAt };
                }
                // WHL confirming our transfer landed — the only mail that closes the fee
                if (msg.payment && lot.labPayment?.status !== "PAID") {
                  lot.labPayment ??= { status: "NOT_REQUESTED" };
                  lot.labPayment.status = "PAID";
                  lot.labPayment.paidAt = msg.payment.paidAt;
                  lot.labPayment.paidRef = msg.payment.paidRef;
                  settled.push(`${lot.lotCode} → fee paid · ref ${msg.payment.paidRef}`);
                  b.events.unshift({
                    id: uid("ev"), eventType: "GENERAL",
                    message: `WHL confirmed payment of invoice ${msg.payment.invoiceNo} for ${lot.lotCode} (${lot.orderLineMpn}) — ref ${msg.payment.paidRef}.`,
                    source: "WHL", occurredAt: today(), recordedBy: WHL_BOT,
                  });
                }
                // lifecycle: the mail says where the lot now is (receipt / progress /
                // report). Forward-only, so a late-arriving interim mail can't drag a
                // finished lot back down the chain — except the payment stage, which is a
                // record rather than a position and must keep its row either way.
                if (msg.stage) {
                  const advance = msg.stage === "WHL_PAYMENT" ? settleStage : moveStage;
                  if (advance(lot, msg.stage, WHL_BOT, { note: msg.subject, sourceEmailId: em.id })) {
                    advanced.push(`${lot.lotCode} → ${TESTING_STAGE_META[msg.stage].label}`);
                  }
                }
                b.labEmails.filter((x) => x.lotId === lot.id && x.direction === "OUT" && x.status === "AWAITING_RESPONSE")
                  .forEach((x) => { x.status = "UPDATE_RECEIVED"; });
              }
            });
            if (settled.length) toast.success(settled.join(" · "));
            else if (invoiced.length) toast.success(invoiced.join(" · "));
            else if (advanced.length) toast.success(advanced.join(" · "));
            else toast.success(`${matched} update(s) applied${unmatched ? ` · ${unmatched} need manual matching` : ""}`);
          } catch (e) { toast.error(`WHL inbox: ${errMsg(e)}`); }
        })();
      },

      matchLabEmail: (orderId, emailId, lotId) => {
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const em = b.labEmails?.find((x) => x.id === emailId); if (!em) return;
          const lot = b.lots.find((l) => l.id === lotId); if (!lot) return;
          em.lotId = lot.id; em.lotCode = lot.lotCode; em.mpn = lot.orderLineMpn;
          em.workOrderNo = em.workOrderNo ?? lot.workOrderNo; em.poNo = lot.clientPoNo;
          em.matchedBy = ME; em.matchNote = undefined;
          em.status = em.kind === "REPORT" ? "REPORT_DELIVERED" : "UPDATE_RECEIVED";
          const spec = (b.mpnTests ?? []).find((x) => x.mpn === lot.orderLineMpn);
          spec?.audit.push(auditRow({ by: ME, action: "EMAIL", target: lot.lotCode, after: "matched inbound mail", note: em.subject, sourceEmailId: em.id }));
        });
        toast.success("Email matched to the lot");
      },

      escalateLabEmail: (orderId, emailId) => {
        set((s) => { const em = s.orders[orderId]?.labEmails?.find((x) => x.id === emailId); if (em) em.status = "ESCALATED"; });
        toast.warning("Thread marked escalated");
      },

      // Reports carry NDA language - every view/download is logged, internal-only.
      logReportAccess: (orderId, lotId, reportId, action) => {
        set((s) => {
          const r = s.orders[orderId]?.lots.find((x) => x.id === lotId)?.reports?.find((x) => x.id === reportId);
          if (r) r.accessLog.unshift({ at: stamp(), by: ME, action });
        });
      },

      reconcileReportPo: (orderId, lotId, reportId) => {
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const lot = b.lots.find((x) => x.id === lotId); if (!lot) return;
          const r = lot.reports?.find((x) => x.id === reportId); if (!r) return;
          const before = r.clientPo;
          const onFile = lot.clientPoNo ?? b.sourcingAllocations.find((a) => a.orderLineMpn === lot.orderLineMpn)?.clientPoNo;
          if (!onFile) { toast.error("No sales order on file for this lot - map it on the Allocations tab first."); return; }
          r.clientPo = onFile;
          r.parseFlags = r.parseFlags.filter((f) => !f.toLowerCase().includes("client p/o"));
          const spec = (b.mpnTests ?? []).find((x) => x.mpn === lot.orderLineMpn);
          spec?.audit.push(auditRow({ by: ME, action: "RECONCILE", target: r.reportNo, before, after: onFile, note: "Report Client P/O reconciled against the PO on file." }));
        });
        toast.success("Client P/O reconciled");
      },

      // "Result is in - who do we tell." One action per counterparty; the report PDF rides
      // along when the operator ticks it. Escrow notifications also land on the escrow ledger.
      notifyLotResult: (orderId, lotId, m) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const lot = b0.lots.find((x) => x.id === lotId); if (!lot) return;
        const rep = (lot.reports ?? []).find((r) => r.current) ?? (lot.reports ?? [])[0];
        const inv = lot.labPayment?.invoice;
        // the finance mail carries the lab's INVOICE, not the test report
        const attachments = m.party === "FINANCE"
          ? (m.attachReport && inv ? [inv.fileName] : [])
          : (m.attachReport && rep ? [rep.fileName] : []);
        const noteFor: Record<NotifyParty, string> = {
          SUPPLIER: "Masked - buyer identity, sales order and sell price withheld.",
          BUYER: "Masked - supplier identity, buy price and inbound AWB withheld.",
          ESCROW: "Release-trigger evidence for the escrow provider.",
          WHL: "Acknowledgement to the laboratory.",
          FINANCE: "Internal — lab testing fee for payment. Booked to the order, not the supplier's material payment.",
        };
        const nId = uid("ntf");
        set((s) => {
          const l = s.orders[orderId]?.lots.find((x) => x.id === lotId); if (!l) return;
          (l.notifications ??= []).unshift({
            id: nId, party: m.party, to: m.to, subject: m.subject, body: m.body, attachments,
            reportNo: rep?.reportNo, at: stamp(), by: ME, status: "SENT",
            note: attachments.length && m.party !== "FINANCE"
              ? `${noteFor[m.party]} Report shared under NDA — internal use by the recipient only.`
              : noteFor[m.party],
          });
          // handing the invoice to finance IS the payment initiation — record it
          if (m.party === "FINANCE" && l.labPayment?.invoice) {
            l.labPayment.status = "SENT_TO_FINANCE";
            l.labPayment.sentToFinanceAt = stamp();
            l.labPayment.sentToFinanceBy = ME;
          }
        });
        toast.message(`Notifying ${m.party.toLowerCase()}…`);
        void (async () => {
          try {
            const res = await sendPartyNotification({
              party: m.party, to: m.to, subject: m.subject, body: m.body, attachments,
              orderNo: b0.orderNo, lotCode: lot.lotCode, reportNo: rep?.reportNo,
            });
            set((s) => {
              const bb = s.orders[orderId]; if (!bb) return;
              bb.events.unshift({
                id: uid("ev"), eventType: "GENERAL",
                message: m.party === "FINANCE"
                  ? `${lot.lotCode} (${lot.orderLineMpn}) — WHL invoice ${inv?.invoiceNo ?? "(awaited)"} sent to finance (${res.to}) to initiate payment${attachments.length ? " with the invoice attached" : ""}.`
                  : `${lot.lotCode} (${lot.orderLineMpn}) result ${rep ? `${rep.reportNo} — ${rep.conclusion.replace(/_/g, " ").toLowerCase()}` : ""} notified to ${m.party.toLowerCase()} (${res.to})${attachments.length ? " with the report attached" : ""}.`,
                source: "NOTIFY", occurredAt: today(), recordedBy: ME,
              });
              // escrow gets a log entry so the release decision has a paper trail
              if (m.party === "ESCROW" && bb.escrow) {
                bb.escrow.agentEmails.push({
                  id: uid("ea"), direction: "SENT", subject: `Lab result shared — ${lot.lotCode}`, from: "you@1buy.ai", to: m.to,
                  snippet: `Lab result shared with HKIN — ${lot.lotCode}${rep ? ` (${rep.reportNo}, ${rep.conclusion.replace(/_/g, " ").toLowerCase()})` : ""}`,
                  receivedAt: today(),
                });
              }
              // the lab acknowledgement belongs on the WHL thread as well
              if (m.party === "WHL") {
                (bb.labEmails ??= []).unshift({
                  id: uid("em"), direction: "OUT", lotId, lotCode: lot.lotCode, mpn: lot.orderLineMpn,
                  workOrderNo: lot.workOrderNo, poNo: lot.clientPoNo, subject: m.subject, body: m.body,
                  at: stamp(), by: ME, status: "SENT", kind: "CUSTOM",
                });
              }
            });
            toast.success(`${m.party[0]}${m.party.slice(1).toLowerCase()} notified (${res.messageId})`);
          } catch (e) {
            set((s) => {
              const n = s.orders[orderId]?.lots.find((x) => x.id === lotId)?.notifications?.find((x) => x.id === nId);
              if (n) { n.status = "FAILED"; n.note = `Send failed - ${errMsg(e)}. Retry.`; }
            });
            toast.error(`Notify: ${errMsg(e)}`);
          }
        })();
      },

      // Bulk sibling of notifyLotResult: ONE mail for many lots. The notification row is
      // written onto every lot it covered, so each lot's trail still shows who was told.
      notifyLotsResult: (orderId, lotIds, m) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const lots = b0.lots.filter((l) => lotIds.includes(l.id));
        if (lots.length === 0) { toast.error("No lots selected."); return; }
        const reportOf = (l: (typeof lots)[number]) => (l.reports ?? []).find((r) => r.current) ?? (l.reports ?? [])[0];
        // a finance run attaches the lab's INVOICES; every other party gets the reports
        const docOf = (l: (typeof lots)[number]) =>
          m.party === "FINANCE" ? l.labPayment?.invoice?.fileName : reportOf(l)?.fileName;
        const attachments = m.attachReports
          ? Array.from(new Set(lots.map(docOf).filter((f): f is string => !!f)))
          : [];
        const coverage = `Sent as one digest covering ${lots.length} lot(s): ${lots.map((l) => l.lotCode).join(", ")}.`;
        const nIds = lots.map((l) => ({ lotId: l.id, id: uid("ntf") }));
        set((s) => {
          const bb = s.orders[orderId]; if (!bb) return;
          for (const { lotId, id: nId } of nIds) {
            const l = bb.lots.find((x) => x.id === lotId); if (!l) continue;
            (l.notifications ??= []).unshift({
              id: nId, party: m.party, to: m.to, subject: m.subject, body: m.body, attachments,
              reportNo: reportOf(l)?.reportNo, at: stamp(), by: ME, status: "SENT",
              note: m.party === "FINANCE"
                ? `${coverage} Lab testing fees for payment — booked to the order, not the supplier's material payment.`
                : `${coverage}${attachments.length ? " Report(s) shared under NDA — internal use by the recipient only." : ""}`,
            });
            // one payment run moves every invoice it covered to "with finance"
            if (m.party === "FINANCE" && l.labPayment?.invoice && l.labPayment.status !== "PAID") {
              l.labPayment.status = "SENT_TO_FINANCE";
              l.labPayment.sentToFinanceAt = stamp();
              l.labPayment.sentToFinanceBy = ME;
            }
          }
        });
        toast.message(`Notifying ${m.party.toLowerCase()} about ${lots.length} lot(s)…`);
        void (async () => {
          try {
            const res = await sendPartyNotification({
              party: m.party, to: m.to, subject: m.subject, body: m.body, attachments,
              orderNo: b0.orderNo, lotCode: lots.map((l) => l.lotCode).join(","),
            });
            set((s) => {
              const bb = s.orders[orderId]; if (!bb) return;
              bb.events.unshift({
                id: uid("ev"), eventType: "GENERAL",
                message: m.party === "FINANCE"
                  ? `${attachments.length} WHL invoice(s) across ${lots.length} lot(s) (${lots.map((l) => l.lotCode).join(", ")}) sent to finance (${res.to}) as one payment run.`
                  : `${lots.length} lot(s) (${lots.map((l) => l.lotCode).join(", ")}) notified to ${m.party.toLowerCase()} (${res.to}) in one digest${attachments.length ? ` with ${attachments.length} report(s) attached` : ""}.`,
                source: "NOTIFY", occurredAt: today(), recordedBy: ME,
              });
              if (m.party === "ESCROW" && bb.escrow) {
                bb.escrow.agentEmails.push({
                  id: uid("ea"), direction: "SENT", subject: `Lab results shared — ${lots.length} lot(s)`, from: "you@1buy.ai", to: m.to,
                  snippet: `Lab results shared with HKIN — ${lots.length} lot(s): ${lots.map((l) => `${l.lotCode}${reportOf(l) ? ` (${reportOf(l)!.reportNo})` : ""}`).join(", ")}`,
                  receivedAt: today(),
                });
              }
              if (m.party === "WHL") {
                (bb.labEmails ??= []).unshift({
                  id: uid("em"), direction: "OUT", subject: m.subject, body: m.body,
                  lotId: lots[0].id, lotCode: lots.map((l) => l.lotCode).join(", "), mpn: lots[0].orderLineMpn,
                  at: stamp(), by: ME, status: "SENT", kind: "CUSTOM",
                });
              }
            });
            toast.success(`${lots.length} lot(s) notified to ${m.party.toLowerCase()} (${res.messageId})`);
          } catch (e) {
            set((s) => {
              const bb = s.orders[orderId]; if (!bb) return;
              for (const { lotId, id: nId } of nIds) {
                const n = bb.lots.find((x) => x.id === lotId)?.notifications?.find((x) => x.id === nId);
                if (n) { n.status = "FAILED"; n.note = `Send failed - ${errMsg(e)}. Retry.`; }
              }
            });
            toast.error(`Notify: ${errMsg(e)}`);
          }
        })();
      },

      addSourcingAllocation: (orderId, a) => {
        const st = get();
        const b = st.orders[orderId]; if (!b) return false;
        // masked part trade: you can only fulfil demand for part X with part X
        if (a.clientLineMpn !== a.orderLineMpn) { toast.error(`Can't map ${a.orderLineMpn} to a ${a.clientLineMpn} demand line - parts must match.`); return false; }
        const line = b.lines.find((l) => l.id === a.orderLineId);
        const orderUnmapped = line ? line.quantity - mappedForOrderLine(b, line) : 0;
        const demand = st.clientPos.find((c) => c.clientPoNo === a.clientPoNo)?.lines.find((l) => l.mpn === a.clientLineMpn)?.qty ?? 0;
        const clientRemaining = demand - sourcedForClientLine(st.supplierPos, st.orders, a.clientPoNo, a.clientLineMpn);
        const cap = Math.min(orderUnmapped, clientRemaining);
        if (a.qty <= 0 || a.qty > cap) { toast.error(`Qty 1-${Math.max(0, cap)} (order-line unmapped ${Math.max(0, orderUnmapped)}, client remaining ${Math.max(0, clientRemaining)}).`); return false; }
        const priceFor = (poNo: string, mpn: string) => st.clientPos.find((c) => c.clientPoNo === poNo)?.lines.find((l) => l.mpn === mpn)?.unitPrice ?? 0;
        set((s) => {
          const bb = s.orders[orderId]; if (!bb) return;
          bb.sourcingAllocations.push({ id: uid("sa"), ...a });
          // map-later realizes the client price → recompute sell + buyer so the header stops showing 0% / "Unlinked"
          let sell = 0;
          for (const l of bb.lines) {
            const mapped = bb.sourcingAllocations.filter((x) => (x.orderLineId ? x.orderLineId === l.id : x.orderLineMpn === l.mpn));
            const mappedQty = mapped.reduce((t, x) => t + x.qty, 0);
            for (const x of mapped) sell += priceFor(x.clientPoNo, x.clientLineMpn) * x.qty;
            sell += Math.max(0, l.quantity - mappedQty) * l.unitPrice; // still-unmapped qty valued at buy (0 margin)
          }
          bb.sellTotal = Math.round(sell);
          const names = new Set(bb.sourcingAllocations.map((x) => st.clientPos.find((c) => c.clientPoNo === x.clientPoNo)?.client.name ?? "-"));
          bb.buyer = { ...bb.buyer, name: names.size === 0 ? "Unlinked (map later)" : names.size === 1 ? [...names][0] : "Multiple clients" };
        });
        toast.success(`Mapped ${a.qty} → ${a.clientPoNo}`);
        return true;
      },

      // The real WHL verdict is a genuine real-world outcome someone has to report — same real
      // backend call as the other purposes below, but with the verdict picked by a human, not
      // synthesized. escrow-agents runs the actual extraction-shaped path for it (see
      // agents/whl_report_extractor.py); here we just choose PASS or FAIL and let it happen.
      recordWhlVerdict: (orderId, verdict) => {
        const b = get().orders[orderId]; if (!b?.escrow) return;
        if (b.escrow.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        toast.message("Checking inbox for WHL's test report…");
        void (async () => {
          try {
            const res = await simulateNextInbound(orderId, verdict);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = withFundedAtStamp(res.escrow); });
            toast[verdict === "PASS" ? "success" : "error"](`WHL verdict received: ${verdict}`);
          } catch (e) { toast.error(errMsg(e)); }
        })();
      },
      // Only allowed pre T/T-received — once funds are moving, cancellation is out of scope for this POC.
      cancelEscrowOrder: (orderId) => {
        const e = get().orders[orderId]?.escrow; if (!e) return;
        if (e.cancelledAt) { toast("Already cancelled."); return; }
        // Real HKin evidence: a real order was cancelled with the fund-transfer step already
        // marked complete — cancellation isn't actually gated on T/T payment, only on the
        // order not already being fully released.
        if (e.status === "RELEASED_TO_SELLER") {
          toast.error("Can't cancel — funds have already been released to the seller."); return;
        }
        void (async () => {
          try {
            const escrow = await cancelEscrowOrderApi(orderId);
            set((s) => {
              const bb = s.orders[orderId]; if (!bb) return;
              bb.escrow = escrow;
              bb.events.unshift({ id: uid("ev"), eventType: "GENERAL", message: "Escrow order cancelled.", source: "SC_MANUAL", occurredAt: today(), recordedBy: "You (demo)" });
            });
            toast.success("Escrow order cancelled");
          } catch (e) { toast.error(errMsg(e)); }
        })();
      },

      markEscrowApplicationRejected: (orderId) => {
        const e = get().orders[orderId]?.escrow; if (!e) return;
        void (async () => {
          try {
            const escrow = await markApplicationRejected(orderId);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = escrow; });
            toast.error("HKin rejected the escrow application.");
          } catch (err) { toast.error(errMsg(err)); }
        })();
      },

      recordEscrowRma: (orderId, input) => {
        const e = get().orders[orderId]?.escrow; if (!e) return;
        void (async () => {
          try {
            const escrow = await recordRma(orderId, input);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = escrow; });
            toast.success(input.markReturned ? "Goods return confirmed." : "RMA details recorded.");
          } catch (err) { toast.error(errMsg(err)); }
        })();
      },

      // Real portal: buyer clicks Accept All / Accept Partially — doesn't have to wait for an
      // explicit WHL verdict. Backend reuses the existing whl_verdict=PASS release path; "partial"
      // is recorded as a note only (real partial-release mechanics aren't evidenced yet).
      acceptEscrowGoods: (orderId, input) => {
        const e = get().orders[orderId]?.escrow; if (!e) return;
        void (async () => {
          try {
            const escrow = await acceptGoodsApi(orderId, input);
            const sellerTo = e.sellerContact.email && e.sellerContact.email !== "—" ? e.sellerContact.email : undefined;
            const amountText = input.amount !== undefined ? ` — ${money(input.amount, e.currency)}` : "";
            set((s) => {
              const bb = s.orders[orderId]; if (!bb?.escrow) return;
              bb.escrow = escrow;
              bb.escrow.agentEmails.push({
                id: uid("ea"), direction: "SENT",
                subject: `Goods accepted${input.partial ? " (partially)" : ""} — ${bb.orderNo}`,
                from: "you@1buy.ai", to: HKIN_EMAIL, cc: sellerTo,
                snippet: input.partial
                  ? `Goods accepted partially${amountText}.${input.note ? ` ${input.note}` : ""}`
                  : `Goods accepted in full${amountText}.`,
                receivedAt: today(),
              });
            });
            toast.success(`Goods accepted${input.partial ? " (partially)" : ""} — release will proceed.`);
          } catch (err) { toast.error(errMsg(err)); }
        })();
      },

      // Real portal: buyer clicks Reject All, citing the WHL report — kicks off the same
      // refund -> RMA -> goods-return -> refund-instruction sequence as a WHL FAIL would.
      rejectEscrowGoods: (orderId, reason, reportFileName) => {
        const e = get().orders[orderId]?.escrow; if (!e) return;
        void (async () => {
          try {
            const escrow = await rejectGoodsApi(orderId, { reason });
            const sellerTo = e.sellerContact.email && e.sellerContact.email !== "—" ? e.sellerContact.email : undefined;
            set((s) => {
              const bb = s.orders[orderId]; if (!bb?.escrow) return;
              bb.escrow = escrow;
              bb.escrow.agentEmails.push({
                id: uid("ea"), direction: "SENT", subject: `Goods rejected — ${bb.orderNo}`,
                from: "you@1buy.ai", to: HKIN_EMAIL, cc: sellerTo, snippet: `Goods rejected — ${reason}`,
                attachmentFileName: reportFileName, receivedAt: today(),
              });
            });
            toast.message("Goods rejected — refund/return sequence started.");
          } catch (err) { toast.error(errMsg(err)); }
        })();
      },

      // Real correspondence: the buyer (not HKin) is the one who asks for more inspection time,
      // almost always citing a WHL delay. The reason text IS the review step (the UI shows/edits
      // it before calling this) — so this creates the draft on the backend and sends it in the
      // same action, rather than requiring a second separate send click on an auto-generated draft.
      // No real approval flow is modelled, so the request is treated as granted immediately —
      // the deadline moves out by `days` right away rather than waiting on a reply.
      requestEscrowExtension: (orderId, reason, days) => {
        const e = get().orders[orderId]?.escrow; if (!e) return;
        void (async () => {
          try {
            const res = await requestExtension(orderId, { reason: `Requesting a ${days}-day extension. ${reason}` });
            const sent = await sendEscrowDraft(res.draftId, { reviewedBy: "You (demo)" });
            set((s) => {
              const bb = s.orders[orderId]; if (!bb?.escrow) return;
              bb.escrow = sent.escrow;
              bb.escrow.inspectionDeadline = addDays(bb.escrow.inspectionDeadline ?? today(), days);
            });
            toast.success(`Extension request sent to HKin — deadline moved out by ${days} day(s).`);
          } catch (err) { toast.error(errMsg(err)); }
        })();
      },

      simulateEscrowDeadlineReminder: (orderId) => {
        const e = get().orders[orderId]?.escrow; if (!e) return;
        void (async () => {
          try {
            const res = await simulateDeadlineReminder(orderId);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = withFundedAtStamp(res.escrow); });
            toast.message(`HKin's inspection-deadline reminder arrived — deadline ${res.escrow.inspectionDeadline ? new Date(res.escrow.inspectionDeadline).toLocaleDateString() : ""}.`);
          } catch (err) { toast.error(errMsg(err)); }
        })();
      },

      // The very first Escrow-tab action — launches the hkin-rpa RPA to fill HKin's real
      // order-creation form from data already on this order (contacts + lines). It stops at HKin's
      // own Confirmation screen for a human (SC) to review + submit on the real site; this call
      // only starts it and returns immediately — it never waits for that human step, and never
      // records a real HKin escrow number itself (there's no way to observe that from here yet).
      askSupplierHkinAccount: (orderId) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        set((s) => { const bb = s.orders[orderId]; if (bb?.escrow) bb.escrow.hkinAccountStatus = "ASKED"; });
        toast.message(`Email sent to ${e.sellerContact.company} — asking if they have an HKin account (or need to open one).`);
      },

      confirmSupplierHkinAccount: (orderId) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        set((s) => { const bb = s.orders[orderId]; if (bb?.escrow) bb.escrow.hkinAccountStatus = "CONFIRMED"; });
        toast.success(`${e.sellerContact.company} confirmed they have an HKin account — you can create the HKin order now.`);
      },

      createHkinOrder: (orderId) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        if (e.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        if (e.hkinAccountStatus !== "CONFIRMED") {
          toast.error("Confirm the supplier has an HKin account before creating the order there.");
          return;
        }
        if (!e.buyerContact?.email || !e.sellerContact?.email) {
          toast.error("Buyer and seller contacts (with email) are required before creating the HKin order.");
          return;
        }
        if (!b.lines.length) { toast.error("Add at least one line item before creating the HKin order."); return; }
        toast.message("Starting HKin order creation — a browser window will open for review.");
        void (async () => {
          try {
            const res = await createOnHkin(orderId, {
              forwarder: e.agreedConditions?.forwarder || "Fedex",
              lines: b.lines.map((l) => ({
                partNumber: l.mpn, brand: l.make, quantity: l.quantity, unitPrice: l.unitPrice,
                remarks: `${l.make ?? ""} ${l.mpn}${l.dateCode ? `, date code ${l.dateCode}` : ""}`.trim(),
              })),
            });
            set((s) => { const bb = s.orders[orderId]; if (bb?.escrow) bb.escrow.hkinRpaStartedAt = res.startedAt; });
            toast.success("HKin order creation started — review the opened browser window before submitting on the real site.");
          } catch (err) { toast.error(errMsg(err)); }
        })();
      },
      // Every SENT email in the action library routes through here — the UI always shows a
      // reviewable/editable draft first (ComposeEmailModal). The actual draft (and its send-time
      // side effects — advancing status, stamping timestamps, instructing a milestone) live in
      // escrow-agents now; this finds the matching backend draft (the orchestrator creates it
      // automatically once the order reaches the right state) and sends it with whatever the
      // human ended up editing.
      sendEscrowEmail: (orderId, purpose, draft, milestoneIndex) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        if (e.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        void (async () => {
          try {
            await tickEscrowOrder(orderId); // best-effort — ensures the backend draft exists
            const drafts = await listEscrowDrafts(orderId);
            const match = drafts.find((d) => d.purpose === purpose && d.status !== "SENT"
              && (milestoneIndex === undefined ? d.milestoneIndex == null : d.milestoneIndex === milestoneIndex));
            if (!match) { toast.error("escrow-agents hasn't generated this draft yet — try Check inbox first."); return; }
            const res = await sendEscrowDraft(match.id, { reviewedBy: "You (demo)", to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body });
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = withFundedAtStamp(res.escrow); });
            toast.message(`Sent: ${draft.subject}`);
          } catch (e) { toast.error(errMsg(e)); }
        })();
      },
      // The single "Check inbox" action the UI calls. escrow-agents' orchestrator decides what
      // it's waiting on; if that's an inbound message (not a draft awaiting a human to send it),
      // the backend synthesizes a realistic one for that exact purpose and applies it for real
      // (classifier + extractor, same as a genuine email) — see simulate-next-inbound in api.py.
      checkEscrowInbox: (orderId) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        if (e.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        toast.message("Checking inbox…");
        void (async () => {
          try {
            const res = await simulateNextInbound(orderId);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = withFundedAtStamp(res.escrow); });
            if (res.action === "waiting" || res.action === "nothing") toast(res.detail);
            else toast.success(res.detail);
          } catch (e) { toast.error(errMsg(e)); }
        })();
      },
      // Unlike checkEscrowInbox, never calls simulate-next-inbound — only ticks the real backend,
      // so a genuine email already ingested by scripts/poll_gmail_inbox.py gets reacted to without
      // fabricating a synthetic one alongside it.
      syncRealInbox: (orderId) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        if (e.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        toast.message("Syncing with escrow-agents…");
        void (async () => {
          try {
            const res = await tickEscrowOrder(orderId);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = withFundedAtStamp(res.escrow); });
            if (res.action === "waiting" || res.action === "nothing") toast(res.detail);
            else toast.success(res.detail);
          } catch (e) { toast.error(errMsg(e)); }
        })();
      },
      // First-ever invoice fetch — once an invoice already exists, escrow-agents has moved past
      // this check entirely (its state machine is one-shot per step, see orchestrator.py), so this
      // only does anything useful while status === SELLER_CONFIRMED and no invoice exists yet.
      simulateEscrowInvoiceEmail: (orderId) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        if (e.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        if (ESCROW_STATUS_ORDER.indexOf(e.status) < ESCROW_STATUS_ORDER.indexOf("SELLER_CONFIRMED")) {
          toast.error("The invoice only arrives once the seller has accepted the order."); return;
        }
        toast.message("Escrow Agent checking inbox…");
        void (async () => {
          try {
            const res = await simulateNextInbound(orderId);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = withFundedAtStamp(res.escrow); });
            toast[res.action === "advanced" ? "success" : "message"](res.detail);
          } catch (e) { toast.error(errMsg(e)); }
        })();
      },
      uploadEscrowInvoiceManually: (orderId, input) => {
        const cur = get().orders[orderId]?.escrow;
        if (cur?.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        if (!cur || ESCROW_STATUS_ORDER.indexOf(cur.status) < ESCROW_STATUS_ORDER.indexOf("SELLER_CONFIRMED")) {
          toast.error("The invoice only arrives once the seller has accepted the order."); return;
        }
        void (async () => {
          try {
            const escrow = await uploadEscrowInvoiceManuallyApi(orderId, input);
            set((s) => { const bb = s.orders[orderId]; if (bb) bb.escrow = escrow; });
            toast.success(`Invoice ${input.invoiceNo} attached`);
          } catch (e) { toast.error(errMsg(e)); }
        })();
      },

      // Fetches the buyer PO + supplier PI as evidence documents for the escrow order.
      simulateEscrowPoPiFetch: (orderId) => {
        const b = get().orders[orderId]; if (!b?.escrow) return;
        if (b.escrow.cancelledAt) { toast.error("This escrow order was cancelled."); return; }
        toast.message("Escrow Agent checking inbox for PO / PI…");
        void (async () => {
          try {
            const res = await escrowAgentFetchPoPi({ orderRef: b.orderNo });
            set((s) => {
              const bb = s.orders[orderId]; if (!bb) return;
              bb.escrow?.agentEmails.push(res.email);
              if (!bb.piNo) bb.piNo = res.piNo;
              bb.documents.push({ id: uid("doc"), subjectType: "ORDER", docType: "PO", fileName: res.poFileName, uploadedBy: "Escrow Agent", uploadedAt: today() });
              bb.documents.push({ id: uid("doc"), subjectType: "ORDER", docType: "PI", fileName: res.piFileName, uploadedBy: "Escrow Agent", uploadedAt: today() });
            });
            toast.success("Escrow Agent: fetched PO + PI");
          } catch (e) { toast.error(`Escrow Agent: ${errMsg(e)}`); }
        })();
      },

      // Final settlement receipt — only meaningful once escrow has actually released funds.
      simulatePaymentClosureFetch: (orderId) => {
        const b = get().orders[orderId]; const e = b?.escrow; if (!b || !e) return;
        if (e.status !== "RELEASED_TO_SELLER") { toast.error("Payment closure isn't issued until escrow reaches Released to Seller."); return; }
        const documentNo = e.paymentClosure?.documentNo ?? `PC${today().replace(/-/g, "").slice(2, 6)}-${shortRef()}`;
        toast.message("Escrow Agent checking inbox for payment closure…");
        void (async () => {
          try {
            const res = await escrowAgentFetchPaymentClosure({ orderRef: b.orderNo, documentNo, releasedAmount: e.poAmount });
            set((s) => {
              const bb = s.orders[orderId]; const ee = bb?.escrow; if (!bb || !ee) return;
              ee.agentEmails.push(res.email);
              ee.paymentClosure = res.closure;
              bb.documents.push({ id: uid("doc"), subjectType: "ESCROW", docType: "PAYMENT_CLOSURE", fileName: res.email.attachmentFileName ?? `${documentNo}.pdf`, uploadedBy: "Escrow Agent", uploadedAt: today() });
            });
            toast.success(`Escrow Agent: fetched payment closure ${res.closure.documentNo}`);
          } catch (e) { toast.error(`Escrow Agent: ${errMsg(e)}`); }
        })();
      },
      uploadPaymentClosureManually: (orderId, input) => {
        const cur = get().orders[orderId]?.escrow;
        if (cur?.status !== "RELEASED_TO_SELLER") { toast.error("Payment closure isn't issued until escrow reaches Released to Seller."); return; }
        const receivedAt = today();
        set((s) => {
          const b = s.orders[orderId]; const e = b?.escrow; if (!b || !e) return;
          e.paymentClosure = { documentNo: input.documentNo, releasedAmount: input.releasedAmount, receivedAt };
          b.documents.push({ id: uid("doc"), subjectType: "ESCROW", docType: "PAYMENT_CLOSURE", fileName: `${input.documentNo}.pdf`, uploadedBy: "You (demo)", uploadedAt: receivedAt });
        });
        toast.success(`Payment closure ${input.documentNo} attached`);
      },

      addPayment: (orderId, p) => { set((s) => {
        const b = s.orders[orderId]; if (!b) return;
        b.payments.push({ id: uid("pay"), direction: p.direction, mode: p.mode, triggerDoc: p.triggerDoc, amount: p.amount, currency: b.currency, status: "PENDING", dueDate: p.dueDate });
      }); toast.success("Payment task created"); },
      setPaymentStatus: (orderId, payId, status, attachment) => {
        set((s) => { const p = s.orders[orderId]?.payments.find((x) => x.id === payId); if (p) { p.status = status; if (status === "PAID") { p.paidAt = today(); if (attachment) p.attachment = attachment; } } });
        toast.success(`Payment ${status.toLowerCase()}${attachment ? ` · ${attachment} attached` : ""}`);
      },
      // Banking adapter: initiate the T/T → INITIATED (providerRef), then poll clearing → PAID (UTR).
      initiatePaymentTransfer: (orderId, payId) => {
        const p0 = get().orders[orderId]?.payments.find((x) => x.id === payId);
        const b = get().orders[orderId];
        if (!p0 || !b) return;
        if (p0.status === "PAID") { toast("Already paid"); return; }
        const beneficiary = p0.direction === "CLIENT_TO_1BUY" ? "SHARPBUY-NOSTRO" : b.supplier.name;
        toast.message("Initiating T/T…");
        void (async () => {
          try {
            const ack = await bankInitiateTransfer({ payId, direction: p0.direction, amount: p0.amount, currency: p0.currency, beneficiary });
            set((s) => { const p = s.orders[orderId]?.payments.find((x) => x.id === payId); if (p) { p.status = "INITIATED"; p.providerRef = ack.providerRef; } });
            toast.success(`T/T initiated (${ack.providerRef})`);
            const cleared = await bankGetTransferStatus(ack.providerRef, p0.amount);
            set((s) => { const p = s.orders[orderId]?.payments.find((x) => x.id === payId); if (p) { p.status = cleared.status === "CLEARED" ? "PAID" : "CANCELLED"; if (cleared.status === "CLEARED") { p.paidAt = today(); p.utr = cleared.utr; } } });
            toast.success(cleared.status === "CLEARED" ? `Cleared - UTR ${cleared.utr}` : "Transfer returned");
          } catch (e) { toast.error(`Banking: ${errMsg(e)}`); }
        })();
      },

      // Pre-booking step 1 — email the supplier for the Packing List / Commercial Invoice (+ COO if intl).
      requestShippingDocs: (orderId, body) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const international = b0.tradeType === "INTERNATIONAL";
        set((s) => { const b = s.orders[orderId]; if (b) b.shippingDocs = { status: "REQUESTED", requestedAt: today(), requested: shippingDocList(international), requestBody: body }; });
        const tid = toast.loading("📡 Calling Supplier Mail — request Packing List / Commercial Invoice…");
        void (async () => {
          try {
            const r = await requestSupplierShippingDocs({ to: b0.supplier.name, orderNo: b0.orderNo, international });
            toast.success(`✓ Docs requested from ${b0.supplier.name} — ${r.requested.join(", ")}`, { id: tid });
          } catch (e) { toast.error(`Supplier Mail — request failed: ${errMsg(e)}`, { id: tid }); }
        })();
      },
      // Pre-booking step 2 — parse the supplier's reply into booking particulars (weight/dims/HS/value).
      receiveShippingDocs: (orderId) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        if (b0.shippingDocs?.status !== "REQUESTED") { toast.error("Request the documents from the supplier first."); return; }
        const totalQty = b0.lines.reduce((a, l) => a + remainingToShipLeg(b0, l.mpn, "INBOUND"), 0);
        const international = b0.tradeType === "INTERNATIONAL";
        const tid = toast.loading("📡 Calling Document Extraction — parsing supplier packing list & invoice…");
        void (async () => {
          try {
            const x = await extractSupplierShippingDocs({ totalQty, buyTotal: b0.buyTotal, currency: b0.currency, international });
            set((s) => { const b = s.orders[orderId]; if (b) b.shippingDocs = { status: "RECEIVED", requestedAt: b.shippingDocs?.requestedAt, receivedAt: today(), requested: b.shippingDocs?.requested ?? shippingDocList(international), pieces: x.pieces, grossWeightKg: x.grossWeightKg, dimensions: x.dimensions, hsCode: x.hsCode, goodsDescription: x.goodsDescription, declaredValue: x.declaredValue, declaredCurrency: x.declaredCurrency, docs: x.docs }; });
            toast.success(`✓ Supplier replied — ${x.pieces} pcs · ${x.grossWeightKg} kg · ${x.docs.join(", ")}`, { id: tid });
          } catch (e) { toast.error(`Document Extraction failed: ${errMsg(e)}`, { id: tid }); }
        })();
      },

      createShipment: (orderId, input) => {
        const b = get().orders[orderId]; if (!b) return null;
        const lines = input.lines.map((l) => ({ mpn: l.mpn, qty: Math.min(l.qty, remainingToShipLeg(b, l.mpn, input.leg)) })).filter((l) => l.qty > 0);
        if (lines.length === 0) { toast.error("Nothing to ship (qty exceeds remaining for this leg)"); return null; }
        const id = uid("shp");
        const shipmentNo = `SHP-${input.leg === "INBOUND" ? "IN" : "OUT"}-${b.shipments.length + 1}`;
        // Incoterm decides who books the carrier. When it's the supplier's responsibility
        // (C/D terms) they've already booked, so we don't call the logistics API — we just
        // record the AWB they gave us (and can still poll tracking, as we have the DHL API).
        const prebooked = !!(input.awb && input.awb.trim());
        set((s) => {
          const bb = s.orders[orderId]; if (!bb) return;
          bb.shipments.push({ id, shipmentNo, leg: input.leg, awb: prebooked ? input.awb!.trim() : "booking…", carrier: input.carrier, fromLocation: input.fromLocation, toLocation: input.toLocation,
            boxCount: input.boxCount, grossWeightKg: input.grossWeightKg, status: "PLANNED", lines, updatedAt: stamp(),
            packages: input.packages, dimensions: input.dimensions, goodsDescription: input.goodsDescription, hsCode: input.hsCode,
            declaredValue: input.declaredValue, declaredCurrency: input.declaredCurrency,
            pickupReadyDate: input.pickupReadyDate, bookingDocs: input.bookingDocs,
            productCode: input.productCode, productName: input.productName, rateAmount: input.rateAmount,
            rateCurrency: input.rateCurrency, estimatedDelivery: input.estimatedDelivery, bookingMode: input.bookingMode });
        });
        // Logistics → Customs desk: queue a (prior) BoE now — create the customs entry so it shows on
        // the Customs desk immediately, and mail the Customs team to file it (no wait for arrival at port).
        if (input.notifyCustomsBoe && input.leg === "INBOUND" && weClearImportCustoms(b)) {
          const sd = b.shippingDocs;
          set((s) => {
            const bb = s.orders[orderId]; if (!bb) return;
            if (!bb.customs.some((c) => c.shipmentNo === shipmentNo)) {
              bb.customs.push({ id: uid("ce"), shipmentNo, portCode: "INDEL4", chaName: "Speedwing CHA", currency: "INR", assessableValue: sd?.declaredValue, docs: sd?.docs });
            }
          });
          const ftid = toast.loading("📡 Calling Mail — notify the Customs team to file the BoE (Prior)…");
          void (async () => {
            try {
              await notifyCustomsTeamToFileBoe({ orderNo: b.orderNo, shipmentNo });
              toast.success(`✓ Customs team notified to file the BoE for ${shipmentNo} — queued on the Customs desk`, { id: ftid });
            } catch (e) { toast.error(`Mail — notify failed: ${errMsg(e)}`, { id: ftid }); }
          })();
        }
        if (prebooked) {
          toast.success(`Inbound shipment recorded · supplier AWB ${input.awb!.trim()}`);
          return id;
        }
        const bookProvider = CARRIER_API[input.carrier] ?? input.carrier;
        const bookTid = toast.loading(`📡 Calling ${bookProvider} — Book Shipment API…`);
        // Logistics adapter: the carrier assigns the real AWB + tracking URL asynchronously
        void (async () => {
          try {
            // Pickup modes: COMBINED = scheduled inline with the shipment (pickup rides on POST /shipments,
            // no separate call); SEPARATE = its own POST /pickups after booking. No pickupDate = no pickup.
            const wantsPickup = !!input.pickupDate;
            const inlinePickup = wantsPickup && input.bookingMode !== "SEPARATE";
            const booked = await bookShipment({ carrier: (input.carrier as Carrier) || "DHL", leg: input.leg, reference: shipmentNo, from: input.fromLocation, to: input.toLocation, pieces: input.boxCount, weightKg: input.grossWeightKg, pickup: inlinePickup ? { date: input.pickupDate!, closeTime: input.pickupCloseTime ?? "18:00" } : undefined });
            set((s) => { const sh = s.orders[orderId]?.shipments.find((x) => x.id === id); if (sh) {
              sh.awb = booked.awb; sh.carrierRef = booked.carrierRef; sh.trackingUrl = booked.trackingUrl; sh.updatedAt = stamp();
              if (inlinePickup && booked.pickupConfirmationNumber) { sh.pickupConfirmationNo = booked.pickupConfirmationNumber; sh.pickupWindow = `${input.pickupDate} · by ${booked.readyByTime}`; }
            } });
            toast.success(`✓ ${bookProvider} — AWB ${booked.awb} booked${inlinePickup ? ` · pickup ${booked.pickupConfirmationNumber} (combined)` : ""}`, { id: bookTid });
            // SEPARATE only: schedule the pickup as its own POST /pickups call.
            if (wantsPickup && input.bookingMode === "SEPARATE") {
              const ptid = toast.loading(`📡 Calling ${bookProvider} — Schedule Pickup API…`);
              try {
                const p = await dhlCreatePickup({ from: input.fromLocation, date: input.pickupDate!, closeTime: input.pickupCloseTime ?? "18:00" });
                set((s) => { const sh = s.orders[orderId]?.shipments.find((x) => x.id === id); if (sh) { sh.pickupConfirmationNo = p.dispatchConfirmationNumber; sh.pickupWindow = `${input.pickupDate} · by ${p.readyByTime}`; sh.updatedAt = stamp(); } });
                toast.success(`✓ Pickup scheduled · ${p.dispatchConfirmationNumber} (separate)`, { id: ptid });
              } catch (e) { toast.error(`${bookProvider} pickup: ${errMsg(e)}`, { id: ptid }); }
            }
          } catch (e) { set((s) => { const sh = s.orders[orderId]?.shipments.find((x) => x.id === id); if (sh) sh.awb = "booking failed"; }); toast.error(`${bookProvider} — booking failed: ${errMsg(e)}`, { id: bookTid }); }
        })();
        return id;
      },
      setShipmentStatus: (orderId, shipId, status) => {
        set((s) => { const bb = s.orders[orderId]; const sh = bb?.shipments.find((x) => x.id === shipId);
          if (sh) { sh.status = status; sh.updatedAt = stamp(); if (status === "DISPATCHED") sh.dispatchDate = today(); if (status === "DELIVERED" || status === "ARRIVED") sh.deliveryDate = today(); }
          if (bb) autoAdvanceOperational(bb); });
      },
      // Logistics adapter: poll the carrier and advance the shipment one checkpoint.
      pollShipmentTracking: (orderId, shipId) => {
        const b0 = get().orders[orderId];
        const sh = b0?.shipments.find((x) => x.id === shipId);
        if (!b0 || !sh) return;
        if (sh.awb === "booking…" || sh.awb === "booking failed") { toast.error("AWB not booked yet."); return; }
        // Customs hold: an international import that 1Buy clears can't move past "held for customs"
        // until the Bill of Entry is cleared in ICEGATE (out of charge). File it on the Customs tab.
        if (sh.status === "AT_CUSTOMS" && sh.leg === "INBOUND" && weClearImportCustoms(b0)) {
          const cleared = b0.customs.some((c) => c.shipmentNo === sh.shipmentNo && !!c.icegateRef);
          if (!cleared) { toast.error("Held at customs — file the Bill of Entry (Customs tab); the shipment clears once ICEGATE gives out-of-charge."); return; }
        }
        const trackSeq: ShipmentStatus[] = ["DISPATCHED", "IN_TRANSIT", "AT_CUSTOMS", "ARRIVED", "DELIVERED"];
        const hopsDone = trackSeq.indexOf(sh.status) + 1; // PLANNED → 0 → first checkpoint
        const trackProvider = CARRIER_API[sh.carrier] ?? sh.carrier;
        const trackTid = toast.loading(`📡 Calling ${trackProvider} — Track Shipment API…`);
        void (async () => {
          try {
            const t = await getTracking(sh.awb, hopsDone, sh.fromLocation, sh.toLocation);
            set((s) => { const bb = s.orders[orderId]; const x = bb?.shipments.find((y) => y.id === shipId); if (x) { x.status = t.mappedStatus; x.lastLocation = t.lastLocation; x.updatedAt = stamp(); if (t.mappedStatus === "DISPATCHED") x.dispatchDate = today(); if (t.mappedStatus === "DELIVERED" || t.mappedStatus === "ARRIVED") x.deliveryDate = today(); } if (bb) autoAdvanceOperational(bb); });
            toast.success(`📦 ${trackProvider} — ${t.mappedStatus} · ${t.lastLocation}`, { id: trackTid });
          } catch (e) { toast.error(`${trackProvider} — tracking failed: ${errMsg(e)}`, { id: trackTid }); }
        })();
      },

      // DHL pickup management — reschedule (PATCH) / cancel (DELETE) a scheduled pickup.
      reschedulePickup: (orderId, shipId, date, closeTime) => {
        const sh = get().orders[orderId]?.shipments.find((x) => x.id === shipId);
        if (!sh?.pickupConfirmationNo) { toast.error("No pickup to reschedule."); return; }
        const conf = sh.pickupConfirmationNo;
        const tid = toast.loading("📡 Calling DHL Global Forwarding — Update Pickup API…");
        void (async () => {
          try {
            const p = await dhlUpdatePickup({ dispatchConfirmationNumber: conf, date, closeTime });
            set((s) => { const x = s.orders[orderId]?.shipments.find((y) => y.id === shipId); if (x) { x.pickupWindow = `${date} · by ${p.readyByTime}`; x.updatedAt = stamp(); } });
            toast.success(`✓ Pickup ${conf} rescheduled · ${date} by ${p.readyByTime}`, { id: tid });
          } catch (e) { toast.error(`DHL pickup: ${errMsg(e)}`, { id: tid }); }
        })();
      },
      cancelPickup: (orderId, shipId) => {
        const sh = get().orders[orderId]?.shipments.find((x) => x.id === shipId);
        if (!sh?.pickupConfirmationNo) { toast.error("No pickup to cancel."); return; }
        const conf = sh.pickupConfirmationNo;
        const tid = toast.loading("📡 Calling DHL Global Forwarding — Cancel Pickup API…");
        void (async () => {
          try {
            await dhlCancelPickup({ dispatchConfirmationNumber: conf, reason: "Rescheduled by supplier" });
            set((s) => { const x = s.orders[orderId]?.shipments.find((y) => y.id === shipId); if (x) { x.pickupConfirmationNo = undefined; x.pickupWindow = undefined; x.updatedAt = stamp(); } });
            toast.success(`✓ Pickup ${conf} cancelled (no fee)`, { id: tid });
          } catch (e) { toast.error(`DHL pickup: ${errMsg(e)}`, { id: tid }); }
        })();
      },
      // DHL document retrieval — pull the waybill + commercial invoice PDFs (the packet the CHA files with).
      retrieveCarrierDocs: (orderId, shipId) => {
        const sh = get().orders[orderId]?.shipments.find((x) => x.id === shipId);
        if (!sh || sh.awb === "booking…" || sh.awb === "booking failed") { toast.error("AWB not booked yet."); return; }
        const tid = toast.loading("📡 Calling DHL Global Forwarding — Get Invoices API…");
        void (async () => {
          try {
            const r = await dhlGetInvoices(sh.awb);
            set((s) => { const x = s.orders[orderId]?.shipments.find((y) => y.id === shipId); if (x) { x.carrierDocs = r.documents; x.updatedAt = stamp(); } });
            toast.success(`✓ Retrieved ${r.documents.map((d) => d.typeCode).join(" + ")} from DHL`, { id: tid });
          } catch (e) { toast.error(`DHL docs: ${errMsg(e)}`, { id: tid }); }
        })();
      },
      // DHL /upload-image — attach a corrected commercial invoice after booking (customs flagged it, etc.).
      correctCarrierInvoice: (orderId, shipId) => {
        const sh = get().orders[orderId]?.shipments.find((x) => x.id === shipId);
        if (!sh || sh.awb === "booking…" || sh.awb === "booking failed") { toast.error("AWB not booked yet."); return; }
        const tid = toast.loading("📡 Calling DHL Global Forwarding — Upload Image (correct CI) API…");
        void (async () => {
          try {
            await dhlUploadImage({ awb: sh.awb, typeCode: "INV" });
            set((s) => { const x = s.orders[orderId]?.shipments.find((y) => y.id === shipId); if (x) x.updatedAt = stamp(); });
            toast.success("✓ Corrected commercial invoice re-attached to the shipment", { id: tid });
          } catch (e) { toast.error(`DHL upload: ${errMsg(e)}`, { id: tid }); }
        })();
      },

      // ICEGATE step 1 — file the Bill of Entry (Prior or on-arrival). Assessment / duty / OOC are
      // now separate steps (assessCustoms → payCustomsDuty → clearCustoms), so the flow mirrors the
      // real clearance sequence and the shipment stays held at customs until OOC issues the ref.
      // File a Bill of Entry two ways — directly on ICEGATE (API) or by mailing the docs to the CHA who
      // files it. Either way we then auto-run the IGM match (if landed) + faceless assessment so the
      // entry lands ready for duty payment — no manual IGM/assess micro-steps.
      fileBOE: (orderId, e) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const shp = b0.shipments.find((x) => x.shipmentNo === e.shipmentNo);
        const ceId = uid("ce");
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          const existing = b.customs.find((c) => c.shipmentNo === e.shipmentNo);
          const entry = { id: existing?.id ?? ceId, shipmentNo: e.shipmentNo, beNo: "filing…", beDate: today(), portCode: e.portCode, chaName: e.chaName, currency: "INR", boeType: e.boeType, assessableValue: e.assessableValue, docs: e.docs ?? b0.shippingDocs?.docs, filingMode: e.mode, awbSentToChaAt: e.mode === "CHA" ? today() : existing?.awbSentToChaAt, igmStatus: undefined, igmNo: undefined, igmItemNo: undefined, stage: "FILED" as const, totalDuty: undefined, duty: undefined, assessment: undefined, query: undefined, queryResolvedAt: undefined, dutyPaidAt: undefined, dutyInvoice: undefined, icegateRef: undefined, oocDate: undefined, filedAt: undefined };
          if (existing) Object.assign(existing, entry); else b.customs.push(entry);
          if (e.awb) { const sh = b.shipments.find((x) => x.shipmentNo === e.shipmentNo); if (sh && sh.awb !== e.awb) { sh.awb = e.awb; sh.updatedAt = stamp(); } }
        });
        const fileTid = toast.loading(e.mode === "CHA" ? "📡 Calling Mail — send BoE docs to CHA…" : "📡 Calling ICEGATE — File Bill of Entry API…");
        void (async () => {
          try {
            if (e.mode === "CHA" && shp) await sendAwbToChaMail({ cha: e.chaName, orderNo: b0.orderNo, shipmentNo: e.shipmentNo, awb: shp.awb });
            const filed = await fileBillOfEntry({ orderId, shipmentNo: e.shipmentNo, portCode: e.portCode, chaName: e.chaName, assessableValue: e.assessableValue });
            set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.shipmentNo === e.shipmentNo); if (c) { c.beNo = filed.beNo; c.beDate = filed.beDate; c.icegateAckNo = filed.icegateAckNo; c.stage = "FILED"; } });
            toast.success(e.mode === "CHA" ? `✓ Docs sent to CHA — BoE ${filed.beNo} filed on ICEGATE` : `✓ BoE ${filed.beNo} filed on ICEGATE (${e.boeType === "PRIOR" ? "Prior" : "on-arrival"})`, { id: fileTid });
            // IGM match (once the flight has landed) — informational, not a gate
            if (shp && ["AT_CUSTOMS", "ARRIVED", "DELIVERED"].includes(shp.status)) {
              try { const igm = await getIgmEntry({ awb: shp.awb, portCode: e.portCode }); set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.shipmentNo === e.shipmentNo); if (c) { c.igmNo = igm.igmNo; c.igmItemNo = igm.itemNo; c.igmStatus = "MATCHED"; } }); } catch { /* manifest not found yet — Prior BoE */ }
            }
            // faceless assessment → duty (Pending payment)
            const atid = toast.loading("📡 Calling ICEGATE — Faceless Assessment API…");
            const a = await getAssessment(filed.beNo, e.assessableValue);
            set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.shipmentNo === e.shipmentNo); if (c) { c.duty = a.duty; c.totalDuty = a.duty.totalDuty; c.stage = "ASSESSED"; } });
            toast.success(`✓ Assessed — duty INR ${a.duty.totalDuty.toLocaleString()} · ready for payment`, { id: atid });
          } catch (err) { toast.error(`Filing failed: ${errMsg(err)}`, { id: fileTid }); }
        })();
      },
      // CHA hand-off — send the AWB (+ docs) to the CHA so they can file the BoE and link the IGM.
      sendAwbToCha: (orderId, customsId) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const c0 = b0.customs.find((x) => x.id === customsId); if (!c0) return;
        const sh = b0.shipments.find((s) => s.shipmentNo === c0.shipmentNo);
        if (!sh || sh.awb === "booking…" || sh.awb === "booking failed") { toast.error("No AWB yet — book the shipment (or add the AWB) first."); return; }
        set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.id === customsId); if (c) c.awbSentToChaAt = today(); });
        const tid = toast.loading(`📡 Calling Mail — send AWB ${sh.awb} + docs to CHA ${c0.chaName ?? ""}…`);
        void (async () => {
          try {
            await sendAwbToChaMail({ cha: c0.chaName ?? "CHA", orderNo: b0.orderNo, shipmentNo: c0.shipmentNo, awb: sh.awb });
            toast.success(`✓ AWB ${sh.awb} sent to CHA — they can file & link the BoE to the IGM`, { id: tid });
          } catch (e) { toast.error(`Mail — send failed: ${errMsg(e)}`, { id: tid }); }
        })();
      },
      // IGM linkage — the BoE can only proceed once the courier's manifest (IGM) lists the AWB, i.e.
      // the flight has landed. Before that it's "Manifest Not Found" and a Prior BoE stays pending.
      linkIgm: (orderId, customsId) => {
        const b0 = get().orders[orderId]; if (!b0) return;
        const c0 = b0.customs.find((x) => x.id === customsId);
        if (!c0 || !c0.beNo || c0.beNo === "filing…") { toast.error("File the BoE first."); return; }
        const sh = b0.shipments.find((s) => s.shipmentNo === c0.shipmentNo);
        const landed = !!sh && ["AT_CUSTOMS", "ARRIVED", "DELIVERED"].includes(sh.status);
        if (!landed) { toast.error("Manifest Not Found — the courier hasn't filed the IGM yet (flight not landed). The Prior BoE stays pending until your AWB appears in a filed manifest."); return; }
        const tid = toast.loading("📡 Calling ICEGATE — matching AWB against filed IGMs…");
        void (async () => {
          try {
            const igm = await getIgmEntry({ awb: sh!.awb, portCode: c0.portCode });
            set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.id === customsId); if (c) { c.igmNo = igm.igmNo; c.igmItemNo = igm.itemNo; c.igmStatus = "MATCHED"; c.stage = "IGM_LINKED"; } });
            toast.success(`✓ Manifest matched — IGM ${igm.igmNo} item ${igm.itemNo} · AWB ${sh!.awb}. BoE linked; assessment can proceed.`, { id: tid });
          } catch (e) { toast.error(`ICEGATE — IGM lookup failed: ${errMsg(e)}`, { id: tid }); }
        })();
      },
      // ICEGATE step 2 — faceless assessment: computes duty + auto-clears or flags for a query.
      assessCustoms: (orderId, customsId) => {
        const c0 = get().orders[orderId]?.customs.find((x) => x.id === customsId);
        if (!c0 || !c0.beNo || c0.beNo === "filing…") { toast.error("File the BOE first."); return; }
        if (c0.stage !== "IGM_LINKED") { toast.error("Link the IGM first — the courier's manifest must list your AWB before assessment."); return; }
        const assessTid = toast.loading("📡 Calling ICEGATE — Faceless Assessment API…");
        void (async () => {
          try {
            const a = await getAssessment(c0.beNo!, c0.assessableValue ?? 0);
            set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.id === customsId); if (c) { c.duty = a.duty; c.totalDuty = a.duty.totalDuty; c.assessment = a.review; c.query = a.query; c.stage = "ASSESSED"; } });
            if (a.review === "FLAGGED") toast.warning(`🚩 ICEGATE flagged — ${a.query}`, { id: assessTid });
            else toast.success("✓ ICEGATE — auto-cleared by faceless assessment", { id: assessTid });
          } catch (err) { toast.error(`ICEGATE — assessment failed: ${errMsg(err)}`, { id: assessTid }); }
        })();
      },
      // ICEGATE step 2b — respond to a flagged query (valuation/HS/BIS), unblocking duty payment.
      respondCustomsQuery: (orderId, customsId) => {
        const c0 = get().orders[orderId]?.customs.find((x) => x.id === customsId);
        if (!c0 || c0.assessment !== "FLAGGED") return;
        set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.id === customsId); if (c) c.queryResolvedAt = today(); });
        toast.success("Query response submitted to customs — assessment resolved");
      },
      // Pay assessed duty (BCD + SWS + IGST) on ICEGATE — from the Payments desk, with the challan/invoice.
      payCustomsDuty: (orderId, customsId, invoice) => {
        const c0 = get().orders[orderId]?.customs.find((x) => x.id === customsId);
        if (!c0 || !(c0.duty || c0.stage === "ASSESSED")) { toast.error("Not assessed yet — file the BoE first."); return; }
        if (c0.dutyPaidAt) { toast.error("Duty already paid for this BoE."); return; }
        set((s) => { const c = s.orders[orderId]?.customs.find((x) => x.id === customsId); if (c) { c.dutyPaidAt = today(); c.dutyInvoice = invoice; c.stage = "DUTY_PAID"; } });
        toast.success(`✓ Duty paid on ICEGATE — ${c0.currency ?? "INR"} ${(c0.duty?.totalDuty ?? c0.totalDuty ?? 0).toLocaleString()}${invoice ? ` · ${invoice}` : ""}`);
      },
      // ICEGATE step 4 — Out-of-Charge: issues the ICEGATE ref and releases the shipment's customs hold.
      clearCustoms: (orderId, customsId) => {
        const c0 = get().orders[orderId]?.customs.find((x) => x.id === customsId);
        if (!c0 || c0.stage !== "DUTY_PAID" || !c0.beNo) { toast.error("Pay the duty first."); return; }
        const oocTid = toast.loading("📡 Calling ICEGATE — Out-of-Charge API…");
        void (async () => {
          try {
            const cleared = await getClearanceStatus(c0.beNo!);
            set((s) => { const bb = s.orders[orderId]; const c = bb?.customs.find((x) => x.id === customsId); if (c) { c.icegateRef = cleared.icegateRef; c.oocDate = cleared.oocDate; c.filedAt = cleared.oocDate; c.stage = "CLEARED"; } if (bb) autoAdvanceOperational(bb); });
            toast.success(`✓ ICEGATE — Out of Charge ${cleared.icegateRef}. Shipment released from customs.`, { id: oocTid });
          } catch (err) { toast.error(`ICEGATE — clearance failed: ${errMsg(err)}`, { id: oocTid }); }
        })();
      },

      allocateDelivery: (orderId, a) => {
        const b = get().orders[orderId]; if (!b) return false;
        // segregation guard: only deliver to a client line THIS order actually sourced, and never past what it owes
        const committed = orderSourcedForClient(b, a.clientPoNo, a.clientLineMpn);
        if (committed <= 0) { toast.error(`This order didn't source ${a.clientLineMpn} for ${a.clientPoNo} - map it first (Allocations tab).`); return false; }
        const physical = remainingToAllocate(b, a.clientLineMpn);
        const clientRemaining = committed - deliveredForClientLine(b, a.clientPoNo, a.clientLineMpn);
        const cap = Math.min(physical, clientRemaining);
        if (a.qty <= 0 || a.qty > cap) { toast.error(`Qty 1-${Math.max(0, cap)} (received ${physical}, still owed to this client ${Math.max(0, clientRemaining)}).`); return false; }
        set((s) => { s.orders[orderId]?.deliveries.push({ id: uid("da"), fromShipmentNo: a.fromShipmentNo, clientPoNo: a.clientPoNo, clientLineMpn: a.clientLineMpn, qty: a.qty, decidedBy: "You (demo)", decidedAt: today() }); });
        toast.success(`Allocated ${a.qty} → ${a.clientPoNo}`);
        return true;
      },
      issueGrn: (orderId, lines, discrepancy) => {
        /*
         * Guard first. A receipt issued twice would give the order two
         * acceptance dates, and "delivered" is computed from this — so a second
         * one would silently move the date the customer is told.
         */
        const b = get().orders[orderId];
        if (!b) return;
        if (b.grn) { toast.error("A goods receipt note has already been issued for this order"); return; }
        if (!lines.length) { toast.error("Nothing to receive"); return; }
        const grnNo = `GRN-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 8999)}`;
        set((s) => {
          const bb = s.orders[orderId];
          if (!bb) return;
          bb.grn = { grnNo, receivedAt: today(), receivedBy: ME, lines, discrepancy: discrepancy?.trim() || undefined };
          bb.events.unshift({
            id: uid("ev"),
            eventType: "GRN_ISSUED",
            message: `${grnNo} issued — ${lines.reduce((a, l) => a + l.receivedQty, 0)} received${discrepancy ? `. ${discrepancy}` : ""}`,
            source: "SC_MANUAL",
            occurredAt: today(),
            recordedBy: ME,
          });
        });
        toast.success(`${grnNo} issued`, {
          description: "The order counts as delivered once proof of delivery is back from the carrier too.",
        });
      },

      recordInboundPod: (orderId, podRef) => {
        /*
         * Guard first. The POD is half of "delivered" — recording it against
         * nothing, or twice, would move the date the customer is told.
         */
        const b = get().orders[orderId];
        if (!b) return;
        const leg = b.shipments.find((x) => x.leg === "INBOUND");
        if (!leg || leg.awb === "booking…" || leg.awb === "booking failed") { toast.error("No inbound shipment to record a proof of delivery against"); return; }
        if (leg.pod) { toast("Proof of delivery is already on file for this consignment"); return; }
        set((s) => {
          const sh = s.orders[orderId]?.shipments.find((x) => x.id === leg.id);
          if (!sh) return;
          sh.pod = today();
          sh.podRef = podRef?.trim() || undefined;
          s.orders[orderId]!.events.unshift({
            id: uid("ev"),
            eventType: "POD_RECEIVED",
            message: `Proof of delivery back from ${sh.carrier}${podRef?.trim() ? ` · ${podRef.trim()}` : ""}`,
            source: "SC_MANUAL",
            occurredAt: today(),
            recordedBy: ME,
          });
        });
        const grnDone = Boolean(get().orders[orderId]?.grn);
        toast.success("Proof of delivery recorded", {
          description: grnDone
            ? "The goods receipt note was already issued — this order is now delivered."
            : "The order counts as delivered once the warehouse issues the goods receipt note too.",
        });
      },

      sendLogisticsMessage: (orderId, m) => {
        const b = get().orders[orderId];
        if (!b) return;
        if (!m.toEmail.trim()) { toast.error("Type the recipient's email address"); return; }
        if (!m.subject.trim() || !m.body.trim()) { toast.error("A subject and a message are both needed"); return; }
        const contact = m.toEmail.trim();
        /* Who this is, read off the address unless the reply flow already knows. */
        const party = m.withParty ?? inferLogisticsParty(b, contact);
        const cc = m.cc?.map((x) => x.trim()).filter(Boolean);
        const bcc = m.bcc?.map((x) => x.trim()).filter(Boolean);
        void (async () => {
          try {
            await sendLogisticsMail({ party, to: contact, cc, bcc, subject: m.subject.trim(), body: m.body.trim(), orderNo: b.orderNo });
            const id = uid("lm");
            set((s) => {
              const bb = s.orders[orderId];
              if (!bb) return;
              (bb.logisticsThread ??= []).push({
                id, threadId: m.threadId, with: party, way: "OUT",
                subject: m.subject.trim(), body: m.body.trim(), at: stamp(), who: contact,
                cc: cc?.length ? cc : undefined, bcc: bcc?.length ? bcc : undefined,
              });
              /* Filed at write time — ticked filters ride with the send. */
              if (m.categories?.length) (bb.logisticsEmailCategories ??= {})[id] = m.categories;
            });
            toast.success(m.threadId ? "Reply sent — added to the chain" : "Sent", { description: contact });
          } catch { toast.error("Send failed — mail relay unavailable"); }
        })();
      },

      checkLogisticsInbox: (orderId) => {
        const b = get().orders[orderId];
        if (!b) return;
        /*
         * A party owes a reply when our newest message to them is more recent
         * than their newest to us. Polling answers exactly those, nothing else —
         * an inbox that invents unprompted mail would drown the real thread.
         */
        const thread = b.logisticsThread ?? [];
        const parties = Array.from(new Set(thread.map((m) => m.with))) as LogisticsParty[];
        const pending = parties.filter((p) => {
          const last = [...thread].reverse().find((m) => m.with === p);
          return last?.way === "OUT";
        }).map((p) => {
          const lastOut = [...thread].reverse().find((m) => m.with === p && m.way === "OUT")!;
          /* The reply belongs to the chain of the mail it answers. */
          return { party: p, subject: lastOut.subject, contact: lastOut.who, threadId: lastOut.threadId ?? lastOut.id };
        });
        if (pending.length === 0) { toast("Nobody owes this thread a reply — nothing to poll for"); return; }
        void (async () => {
          try {
            const res = await fetchLogisticsReplies({ orderNo: b.orderNo, pending });
            set((s) => {
              const bb = s.orders[orderId];
              if (!bb) return;
              for (const r of res.replies) {
                (bb.logisticsThread ??= []).push({
                  id: uid("lm"), threadId: r.threadId, with: r.party, way: "IN",
                  subject: r.subject, body: r.body, at: stamp(), who: r.who,
                  attachments: r.attachments.length ? r.attachments : undefined,
                });
              }
            });
            toast.success(`${res.replies.length} repl${res.replies.length === 1 ? "y" : "ies"} received`);
          } catch { toast.error("Mailbox poll timed out — try again"); }
        })();
      },

      createLogisticsDoc: (orderId, doc) => {
        const b = get().orders[orderId];
        if (!b) return;
        if (!doc.name.trim() || !doc.body.trim()) { toast.error("The document needs a name and its content"); return; }
        if (doc.to.length === 0) { toast.error("Pick at least one recipient — a document sent to nobody is a draft, not a record"); return; }
        void (async () => {
          try {
            /* One mail per recipient — each lands separately on the Integrations board. */
            for (const p of doc.to) {
              await sendLogisticsMail({ party: p, to: logisticsContact(b, p), subject: `${doc.name} · ${b.orderNo}`, body: doc.body.trim(), orderNo: b.orderNo });
            }
            const toLabels = doc.to.map((p) => LOGISTICS_PARTY_LABEL[p]);
            set((s) => {
              const bb = s.orders[orderId];
              if (!bb) return;
              (bb.logisticsOutbox ??= []).push({
                id: uid("ld"), docId: doc.docId, name: doc.name.trim(),
                to: doc.to, at: today(), body: doc.body.trim(),
              });
              bb.events.unshift({
                id: uid("ev"),
                eventType: "LOGISTICS_DOC_SENT",
                message: `${doc.name.trim()} sent to ${toLabels.join(", ")}`,
                source: "SC_MANUAL",
                occurredAt: today(),
                recordedBy: ME,
              });
            });
            toast.success(`${doc.name.trim()} sent`, { description: `To ${toLabels.join(", ")}` });
          } catch { toast.error("Send failed — mail relay unavailable"); }
        })();
      },

      seedLogisticsDemo: (orderId) => {
        const b0 = get().orders[orderId];
        if (!b0) return;
        /*
         * Deliberately overwrites this order's inbound state — that is what a
         * demo loader is for. It stops one step short of done (no GRN, no POD)
         * so the delivered rule is finished by hand, not read about.
         */
        set((s) => {
          const b = s.orders[orderId];
          if (!b) return;
          const d = (offset: number) => { const x = new Date(); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); };
          const awb = "1Z 8842 7719";
          const shipmentNo = `SHP-IN-${b.shipments.filter((x) => x.leg !== "INBOUND").length + 1}`;

          b.shippingDocs = {
            status: "RECEIVED",
            requestedAt: d(-9),
            receivedAt: d(-8),
            requested: ["Packing List", "Commercial Invoice", "Certificate of Origin"],
            docs: ["Packing List", "Commercial Invoice", "Certificate of Origin"],
            pieces: 3,
            grossWeightKg: 26.4,
            dimensions: "40×30×25 ×3",
            hsCode: "8541.10",
            goodsDescription: "Electronic components",
            declaredValue: 18400,
            declaredCurrency: b.currency || "USD",
          };

          b.shipments = [
            ...b.shipments.filter((x) => x.leg !== "INBOUND"),
            {
              id: uid("shp"), shipmentNo, leg: "INBOUND", awb, carrier: "DHL",
              fromLocation: b.supplier.name, toLocation: "1Buy hub — New Delhi",
              boxCount: 3, grossWeightKg: 26.4, dimensions: "40×30×25 ×3",
              dispatchDate: d(-6), status: "ARRIVED",
              lines: b.lines.map((l) => ({ mpn: l.mpn, qty: l.quantity })),
              carrierRef: "DHL-BKG-55021", trackingUrl: "https://www.dhl.com/track?awb=1Z88427719",
              lastLocation: "New Delhi — arrived at destination facility", updatedAt: d(-1),
              productCode: "P", productName: "EXPRESS WORLDWIDE", rateAmount: 412, rateCurrency: "USD",
              estimatedDelivery: d(0), bookingMode: "COMBINED",
              pickupConfirmationNo: "PU-88132", pickupWindow: `${d(-6)} · by 18:00`,
              goodsDescription: "Electronic components", hsCode: "8541.10",
              declaredValue: 18400, declaredCurrency: b.currency || "USD",
              packages: [{ count: 3, weightKg: 8.8, dimensions: "40×30×25" }],
              bookingDocs: ["Packing List", "Commercial Invoice", "Certificate of Origin"],
            },
          ];

          if (b.tradeType === "INTERNATIONAL") {
            b.customs = [{
              id: uid("ce"), shipmentNo, beNo: "BE-7719-2214", beDate: d(-2),
              portCode: "INDEL4", chaName: "Meridian Clearing Co", currency: "INR",
              boeType: "PRIOR", assessableValue: 18400, filingMode: "CHA",
              awbSentToChaAt: d(-5), igmStatus: "MATCHED", igmNo: "IGM-99120", igmItemNo: "042",
              stage: "CLEARED", assessment: "AUTO_CLEAR", dutyPaidAt: d(-1), oocDate: d(-1),
              duty: { bcd: 0, sws: 0, igst: 3312, totalDuty: 3312 },
              docs: ["Packing List", "Commercial Invoice", "Certificate of Origin"],
            }];
          }

          /* Two of the pairs are real chains — reply threaded onto its root —
           * so the mail-chain UI has something to show before anyone sends. */
          const pickupRoot = uid("lm");
          const chaRoot = uid("lm");
          b.logisticsThread = [
            { id: pickupRoot, with: "CARRIER", way: "OUT", subject: `${b.orderNo} — pickup window confirmation`, body: "Please confirm the courier pickup for the booked consignment; supplier dock closes 18:00 local.", at: `${d(-7)} 10:12`, who: "bookings@dhl.com" },
            { id: uid("lm"), threadId: pickupRoot, with: "CARRIER", way: "IN", subject: `Re: ${b.orderNo} — pickup window confirmation`, body: "Pickup confirmed for tomorrow, courier assigned. Status report attached.", at: `${d(-7)} 14:40`, who: "bookings@dhl.com", attachments: ["Shipment status report.pdf"] },
            { id: chaRoot, with: "CHA", way: "OUT", subject: `${b.orderNo} — pre-alert & entry filing`, body: "Pre-alert sent with the full document set. Please file PRIOR so clearance starts before arrival.", at: `${d(-5)} 09:05`, who: "filing@meridian-clearing-co.in" },
            { id: uid("lm"), threadId: chaRoot, with: "CHA", way: "IN", subject: `Re: ${b.orderNo} — pre-alert & entry filing`, body: "Entry filed PRIOR and assessed clean; duty paid and out-of-charge granted on arrival. Filed copy attached.", at: `${d(-1)} 11:20`, who: "filing@meridian-clearing-co.in", attachments: ["Bill of Entry (filed copy).pdf", "Clearance checklist.pdf"] },
            { id: uid("lm"), with: "WAREHOUSE", way: "OUT", subject: `${b.orderNo} — dock slot for final delivery`, body: "Cleared consignment moving from the airport custodian today — please hold a dock slot and count against the packing list.", at: `${d(0)} 08:30`, who: "dock@1buy-hub.in" },
            /* Arrives filed under the carrier; belongs to Finance — the category
             * re-filing exists for exactly this mail. */
            { id: uid("lm"), with: "CARRIER", way: "IN", subject: `Freight invoice INV-8802 — USD 412 · AWB ${awb}`, body: "Invoice for carriage on the referenced consignment, payable 30 days. Please route to your accounts team.", at: `${d(-1)} 16:05`, who: "billing@dhl.com", attachments: ["Freight invoice INV-8802.pdf"] },
          ];

          b.logisticsOutbox = [{
            id: uid("ld"), docId: "PRE_ALERT", name: "Pre-alert pack", to: ["CHA", "WAREHOUSE"], at: d(-5),
            body: `Pre-alert · ${b.orderNo}
Carrier DHL · AWB ${awb}
Expected arrival ${d(0)}
Attached: Packing List, Commercial Invoice, Certificate of Origin
HS 8541.10 · declared ${b.currency || "USD"} 18400
Please pre-file the entry so clearance starts before the goods land.`,
          }];

          b.grn = undefined;
          b.events.unshift({ id: uid("ev"), eventType: "DEMO_SEEDED", message: "Logistics demo flow loaded — cleared customs, at the warehouse door; GRN and POD left to do", source: "SC_MANUAL", occurredAt: today(), recordedBy: ME });
        });
        toast.success("Demo flow loaded", {
          description: "Docs received, booked, cleared customs, arrived. Finish it: issue the GRN and record the POD — that is what makes it delivered.",
        });
      },

      setLogisticsEmailCategories: (orderId, itemId, categories) => {
        set((s) => {
          const b = s.orders[orderId];
          if (!b) return;
          (b.logisticsEmailCategories ??= {})[itemId] = categories;
        });
      },

      seedTestingDemo: (orderId) => {
        const b0 = get().orders[orderId];
        if (!b0) return;
        /*
         * Deliberately overwrites this order's testing state — that is what a
         * demo loader is for. It stops one step short of done: the first lot is
         * finished and PASSED, the second is still on the bench with its
         * results open, so the last mile (sync the inbox, fetch the report, set
         * the verdict) is walked by hand rather than read about.
         */
        set((s) => {
          const b = s.orders[orderId];
          if (!b) return;
          const d = (offset: number) => { const x = new Date(); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); };
          const at = (offset: number, time: string) => `${d(offset)} ${time}`;
          const lab = "WHL Shenzhen";

          /* Two MPNs off the order itself, so the demo talks about real lines.
           * A single-line order just tests the one it has. */
          const mpnA = b.lines[0]?.mpn ?? "STM32F407VGT6";
          const mpnB = b.lines[1]?.mpn ?? mpnA;
          const qtyA = b.lines[0]?.quantity ?? 300;
          const qtyB = b.lines[1]?.quantity ?? 150;
          const woA = "352901";
          const woB = "352902";
          const slotId = uid("slot");
          const lotAId = uid("lot");
          const lotBId = uid("lot");

          const PLAN_A = ["External Visual Inspection", "X-Ray Inspection", "Decapsulation", "XRF Analysis"];
          const PLAN_B = ["External Visual Inspection", "X-Ray Inspection", "Solderability"];
          const req = (name: string) => ({ id: uid("req"), name, standard: "AS6081", source: "AUTO_BOOKING" as const });

          // ---- the lab appointment everything hangs off ----
          b.testSlots = [{
            id: slotId, slotNo: "TS-2026-0044", lab, status: "CONFIRMED",
            preferredDate: d(-12),
            lines: [
              { mpn: mpnA, qty: qtyA, sampleQty: 20, dateCode: "2325", tests: PLAN_A.map((name) => ({ name, standard: "AS6081" })) },
              { mpn: mpnB, qty: qtyB, sampleQty: 15, dateCode: "2410", tests: PLAN_B.map((name) => ({ name, standard: "AS6081" })) },
            ],
            note: "Two date codes, same purchase order — please run both under one appointment.",
            requestedAt: at(-14, "09:20"), requestedBy: ME,
            confirmedAt: at(-13, "11:05"), appointmentNo: "WHL-APT-77120",
            createdLotIds: [lotAId, lotBId],
          }];

          // ---- the test plan the lab confirmed, per MPN ----
          const specs = [
            { mpn: mpnA, tests: PLAN_A },
            ...(mpnB !== mpnA ? [{ mpn: mpnB, tests: PLAN_B }] : []),
          ];
          b.mpnTests = specs.map((x) => ({
            id: uid("spec"), mpn: x.mpn, autofill: "OK" as const,
            sourceDoc: "WHL-APT-77120", parsedAt: at(-13, "11:06"), confidence: 0.94,
            tests: x.tests.map(req),
            audit: [auditRow({
              by: `${lab} (confirmation)`, action: "AUTOFILL", target: x.mpn,
              before: "-", after: `${x.tests.length} test(s) from WHL-APT-77120`,
              note: "Confidence 94%.",
            })],
          }));

          // ---- lot A: the whole journey, finished clean ----
          const reportA: WhlReport = {
            id: uid("rep"), reportNo: `${woA}.1`, revision: 1, reportDate: d(-3),
            workOrderNo: woA, fileName: `WHL-${woA}-R1.pdf`, receivedAt: at(-3, "16:40"),
            current: true, partNumber: mpnA, manufacturer: b.lines[0]?.make ?? "ST Microelectronics",
            lotQty: qtyA, client: b.maskingEntity, clientPo: b.supplierPoNo ?? "PO Unknown",
            conclusion: "ACCEPTABLE", anyFar: false,
            processes: PLAN_A.map((name) => ({ name, result: "ACCEPTABLE" as const, acceptQty: 20, rejectQty: 0 })),
            approvedBy: "L. Chen", approverTitle: "Laboratory Manager",
            standards: ["AS6081"], riskClass: "ERAI Low Risk", msl: "MSL 3", packageType: "LQFP-100",
            parseFlags: [], accessLog: [],
          };

          b.lots = [
            {
              id: lotAId, orderLineMpn: mpnA, lotCode: "LOT-D1", dateCode: "2325",
              qty: qtyA, sampleQty: 20, testStatus: "PASS", lab, workOrderNo: woA,
              reportNo: reportA.reportNo, tatDays: 6, testedAt: d(-3),
              testSlotId: slotId, testSlotNo: "TS-2026-0044",
              tests: PLAN_A.map((name) => ({
                id: uid("lt"), name, standard: "AS6081", source: "AUTO_BOOKING" as const,
                status: "PASSED" as const, acceptQty: 20, rejectQty: 0, updatedAt: at(-3, "16:40"),
                history: [auditRow({ by: "WHL inbox (auto)", action: "STATUS", target: name, after: "PASSED" })],
              })),
              reports: [reportA],
              /* The lab bills after issuing the report, so a settled fee puts the
               * lot at WHL_PAYMENT — one stage short of the hand-off, which is
               * left for the demo to walk. */
              stage: "WHL_PAYMENT",
              stageHistory: ([
                ["TEST_BOOKED", -13, "11:05"], ["SUPPLIER_DISPATCHING", -11, "10:15"],
                ["COMPONENTS_RECEIVED", -9, "09:40"], ["TESTING_IN_PROGRESS", -8, "12:00"],
                ["TESTING_COMPLETED", -4, "17:20"], ["REPORT_SHARED", -3, "16:40"],
                ["WHL_PAYMENT", -2, "10:25"],
              ] as const).map(([stage, off, time]) => ({
                id: uid("se"), stage, at: at(off, time), by: "WHL inbox (auto)",
              })),
              dispatch: {
                courier: "DHL Express", awb: "4471-9955-02", dispatchedOn: d(-11), expectedArrival: d(-9),
                note: "Samples drawn from the same date-code reel.", recordedBy: ME, recordedAt: at(-11, "10:15"),
              },
              /* Settled on credit: billed, sent to finance, paid — this leg is closed. */
              labPayment: {
                status: "PAID", requestedAt: at(-3, "17:00"),
                sentToFinanceAt: at(-2, "09:40"), sentToFinanceBy: ME,
                paidAt: at(-2, "10:25"), paidRef: "UTR-8814226",
                invoice: {
                  id: uid("inv"), invoiceNo: `WHL-INV-${woA}`, amount: 580, taxAmount: 35, currency: "USD",
                  fileName: `WHL-INV-${woA}.pdf`, receivedAt: at(-3, "17:20"), dueDate: d(12),
                  terms: "CREDIT", creditDays: 15, ratePerProcess: 145, processCount: 4,
                  note: `4 process(es) billed against WO ${woA} at USD 145 each.`,
                  source: "MAIL", accessLog: [],
                },
              },
            },
            /* ---- lot B: still on the bench — this is the one left to finish ---- */
            {
              id: lotBId, orderLineMpn: mpnB, lotCode: "LOT-D2", dateCode: "2410",
              qty: qtyB, sampleQty: 15, testStatus: "PENDING", lab, workOrderNo: woB,
              testSlotId: slotId, testSlotNo: "TS-2026-0044",
              tests: PLAN_B.map((name, i) => ({
                id: uid("lt"), name, standard: "AS6081", source: "AUTO_BOOKING" as const,
                // first process done, the rest still running
                status: (i === 0 ? "PASSED" : "IN_PROGRESS") as "PASSED" | "IN_PROGRESS",
                acceptQty: i === 0 ? 15 : undefined, rejectQty: i === 0 ? 0 : undefined,
                updatedAt: at(-2, "15:10"),
                history: [auditRow({ by: "WHL inbox (auto)", action: "STATUS", target: name, after: i === 0 ? "PASSED" : "IN_PROGRESS" })],
              })),
              stage: "TESTING_IN_PROGRESS",
              stageHistory: ([
                ["TEST_BOOKED", -13, "11:05"], ["SUPPLIER_DISPATCHING", -11, "10:20"],
                ["COMPONENTS_RECEIVED", -9, "09:40"], ["TESTING_IN_PROGRESS", -2, "15:10"],
              ] as const).map(([stage, off, time]) => ({
                id: uid("se"), stage, at: at(off, time), by: "WHL inbox (auto)",
              })),
              dispatch: {
                courier: "DHL Express", awb: "4471-9955-02", dispatchedOn: d(-11), expectedArrival: d(-9),
                recordedBy: ME, recordedAt: at(-11, "10:20"),
              },
              /* Billed on credit and still owed — money the desk can see without it
               * blocking the bench, which is the common real case. */
              /* Not billed yet — the lab invoices once it issues the report, and
               * this lot's report is still to come. */
              labPayment: { status: "NOT_REQUESTED" },
            },
          ];

          // ---- the WHL thread, as it would actually read ----
          const mail = (
            x: { dir: "OUT" | "IN"; kind: LabEmail["kind"]; subject: string; body: string; off: number; time: string;
                 lotId?: string; lotCode?: string; wo?: string; status: LabEmail["status"]; by: string; att?: string[]; note?: string },
          ): LabEmail => ({
            id: uid("lm"), direction: x.dir, lotId: x.lotId, lotCode: x.lotCode, workOrderNo: x.wo,
            subject: x.subject, body: x.body, at: at(x.off, x.time), by: x.by,
            status: x.status, kind: x.kind, attachments: x.att, matchNote: x.note,
          });

          b.labEmails = [
            mail({ dir: "OUT", kind: "BOOKING_REQUEST", off: -14, time: "09:20", by: ME, status: "SENT",
              subject: `Test slot request — ${b.orderNo} (2 date codes)`,
              body: `Please confirm an appointment for two lots against ${b.supplierPoNo ?? b.orderNo}.\n\n· ${mpnA} — ${qtyA} pcs, date code 2325\n· ${mpnB} — ${qtyB} pcs, date code 2410\n\nStandard AS6081 screening on both.` }),
            mail({ dir: "IN", kind: "BOOKING_CONFIRMED", off: -13, time: "11:05", by: "WHL Bookings", status: "UPDATE_RECEIVED",
              subject: "Appointment confirmed — WHL-APT-77120",
              body: `Confirmed for ${d(-9)}. Work orders ${woA} and ${woB} raised. Please dispatch samples to WHL Shenzhen quoting the appointment number.`,
              att: ["WHL-APT-77120.pdf"] }),
            mail({ dir: "IN", kind: "DISPATCH", off: -11, time: "10:15", by: "Supplier (relayed)", status: "UPDATE_RECEIVED",
              subject: "Samples dispatched — AWB 4471-9955-02",
              body: "Both lots handed to DHL today, one waybill. Expected at the lab in two days." }),
            mail({ dir: "IN", kind: "INVOICE", off: -3, time: "17:20", by: "WHL Accounts", status: "UPDATE_RECEIVED",
              lotId: lotAId, lotCode: "LOT-D1", wo: woA,
              subject: `Testing invoice — WO ${woA}`,
              body: "Invoice for the completed work order attached, 15-day credit as agreed. The second lot will be billed on completion.",
              att: [`WHL-INV-${woA}.pdf`] }),
            mail({ dir: "IN", kind: "REPORT", off: -3, time: "16:40", by: "WHL Reports", status: "REPORT_DELIVERED",
              lotId: lotAId, lotCode: "LOT-D1", wo: woA,
              subject: `Report ${woA}.1 — ${mpnA}`,
              body: "All four processes acceptable. Report attached; originals follow.",
              att: [`WHL-${woA}-R1.pdf`] }),
            mail({ dir: "IN", kind: "STATUS_UPDATE", off: -2, time: "15:10", by: "WHL Reports", status: "UPDATE_RECEIVED",
              lotId: lotBId, lotCode: "LOT-D2", wo: woB,
              subject: `Progress — WO ${woB}`,
              body: "Visual inspection acceptable. X-ray and solderability running; report expected in two working days." }),
            /* One inbound nobody could file — the manual-match queue needs a live
             * example or the feature reads as decoration. */
            mail({ dir: "IN", kind: "STATUS_UPDATE", off: -1, time: "09:30", by: "WHL Reports", status: "UPDATE_RECEIVED",
              subject: "Re: sample query — date code clarification",
              body: "Could you confirm which reel the second date code was drawn from? The packing note is ambiguous.",
              note: "No work order or lot code quoted in the subject or body." }),
          ];

          b.events.unshift({
            id: uid("ev"), eventType: "DEMO_SEEDED",
            message: "Testing demo flow loaded — LOT-D1 passed and reported, LOT-D2 still on the bench",
            source: "SC_MANUAL", occurredAt: today(), recordedBy: ME,
          });
        });
        toast.success("Testing demo flow loaded", {
          description: "LOT-D1 is through and passed. LOT-D2 is on the bench — sync the WHL inbox, fetch its report and set the verdict to finish.",
        });
      },

      resetTestingFlow: (orderId) => {
        const b0 = get().orders[orderId];
        if (!b0) return;
        set((s) => {
          const b = s.orders[orderId];
          if (!b) return;
          /* Back to before anything was booked. The test plan goes too — the
           * lab's confirmation is what fills it, so booking a slot rebuilds it. */
          b.lots = [];
          b.testSlots = [];
          b.labEmails = [];
          b.mpnTests = [];
          const gone = new Set(["DEMO_SEEDED", "TESTING_RESET"]);
          b.events = b.events.filter((e) => !gone.has(e.eventType));
          b.events.unshift({
            id: uid("ev"), eventType: "TESTING_RESET",
            message: "Testing reset to the start for a demo run",
            source: "SC_MANUAL", occurredAt: today(), recordedBy: ME,
          });
        });
        toast.success("Testing reset", {
          description: "Back to the start: book a test slot with the lab, dispatch samples, track the bench, then reports and verdicts.",
        });
      },

      resetLogisticsFlow: (orderId) => {
        const b0 = get().orders[orderId];
        if (!b0) return;
        set((s) => {
          const b = s.orders[orderId];
          if (!b) return;
          const inboundNos = b.shipments.filter((x) => x.leg === "INBOUND").map((x) => x.shipmentNo);
          b.shipments = b.shipments.filter((x) => x.leg !== "INBOUND");
          b.customs = b.customs.filter((c) => !inboundNos.includes(c.shipmentNo));
          b.shippingDocs = undefined;
          b.grn = undefined;
          b.logisticsThread = undefined;
          b.logisticsOutbox = undefined;
          /* The warehouse's relabel mark reads as "at our warehouse" — clear it
           * too, or the reset order would start seven steps in. */
          b.relabelledAt = undefined;
          const gone = new Set(["GRN_ISSUED", "POD_RECEIVED", "LOGISTICS_DOC_SENT", "DEMO_SEEDED"]);
          b.events = b.events.filter((e) => !gone.has(e.eventType));
          b.events.unshift({ id: uid("ev"), eventType: "LOGISTICS_RESET", message: "Inbound flow reset to the start for a demo run", source: "SC_MANUAL", occurredAt: today(), recordedBy: ME });
        });
        toast.success("Inbound flow reset", {
          description: "Back to the start: ask the supplier for documents, book, track, clear, receive — then GRN + POD.",
        });
      },

      recordPoD: (orderId, deliveryId) => {
        set((s) => { const d = s.orders[orderId]?.deliveries.find((x) => x.id === deliveryId); if (d) d.pod = today(); });
        toast.success("Proof of delivery recorded");
      },

      // GST e-Invoice / IRP adapter. Seller is ALWAYS the masking entity - supplier is never sent.
      generateEInvoice: (orderId) => {
        const b = get().orders[orderId]; if (!b) return;
        if (b.einvoice?.irn) { toast("IRN already generated for this order"); return; }
        const intl = b.tradeType === "INTERNATIONAL";
        toast.message("Generating IRN via IRP…");
        void (async () => {
          try {
            const igst = Math.round(b.sellTotal * 0.18);
            const res = await generateIrn({ supplyType: intl ? "EXPWOP" : "B2B", sellerGstin: SHARPBUY_GSTIN, buyerGstin: intl ? "URP" : "33AALCG9069K1Z0", docNo: b.orderNo, totalValue: b.sellTotal, igst });
            set((s) => {
              const bb = s.orders[orderId]; if (!bb) return;
              bb.einvoice = { irn: res.irn, ackNo: res.ackNo, signedQRCode: res.signedQRCode, generatedAt: res.ackDt, supplyType: intl ? "EXPWOP" : "B2B" };
              bb.documents.push({ id: uid("doc"), subjectType: "ORDER", docType: "TAX_INVOICE", fileName: `e-invoice-${res.ackNo}.pdf`, uploadedBy: "IRP (mock)", uploadedAt: today() });
              bb.events.unshift({ id: uid("ev"), eventType: "GENERAL", message: `GST e-Invoice IRN generated (ack ${res.ackNo}).`, source: "IRP", occurredAt: today(), recordedBy: "IRP (mock)" });
            });
            toast.success(`IRN generated (ack ${res.ackNo})`);
          } catch (e) { toast.error(`IRP: ${errMsg(e)}`); }
        })();
      },

      // Exception path: cancel a stranded/rejected order and release its supplier PO back to DRAFT.
      cancelOrder: (orderId) => {
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          b.status = "CANCELLED";
          b.journey.forEach((j) => { if (j.status === "IN_PROGRESS" || j.status === "BLOCKED") j.status = "SKIPPED"; });
          if (b.supplierPoId) { const spo = s.supplierPos.find((x) => x.id === b.supplierPoId); if (spo) { spo.status = "DRAFT"; spo.orderId = undefined; } }
          b.events.unshift({ id: uid("ev"), eventType: "GENERAL", message: "Order cancelled; purchase order released back to draft.", source: "SC_MANUAL", occurredAt: today(), recordedBy: "You (demo)" });
        });
        toast.success("Order cancelled - purchase order released to draft");
      },

      addEvent: (orderId, e) => { set((s) => { s.orders[orderId]?.events.unshift({ id: uid("ev"), eventType: e.eventType, message: e.message, source: "SC_MANUAL", occurredAt: today(), recordedBy: "You (demo)" }); }); toast.success("Event logged"); },
      addDocument: (orderId, d) => { set((s) => { s.orders[orderId]?.documents.push({ id: uid("doc"), subjectType: d.subjectType, docType: d.docType, fileName: d.fileName, uploadedBy: "You (demo)", uploadedAt: today() }); }); toast.success("Document attached"); },
      attachPI: (orderId, p) => {
        set((s) => {
          const b = s.orders[orderId]; if (!b) return;
          if (p.piNo) b.piNo = p.piNo;
          b.documents.push({ id: uid("doc"), subjectType: "ORDER", docType: "PI", fileName: p.fileName || `supplier-pi-${p.piNo || "attached"}.pdf`, uploadedBy: "You (demo)", uploadedAt: today() });
          b.events.unshift({ id: uid("ev"), eventType: "GENERAL", message: `Supplier PI${p.piNo ? ` ${p.piNo}` : ""} uploaded to the order.`, source: "SC_MANUAL", occurredAt: today(), recordedBy: "You (demo)" });
        });
        toast.success("Supplier PI attached");
      },
      decideApproval: (orderId, approvalId, status) => {
        let nextName: string | null = null;
        set((s) => {
          const b = s.orders[orderId]; const a = b?.approvals.find((x) => x.id === approvalId);
          if (a && b) {
            a.status = status; a.decidedBy = "You (demo)";
            if (a.kind === "PO_REVIEW" && status === "APPROVED") {
              b.approvalStatus = "APPROVED";
              // auto-advance the "PO reviewed & approved" gate - approving IS the action, no separate Advance click
              const idx = b.journey.findIndex((x) => (x.status === "IN_PROGRESS" || x.status === "BLOCKED") && x.name.toLowerCase().includes("approved"));
              if (idx >= 0) {
                b.journey[idx].status = "DONE";
                if (idx + 1 < b.journey.length) { b.journey[idx + 1].status = "IN_PROGRESS"; nextName = b.journey[idx + 1].name; }
                else b.status = "CLOSED";
              }
              if (b.status !== "CLOSED" && ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ON_HOLD"].includes(b.status)) b.status = "ACTIVE";
            }
            if (a.kind === "PO_REVIEW" && status === "REJECTED") b.approvalStatus = "REJECTED";
          }
        });
        toast.success(nextName ? `PO approved - advanced to "${nextName}"` : `Approval ${status.toLowerCase()}`);
      },

      // ---- RFQ Module Actions ----
      createDemandLine: (input) => {
        const id = uid("dem");
        set((s) => {
          s.demandLines[id] = {
            id, mpn: input.mpn, qty: input.qty, targetPrice: input.targetPrice, currency: input.currency,
            requiredByDate: input.requiredByDate, source: input.source as "email" | "manual" | "portal",
            clientPoId: input.clientPoId, clientLineId: input.clientLineId, createdAt: today(),
          };
        });
        toast.success(`Demand ${input.mpn} · Qty ${input.qty} created`);
        return id;
      },

      createRfqBundle: (input) => {
        const st = get();
        // Guard: validate bundling (sum of RfqLines ≤ demand qty for each demand)
        for (const demandLineId of input.demandLineIds) {
          const demand = st.demandLines[demandLineId];
          if (!demand) { toast.error(`Demand line ${demandLineId} not found`); return null; }
        }
        const bundleId = uid("rfq");
        const now = today();
        const deadlineDate = new Date(input.deadline);
        set((s) => {
          const rfqLines = input.demandLineIds.map((id, i) => {
            const demand = s.demandLines[id];
            return {
              id: uid("rlin"),
              rfqBundleId: bundleId,
              demandLineIds: [id],
              mpn: demand?.mpn || "-",
              alternateGroupId: `alt-${demand?.mpn || "unknown"}`,
              aggregatedQty: demand?.qty || 0,
              targetPrice: demand?.targetPrice || 0,
              currency: demand?.currency || "USD",
              clientPoId: demand?.clientPoId,
              clientLineIds: demand?.clientLineId ? [demand.clientLineId] : [],
            };
          });
          s.rfqBundles[bundleId] = {
            id: bundleId,
            lines: rfqLines,
            invites: input.supplierEmails.map((email) => ({
              id: uid("inv"),
              rfqBundleId: bundleId,
              supplierName: SUPPLIERS.find((sup) => sup.email?.toLowerCase() === email.toLowerCase())?.name ?? email,
              supplierEmail: email,
              status: "PENDING" as const,
              portalToken: uid("tok"),
              expiresAt: new Date(deadlineDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
            })),
            status: "DRAFT" as RfqBundleStatus,
            deadline: input.deadline,
            dateToleranceDays: input.dateToleranceDays,
            createdAt: now,
          };
        });
        toast.success(`RFQ Bundle ${bundleId} created with ${input.demandLineIds.length} line(s)`);
        return bundleId;
      },

      floatRfqToSuppliers: async (bundleId) => {
        const st = get();
        const bundle = st.rfqBundles[bundleId];
        if (!bundle) { toast.error(`Bundle ${bundleId} not found`); return false; }

        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        let sentCount = 0;
        const results = await Promise.all(
          bundle.invites.map((invite) =>
            sendRfqInvite({
              supplierEmail: invite.supplierEmail,
              supplierName: invite.supplierName,
              rfqBundleId: bundleId,
              portalLink: `${baseUrl}/portal/rfq/${bundleId}/${invite.portalToken}`,
              deadline: bundle.deadline,
              lineCount: bundle.lines.length,
            }).then((res) => ({ inviteId: invite.id, res })),
          ),
        );

        set((s) => {
          for (const { inviteId, res } of results) {
            const inv = s.rfqBundles[bundleId]!.invites.find((i) => i.id === inviteId);
            if (!inv) continue;
            if (res.sent) {
              inv.status = "SENT";
              inv.sentAt = today();
              sentCount++;
            } else {
              inv.lastError = res.error;
            }
          }
          s.rfqBundles[bundleId]!.status = "FLOATED";
        });

        const failedCount = bundle.invites.length - sentCount;
        if (failedCount > 0) {
          toast.warning(`RFQ sent to ${sentCount}/${bundle.invites.length} supplier(s) — ${failedCount} failed`);
        } else {
          toast.success(`RFQ Bundle sent to ${sentCount} supplier(s)`);
        }
        return true;
      },

      resendSupplierInvite: async (bundleId, inviteId) => {
        const st = get();
        const bundle = st.rfqBundles[bundleId];
        const invite = bundle?.invites.find((i) => i.id === inviteId);
        if (!bundle || !invite) { toast.error(`Invite not found`); return false; }

        const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
        const res = await sendRfqInvite({
          supplierEmail: invite.supplierEmail,
          supplierName: invite.supplierName,
          rfqBundleId: bundleId,
          portalLink: `${baseUrl}/portal/rfq/${bundleId}/${invite.portalToken}`,
          deadline: bundle.deadline,
          lineCount: bundle.lines.length,
        });

        set((s) => {
          const inv = s.rfqBundles[bundleId]!.invites.find((i) => i.id === inviteId);
          if (!inv) return;
          if (res.sent) {
            if (inv.status === "PENDING" || inv.status === "SENT") inv.status = "SENT";
            inv.sentAt = today();
            inv.lastError = undefined;
          } else {
            inv.lastError = res.error;
          }
        });

        if (res.sent) toast.success(`Resent to ${invite.supplierName}`);
        else toast.error(`Resend to ${invite.supplierName} failed: ${res.error}`);
        return res.sent;
      },

      markInviteViewed: (bundleId, portalToken) => {
        set((s) => {
          const invite = s.rfqBundles[bundleId]?.invites.find((i) => i.portalToken === portalToken);
          if (invite && invite.status !== "QUOTED" && invite.status !== "DECLINED") {
            if (invite.status !== "VIEWED") invite.status = "VIEWED";
            invite.viewedAt = today();
          }
        });
      },

      askSupplierQuestion: (bundleId, portalToken, question) => {
        set((s) => {
          const invite = s.rfqBundles[bundleId]?.invites.find((i) => i.portalToken === portalToken);
          if (!invite) return;
          if (!invite.questions) invite.questions = [];
          invite.questions.push({ id: uid("q"), question, askedAt: today() });
        });
        toast.success(`Question sent to Sharpbuy sourcing`);
      },

      answerSupplierQuestion: (bundleId, inviteId, questionId, answer) => {
        set((s) => {
          const invite = s.rfqBundles[bundleId]?.invites.find((i) => i.id === inviteId);
          const q = invite?.questions?.find((x) => x.id === questionId);
          if (q) { q.answer = answer; q.answeredAt = today(); }
        });
        toast.success(`Answer sent to supplier`);
      },

      submitSupplierQuote: (input) => {
        const quoteId = uid("quote");
        set((s) => {
          s.supplierQuotes[quoteId] = {
            id: quoteId,
            rfqBundleId: input.rfqBundleId,
            supplierEmail: input.supplierEmail,
            lines: input.lines.map((l: any) => ({
              id: l.id || uid("ql"),
              rfqLineId: l.rfqLineId,
              supplierEmail: input.supplierEmail,
              quotedMpn: l.quotedMpn,
              stockQty: l.stockQty ?? 0,
              unitPrice: l.unitPrice ?? 0,
              currency: l.currency || "USD",
              leadTimeDays: l.leadTimeDays ?? 7,
              leadTimeUnit: l.leadTimeUnit || "days",
              incoterm: l.incoterm || "EXW",
              location: l.location || "",
              packaging: l.packaging || "Tape & Reel",
              validityDays: l.validityDays ?? 30,
              moq: l.moq ?? 1,
              spq: l.spq ?? 1,
              dateCode: l.dateCode || "",
              termsConditions: l.termsConditions || [],
              stockSource: l.stockSource || "warehouse",
              paymentTerms: l.paymentTerms || "Advance via T/T",
              status: "ACTIVE" as const,
            })),
            status: "SUBMITTED" as const,
            submittedAt: today(),
          };
          s.rfqBundles[input.rfqBundleId]!.status = "QUOTES_IN";
          const invite = s.rfqBundles[input.rfqBundleId]!.invites.find((i) => i.supplierEmail === input.supplierEmail);
          if (invite) invite.status = "QUOTED";
        });
        toast.success(`Quote from ${input.supplierEmail} submitted`);
        return quoteId;
      },

      matchQuoteEmail: (bundleId, emailId, rfqLineId) => {
        const st = get();
        const email = st.quoteEmails[emailId];
        if (!email) { toast.error(`Email ${emailId} not found`); return false; }
        set((s) => {
          s.quoteEmails[emailId]!.matchedSupplierQuoteId = uid("quote");
          s.quoteEmails[emailId]!.status = "MATCHED";
        });
        toast.success(`Quote email matched to RfqLine`);
        return true;
      },

      syncQuoteInbox: async (bundleId) => {
        // Mock: return matched and unmatched counts
        const st = get();
        const emails = Object.values(st.quoteEmails).filter((e) => e.rfqBundleId === bundleId);
        const matched = emails.filter((e) => e.status === "MATCHED").length;
        const unmatched = emails.filter((e) => e.status === "UNMATCHED").length;
        toast.success(`Inbox: ${matched} matched, ${unmatched} unmatched`);
        return { matched, unmatched };
      },

      createClientQuoteDecision: (input) => {
        const st = get();
        const bundle = st.rfqBundles[input.rfqBundleId];
        if (!bundle) { toast.error("Bundle not found"); return null; }

        const decisionId = uid("cqd");
        const selectedLines = input.selectedQuoteLineIds.map((quoteLineId) => {
          for (const sq of Object.values(st.supplierQuotes)) {
            const line = sq.lines.find((l) => l.id === quoteLineId);
            if (line) {
              const rfqLine = bundle.lines.find((rl) => rl.id === line.rfqLineId);
              if (rfqLine) return { rfqLineId: rfqLine.id, quoteLineId };
            }
          }
          return { rfqLineId: "", quoteLineId };
        });

        const allocations: { rfqLineId: string; clientPoId: string; qty: number; unitPrice: number }[] = [];
        for (const selection of selectedLines) {
          const rfqLine = bundle.lines.find((l) => l.id === selection.rfqLineId);
          if (rfqLine) {
            for (const sq of Object.values(st.supplierQuotes)) {
              const quoteLine = sq.lines.find((l) => l.id === selection.quoteLineId);
              if (quoteLine && rfqLine.clientPoId) {
                allocations.push({
                  rfqLineId: rfqLine.id,
                  clientPoId: rfqLine.clientPoId,
                  qty: quoteLine.stockQty || rfqLine.aggregatedQty,
                  unitPrice: quoteLine.unitPrice,
                });
              }
            }
          }
        }

        set((s) => {
          s.clientQuoteDecisions[decisionId] = {
            id: decisionId,
            rfqBundleId: input.rfqBundleId,
            selectedQuoteLines: selectedLines,
            allocations,
            markupPercent: input.markupPercent,
            status: "DRAFT" as const,
            createdAt: today(),
          };
        });
        toast.success(`Quote Decision created with ${input.selectedQuoteLineIds.length} quotes & allocations`);
        return decisionId;
      },

      submitQuoteForApproval: (bundleId) => {
        const st = get();
        const decision = Object.values(st.clientQuoteDecisions).find((d) => d.rfqBundleId === bundleId);
        if (!decision) { toast.error("No decision found for this bundle"); return ""; }
        const approvalId = uid("app");
        set((s) => {
          s.clientQuoteDecisions[decision.id]!.status = "PENDING_APPROVAL" as const;
          s.clientQuoteDecisions[decision.id]!.approvalId = approvalId;
          s.rfqBundles[bundleId]!.status = "DECISION_PENDING";
        });
        toast.success(`Quote Decision submitted for Finance approval`);
        return approvalId;
      },

      approveQuoteDecision: async (decisionId) => {
        const st = get();
        const decision = st.clientQuoteDecisions[decisionId];
        if (!decision) { toast.error(`Decision not found`); return; }
        set((s) => {
          s.clientQuoteDecisions[decisionId]!.status = "APPROVED";
          s.clientQuoteDecisions[decisionId]!.decidedBy = "You (Finance, demo)";
          s.clientQuoteDecisions[decisionId]!.decidedAt = today();
        });
        toast.success(`Quote decision approved`);
        await get().sendClientQuote(decision.rfqBundleId);
      },

      rejectQuoteDecision: (decisionId, reason) => {
        const st = get();
        const decision = st.clientQuoteDecisions[decisionId];
        if (!decision) { toast.error(`Decision not found`); return; }
        if (!reason.trim()) { toast.error(`A rejection reason is required`); return; }
        set((s) => {
          s.clientQuoteDecisions[decisionId]!.status = "REJECTED";
          s.clientQuoteDecisions[decisionId]!.decidedBy = "You (Finance, demo)";
          s.clientQuoteDecisions[decisionId]!.decidedAt = today();
          s.clientQuoteDecisions[decisionId]!.rejectionReason = reason;
        });
        toast(`Quote decision rejected`);
      },

      submitCounterOffer: (bundleId, quoteLineId, price, notes) => {
        const st = get();
        const quotes = Object.values(st.supplierQuotes).filter((q) => q.rfqBundleId === bundleId);
        let found = false;
        for (const quote of quotes) {
          const line = quote.lines.find((l) => l.id === quoteLineId);
          if (line) {
            // Guard: price bounds 0 ≤ counter ≤ original × 150%
            const original = line.unitPrice;
            if (price < 0 || price > original * 1.5) {
              toast.error(`Counter price out of bounds (0-${(original * 1.5).toFixed(2)})`);
              return false;
            }
            // Guard: not locked post-approval
            const decision = Object.values(st.clientQuoteDecisions).find((d) => d.rfqBundleId === bundleId && d.status === "APPROVED");
            if (decision && decision.selectedQuoteLines.some((s) => s.quoteLineId === quoteLineId)) {
              toast.error(`Cannot counter accepted quote`);
              return false;
            }
            found = true;
            break;
          }
        }
        if (!found) { toast.error(`Quote line not found`); return false; }
        set((s) => {
          for (const quote of Object.values(s.supplierQuotes).filter((q) => q.rfqBundleId === bundleId)) {
            const line = quote.lines.find((l) => l.id === quoteLineId);
            if (line) line.status = "COUNTER_PENDING";
          }
        });
        toast.success(`Counter-offer sent: ${price.toFixed(2)}`);
        return true;
      },

      recordSupplierCounter: (bundleId, quoteLineId, price) => {
        set((s) => {
          for (const quote of Object.values(s.supplierQuotes).filter((q) => q.rfqBundleId === bundleId)) {
            const line = quote.lines.find((l) => l.id === quoteLineId);
            if (line) line.status = "COUNTER_RESPONSE";
          }
        });
        toast.success(`Supplier counter recorded: ${price.toFixed(2)}`);
      },

      requestQuoteClarification: async (bundleId, quoteLineId, ambiguityType) => {
        await new Promise((r) => setTimeout(r, 500));
        toast.success(`Clarification request sent`);
      },

      sendClientQuote: async (bundleId) => {
        const st = get();
        const bundle = st.rfqBundles[bundleId];
        const decision = Object.values(st.clientQuoteDecisions).find((d) => d.rfqBundleId === bundleId && d.status === "APPROVED");
        if (!bundle || !decision) { toast.error(`Bundle or approved decision not found`); return false; }

        const clientQuoteIds: string[] = [];
        const quotesByClient = new Map<string, { name: string; email: string; lines: { rfqLineId: string; mpn: string; qty: number; unitPrice: number }[]; total: number }>();

        for (const alloc of decision.allocations) {
          const buyerEntry = BUYERS.find((b) => b.id === alloc.clientPoId);
          if (!buyerEntry) continue;
          const rfqLine = bundle.lines.find((l) => l.id === alloc.rfqLineId);
          if (!rfqLine) continue;

          if (!quotesByClient.has(alloc.clientPoId)) {
            quotesByClient.set(alloc.clientPoId, {
              name: buyerEntry.name,
              email: buyerEntry.email || "buyer@example.com",
              lines: [],
              total: 0,
            });
          }
          const clientData = quotesByClient.get(alloc.clientPoId)!;
          const clientPrice = alloc.unitPrice * (1 + decision.markupPercent / 100);
          const lineTotal = alloc.qty * clientPrice;

          clientData.lines.push({
            rfqLineId: rfqLine.id,
            mpn: rfqLine.mpn,
            qty: alloc.qty,
            unitPrice: clientPrice,
          });
          clientData.total += lineTotal;
        }

        set((s) => {
          let piSeq = 0;
          for (const [clientPoId, data] of quotesByClient.entries()) {
            const quoteId = uid("cq");
            piSeq++;
            s.clientQuotes[quoteId] = {
              id: quoteId,
              rfqBundleId: bundleId,
              clientQuoteDecisionId: decision.id,
              clientPoId,
              piNo: `PI-${bundleId.slice(-6).toUpperCase()}-${piSeq}`,
              clientName: data.name,
              clientEmail: data.email,
              token: uid("token").substring(0, 12),
              lines: data.lines,
              totalPrice: data.total,
              expiresAt: addDays(today(), 7),
              status: "PENDING" as const,
              createdAt: today(),
            };
            clientQuoteIds.push(quoteId);
          }
          s.rfqBundles[bundleId]!.status = "CLIENT_QUOTE_SENT";
          s.clientQuoteDecisions[decision.id]!.sentAt = today();
        });
        toast.success(`${clientQuoteIds.length} client quote(s) created & sent (PI issued)`);
        return true;
      },

      acceptClientQuote: async (clientQuoteId) => {
        const st = get();
        const quote = st.clientQuotes[clientQuoteId];
        if (!quote) { toast.error(`Quote not found`); return; }
        const decision = st.clientQuoteDecisions[quote.clientQuoteDecisionId];
        if (!decision) { toast.error(`Decision not found`); return; }

        const poNo = "CPO_" + crypto.getRandomValues(new Uint8Array(4)).reduce((acc, v) => acc + v.toString(16).padStart(2, "0"), "");

        set((s) => {
          s.clientQuotes[clientQuoteId]!.status = "ACCEPTED";
          s.clientQuotes[clientQuoteId]!.acceptedAt = today();

          const existingCpo = s.clientPos.find((c) => c.clientPoNo === quote.clientPoId);
          if (existingCpo) {
            existingCpo.terms = { ...existingCpo.terms, referenceNo: quote.piNo };
            existingCpo.lines = quote.lines.map((l) => ({
              mpn: l.mpn,
              make: "",
              dateCode: "",
              qty: l.qty,
              unitPrice: l.unitPrice,
              requiredBy: addDays(today(), 30),
              status: "DRAFT",
            }));
          } else {
            const newClientPo: typeof s.clientPos[0] = {
              id: uid("cpo"),
              clientPoNo: poNo,
              client: { name: quote.clientName, country: "IN", gstin: "", state: "" },
              paymentMode: "CREDIT",
              status: "DRAFT",
              terms: { referenceNo: quote.piNo }, // this PO is raised against our PI to the client
              deliveryAddress: { city: "", state: "", country: "IN" },
              lines: quote.lines.map((l) => ({
                mpn: l.mpn,
                make: "",
                dateCode: "",
                qty: l.qty,
                unitPrice: l.unitPrice,
                requiredBy: addDays(today(), 30),
                status: "DRAFT",
              })),
            };
            s.clientPos.push(newClientPo);
          }
        });

        const created = st.finalizeRfqToSupplierPos(decision.rfqBundleId);
        if (created && created.pending.length > 0) {
          toast.success(`Quote accepted (against PI ${quote.piNo}). ClientPO created — ${created.poIds.length} SupplierPO(s) created, ${created.pending.length} supplier(s) still awaiting their PI.`);
        } else {
          toast.success(`Quote accepted (against PI ${quote.piNo}). ClientPO + SupplierPO(s) created.`);
        }
      },

      declineClientQuote: (clientQuoteId) => {
        const st = get();
        const quote = st.clientQuotes[clientQuoteId];
        if (!quote) { toast.error(`Quote not found`); return; }
        set((s) => { s.clientQuotes[clientQuoteId]!.status = "WITHDRAWN"; });
        toast(`Quote declined`);
      },

      requestQuoteChanges: (clientQuoteId, notes) => {
        const st = get();
        const quote = st.clientQuotes[clientQuoteId];
        if (!quote) { toast.error(`Quote not found`); return; }
        set((s) => {
          s.clientQuotes[clientQuoteId]!.status = "CHANGE_REQUESTED";
          s.clientQuotes[clientQuoteId]!.buyerNotes = notes || undefined;
        });
        toast(`Change request sent to Sharpbuy sourcing`);
      },

      recordSellerPi: (supplierQuoteId, piNo) => {
        const st = get();
        const quote = st.supplierQuotes[supplierQuoteId];
        if (!quote) { toast.error(`Supplier quote not found`); return; }
        if (!piNo.trim()) { toast.error(`PI number is required`); return; }
        set((s) => {
          s.supplierQuotes[supplierQuoteId]!.sellerPiNo = piNo.trim();
          s.supplierQuotes[supplierQuoteId]!.sellerPiReceivedAt = today();
        });
        toast.success(`Seller PI ${piNo.trim()} recorded for ${quote.supplierEmail}`);
      },

      finalizeRfqToSupplierPos: (bundleId) => {
        const st = get();
        const bundle = st.rfqBundles[bundleId];
        const decision = Object.values(st.clientQuoteDecisions).find((d) => d.rfqBundleId === bundleId && d.status === "APPROVED");
        if (!bundle || !decision) { toast.error("Bundle or approved decision not found"); return null; }

        type DraftLine = { mpn: string; qty: number; buyUnitPrice: number; leadTimeDays: number; clientPoNo?: string; clientLineMpn?: string };
        const supplierPoMap = new Map<string, { supplierEmail: string; sellerPiNo: string; lines: DraftLine[] }>();
        const pendingPi = new Set<string>(); // suppliers who won a line but haven't sent their PI yet

        for (const selection of decision.selectedQuoteLines) {
          const rfqLine = bundle.lines.find((l) => l.id === selection.rfqLineId);
          if (!rfqLine) continue;
          for (const sq of Object.values(st.supplierQuotes)) {
            const quoteLine = sq.lines.find((l) => l.id === selection.quoteLineId);
            if (!quoteLine) continue;

            // gate: we don't cut our PO to a supplier until their PI is in hand
            if (!sq.sellerPiNo) { pendingPi.add(sq.supplierEmail); continue; }

            // idempotent per PI: this supplier's PO for this exact PI already exists → skip, don't duplicate
            if (st.supplierPos.some((sp) => sp.terms?.referenceNo === sq.sellerPiNo)) continue;

            if (!supplierPoMap.has(sq.supplierEmail)) {
              supplierPoMap.set(sq.supplierEmail, { supplierEmail: sq.supplierEmail, sellerPiNo: sq.sellerPiNo, lines: [] });
            }

            // resolve the real ClientPO number if this buyer has already accepted (their ClientPO exists);
            // otherwise the line ships unlinked, same as an uploaded supplier PO with no client match yet
            const buyerEntry = rfqLine.clientPoId ? BUYERS.find((b) => b.id === rfqLine.clientPoId) : undefined;
            const linkedCpo = buyerEntry
              ? st.clientPos.find((c) => Object.values(st.clientQuotes).some((q) => q.clientPoId === rfqLine.clientPoId && q.piNo === c.terms?.referenceNo) && c.client.name === buyerEntry.name)
              : undefined;

            supplierPoMap.get(sq.supplierEmail)!.lines.push({
              mpn: quoteLine.quotedMpn || rfqLine.mpn,
              qty: quoteLine.stockQty || rfqLine.aggregatedQty,
              buyUnitPrice: quoteLine.unitPrice,
              leadTimeDays: quoteLine.leadTimeDays || 7,
              clientPoNo: linkedCpo?.clientPoNo,
              clientLineMpn: linkedCpo ? (quoteLine.quotedMpn || rfqLine.mpn) : undefined,
            });
          }
        }

        const poIds: string[] = [];
        set((s) => {
          for (const [supplierEmail, poData] of supplierPoMap.entries()) {
            const supplierEntry = SUPPLIERS.find((sup) => sup.email === supplierEmail);
            const id = uid("spo");
            const poNo = `SPO-2026-${(300 + s.supplierPos.length).toString().padStart(4, "0")}`;
            const buyTotal = poData.lines.reduce((a, l) => a + l.qty * l.buyUnitPrice, 0);
            const spo: SupplierPO = {
              id, poNo,
              supplier: { name: supplierEntry?.name || supplierEmail, country: supplierEntry?.country || "-", gstin: supplierEntry?.gstin },
              tradeType: supplierEntry?.country === "IN" ? "DOMESTIC" : "INTERNATIONAL",
              currency: "USD", incoterm: "EXW", paymentMode: "ADVANCE", testing: "NONE",
              leadTimeDays: Math.max(...poData.lines.map((l) => l.leadTimeDays), 7),
              testingTimeDays: 0, deliveryTimeDays: 9,
              terms: { referenceNo: poData.sellerPiNo, paymentMethod: "Advance via T/T" }, // this PO is raised against the supplier's PI
              lines: poData.lines.map((l) => ({ mpn: l.mpn, qty: l.qty, buyUnitPrice: l.buyUnitPrice, marginPct: 0, clientPoNo: l.clientPoNo, clientLineMpn: l.clientLineMpn })),
              buyTotal: Math.round(buyTotal), createdBy: "RFQ (auto)", createdAt: today(), status: "DRAFT",
            };
            s.supplierPos.unshift(spo);
            poIds.push(id);
          }
          if (pendingPi.size === 0 && supplierPoMap.size > 0) {
            s.rfqBundles[bundleId]!.status = "CLIENT_CONFIRMED";
          }
        });

        const pending = Array.from(pendingPi);
        if (poIds.length > 0) {
          toast.success(`RFQ finalized → ${poIds.length} SupplierPO(s) created against seller PI`);
        }
        if (pending.length > 0) {
          toast(`${pending.length} supplier(s) still need to send their PI before their PO can be cut`);
        }
        return { poIds, pending };
      },
    })),
    {
      name: "poc-sourceops",
      // 2 = 3-entity model · 3 = WHL testing · 4 = full hardcoded seed on every order ·
      // 5-11 = escrow rebuild (8-state machine, milestones, checkEscrowInbox) · 12 = merged with the WHL testing module ·
      // 13 = merged with the RFQ module (client intake → PO, PI-gated approvals) ·
      // 14 = added ord-201/202 demo orders + Escrow.hkinRpaStartedAt · 15-17 = escrow real-HKin-evidence rework ·
      // 18 = merged with WHL testing rework: 7-stage lifecycle (started / report-prep dropped),
      //      advance-vs-credit lab payment terms on the invoice, all-mail-driven stages ·
      // 19 = staged customs clearance (file BoE → faceless assessment → duty → out-of-charge) on CustomsEntry ·
      // 20 = shipment booking particulars (pieces/weight/dims/HS/value/docs) captured at carrier booking ·
      // 21 = pre-booking supplier document request/receipt (OrderBundle.shippingDocs) ·
      // 22 = editable request email (shippingDocs.requestBody) + supplier docs forwarded to customs (CustomsEntry.docs) ·
      // 23 = IGM↔BoE linkage: AWB→CHA + IGM_LINKED stage + igmStatus/igmNo/igmItemNo/awbSentToChaAt ·
      // 24 = Shipment.updatedAt (newest-first sorting on the Logistics/Customs desks) ·
      // 25 = DHL booking fields on Shipment (product/rate/estimatedDelivery + pickup confirmation/window/mode) ·
      // 26 = Shipment.carrierDocs (waybill + CI retrieved from DHL /invoices) ·
      // 27 = customs filing mode (ICEGATE/CHA) + duty invoice; file auto-assesses; coarse buckets ·
      // 28 = Shipment.packages[] (per-box weight + dimensions; multi-box DHL booking) ·
      // 29 = Payment.attachment (proof/invoice attached by Finance when marking paid) ·
      // 30 = LabInvoice provenance (source/enteredBy/receivedVia) for hand-entered testing invoices
      // 31: GoodsReceipt on the bundle — "delivered" now means GRN + POD, not POD alone. ·
      // 32 = Shipment.pod/podRef (carrier POD on the inbound leg) + logisticsThread/logisticsOutbox (desk correspondence + created docs) ·
      // 33 = LogisticsMessage.attachments (counterparty replies carry their paper) ·
      // 34 = FINANCE as a logistics counterparty + logisticsEmailCategories (per-email category filing, OTHERS bucket) ·
      // 35 = LogisticsMessage.threadId/cc/bcc (mail chains with per-email reply) ·
      // 36 = multi-category email filing (string[] per email) + free-address To with inferred counterparty (OTHER) ·
      // 37 = merge: 6-phase fulfilment clock (Escrow.fundedAt + OrderBundle.whlReturnedToSupplierAt) landed beside 36 on main — both schemas, one discard
      version: 40,
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : (undefined as unknown as Storage))),
      skipHydration: true,
      // No real migration path across these schema jumps — discard on a version bump rather than
      // half-apply old shapes. Returning undefined here (instead of omitting `migrate`) makes that
      // an explicit choice instead of zustand logging its own "couldn't be migrated" console.error.
      migrate: () => undefined,
      merge: (persisted, current) => {
        const p = persisted as Partial<Store> | undefined;
        // pre-refactor blobs have `orders` but no `supplierPos` - discard rather than half-merge seed data on top of stale orders
        if (!p || !p.orders || !p.supplierPos) return current;
        const orders: OrdersMap = {};
        for (const [id, b] of Object.entries(p.orders)) orders[id] = normalizeBundle(b);
        return {
          ...current, orders,
          clientPos: (p.clientPos ?? current.clientPos).map((c) => ({ ...c, lines: c.lines ?? [] })),
          supplierPos: p.supplierPos.map((s) => ({ ...s, lines: s.lines ?? [] })),
          demandLines: p.demandLines ?? current.demandLines,
          rfqBundles: p.rfqBundles ?? current.rfqBundles,
          quoteEmails: p.quoteEmails ?? current.quoteEmails,
          clientQuoteDecisions: p.clientQuoteDecisions ?? current.clientQuoteDecisions,
          clientQuotes: p.clientQuotes ?? current.clientQuotes,
          supplierQuotes: p.supplierQuotes ?? current.supplierQuotes,
        };
      },
    },
  ),
);
