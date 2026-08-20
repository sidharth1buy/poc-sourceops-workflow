// THE EMAIL DRAFTER — reads the order, writes the mail.
//
// "Draft with AI" is only useful if the draft knows THIS order: where the
// consignment actually is, how hard the customer's date presses, which
// documents are still owed by the very party being written to, what went
// wrong at the dock. So the drafter is built on the same derivations the
// screens use — inboundView, the incoterm plan, the document register — and
// picks the most pressing topic for the chosen counterparty rather than
// emitting a greeting with blanks.
//
// Deterministic on purpose: the same order state always drafts the same mail,
// so the demo is repeatable and the draft can never contradict the screen
// beside it. The mock-model round-trip lives in the adapter; this file is the
// intelligence.

import type { OrderBundle } from "@/types";
import type { LogisticsParty } from "@/integrations/logistics";
import { inboundView, INBOUND_META } from "@/lib/logistics-order";
import { incotermPlan } from "@/lib/incoterm";

export interface EmailDraft {
  subject: string;
  /** One line naming what the drafter decided this mail is about. */
  intent: string;
  body: string;
}

const SIGN = "\n\nRegards,\nInbound logistics desk · 1Buy";

/** Days-left phrasing shared by every draft. */
function datePressure(daysLeft: number | null): string {
  if (daysLeft === null) return "No committed date is on file for the customer";
  if (daysLeft < 0) return `The customer's committed date passed ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? "" : "s"} ago`;
  if (daysLeft === 0) return "The customer's committed date is today";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} remain to the customer's committed date`;
}

/**
 * Draft the most useful mail to `party`, given everything the order knows.
 * When `replyTo` is passed the draft answers that mail instead of opening a
 * new topic.
 */
export function buildDraft(
  b: OrderBundle,
  party: LogisticsParty,
  replyTo?: { subject: string; body?: string; who: string },
): EmailDraft {
  const v = inboundView(b);
  const leg = b.shipments.find((s) => s.leg === "INBOUND");
  const booked = Boolean(leg && leg.awb !== "booking…" && leg.awb !== "booking failed");
  const sd = b.shippingDocs;
  const customs = b.customs?.[0];
  const plan = incotermPlan(b.incoterm);
  const press = datePressure(v.daysLeft);
  const stageLine = `${INBOUND_META[v.stage].label} — ${INBOUND_META[v.stage].what}`;
  const consign = booked ? `${leg!.carrier} AWB ${leg!.awb}` : "not yet booked";

  if (replyTo) {
    const re = replyTo.subject.startsWith("Re: ") ? replyTo.subject : `Re: ${replyTo.subject}`;
    return {
      subject: re,
      intent: `Reply to ${replyTo.who}`,
      body:
        `Thanks for the note.\n\nWhere this stands on our side: ${stageLine.toLowerCase()} ${press}.` +
        (booked ? `\nConsignment: ${consign}.` : "") +
        `\n\nPlease treat this as priority given the date position, and flag anything you need from us by return.` +
        SIGN,
    };
  }

  switch (party) {
    case "SUPPLIER": {
      if (!sd || sd.status !== "RECEIVED") {
        return {
          subject: `${b.orderNo} — shipping documents needed to book the carrier`,
          intent: "Chase the shipping document set",
          body:
            `We are ready to arrange collection for ${b.orderNo} and are only waiting on your shipping set — packing list, commercial invoice${b.tradeType === "INTERNATIONAL" ? ", certificate of origin" : ""}.\n\n` +
            `${press}, and nothing can be booked until the carrier has boxes, weights and declared value from those documents. Please send them today; scans are fine to start.` +
            SIGN,
        };
      }
      if (b.grn?.discrepancy) {
        return {
          subject: `${b.orderNo} — discrepancy recorded at goods receipt`,
          intent: "Raise the dock discrepancy with the supplier",
          body:
            `At goods receipt we recorded: ${b.grn.discrepancy}\n\n` +
            `Receipt ${b.grn.grnNo} of ${b.grn.receivedAt} refers. Please confirm within 2 working days how the shortfall will be made good (replacement despatch or credit note), so we can settle the claim side consistently.` +
            SIGN,
        };
      }
      return {
        subject: `${b.orderNo} — despatch status against the committed date`,
        intent: "Status check with the supplier",
        body:
          `Checking status on ${b.orderNo}. On our side: ${stageLine.toLowerCase()}\n\n${press}. Please confirm everything on your side is on plan, and flag anything that could move the date now rather than later.` +
          SIGN,
      };
    }

    case "CARRIER": {
      if (!booked) {
        return {
          subject: `${b.orderNo} — collection enquiry ${b.supplier.name} → 1Buy hub`,
          intent: "Pre-booking enquiry to the carrier",
          body:
            `We have a consignment to move: ${b.supplier.name} (${b.supplier.country}) → 1Buy hub.` +
            (sd?.pieces ? `\nParticulars: ${sd.pieces} boxes · ${sd.grossWeightKg ?? "?"} kg · ${sd.dimensions ?? "dims to follow"} · declared ${sd.declaredCurrency ?? ""} ${sd.declaredValue ?? ""}.` : "\nParticulars follow from the supplier's packing list.") +
            `\n\n${press}, so earliest collection matters. Please confirm service options and next pickup window.` +
            SIGN,
        };
      }
      if (v.stage === "AT_WAREHOUSE" && !v.podAt) {
        return {
          subject: `${consign} — proof of delivery required`,
          intent: "Chase the POD",
          body:
            `The consignment on ${consign} has been handed over at our warehouse, and we still hold no proof of delivery.\n\n` +
            `Please return the ePOD (signatory and timestamp) today. Until it is on file the order cannot be closed, and any claim window is running.` +
            SIGN,
        };
      }
      return {
        subject: `${consign} — status and ETA against a committed date`,
        intent: "Track and chase the carrier",
        body:
          `Requesting the latest on ${consign} (${b.orderNo}).\nOur tracking shows: ${stageLine.toLowerCase()}${leg?.lastLocation ? ` Last seen: ${leg.lastLocation}.` : ""}\n\n${press}. If any milestone is at risk, we need to know today, not at delivery.` +
          SIGN,
      };
    }

    case "CHA": {
      if (b.tradeType !== "INTERNATIONAL") {
        return {
          subject: `${b.orderNo} — no customs formalities expected`,
          intent: "Confirm nothing is needed",
          body: `${b.orderNo} is a domestic movement — flagging so nothing is filed against it in error. Please confirm.` + SIGN,
        };
      }
      if (!customs?.awbSentToChaAt && booked) {
        return {
          subject: `${b.orderNo} — pre-alert: ${consign}, please file PRIOR`,
          intent: "Pre-alert the broker",
          body:
            `Pre-alert for the inbound consignment on ${consign}.\n` +
            (sd?.docs?.length ? `Documents attached: ${sd.docs.join(", ")}.\n` : "") +
            (sd?.hsCode ? `HS ${sd.hsCode} · declared ${sd.declaredCurrency ?? ""} ${sd.declaredValue ?? ""}.\n` : "") +
            `\n${press}. Please file the Bill of Entry PRIOR so clearance starts before the goods land, and flag anything missing immediately.` +
            SIGN,
        };
      }
      if (customs && customs.stage !== "CLEARED") {
        return {
          subject: `${b.orderNo} — clearance status on ${customs.beNo ?? "the filed entry"}`,
          intent: "Chase clearance",
          body:
            `Where does clearance stand on ${customs.beNo ?? "our entry"} (${consign})?\n\n${press}, and this consignment is the critical path. Please advise the current stage — assessment, duty, out-of-charge — and anything you need from us to move it today.` +
            SIGN,
        };
      }
      return {
        subject: `${b.orderNo} — thanks; delivery order next`,
        intent: "Post-clearance follow-up",
        body: `Clearance is through on ${consign}. Please confirm the delivery order is with the custodian so the final leg is not held at the gate.` + SIGN,
      };
    }

    case "WAREHOUSE": {
      if (v.stage === "AT_WAREHOUSE" && !v.grnNo) {
        return {
          subject: `${b.orderNo} — please count in and issue the GRN`,
          intent: "GRN reminder to the dock",
          body:
            `The consignment on ${consign} is with you. Please count in against the packing list${sd?.pieces ? ` (${sd.pieces} boxes · ${sd.grossWeightKg} kg)` : ""} and issue the goods receipt note today.\n\n${press} — the order only counts as delivered once your GRN and the carrier's POD are both on file.` +
            SIGN,
        };
      }
      return {
        subject: `${b.orderNo} — dock slot for an inbound consignment`,
        intent: "Book a dock slot",
        body:
          `Inbound consignment ${consign} is expected${leg?.estimatedDelivery ? ` around ${leg.estimatedDelivery}` : " shortly"}. Please hold a dock slot and have the packing list ready to count against.` +
          SIGN,
      };
    }

    case "CLIENT":
      return {
        subject: `${b.orderNo} — status update on your order`,
        intent: "Customer status update",
        body:
          `A quick status on your order ${b.orderNo}:\n\n· Where it is: ${stageLine}\n· ${press}.` +
          (booked && leg?.estimatedDelivery ? `\n· Carrier estimate: ${leg.estimatedDelivery}.` : "") +
          `\n\nWe will flag immediately if anything moves the date.` +
          SIGN,
      };

    case "INSURER": {
      if (b.grn?.discrepancy) {
        return {
          subject: `${b.orderNo} — notice of loss: ${consign}`,
          intent: "Insurance claim notice",
          body:
            `Formal notice within the policy window.\n\nConsignment: ${consign}, delivered to our warehouse ${v.podAt ?? "(POD pending)"}.\nRecorded at receipt: ${b.grn.discrepancy}\n\nEvidence (endorsed consignment note, photographs, GRN ${b.grn.grnNo}) follows. Please open a claim reference by return.` +
            SIGN,
        };
      }
      return {
        subject: `${b.orderNo} — cover confirmation for the inbound leg`,
        intent: "Confirm transit cover",
        body:
          `Please confirm marine cover is in place for ${b.orderNo} (${b.supplier.name} → 1Buy hub, ${b.incoterm} — ${plan.summary}) and send the certificate for the file.` +
          SIGN,
      };
    }

    case "OTHER":
      return {
        subject: `${b.orderNo} — status on the inbound consignment`,
        intent: "Order status to a named contact",
        body:
          `Sharing the current position on ${b.orderNo}:

· Where it is: ${stageLine}
· ${press}.` +
          (booked ? `
· Consignment: ${consign}${leg?.estimatedDelivery ? ` · expected ${leg.estimatedDelivery}` : ""}.` : "") +
          `

Happy to share anything further you need on this.` +
          SIGN,
      };

    case "FINANCE": {
      if (leg?.rateAmount) {
        return {
          subject: `${b.orderNo} — freight invoice for the payment run: ${leg.rateCurrency ?? "USD"} ${leg.rateAmount}`,
          intent: "Forward freight cost to Finance",
          body:
            `Forwarding the freight charge on ${consign} for the next payment run:\n\n· Carrier: ${leg.carrier}${leg.productName ? ` · ${leg.productName}` : ""}\n· Amount: ${leg.rateCurrency ?? "USD"} ${leg.rateAmount}\n· Order: ${b.orderNo}\n\nBooked at carrier booking; invoice attached to the shipment record.` +
            SIGN,
        };
      }
      return {
        subject: `${b.orderNo} — freight cost to follow`,
        intent: "Warn Finance of a coming cost",
        body: `Heads-up: carriage for ${b.orderNo} is not yet booked; the freight charge will follow once a rate is taken. ${press}.` + SIGN,
      };
    }
  }
}
