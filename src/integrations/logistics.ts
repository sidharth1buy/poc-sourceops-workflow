import { mockCall, ref } from "@/integrations/mock-client";
import type { ShipmentStatus, ShipmentLeg } from "@/types";

const SYS = "logistics";
const LABEL = "Logistics";

export type Carrier = "DHL" | "FEDEX" | "DELHIVERY";
export const CARRIERS: Carrier[] = ["DHL", "FEDEX", "DELHIVERY"];

// pickup.isRequested → DHL schedules the courier pickup inline with the shipment (one POST /shipments)
// and returns the dispatchConfirmationNumber in the same response. Omit it to book without a pickup.
export interface BookShipmentReq { carrier: Carrier; leg: ShipmentLeg; reference: string; from: string; to: string; pieces: number; weightKg: number; pickup?: { date: string; closeTime: string }; }
export interface BookShipmentRes { awb: string; carrier: Carrier; carrierRef: string; trackingUrl: string; status: "PLANNED"; pickupConfirmationNumber?: string; readyByTime?: string; }
export interface TrackingRes { awb: string; carrierStatusCode: string; mappedStatus: ShipmentStatus; lastLocation: string; checkpoints: { at: string; location: string; description: string }[]; }

const AWB_PREFIX: Record<Carrier, string> = { DHL: "DHL", FEDEX: "FDX", DELHIVERY: "DLV" };

export function bookShipment(req: BookShipmentReq) {
  return mockCall<BookShipmentRes>(SYS, LABEL, "POST /shipments", req,
    () => {
      const awb = `${AWB_PREFIX[req.carrier]} ${Math.floor(10000000 + Math.random() * 89999999)}`;
      const res: BookShipmentRes = { awb, carrier: req.carrier, carrierRef: ref("CR"), trackingUrl: `https://track.example/${req.carrier.toLowerCase()}/${encodeURIComponent(awb)}`, status: "PLANNED" };
      if (req.pickup) { res.pickupConfirmationNumber = `${Math.floor(10000000 + Math.random() * 89999999)}`; res.readyByTime = req.pickup.closeTime; }
      return res;
    },
    { latencyMs: [400, 1200], failError: { code: "INVALID_ADDRESS", message: "Missing/invalid recipient pincode", status: 422 } });
}

// Per-status checkpoint location + description. Early hops sit in the ORIGIN ("away") country
// so an international shipment is trackable before it lands at destination customs.
function legCheckpoints(from: string, to: string): { status: ShipmentStatus; location: string; description: string }[] {
  const origin = from || "Origin";
  const dest = to || "Destination";
  return [
    { status: "DISPATCHED", location: origin, description: "Picked up at origin" },
    { status: "IN_TRANSIT", location: `${origin} — export cleared, departed`, description: "Export-cleared; in transit from origin country" },
    { status: "AT_CUSTOMS", location: `${dest} — import customs`, description: "Arrived destination; customs clearance" },
    { status: "ARRIVED", location: dest, description: "Arrived at destination hub" },
    { status: "DELIVERED", location: dest, description: "Delivered" },
  ];
}

export function getTracking(awb: string, hopsDone = 0, from = "", to = "") {
  return mockCall<TrackingRes>(SYS, LABEL, `GET /shipments/${encodeURIComponent(awb)}/tracking`, { awb },
    () => {
      const legs = legCheckpoints(from, to);
      const idx = Math.min(hopsDone, legs.length - 1);
      const mappedStatus = legs[idx].status;
      const checkpoints = legs.slice(0, idx + 1).map((l, i) => ({ at: `hop ${i + 1}`, location: l.location, description: l.description }));
      return {
        awb, carrierStatusCode: mappedStatus.slice(0, 2), mappedStatus,
        lastLocation: legs[idx].location, checkpoints,
      };
    },
    { latencyMs: [200, 800] });
}

// ---- Display-side tracking timeline -----------------------------------------
// A richer, DHL-style scan history for the shipment card. This is a *pure* derivation
// from the shipment's current status (no network) so it renders for seeded shipments too,
// not only ones we've polled. Each hop is tagged with the ShipmentStatus milestone it belongs
// to, so the timeline stays in lock-step with the coarse status the poll/dropdown advances.
export interface TrackHop { status: ShipmentStatus; location: string; description: string; hrs: number }

const STATUS_RANK: Record<ShipmentStatus, number> = {
  PLANNED: 0, DISPATCHED: 1, IN_TRANSIT: 2, AT_CUSTOMS: 3, ARRIVED: 4, DELIVERED: 5, CANCELLED: 0,
};

// The granular scan events. Customs hops only appear for an international import leg.
function trackHops(from: string, to: string, isImport: boolean): TrackHop[] {
  const origin = from || "Origin";
  const dest = to || "Destination";
  const hops: TrackHop[] = [
    { status: "DISPATCHED", hrs: 0, location: origin, description: "Shipment picked up by carrier" },
    { status: "DISPATCHED", hrs: 2, location: origin, description: "Processed at origin facility" },
    { status: "IN_TRANSIT", hrs: 6, location: `${origin} — export cleared`, description: "Departed origin facility" },
    { status: "IN_TRANSIT", hrs: 16, location: "In transit", description: "In transit to destination country" },
  ];
  if (isImport) hops.push(
    { status: "AT_CUSTOMS", hrs: 24, location: `${dest} — import customs`, description: "Arrived at destination; held for customs clearance" },
  );
  hops.push(
    { status: "ARRIVED", hrs: 32, location: dest, description: isImport ? "Customs cleared (Bill of Entry / CHA); arrived at destination facility" : "Arrived at destination facility" },
    { status: "DELIVERED", hrs: 36, location: dest, description: "Delivered" },
  );
  return hops;
}

/** All scan events up to (and including) the shipment's current status. Chronological. */
export function trackingTimeline(status: ShipmentStatus, from: string, to: string, isImport = true): TrackHop[] {
  const reached = STATUS_RANK[status] ?? 0;
  if (reached === 0) return []; // PLANNED / CANCELLED — nothing scanned yet
  return trackHops(from, to, isImport).filter((h) => STATUS_RANK[h.status] <= reached);
}

// ---- DHL Express (MyDHL API v3.3.1) shaped mocks --------------------------------------------
// Pre-booking (address-validate, rates, landed-cost), pickup scheduling, and document retrieval.
// All route through mockCall so they log on the Integrations board and inject latency.
export interface DhlProduct { productName: string; productCode: string; price: number; currency: string; estimatedDelivery: string }

export function dhlAddressValidate(req: { type: "pickup" | "delivery"; countryCode: string; postalCode?: string; cityName?: string }) {
  return mockCall(SYS, LABEL, "GET /address-validate", req,
    () => ({ valid: true, serviceArea: req.cityName || req.countryCode }),
    { latencyMs: [200, 700] });
}

export function dhlGetRates(req: { from: string; to: string; weightKg: number; declaredValue: number; currency: string }) {
  return mockCall<{ products: DhlProduct[] }>(SYS, LABEL, "POST /rates", req,
    () => {
      const ccy = req.currency || "USD";
      const base = Math.max(35, Math.round(req.weightKg * 8 + 30));
      return { products: [
        { productName: "ECONOMY SELECT", productCode: "W", price: base, currency: ccy, estimatedDelivery: "5 days" },
        { productName: "EXPRESS WORLDWIDE", productCode: "P", price: base + 22, currency: ccy, estimatedDelivery: "3 days" },
        { productName: "EXPRESS 12:00", productCode: "Y", price: base + 48, currency: ccy, estimatedDelivery: "3 days · by 12:00" },
      ] };
    },
    { latencyMs: [500, 1500] });
}

export function dhlLandedCost(req: { declaredValue: number; currency: string }) {
  return mockCall<{ totalCost: number; currency: string }>(SYS, LABEL, "POST /landed-cost", req,
    () => ({ totalCost: Math.round(req.declaredValue * 0.2 + 40), currency: req.currency || "USD" }),
    { latencyMs: [500, 1500] });
}

export function dhlCreatePickup(req: { from: string; date: string; closeTime: string }) {
  return mockCall<{ dispatchConfirmationNumber: string; readyByTime: string }>(SYS, LABEL, "POST /pickups", req,
    () => ({ dispatchConfirmationNumber: `${Math.floor(10000000 + Math.random() * 89999999)}`, readyByTime: req.closeTime }),
    { latencyMs: [400, 1200] });
}

export function dhlGetInvoices(awb: string) {
  return mockCall<{ documents: { typeCode: string; fileName: string }[] }>(SYS, LABEL, `GET /shipments/${encodeURIComponent(awb)}/invoices`, { awb },
    () => ({ documents: [{ typeCode: "waybill", fileName: `waybill-${awb}.pdf` }, { typeCode: "invoice", fileName: `commercial-invoice-${awb}.pdf` }] }),
    { latencyMs: [400, 1000] });
}

export function dhlUpdatePickup(req: { dispatchConfirmationNumber: string; date: string; closeTime: string }) {
  return mockCall<{ dispatchConfirmationNumber: string; readyByTime: string; status: "updated" }>(SYS, LABEL, `PATCH /pickups/${req.dispatchConfirmationNumber}`, req,
    () => ({ dispatchConfirmationNumber: req.dispatchConfirmationNumber, readyByTime: req.closeTime, status: "updated" }),
    { latencyMs: [300, 900] });
}

export function dhlCancelPickup(req: { dispatchConfirmationNumber: string; reason?: string }) {
  return mockCall<{ dispatchConfirmationNumber: string; status: "cancelled" }>(SYS, LABEL, `DELETE /pickups/${req.dispatchConfirmationNumber}`, req,
    () => ({ dispatchConfirmationNumber: req.dispatchConfirmationNumber, status: "cancelled" }),
    { latencyMs: [300, 900] });
}

export function dhlUploadImage(req: { awb: string; typeCode: string }) {
  return mockCall<{ shipmentTrackingNumber: string; status: "document updated" }>(SYS, LABEL, `POST /shipments/${encodeURIComponent(req.awb)}/upload-image`, req,
    () => ({ shipmentTrackingNumber: req.awb, status: "document updated" }),
    { latencyMs: [400, 1200] });
}

// ---- Logistics-desk correspondence ------------------------------------------
// The desk's own mail seam — order-scoped messages to the carrier, the broker,
// the supplier or the dock, plus its outbound documents (pre-alerts, damage
// notices). Same mockCall seam as every adapter, so each send and each inbox
// poll shows on the Integrations board.

export type LogisticsParty = "SUPPLIER" | "CARRIER" | "CHA" | "WAREHOUSE" | "CLIENT" | "INSURER" | "FINANCE";

export const LOGISTICS_PARTY_LABEL: Record<LogisticsParty, string> = {
  SUPPLIER: "Supplier",
  CARRIER: "Logistics partner",
  CHA: "Customs broker (CHA)",
  WAREHOUSE: "Warehouse",
  CLIENT: "Client",
  INSURER: "Insurer",
  FINANCE: "Finance",
};

export interface LogisticsMailReq {
  party: LogisticsParty;
  to: string;
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  orderNo: string;
  attachments?: string[];
}
export interface LogisticsMailRes { messageId: string; to: string; queuedAt: string }

export function sendLogisticsMail(req: LogisticsMailReq) {
  return mockCall<LogisticsMailRes>(SYS, LABEL, `POST /mail/${req.party.toLowerCase()}`, req,
    () => ({ messageId: ref("LGM"), to: req.to, queuedAt: new Date().toISOString().slice(0, 16).replace("T", " ") }),
    { latencyMs: [350, 1100], failError: { code: "MAIL_RELAY_DOWN", message: "Mail relay unavailable — retry", status: 503 } });
}

/*
 * Poll the desk mailbox for replies to what we sent. One canned acknowledgement
 * per counterparty — enough for the to-and-fro to be visible end to end without
 * pretending the mock can hold a conversation.
 */
const REPLY_BODY: Record<LogisticsParty, string> = {
  SUPPLIER: "Noted — please find the shipping set attached. Originals follow by courier.",
  CARRIER: "Acknowledged. The latest shipment status report is attached; milestones will also reflect on tracking.",
  CHA: "Acknowledged. The filed copy and our checklist are attached — we will flag anything missing for this consignment.",
  WAREHOUSE: "Noted — the dock has been informed; the slot confirmation is attached.",
  CLIENT: "Thank you for the update.",
  INSURER: "Noted — the claim acknowledgement is attached; a surveyor will be appointed if warranted.",
  FINANCE: "Received — queued for the next payment run; the booking confirmation is attached.",
};

/* Counterparties do not reply empty-handed — each answers with its own paper.
 * File names only; the files themselves are rendered on demand when opened. */
const REPLY_ATTACHMENTS: Record<LogisticsParty, string[]> = {
  SUPPLIER: ["Packing List.pdf", "Commercial Invoice.pdf", "Certificate of Origin.pdf"],
  CARRIER: ["Shipment status report.pdf"],
  CHA: ["Bill of Entry (filed copy).pdf", "Clearance checklist.pdf"],
  WAREHOUSE: ["Dock slot confirmation.pdf"],
  CLIENT: [],
  INSURER: ["Claim acknowledgement.pdf"],
  FINANCE: ["Payment booking confirmation.pdf"],
};

export interface LogisticsReplyReq { orderNo: string; pending: { party: LogisticsParty; subject: string; contact: string; threadId: string }[] }
export interface LogisticsReply { party: LogisticsParty; who: string; subject: string; body: string; attachments: string[]; threadId: string }

export function fetchLogisticsReplies(req: LogisticsReplyReq) {
  return mockCall<{ replies: LogisticsReply[] }>(SYS, LABEL, `GET /mail/inbox?order=${req.orderNo}`, req,
    () => ({
      replies: req.pending.map((p) => ({
        party: p.party,
        who: p.contact,
        subject: p.subject.startsWith("Re: ") ? p.subject : `Re: ${p.subject}`,
        body: REPLY_BODY[p.party],
        attachments: REPLY_ATTACHMENTS[p.party],
        threadId: p.threadId,
      })),
    }),
    { latencyMs: [400, 1200], failError: { code: "MAILBOX_TIMEOUT", message: "Mailbox poll timed out — retry", status: 504 } });
}

export interface AiDraftReq { orderNo: string; party: LogisticsParty; intent: string; draft: { subject: string; body: string } }
export interface AiDraftRes { subject: string; body: string; model: string }

export function aiDraftEmail(req: AiDraftReq) {
  return mockCall<AiDraftRes>(SYS, "AI Drafter", `POST /ai/draft-email`, { orderNo: req.orderNo, party: req.party, intent: req.intent },
    () => ({ ...req.draft, model: "claude-sonnet-5 (simulated)" }),
    { latencyMs: [700, 1800], failError: { code: "DRAFTER_BUSY", message: "Drafting model busy — retry", status: 429 } });
}
