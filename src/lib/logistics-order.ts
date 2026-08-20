// WHERE AN INBOUND ORDER SITS, AND HOW HARD IT IS PRESSING.
//
// The logistics desk works a queue, and the only question that orders that
// queue properly is "how long until we have promised this to the customer, and
// how far is it from being here". Everything else — carrier, waybill, stage —
// is detail you read once you have decided which one to pick up.
//
// TWO NUMBERS DECIDE THE ORDER OF WORK:
//   DAYS LEFT   against the date the customer was given.
//   HOW FAR ALONG the inbound leg the consignment actually is.
// A consignment with nine days left and no booking is in more trouble than one
// with three days left that has already cleared customs, and a queue sorted on
// either number alone gets that backwards.
//
// DELIVERED MEANS BOTH DOCUMENTS. The goods are not delivered when the van
// leaves, nor when somebody says they arrived: they are delivered when the
// warehouse has issued the goods receipt note AND the carrier has returned
// proof of delivery. One without the other is a claim nobody can win — a GRN
// with no POD cannot be pinned on the carrier, and a POD with no GRN says
// something arrived but not that it was accepted.

import type { OrderBundle, ShipmentStatus } from "@/types";

/** The plain-language inbound journey, in the order a person meets it. */
export type InboundStage =
  | "NOT_BOOKED"
  | "BOOKED"
  | "COLLECTED"
  | "IN_TRANSIT"
  | "AT_CUSTOMS"
  | "CLEARED"
  | "AT_WAREHOUSE"
  | "DELIVERED";

export const INBOUND_ORDER: InboundStage[] = [
  "NOT_BOOKED", "BOOKED", "COLLECTED", "IN_TRANSIT", "AT_CUSTOMS", "CLEARED", "AT_WAREHOUSE", "DELIVERED",
];

export const INBOUND_META: Record<InboundStage, { label: string; what: string }> = {
  NOT_BOOKED:   { label: "Not booked yet",   what: "Nobody has asked a carrier to collect this." },
  BOOKED:       { label: "Booked",           what: "The carrier has the job and a waybill exists." },
  COLLECTED:    { label: "Picked up",        what: "The carrier has the goods." },
  IN_TRANSIT:   { label: "On its way",       what: "In the air or on the water, heading here." },
  AT_CUSTOMS:   { label: "With customs",     what: "Landed in India and waiting to be cleared." },
  CLEARED:      { label: "Cleared customs",  what: "Released by customs and ready to collect." },
  AT_WAREHOUSE: { label: "At our warehouse", what: "Arrived with us, being counted and checked in." },
  DELIVERED:    { label: "Delivered",        what: "Goods receipt note issued and proof of delivery back from the carrier." },
};

/** The carrier's tracking status, in plain words — what the tracking feed says, as opposed to our derived stage. */
export const TRACKING_LABEL: Record<ShipmentStatus, string> = {
  PLANNED: "Booked — awaiting pickup scan",
  DISPATCHED: "Picked up by the carrier",
  IN_TRANSIT: "In transit",
  AT_CUSTOMS: "Held at customs",
  ARRIVED: "Arrived at destination",
  DELIVERED: "Delivered by the carrier",
  CANCELLED: "Booking cancelled",
};

/** How hard the date is pressing. */
export type Pressure = "OVERDUE" | "CRITICAL" | "TIGHT" | "COMFORTABLE" | "DONE";

export const PRESSURE_META: Record<Pressure, { label: string; tone: "bad" | "warn" | "info" | "ok" | "neutral" }> = {
  OVERDUE:     { label: "Past the promised date", tone: "bad" },
  CRITICAL:    { label: "Days away",              tone: "bad" },
  TIGHT:       { label: "Getting tight",          tone: "warn" },
  COMFORTABLE: { label: "On track",               tone: "ok" },
  DONE:        { label: "Delivered",              tone: "neutral" },
};

export interface InboundView {
  stage: InboundStage;
  /** 0-based position on the journey, for the stepper. */
  stageIndex: number;
  /** Days until the date the customer was given. Negative means past it. */
  daysLeft: number | null;
  pressure: Pressure;
  /** Why it is that pressure, in the reader's words. */
  because: string;
  /** True once BOTH the goods receipt note and proof of delivery exist. */
  delivered: boolean;
  grnNo?: string;
  podAt?: string;
  /** What is missing before it can be called delivered. */
  deliveryGap: string | null;
  /** The inbound consignment, where one has been booked. */
  awb?: string;
  carrier?: string;
  /** The carrier's tracking status — null until something is booked. */
  trackingStatus: ShipmentStatus | null;
  /** The latest tracking checkpoint's location, where the feed gave one. */
  lastSeen?: string;
}

const DAY = 86_400_000;

/**
 * Days between today and a date string, tolerant of the several formats the
 * fixtures use. Returns null rather than a wrong number where it cannot parse —
 * a queue sorted on a date nobody can read is worse than one that says so.
 */
function daysUntil(date: string | undefined, now: Date): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.round((t - now.getTime()) / DAY);
}

/**
 * Where this order actually is on the inbound leg.
 *
 * Read from the records the rest of the app writes — the shipment's status, the
 * customs entry's stage, the receipt — rather than stored, so the stepper can
 * never disagree with the screens that moved it.
 */
export function inboundView(b: OrderBundle, now = new Date()): InboundView {
  const leg = b.shipments.find((s) => s.leg === "INBOUND");
  const customs = b.customs?.[0];
  const pod = leg?.pod;
  const grnNo = b.grn?.grnNo;

  const delivered = Boolean(grnNo && pod);

  /*
   * The shipment's tracking says where the goods physically ARE; the customs
   * entry says whether the state will let them through. A PRIOR Bill of Entry
   * is filed while the goods are still at origin, so the mere existence of an
   * entry must never move the consignment — only its tracking does, with the
   * entry deciding which side of the customs gate an arrived consignment is on.
   */
  const booked = Boolean(leg?.awb && leg.awb !== "booking…" && leg.awb !== "booking failed");
  const entryOpen = Boolean(customs && customs.stage !== "CLEARED" && b.tradeType === "INTERNATIONAL");
  let stage: InboundStage = "NOT_BOOKED";
  if (delivered) stage = "DELIVERED";
  else if (grnNo || b.relabelledAt) stage = "AT_WAREHOUSE";
  else if (leg?.status === "ARRIVED" || leg?.status === "DELIVERED") stage = entryOpen ? "AT_CUSTOMS" : "AT_WAREHOUSE";
  else if (leg?.status === "AT_CUSTOMS") stage = customs?.stage === "CLEARED" ? "CLEARED" : "AT_CUSTOMS";
  else if (customs?.stage === "CLEARED" && leg && leg.status !== "PLANNED") stage = "CLEARED";
  else if (leg?.status === "IN_TRANSIT") stage = "IN_TRANSIT";
  else if (leg?.status === "DISPATCHED") stage = "COLLECTED";
  else if (booked) stage = "BOOKED";

  const daysLeft = daysUntil(b.requiredBy, now);

  /*
   * Pressure is the date AND the distance still to travel. Nine days left with
   * nothing booked is worse than three days left having already cleared
   * customs, and a queue sorted on the date alone gets that exactly backwards.
   */
  const stepsLeft = INBOUND_ORDER.length - 1 - INBOUND_ORDER.indexOf(stage);
  let pressure: Pressure;
  let because: string;

  if (delivered) {
    pressure = "DONE";
    because = "Goods receipt note issued and proof of delivery back from the carrier.";
  } else if (daysLeft === null) {
    pressure = "TIGHT";
    because = "No date was recorded for the customer, so there is nothing to measure against — treat it as urgent until somebody sets one.";
  } else if (daysLeft < 0) {
    pressure = "OVERDUE";
    because = `The customer was promised this ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago and it is still ${INBOUND_META[stage].label.toLowerCase()}.`;
  } else if (daysLeft <= 3 || (stepsLeft >= 5 && daysLeft <= 10)) {
    pressure = "CRITICAL";
    because =
      daysLeft <= 3
        ? daysLeft === 0
          ? "The promised date is today."
          : `Only ${daysLeft} day${daysLeft === 1 ? "" : "s"} until the promised date.`
        : `${daysLeft} days left and the consignment is still ${INBOUND_META[stage].label.toLowerCase()} — there is not enough road left for what is still to happen.`;
  } else if (daysLeft <= 10 || stepsLeft >= 5) {
    pressure = "TIGHT";
    because = `${daysLeft} days left, ${stepsLeft} step${stepsLeft === 1 ? "" : "s"} still to go.`;
  } else {
    pressure = "COMFORTABLE";
    because = `${daysLeft} days until the promised date, and it is already ${INBOUND_META[stage].label.toLowerCase()}.`;
  }

  return {
    stage,
    stageIndex: INBOUND_ORDER.indexOf(stage),
    daysLeft,
    pressure,
    because,
    delivered,
    grnNo,
    podAt: pod,
    deliveryGap: delivered
      ? null
      : grnNo
        ? "Goods receipt note is issued — waiting on proof of delivery from the carrier."
        : pod
          ? "Proof of delivery is back — waiting on the warehouse to issue the goods receipt note."
          : "Neither the goods receipt note nor proof of delivery is in yet.",
    awb: booked ? leg!.awb : undefined,
    carrier: leg?.carrier,
    trackingStatus: booked ? leg!.status : null,
    lastSeen: booked ? leg!.lastLocation : undefined,
  };
}

const PRESSURE_RANK: Record<Pressure, number> = {
  OVERDUE: 0, CRITICAL: 1, TIGHT: 2, COMFORTABLE: 3, DONE: 4,
};

/**
 * The queue, worst first.
 *
 * Pressure leads, then the fewest days remaining within a band, then the least
 * far along. Delivered orders fall to the bottom rather than out of the list —
 * a desk asked to account for last week still needs to find them.
 */
export function sortByUrgency(rows: { view: InboundView }[]) {
  return [...rows].sort((a, z) => {
    const p = PRESSURE_RANK[a.view.pressure] - PRESSURE_RANK[z.view.pressure];
    if (p !== 0) return p;
    const ad = a.view.daysLeft ?? -9999;
    const zd = z.view.daysLeft ?? -9999;
    if (ad !== zd) return ad - zd;
    return a.view.stageIndex - z.view.stageIndex;
  });
}

/**
 * The one thing to do next on this order, in the doer's words.
 *
 * Derived from the same records as the stage so the two can never disagree —
 * a queue whose "action" column lags its "status" column teaches people to
 * trust neither.
 */
export function nextAction(b: OrderBundle, v: InboundView): string {
  if (v.delivered) return "Nothing — delivered.";
  const sd = b.shippingDocs;
  const intl = b.tradeType === "INTERNATIONAL";
  const awbWithCha = Boolean(b.customs?.[0]?.awbSentToChaAt);

  switch (v.stage) {
    case "NOT_BOOKED": {
      /* Incoterm decides whose move a missing booking is. */
      const group = (b.incoterm || "").toUpperCase().charAt(0);
      const supplierBooks = group === "C" || group === "D";
      if (supplierBooks) return "Supplier arranges this leg — chase their booking advice.";
      if (!sd) return "Ask the supplier for the shipping documents.";
      if (sd.status !== "RECEIVED") return "Waiting on the supplier's documents — chase them.";
      return "Book with the logistics partner.";
    }
    case "BOOKED":
      return intl && !awbWithCha ? "Hand the waybill to the customs broker." : "Confirm the pickup with the carrier.";
    case "COLLECTED":
    case "IN_TRANSIT":
      return intl && !awbWithCha ? "Send the pre-alert to the customs broker." : "Track the consignment.";
    case "AT_CUSTOMS":
      return "With the broker — chase the clearance.";
    case "CLEARED":
      return "Arrange the final leg to the warehouse.";
    case "AT_WAREHOUSE":
      if (!v.grnNo && !v.podAt) return "Issue the goods receipt note; chase the proof of delivery.";
      if (!v.grnNo) return "Issue the goods receipt note.";
      return "Chase the carrier for the proof of delivery.";
    case "DELIVERED":
      return "Nothing — delivered.";
  }
}
