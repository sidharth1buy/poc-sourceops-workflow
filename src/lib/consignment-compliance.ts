// What has to be settled before a consignment can legally and safely fly, beyond
// "who books it".
//
// `incoterm.ts` answers the two questions the leg asks about responsibility —
// who books the carriage, who clears import. This answers the four it does not,
// and each of them stops a consignment or costs real money when it is missed:
//
//   INSURANCE       — on E and F terms nobody insures unless we do. An uninsured
//                     air leg is an open exposure, and Indian customs adds a
//                     notional 1.125% to the assessable value anyway, so duty is
//                     paid on cover that was never bought.
//   DANGEROUS GOODS — anything with a lithium cell is DG by air. A service that
//                     does not accept them offloads the consignment at the
//                     airport, usually after acceptance, and the booking is remade.
//   EXPORT CLEARANCE— on EXW the supplier's obligation ends at their door, so
//                     filing the export declaration in THEIR country is ours.
//                     It is the part of EXW that catches people out.
//   FREIGHT BILLING — who the carrier invoices. Billing us on a term where the
//                     supplier already priced the carriage in is a double charge,
//                     and nobody notices until the invoice arrives.
//
// Every answer is DERIVED from the order, never chosen in a form: these are
// consequences of the Incoterm and of what is in the box, and a dropdown would
// let somebody record the wrong one.

import type { OrderBundle } from "@/types";
import { incotermPlan, type ResponsibleParty } from "@/lib/incoterm";

export type ComplianceSeverity = "BLOCKER" | "REQUIRED" | "CHECK" | "SETTLED";

export interface ComplianceItem {
  id: "INSURANCE" | "DANGEROUS_GOODS" | "EXPORT_CLEARANCE" | "FREIGHT_BILLING";
  label: string;
  severity: ComplianceSeverity;
  /** Whose it is to do or to produce. */
  party: ResponsibleParty;
  /** The answer, in one line. */
  answer: string;
  /** Why it is that answer — the term, or what is in the box. */
  because: string;
  /** What goes wrong if it is skipped. Empty once settled. */
  ifMissed: string;
}

// Words in a line description that mean a cell is in the box. Deliberately broad:
// a false positive costs one question to the supplier, a false negative costs the
// consignment being offloaded at the airport.
const CELL_WORDS = ["lithium", "li-ion", "liion", "li-po", "lipo", "coin cell", "batter", "supercap"];

/** The line that reads as containing a cell, if any. */
export function cellBearingLine(b: OrderBundle): string | null {
  for (const l of b.lines) {
    const hay = `${l.mpn} ${l.description ?? ""}`.toLowerCase();
    if (CELL_WORDS.some((w) => hay.includes(w))) return l.mpn;
  }
  return null;
}

/** Does anything on this order have to travel as dangerous goods? */
export const carriesDangerousGoods = (b: OrderBundle) => cellBearingLine(b) !== null;

/**
 * The four, answered for this order.
 *
 * CHECK is not the same as NOT NEEDED. Where the platform cannot tell — a cell
 * inside a module never appears in a part description — it says so and asks,
 * because a file quietly marked complete is how a consignment gets held.
 */
export function consignmentCompliance(b: OrderBundle): ComplianceItem[] {
  const plan = incotermPlan(b.incoterm);
  const intl = b.tradeType === "INTERNATIONAL";
  const cell = cellBearingLine(b);
  const insured = Boolean(b.shippingDocs?.insuranceCertRef);
  const dgOnFile = Boolean(b.shippingDocs?.dgDeclarationRef);
  const exportRef = b.shippingDocs?.exportDeclarationRef;

  // Insurance follows the term: E and F leave it with the buyer, C-terms (CIF /
  // CIP) put it on the seller, D-terms are the seller's risk to destination.
  const weInsure = plan.group === "E" || plan.group === "F";

  const items: ComplianceItem[] = [
    {
      id: "INSURANCE",
      label: "Cargo insurance",
      severity: insured ? "SETTLED" : weInsure ? "REQUIRED" : "CHECK",
      party: weInsure ? "1BUY" : "SUPPLIER",
      answer: insured
        ? `Covered — certificate ${b.shippingDocs!.insuranceCertRef}.`
        : weInsure
          ? "Ours to arrange. Cover should start at the supplier's loading bay, not at the airport."
          : "The supplier's price already includes cover — ask them for the certificate rather than buying a second one.",
      because: `${plan.incoterm}: ${weInsure ? "no party is obliged to insure under this term, so nothing is insured unless we insure it" : "the seller carries the risk to destination and holds the policy"}.`,
      ifMissed: insured
        ? ""
        : weInsure
          ? "An uninsured leg is an open exposure. Customs add a notional 1.125% to the assessable value regardless, so the duty is paid either way."
          : "Without their certificate the assessable value is built on our estimate of a premium somebody else paid.",
    },
    {
      id: "DANGEROUS_GOODS",
      label: "Dangerous goods",
      severity: cell ? (dgOnFile ? "SETTLED" : "BLOCKER") : "CHECK",
      party: "SUPPLIER",
      answer: cell
        ? dgOnFile
          ? `Declared — ${b.shippingDocs!.dgDeclarationRef}. Only a service that accepts cells may carry it.`
          : `${cell} reads as a cell, so this is dangerous goods by air. The declaration, the UN38.3 test summary and the safety data sheet must be with the carrier before it is loaded.`
        : "Nothing on the order reads as a battery. Confirm with the supplier before dispatch — a cell inside a module is easy to miss.",
      because: cell ? `Line ${cell} matched a cell in its description.` : "No line description matched a cell.",
      ifMissed:
        cell && !dgOnFile
          ? "The consignment is offloaded at the airport, usually after acceptance, and the whole booking is remade."
          : cell
            ? ""
            : "A module with a cell inside it is the case people miss, and it is found at the airport rather than on the packing list.",
    },
    {
      id: "EXPORT_CLEARANCE",
      label: "Export clearance at origin",
      severity: !intl ? "SETTLED" : exportRef ? "SETTLED" : plan.group === "E" ? "REQUIRED" : "CHECK",
      // On EXW the supplier's obligation ends at their door — filing the export
      // declaration in their country is ours, and it is the part of EXW that
      // catches people out.
      party: plan.group === "E" ? "1BUY" : "SUPPLIER",
      answer: !intl
        ? "Domestic movement — no export declaration."
        : exportRef
          ? `Cleared — declaration ${exportRef}.`
          : plan.group === "E"
            ? "Ours to file, in the supplier's country. They will hand over at their door and no further."
            : "The supplier files it. Ask for the reference — the carrier will want it.",
      because: !intl
        ? `${b.tradeType.toLowerCase()} order.`
        : `${plan.incoterm}: ${plan.group === "E" ? "the seller's obligation ends at their premises" : "the seller clears the goods for export"}.`,
      ifMissed:
        !intl || exportRef
          ? ""
          : "The consignment does not leave. It sits at the origin airport with nobody chasing it, and the carrier will not raise the waybill without it.",
    },
    {
      id: "FREIGHT_BILLING",
      label: "Who the carrier bills",
      severity: "SETTLED",
      party: plan.freightParty,
      answer:
        plan.freightParty === "1BUY"
          ? "1Buy — the waybill is raised on our carrier account."
          : "The supplier — on their own account. We record and track the AWB, we do not pay for it.",
      because: plan.summary,
      ifMissed: "",
    },
  ];

  return items;
}

/** Anything that stops the booking, or that has to be produced before it. */
export const complianceBlockers = (items: ComplianceItem[]) =>
  items.filter((i) => i.severity === "BLOCKER");

export const complianceOutstanding = (items: ComplianceItem[]) =>
  items.filter((i) => i.severity === "BLOCKER" || i.severity === "REQUIRED");
