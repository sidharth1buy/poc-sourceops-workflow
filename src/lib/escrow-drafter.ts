// THE ESCROW EMAIL DRAFTER — reads the escrow order, writes the mail.
//
// The twin of `lib/email-drafter.ts` on the logistics side. "Draft with AI" is
// only useful if the draft knows THIS order: which of the eight states it sits
// in, whether the money is in, whether the invoice matches what was agreed,
// how long the inspection window has left, which tranche is next. So it is
// built on the same derivation the board uses (`escrowView`), and picks the
// most pressing topic for the chosen counterparty.
//
// Deterministic on purpose: the same state always drafts the same mail, so the
// demo is repeatable and the draft can never contradict the screen beside it.

import type { OrderBundle } from "@/types";
import { escrowView } from "@/lib/escrow-queue";
import type { EscrowParty } from "@/lib/escrow-thread";
import { money } from "@/lib/utils";

export interface EscrowDraft {
  subject: string;
  /** One line naming what the drafter decided this mail is about. */
  intent: string;
  body: string;
}

const SIGN = "\n\nRegards,\nSupply Chain desk · 1Buy";

export function buildEscrowDraft(
  b: OrderBundle,
  party: EscrowParty,
  replyTo?: { subject: string; body?: string; who: string },
): EscrowDraft {
  const e = b.escrow!;
  const v = escrowView(b)!;
  const amount = money(v.poAmount, v.currency);
  const deadline = v.daysToDeadline === null ? null
    : v.daysToDeadline < 0 ? `${Math.abs(v.daysToDeadline)} days past the inspection deadline`
    : v.daysToDeadline === 0 ? "the inspection deadline is today"
    : `${v.daysToDeadline} days left on the inspection window`;

  if (replyTo) {
    const re = replyTo.subject.startsWith("Re: ") ? replyTo.subject : `Re: ${replyTo.subject}`;
    return {
      subject: re,
      intent: `Reply to ${replyTo.who}`,
      body:
        `Thanks for the note.\n\nWhere this stands on our side: escrow order ${b.orderNo} is at ${v.status.replace(/_/g, " ").toLowerCase()}` +
        (deadline ? `, and ${deadline}` : "") + "." +
        `\n\nPlease come back on anything outstanding at your end so we can keep this moving.` +
        SIGN,
    };
  }

  switch (party) {
    case "HKIN": {
      if (v.cancelled) return {
        subject: `${b.orderNo} — refund of held funds after cancellation`,
        intent: "Chase the refund on a cancelled order",
        body: `Escrow order ${b.orderNo} was cancelled. Please confirm the refund of the ${amount} held and the value date we should expect it.` + SIGN,
      };
      if (v.feeMismatch) return {
        subject: `${b.orderNo} — query on invoice ${e.invoice?.invoiceNo ?? ""}`.trim(),
        intent: "Query the fee against what was agreed",
        body:
          `The fee on ${e.invoice?.invoiceNo ?? "your invoice"} does not match what was agreed when the PO was drafted ` +
          `(${money(e.agreedFeeToBuyer, v.currency)}). Please confirm the correct figure before we instruct payment.` + SIGN,
      };
      switch (e.status) {
        case "DRAFT":
        case "SENT_FOR_SELLER_CONFIRMATION":
          return {
            subject: `${b.orderNo} — escrow order status`,
            intent: "Chase the seller's confirmation",
            body: `Could you confirm where escrow order ${b.orderNo} stands, and whether the seller has accepted the terms yet?` + SIGN,
          };
        case "SELLER_CONFIRMED":
          return {
            subject: `${b.orderNo} — fee invoice not yet received`,
            intent: "Chase the fee invoice",
            body: `The seller has confirmed on ${b.orderNo}. We are waiting on your fee invoice so we can instruct payment — please send it across.` + SIGN,
          };
        case "ESCROW_FEE_INVOICED":
          return {
            subject: `${b.orderNo} — payment against ${e.invoice?.invoiceNo ?? "your invoice"}`,
            intent: "Confirm the payment position to HKin",
            body: e.financeSwiftReference
              ? `Payment for ${amount} plus fees has been made under SWIFT ${e.financeSwiftReference}. Please confirm receipt and open the shipping window.` + SIGN
              : `We are processing payment against ${e.invoice?.invoiceNo ?? "your invoice"} and will send the SWIFT reference as soon as it is wired.` + SIGN,
          };
        case "TT_PAYMENT_RECEIVED":
          return {
            subject: `${b.orderNo} — shipping window`,
            intent: "Chase the seller's despatch through HKin",
            body: `Funds are held against ${b.orderNo}. Please confirm the seller is despatching within the agreed window.` + SIGN,
          };
        case "GOODS_SHIPPED":
          return {
            subject: `${b.orderNo} — inspection window`,
            intent: "Confirm when inspection opens",
            body: `The consignment is on its way. Please confirm when the inspection window opens so we can plan the check.` + SIGN,
          };
        case "RECIPIENT_INSPECTION": {
          if (!e.whlVerdict) return {
            subject: `${b.orderNo} — extension of the inspection period`,
            intent: "Ask for more inspection time",
            body: `Testing on ${b.orderNo} is not yet concluded${deadline ? ` and ${deadline}` : ""}. Please extend the inspection period so the result can be recorded properly.` + SIGN,
          };
          const next = v.milestonesDone + 1;
          return {
            subject: `${b.orderNo} — release instruction, tranche ${next} of ${v.milestonesTotal}`,
            intent: "Instruct the next release",
            body: `Testing has come back acceptable on ${b.orderNo}. Please release tranche ${next} of ${v.milestonesTotal} to the seller against the agreed milestone.` + SIGN,
          };
        }
        case "RELEASED_TO_SELLER":
          return {
            subject: `${b.orderNo} — payment closure document`,
            intent: "Ask for the closure document",
            body: `All tranches are released on ${b.orderNo}. Please send the payment closure document for our records.` + SIGN,
          };
      }
      break;
    }

    case "SUPPLIER":
      if (e.status === "DRAFT" || e.status === "SENT_FOR_SELLER_CONFIRMATION") return {
        subject: `${b.orderNo} — please confirm the escrow order`,
        intent: "Chase the seller's acceptance",
        body: `We have raised escrow order ${b.orderNo} for ${amount}. Please review the terms on HKin and confirm, so the funding step can start.` + SIGN,
      };
      if (e.status === "TT_PAYMENT_RECEIVED") return {
        subject: `${b.orderNo} — funds held, please despatch`,
        intent: "Tell the seller the money is in",
        body: `Funds for ${b.orderNo} are held in escrow. Please despatch within the agreed window and send the shipping documents.` + SIGN,
      };
      if (e.whlVerdict === "FAIL") return {
        subject: `${b.orderNo} — testing came back not acceptable`,
        intent: "Raise the failed result with the seller",
        body: `Testing on ${b.orderNo} has come back not acceptable${e.whlReportRef ? ` (report ${e.whlReportRef})` : ""}. Please advise whether you want a re-test or will accept a return — the escrow release is held either way.` + SIGN,
      };
      return {
        subject: `${b.orderNo} — status`,
        intent: "Status check with the seller",
        body: `Checking in on ${b.orderNo}. Escrow is at ${e.status.replace(/_/g, " ").toLowerCase()}${deadline ? `, and ${deadline}` : ""}. Flag anything at your end that could move the date.` + SIGN,
      };

    case "FINANCE":
      if (e.invoice && !e.paymentInstructedAt) return {
        subject: `${b.orderNo} — payment instruction, escrow`,
        intent: "Instruct Finance to pay",
        body:
          `Please wire against ${e.invoice.invoiceNo} for escrow order ${b.orderNo}.\n\n` +
          `· PO amount: ${amount}\n· Escrow fee: ${money(e.invoice.fees.feeToBuyer, v.currency)}\n` +
          `· Wiring fee: ${money(e.invoice.fees.wiringFeeToBuyer, v.currency)}\n\n` +
          `Bank details are on the invoice. Please send the SWIFT reference back once wired — HKin needs it to confirm.` + SIGN,
      };
      if (e.paymentInstructedAt && !e.financeConfirmedAt) return {
        subject: `${b.orderNo} — chasing the wire`,
        intent: "Chase Finance for the wire",
        body: `Following up on the payment instruction for ${b.orderNo}. Has the wire gone out, and can you send the SWIFT reference?` + SIGN,
      };
      return {
        subject: `${b.orderNo} — escrow position`,
        intent: "Update Finance on the escrow position",
        body: `For your records: ${b.orderNo} is at ${e.status.replace(/_/g, " ").toLowerCase()}, ${amount} under escrow${v.milestonesTotal > 1 ? `, ${v.milestonesDone} of ${v.milestonesTotal} tranches released` : ""}.` + SIGN,
      };

    case "CLIENT":
      return {
        subject: `${b.orderNo} — status update`,
        intent: "Customer status update",
        body:
          `A quick update on ${b.orderNo}:\n\n· Escrow status: ${e.status.replace(/_/g, " ").toLowerCase()}\n· Value under escrow: ${amount}` +
          (deadline ? `\n· Inspection: ${deadline}` : "") +
          `\n\nWe will flag immediately if anything changes.` + SIGN,
      };

    case "OTHER":
      return {
        subject: `${b.orderNo} — escrow status`,
        intent: "Status to a named contact",
        body: `Sharing the current position on ${b.orderNo}: escrow is at ${e.status.replace(/_/g, " ").toLowerCase()}, ${amount} held${deadline ? `, ${deadline}` : ""}.` + SIGN,
      };
  }

  /* Every branch above returns; this satisfies the compiler for the switch fallthrough. */
  return {
    subject: `${b.orderNo} — escrow status`,
    intent: "Status",
    body: `Sharing the current position on ${b.orderNo}.` + SIGN,
  };
}
