// THE LOGISTICS DESK'S OWN PAPER — what it receives, and what it has to produce.
//
// The document warehouse answers "what does this consignment require, across
// every desk". This answers the narrower and more immediately useful question
// the forwarding desk actually has: WHAT AM I WAITING FOR, FROM WHOM, and WHAT
// DO I OWE, TO WHOM.
//
// The two halves behave completely differently and are not one list:
//
//   COMING IN   — the supplier's shipping documents, the carrier's waybill and
//                 delivery order, the broker's entry and out-of-charge. The work
//                 is chasing: know who has it and when it was asked for.
//
//   GOING OUT   — the pre-alert to the broker, the shipping instruction to the
//                 carrier, the goods receipt note. The work is producing: draft
//                 it, check it, send it, and know it landed.
//
// EVERY OUTBOUND DOCUMENT NAMES ITS RECIPIENTS. A document produced and not
// sent is the commonest silent failure on an inbound leg — the pre-alert that
// sat in a drafts folder is indistinguishable, on any dashboard, from one the
// broker is working from.

import type { OrderBundle } from "@/types";
import { incotermPlan } from "@/lib/incoterm";
import { cellBearingLine } from "@/lib/consignment-compliance";
import { LOGISTICS_PARTY_LABEL, type LogisticsParty as LogisticsPartyKey } from "@/integrations/logistics";

/** Everyone the logistics desk deals with on an inbound leg. */
export type Counterparty = "SUPPLIER" | "CARRIER" | "CHA" | "CUSTOMS" | "PLANT" | "INSURER" | "CLIENT";

export const COUNTERPARTY_LABEL: Record<Counterparty, string> = {
  SUPPLIER: "Supplier",
  CARRIER: "Logistics partner",
  CHA: "Customs broker (CHA)",
  CUSTOMS: "Customs",
  PLANT: "Warehouse / QA",
  INSURER: "Insurer",
  CLIENT: "Client",
};

export type DocDirection = "IN" | "OUT";

export type DocStatus = "not_needed" | "awaited" | "received" | "draft" | "sent";

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  not_needed: "Not needed here",
  awaited: "Waiting on them",
  received: "Received",
  draft: "Owed — not sent yet",
  sent: "Sent",
};

export interface LogisticsDoc {
  id: string;
  name: string;
  direction: DocDirection;
  /** Who it comes from (IN) — the party to chase. */
  from?: Counterparty;
  /** Who it must go to (OUT) — the mapping, and never empty on an outbound doc. */
  to?: Counterparty[];
  /** When it is wanted. */
  due: string;
  why: string;
  /** What goes wrong without it. */
  ifMissing: string;
  applies: (b: OrderBundle) => boolean;
  /** Why it does not apply, where it does not. */
  notHere?: (b: OrderBundle) => string;
}

/**
 * What the desk waits on, and what it owes.
 *
 * Ordered as the leg runs: the supplier's set first because nothing books
 * without it, then the carrier's, then the broker's, then the receipt.
 */
export const LOGISTICS_DOCS: LogisticsDoc[] = [
  // ── Coming in ──────────────────────────────────────────────────────────
  {
    id: "PACKING_LIST",
    name: "Packing list",
    direction: "IN",
    from: "SUPPLIER",
    due: "Before we can book",
    why: "Cartons, weights and dimensions — the particulars a carrier needs to quote and raise a waybill.",
    ifMissing: "Nothing can be booked, and nothing can be counted in against it at the dock.",
    applies: () => true,
  },
  {
    id: "COMMERCIAL_INVOICE",
    name: "Commercial invoice",
    direction: "IN",
    from: "SUPPLIER",
    due: "Before we can book",
    why: "The declared value the carrier declares against and the broker files on.",
    ifMissing: "The carrier will not accept the consignment.",
    applies: () => true,
  },
  {
    id: "COO",
    name: "Certificate of origin",
    direction: "IN",
    from: "SUPPLIER",
    due: "Before the entry is filed",
    why: "Where the goods were made — it decides the duty rate.",
    ifMissing: "Duty is assessed at the standard rate and any concession is forfeited.",
    applies: (b) => b.tradeType === "INTERNATIONAL",
    notHere: () => "Domestic movement — origin does not change the rate.",
  },
  {
    id: "DG_PACK",
    name: "Dangerous goods pack (declaration, UN38.3, safety data sheet)",
    direction: "IN",
    from: "SUPPLIER",
    due: "Before the consignment is loaded",
    why: "Anything with a cell in it is dangerous goods by air and cannot be loaded without it.",
    ifMissing: "The consignment is offloaded at the airport, usually after acceptance.",
    applies: (b) => cellBearingLine(b) !== null,
    notHere: () => "Nothing on this order reads as a cell — worth confirming with the supplier.",
  },
  {
    id: "AWB",
    name: "Air waybill",
    direction: "IN",
    from: "CARRIER",
    due: "On booking",
    why: "The contract of carriage. Everything downstream quotes its number.",
    ifMissing: "No entry can be filed and nothing can be tracked.",
    applies: () => true,
  },
  {
    id: "CARRIER_INVOICE",
    name: "Freight invoice",
    direction: "IN",
    from: "CARRIER",
    due: "Before the entry is filed",
    why: "Freight is added to the assessable value where we bought the carriage, so the figure has to be evidenced.",
    ifMissing: "The assessable value is built on an estimate, which is a valuation query waiting to happen.",
    applies: (b) => incotermPlan(b.incoterm).weBookFreight,
    notHere: (b) => `${b.incoterm}: freight is already inside the supplier's price.`,
  },
  {
    id: "DELIVERY_ORDER",
    name: "Delivery order",
    direction: "IN",
    from: "CARRIER",
    due: "After customs release",
    why: "The carrier authorising the custodian to hand the consignment over.",
    ifMissing: "Customs have released it and it still cannot be collected — the most avoidable day of demurrage there is.",
    applies: (b) => b.tradeType === "INTERNATIONAL",
    notHere: () => "Domestic movement — no custodian to release from.",
  },
  {
    id: "BOE_COPY",
    name: "Bill of Entry (filed copy)",
    direction: "IN",
    from: "CHA",
    due: "On filing",
    why: "Proof the entry was filed, and the reference every later query hangs off.",
    ifMissing: "Nobody here can tell whether the broker has actually filed.",
    applies: (b) => b.tradeType === "INTERNATIONAL",
    notHere: () => "Domestic movement — no entry.",
  },
  {
    id: "OOC",
    name: "Out-of-charge endorsement",
    direction: "IN",
    from: "CHA",
    due: "On clearance",
    why: "Customs releasing the consignment — the gate the domestic leg waits behind.",
    ifMissing: "Nothing moves out of the port.",
    applies: (b) => b.tradeType === "INTERNATIONAL",
    notHere: () => "Domestic movement — nothing to clear.",
  },
  {
    id: "POD",
    name: "Proof of delivery",
    direction: "IN",
    from: "CARRIER",
    due: "On delivery to the warehouse",
    why: "The carrier's own record that it was handed over. With the goods receipt note, this is what makes an order delivered.",
    ifMissing: "The order cannot be closed, and a damage claim has nothing to pin on the carrier.",
    applies: () => true,
  },

  // ── Going out ──────────────────────────────────────────────────────────
  {
    id: "DOC_REQUEST",
    name: "Shipping-document request",
    direction: "OUT",
    to: ["SUPPLIER"],
    due: "As soon as the order is ready to move",
    why: "Asks the supplier for the packing list, commercial invoice and origin certificate in one mail.",
    ifMissing: "The supplier does not know we are waiting, and the booking cannot start.",
    applies: (b) => incotermPlan(b.incoterm).weBookFreight,
    notHere: (b) => `${b.incoterm}: the supplier books their own carriage and holds their own documents.`,
  },
  {
    id: "SHIPPING_INSTRUCTION",
    name: "Shipping instruction",
    direction: "OUT",
    to: ["CARRIER"],
    due: "At booking",
    why: "Tells the carrier who ships, who receives, on what terms and who is billed.",
    ifMissing: "The waybill is raised on assumptions — most often freight billed to the wrong party.",
    applies: (b) => incotermPlan(b.incoterm).weBookFreight,
    notHere: (b) => `${b.incoterm}: the supplier instructs their own carrier.`,
  },
  {
    id: "PRE_ALERT",
    name: "Pre-alert pack",
    direction: "OUT",
    // The broker files against it; the plant needs the dock date; the client is
    // told when to expect it.
    to: ["CHA", "PLANT"],
    due: "48–72 hours before arrival by air",
    why: "The complete document set the broker files the entry against. Advance filing is permitted up to 30 days before arrival and is the biggest single lever on how long the consignment sits.",
    ifMissing: "The broker starts assembling on the day the goods land — the largest controllable cause of clearance delay.",
    applies: (b) => b.tradeType === "INTERNATIONAL",
    notHere: () => "Domestic movement — no entry to pre-alert.",
  },
  {
    id: "AWB_TO_CHA",
    name: "Waybill and invoice to the broker",
    direction: "OUT",
    to: ["CHA"],
    due: "As soon as the waybill exists",
    why: "The broker cannot link the manifest line or file the entry without them.",
    ifMissing: "The entry waits on paperwork we already have.",
    applies: (b) => b.tradeType === "INTERNATIONAL",
    notHere: () => "Domestic movement — no broker.",
  },
  {
    id: "GRN",
    name: "Goods receipt note",
    direction: "OUT",
    // Finance reconciles against it; the supplier is told what we counted; the
    // client is told their goods are here.
    to: ["PLANT", "SUPPLIER", "CLIENT"],
    due: "On arrival at the warehouse",
    why: "What we actually counted in, against the packing list. With proof of delivery, this is what makes the order delivered.",
    ifMissing: "The order cannot be closed and nothing reconciles against the invoice.",
    applies: () => true,
  },
  {
    id: "DAMAGE_NOTICE",
    name: "Damage or shortage notice",
    direction: "OUT",
    to: ["CARRIER", "INSURER", "SUPPLIER"],
    due: "The day it is found — the window is days, not weeks",
    why: "Notice to the carrier and the insurer, with the endorsement on the consignment note before the driver leaves.",
    ifMissing: "Both the carrier claim and the insurance claim fail. The clock runs from delivery, not from discovery.",
    applies: () => true,
  },
];

export interface LogisticsDocView extends LogisticsDoc {
  status: DocStatus;
  /** The reference or file behind it, where one exists. */
  evidence?: string;
  /** Why it does not apply, when it does not. */
  because?: string;
}

/**
 * Where each of the desk's documents has got to on this order.
 *
 * Read from the records the app already writes — the supplier exchange, the
 * shipment, the customs entry, the receipt — so the section cannot drift from
 * the screens that moved them.
 */
export function logisticsDocuments(b: OrderBundle): LogisticsDocView[] {
  const sd = b.shippingDocs;
  const leg = b.shipments.find((s) => s.leg === "INBOUND");
  const customs = b.customs?.[0];
  const booked = Boolean(leg?.awb && leg.awb !== "booking…" && leg.awb !== "booking failed");
  /** Evidence line for a document the desk produced and sent from this order, if it did. */
  const sentDoc = (docId: string): string | undefined => {
    const hit = b.logisticsOutbox?.find((x) => x.docId === docId);
    return hit ? `${hit.name} · sent to ${hit.to.map((k) => LOGISTICS_PARTY_LABEL[k as LogisticsPartyKey] ?? k).join(", ")} · ${hit.at}` : undefined;
  };
  const pod = leg?.pod;

  return LOGISTICS_DOCS.map((d): LogisticsDocView => {
    if (!d.applies(b)) {
      return { ...d, status: "not_needed", because: d.notHere?.(b) ?? "Does not apply to this consignment." };
    }

    let status: DocStatus = d.direction === "IN" ? "awaited" : "draft";
    let evidence: string | undefined;

    switch (d.id) {
      case "PACKING_LIST":
      case "COMMERCIAL_INVOICE":
      case "COO":
        if (sd?.status === "RECEIVED") { status = "received"; evidence = `Supplier reply${sd.receivedAt ? ` · ${sd.receivedAt}` : ""}`; }
        break;
      case "DG_PACK":
        if (sd?.dgDeclarationRef) { status = "received"; evidence = sd.dgDeclarationRef; }
        break;
      case "AWB":
        if (booked) { status = "received"; evidence = `${leg!.carrier} ${leg!.awb}`; }
        break;
      case "CARRIER_INVOICE":
        if (leg?.rateAmount) { status = "received"; evidence = `${leg.rateCurrency ?? ""} ${leg.rateAmount}`.trim(); }
        break;
      case "DELIVERY_ORDER":
        if (leg?.carrierDocs?.length) { status = "received"; evidence = leg.carrierDocs.map((x) => x.fileName).join(", "); }
        break;
      case "BOE_COPY":
        if (customs?.beNo) { status = "received"; evidence = customs.beNo; }
        break;
      case "OOC":
        if (customs?.stage === "CLEARED") { status = "received"; evidence = "Cleared"; }
        break;
      case "POD":
        if (pod) { status = "received"; evidence = `Proof of delivery · ${pod}`; }
        break;

      // ── outbound ────────────────────────────────────────────────────────
      case "DOC_REQUEST":
        if (sd) { status = "sent"; evidence = `Requested${sd.requestedAt ? ` · ${sd.requestedAt}` : ""}`; }
        break;
      case "SHIPPING_INSTRUCTION":
        if (booked) { status = "sent"; evidence = "Sent with the booking"; }
        break;
      case "PRE_ALERT":
        if (sentDoc("PRE_ALERT")) { status = "sent"; evidence = sentDoc("PRE_ALERT"); }
        else if (customs?.awbSentToChaAt) { status = "sent"; evidence = `Sent to the broker · ${customs.awbSentToChaAt}`; }
        break;
      case "AWB_TO_CHA":
        if (customs?.awbSentToChaAt) { status = "sent"; evidence = `Sent to the broker · ${customs.awbSentToChaAt}`; }
        break;
      case "GRN":
        if (b.grn) { status = "sent"; evidence = `${b.grn.grnNo} · ${b.grn.receivedAt}`; }
        break;
      case "DAMAGE_NOTICE":
        /*
         * Only a real job where something is actually wrong. Listing it as owed
         * on every clean receipt would train people to ignore it on the one
         * consignment where it matters.
         */
        if (!b.grn?.discrepancy && !sentDoc("DAMAGE_NOTICE")) {
          return { ...d, status: "not_needed", because: "Nothing short or damaged has been recorded at the dock." };
        }
        if (sentDoc("DAMAGE_NOTICE")) { status = "sent"; evidence = sentDoc("DAMAGE_NOTICE"); }
        else evidence = b.grn?.discrepancy;
        break;
    }

    return { ...d, status, evidence };
  });
}

/** What the desk is waiting on somebody else for. */
export const awaitingFrom = (docs: LogisticsDocView[]) =>
  docs.filter((d) => d.direction === "IN" && d.status === "awaited");

/** What the desk owes, and has not yet sent. */
export const owedOut = (docs: LogisticsDocView[]) =>
  docs.filter((d) => d.direction === "OUT" && (d.status === "awaited" || d.status === "draft"));
