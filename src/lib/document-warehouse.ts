// THE DOCUMENT WAREHOUSE — what this order actually needs, who owes it, and
// which desk is answerable for it.
//
// Built from the inbound register in the APAC→India flow document. Three ideas
// from that brief drive the whole shape here, and each is a correction of how
// document checklists normally go wrong:
//
//   1. THE REQUIRED SET IS NOT A FIXED LIST. It is a function of
//      (Incoterm × mode × trade type × HS/DG class × FTA claim × scheme). A flat
//      checklist either over-demands — training people to tick past it — or
//      misses the one document that holds the consignment. So every entry
//      carries an `applies` predicate and says why it does or does not apply.
//
//   2. WHO PRODUCES A DOCUMENT IS RARELY WHO ANSWERS FOR IT. The supplier issues
//      the certificate of origin; under CAROTAR 2020 the IMPORTER must possess
//      sufficient origin information, and a certificate they cannot substantiate
//      is worse than no claim at all. Four documents diverge this way and each
//      needs a named internal verifier, not a "received" tick.
//
//   3. EVERY DOCUMENT BELONGS TO A DESK. A warehouse that shows every team
//      every document is a warehouse nobody reads. Each entry names the internal
//      team answerable for having it, and the view is scoped to that team.
//
// Nothing here files anything or changes an order. It is a pure reading of what
// the order holds against what the lane requires.

import type { OrderBundle } from "@/types";
import { incotermPlan } from "@/lib/incoterm";
import { cellBearingLine } from "@/lib/consignment-compliance";

/** The internal desk answerable for having the document. */
export type Desk = "SOURCING" | "LOGISTICS" | "CUSTOMS" | "FINANCE" | "QUALITY" | "RISK";

export const DESKS: Desk[] = ["SOURCING", "LOGISTICS", "CUSTOMS", "FINANCE", "QUALITY", "RISK"];

export const DESK_META: Record<Desk, { label: string; blurb: string }> = {
  SOURCING: { label: "Sourcing", blurb: "The order itself, the supplier's paper, and what the PO had to specify." },
  LOGISTICS: { label: "Logistics", blurb: "Booking, carriage, and the documents a carrier will not fly without." },
  CUSTOMS: { label: "Customs & compliance", blurb: "The entry, its substantiation, and the licences that gate import." },
  FINANCE: { label: "Finance", blurb: "Duty, credit, landed cost and what the ledger has to be able to prove." },
  QUALITY: { label: "Quality & receiving", blurb: "What arrives, in what condition, and whether it may be accepted." },
  RISK: { label: "Risk & insurance", blurb: "Cover, and the evidence a claim is recoverable on." },
};

/** Who physically produces it, and who answers for it to an authority. */
export type Party =
  | "SUPPLIER" | "IMPORTER" | "FORWARDER" | "CARRIER" | "CHA"
  | "CUSTOMS" | "INSURER" | "BANK" | "TRANSPORTER" | "PLANT";

export const PARTY_LABEL: Record<Party, string> = {
  SUPPLIER: "Supplier",
  IMPORTER: "Importer (client)",
  FORWARDER: "Forwarder",
  CARRIER: "Carrier",
  CHA: "Customs broker",
  CUSTOMS: "Customs",
  INSURER: "Insurer",
  BANK: "Bank (AD)",
  TRANSPORTER: "Transporter",
  PLANT: "Plant / QA",
};

/**
 * Where a document has got to.
 *
 * `draft_received` is a real state and not a nicety: reviewing the draft
 * invoice and origin certificate BEFORE shipping is the highest-leverage check
 * in the whole flow, because s.149 only permits amendment on evidence that
 * existed at the time of clearance — an error caught at origin costs an email,
 * the same error caught at the Indian border may not be correctable at all.
 */
export type DocState =
  | "not_required"
  | "pending"
  | "draft_received"
  | "verified"
  | "original_received";

export const STATE_LABEL: Record<DocState, string> = {
  not_required: "Not needed here",
  pending: "Not received",
  draft_received: "Draft in — needs review",
  verified: "Verified",
  original_received: "Original on file",
};

export interface DocSpec {
  id: string;
  name: string;
  /**
   * The desk that OBTAINS it — runs the chase. Exactly one.
   *
   * Not the same as the desks that need it (`neededByDesks`), and not the same
   * as the desk that checks its content (`verifiedBy`). Conflating obtaining
   * with needing made the commercial invoice invisible to Logistics, whose
   * carrier will not accept the consignment without it. Conflating obtaining
   * with verifying split ONE supplier email — which asks for the packing list,
   * the commercial invoice and the origin certificate together — across two
   * desks, so half of a single exchange sat on a queue nobody was working.
   */
  desk: Desk;
  /**
   * The desk that must READ it, where that is not the desk that obtains it.
   *
   * Logistics asks the supplier for all three shipping documents in one mail,
   * but the declared value and the origin claim carry declaration liability, so
   * Customs has to check those two before they are relied on. Obtaining is a
   * chase; verifying is a judgement, and they are not the same person's job.
   */
  verifiedBy?: Desk;
  /** The flow phase it belongs to, for grouping. */
  phase: "Enablement" | "Order" | "Origin" | "Transit" | "Clearance" | "Domestic" | "Receipt";
  providedBy: Party;
  /**
   * Who answers for it to an authority. Where this differs from `providedBy`,
   * the document needs a named internal verifier rather than a receipt tick.
   */
  accountable: Party;
  /** Every downstream party whose work stops without it. */
  requiredBy: Party[];
  /** The milestone by which it has to exist. */
  trigger: string;
  /** What it is for. */
  why: string;
  /** What goes wrong without it — the reason a chase is justified today. */
  ifMissing: string;
  /**
   * Somebody internal must READ this, not just log its arrival.
   *
   * Stated per document rather than inferred from producer ≠ accountable,
   * because that inference over-fires: our own plant produces the goods receipt
   * note and the importer answers for it, but there is no second party whose
   * content needs checking. The real cases are the ones where an OUTSIDE party
   * authored something we are answerable for and could be wrong about — the
   * supplier's value and origin claim, the broker's declaration, the heading the
   * datasheets have to support, the adequacy of somebody else's cover.
   */
  verifyNotReceive?: boolean;
  /**
   * Does THIS order need it? Returning a reason string means yes-and-because;
   * returning null means it does not apply, and the reason is stated too.
   */
  applies: (b: OrderBundle) => { needed: boolean; because: string };
}

// ── the facts the predicates read ────────────────────────────────────────
const intl = (b: OrderBundle) => b.tradeType === "INTERNATIONAL";
const term = (b: OrderBundle) => incotermPlan(b.incoterm);
/** Air is the only mode this platform books today; ocean adds VGM and ISPM-15. */
const isOcean = (b: OrderBundle) =>
  b.shipments.some((s) => /sea|ocean|fcl|lcl/i.test(`${s.carrier} ${s.productName ?? ""}`));

const always = (because: string) => () => ({ needed: true, because });

/**
 * THE REGISTER.
 *
 * Ordered by the phase it is wanted in, because that is the order a desk meets
 * them in — not alphabetically, and not by who produces them.
 */
export const DOCUMENT_REGISTER: DocSpec[] = [
  // ── Order ──────────────────────────────────────────────────────────────
  {
    id: "PO",
    name: "Purchase order",
    desk: "SOURCING",
    phase: "Order",
    providedBy: "IMPORTER",
    accountable: "IMPORTER",
    requiredBy: ["SUPPLIER", "FORWARDER", "CHA", "PLANT"],
    trigger: "Order placement",
    why: "Evidences the transaction value declared at the border, and carries the Incoterm, HS code, origin form type and packaging spec everything downstream depends on.",
    ifMissing: "The declared value is unsupported, which is the first thing a valuation query asks for.",
    applies: always("Every order."),
  },
  {
    id: "SUPPLIER_PI",
    name: "Supplier proforma invoice",
    desk: "SOURCING",
    phase: "Order",
    providedBy: "SUPPLIER",
    accountable: "SUPPLIER",
    requiredBy: ["IMPORTER", "BANK"],
    trigger: "Post-PO acknowledgement",
    why: "The supplier's own commitment to price, quantity and lead time — what the remittance and the escrow hold are raised against.",
    ifMissing: "Nothing anchors what was actually agreed, and the bank has no basis for the remittance.",
    applies: always("Every order."),
  },
  {
    id: "LANDED_COST",
    name: "Landed-cost worksheet",
    desk: "FINANCE",
    phase: "Order",
    providedBy: "IMPORTER",
    accountable: "IMPORTER",
    requiredBy: ["IMPORTER", "BANK"],
    trigger: "Before the PO is placed",
    why: "Unit price plus freight, the full duty stack and the domestic leg. A part at 0% under a trade agreement can beat a cheaper one at 10% BCD plus surcharge.",
    ifMissing: "The sourcing decision was made on unit price, which is not the number the business pays.",
    applies: always("Every order — the comparison is only meaningful before commitment."),
  },

  // ── Origin ─────────────────────────────────────────────────────────────
  {
    id: "COMMERCIAL_INVOICE",
    name: "Commercial invoice",
    // Arrives in the same supplier mail as the packing list and the origin
    // certificate, which Logistics sends. The VALUE on it is Customs' to check.
    desk: "LOGISTICS",
    verifiedBy: "CUSTOMS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    // The supplier writes it; the importer answers for the value declared on it.
    accountable: "IMPORTER",
    requiredBy: ["FORWARDER", "CHA", "CUSTOMS", "BANK"],
    trigger: "Before dispatch",
    why: "The declared value. The carrier declares against it and customs assess duty on it.",
    ifMissing: "The carrier will not accept the consignment, and an entry filed on an invoice that does not match the goods is a query at best.",
    verifyNotReceive: true,
    applies: always("Every consignment."),
  },
  {
    id: "PACKING_LIST",
    name: "Packing list",
    desk: "LOGISTICS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    accountable: "SUPPLIER",
    requiredBy: ["FORWARDER", "CHA", "CUSTOMS", "PLANT"],
    trigger: "Before dispatch",
    why: "What is in each carton, with weights, dimensions and marks.",
    ifMissing: "Nothing can be counted in against it at the dock, and a shortage claim argued without one gets refused.",
    applies: always("Every consignment."),
  },
  {
    id: "COO",
    name: "Certificate of origin",
    // Same mail again. The CLAIM made on it is Customs' to substantiate.
    desk: "LOGISTICS",
    verifiedBy: "CUSTOMS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    // CAROTAR 2020: holding the certificate does not discharge the importer.
    accountable: "IMPORTER",
    requiredBy: ["CHA", "CUSTOMS"],
    trigger: "Before the entry is filed",
    why: "Where the goods were made — it decides the duty rate.",
    ifMissing: "Duty is assessed at the standard rate, and a preferential rate that was available is forfeited with no way to reclaim it.",
    verifyNotReceive: true,
    applies: (b) =>
      intl(b)
        ? { needed: true, because: "International consignment — origin decides the rate." }
        : { needed: false, because: "Domestic movement." },
  },
  {
    id: "ORIGIN_DATA_PACK",
    name: "Origin data pack (regional value content)",
    desk: "CUSTOMS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    accountable: "IMPORTER",
    requiredBy: ["CUSTOMS"],
    trigger: "With any preferential claim",
    why: "CAROTAR Rule 4 requires the importer to POSSESS sufficient origin information, not merely hold a certificate.",
    ifMissing: "A preferential claim you cannot substantiate converts a duty saving into a suppression allegation, which reopens five years rather than two.",
    verifyNotReceive: true,
    applies: (b) =>
      intl(b)
        ? { needed: true, because: "Needed wherever a preferential rate is claimed. Confirm whether this lane claims one." }
        : { needed: false, because: "Domestic movement — no preferential claim." },
  },
  {
    id: "SLI",
    name: "Shipper's letter of instruction",
    desk: "LOGISTICS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    accountable: "SUPPLIER",
    requiredBy: ["FORWARDER", "CARRIER"],
    trigger: "At booking",
    why: "Tells the carrier who ships, who receives, on what terms and who pays the freight.",
    ifMissing: "The waybill is raised on assumptions — most often freight billed to the wrong party, argued about after it is paid.",
    applies: (b) =>
      term(b).weBookFreight
        ? { needed: true, because: `${b.incoterm}: we book, so the supplier instructs our forwarder.` }
        : { needed: false, because: `${b.incoterm}: the supplier books their own carriage.` },
  },
  {
    id: "EXPORT_DECLARATION",
    name: "Export declaration at origin",
    desk: "LOGISTICS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    accountable: "SUPPLIER",
    requiredBy: ["CARRIER", "FORWARDER"],
    trigger: "Before departure",
    why: "Clears the goods out of the supplier's country.",
    ifMissing: "The consignment does not leave. It sits at the origin airport with nobody chasing it.",
    applies: (b) => {
      if (!intl(b)) return { needed: false, because: "Domestic movement." };
      return term(b).group === "E"
        ? { needed: true, because: "Bought on EXW: the seller's obligation ends at their door, so filing it is OURS. This is the part of EXW people are caught by." }
        : { needed: true, because: `${b.incoterm}: the supplier files it — get the reference, the carrier will want it.` };
    },
  },
  {
    id: "DG_PACK",
    name: "DG declaration, UN38.3 summary and safety data sheet",
    desk: "LOGISTICS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    accountable: "SUPPLIER",
    requiredBy: ["CARRIER", "FORWARDER", "CUSTOMS"],
    trigger: "Before the consignment is loaded",
    why: "Anything with a lithium cell is dangerous goods by air, and the carrier must hold the test summary and the sheet before loading.",
    ifMissing: "The consignment is offloaded at the airport, usually after acceptance, and the whole booking is remade.",
    applies: (b) => {
      const cell = cellBearingLine(b);
      return cell
        ? { needed: true, because: `${cell} reads as a cell.` }
        : { needed: false, because: "Nothing on the order reads as a cell — worth confirming, since a cell inside a module never appears in a description." };
    },
  },
  {
    id: "ISPM15",
    name: "ISPM-15 fumigation certificate or non-wood declaration",
    desk: "LOGISTICS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    accountable: "SUPPLIER",
    requiredBy: ["CUSTOMS"],
    trigger: "At handover",
    why: "Wood packaging entering India must be treated and marked, or declared wood-free.",
    ifMissing: "Plant quarantine holds the consignment, and remediation at the port is slow and expensive.",
    applies: (b) =>
      intl(b)
        ? { needed: true, because: "International consignment — either the treatment certificate or a wood-free declaration." }
        : { needed: false, because: "Domestic movement." },
  },
  {
    id: "VGM",
    name: "Verified gross mass declaration",
    desk: "LOGISTICS",
    phase: "Origin",
    providedBy: "SUPPLIER",
    accountable: "SUPPLIER",
    requiredBy: ["CARRIER"],
    trigger: "Before the container is loaded",
    why: "SOLAS requires a verified gross mass before a container may be shipped.",
    ifMissing: "The container is not loaded.",
    applies: (b) =>
      isOcean(b)
        ? { needed: true, because: "Ocean container movement." }
        : { needed: false, because: "Air consignment — SOLAS does not apply." },
  },

  // ── Risk ───────────────────────────────────────────────────────────────
  {
    id: "INSURANCE_DECLARATION",
    name: "Insurance declaration (before departure)",
    desk: "RISK",
    phase: "Origin",
    providedBy: "IMPORTER",
    accountable: "IMPORTER",
    requiredBy: ["INSURER"],
    trigger: "BEFORE the consignment departs",
    why: "An open marine policy covers a consignment only once it has been declared. Declaring after departure is void cover.",
    ifMissing: "There is no cover, and it cannot be fixed retrospectively — this is the one failure in the whole flow with no remedy.",
    applies: (b) =>
      ["E", "F"].includes(term(b).group)
        ? { needed: true, because: `${b.incoterm}: no party is obliged to insure, so nothing is covered unless we cover it.` }
        : { needed: false, because: `${b.incoterm}: the seller carries the risk to destination and holds the policy — get their certificate.` },
  },
  {
    id: "INSURANCE_CERTIFICATE",
    name: "Insurance certificate",
    desk: "RISK",
    phase: "Transit",
    providedBy: "INSURER",
    // The insurer issues it; the adequacy of the cover is the importer's call.
    accountable: "IMPORTER",
    requiredBy: ["CHA", "CUSTOMS"],
    trigger: "On declaration",
    why: "Evidence of cover, and a figure the assessable value is built on. Sum insured should be CIF + duty + 10% — duty is unrecoverable if the goods are destroyed.",
    ifMissing: "Customs add a notional insurance percentage to the assessable value anyway, so the duty is paid either way — with no cover behind it.",
    verifyNotReceive: true,
    applies: (b) =>
      intl(b)
        ? { needed: true, because: "International consignment — whoever insures, the certificate is needed for the entry." }
        : { needed: false, because: "Domestic movement." },
  },

  // ── Transit ────────────────────────────────────────────────────────────
  {
    id: "AWB_BL",
    name: "Air waybill or bill of lading",
    desk: "LOGISTICS",
    phase: "Transit",
    providedBy: "CARRIER",
    accountable: "CARRIER",
    requiredBy: ["CHA", "CUSTOMS", "INSURER"],
    trigger: "On departure",
    why: "The contract of carriage. The entry quotes its number and a claim is argued on it.",
    ifMissing: "No entry can be filed. The consignment lands and sits.",
    applies: always("Every consignment."),
  },
  {
    id: "FREIGHT_INVOICE",
    name: "Freight invoice or certificate",
    desk: "FINANCE",
    phase: "Transit",
    providedBy: "FORWARDER",
    accountable: "FORWARDER",
    requiredBy: ["CHA", "CUSTOMS"],
    trigger: "Before the entry is filed",
    why: "Freight is added to the assessable value where the Incoterm leaves it with the buyer, so the figure has to be evidenced.",
    ifMissing: "The assessable value is built on an estimate, which is a valuation query waiting to happen.",
    applies: (b) =>
      term(b).weBookFreight
        ? { needed: true, because: `${b.incoterm}: freight is ours and must be added to the assessable value.` }
        : { needed: false, because: `${b.incoterm}: freight is already inside the supplier's price.` },
  },
  {
    id: "TECHNICAL_LITERATURE",
    name: "Datasheets and technical write-up",
    desk: "CUSTOMS",
    phase: "Transit",
    providedBy: "SUPPLIER",
    accountable: "IMPORTER",
    requiredBy: ["CUSTOMS"],
    trigger: "Staged before arrival",
    why: "Supports the tariff heading declared for each part, and answers a classification query without a scramble.",
    ifMissing: "The appraiser queries the classification and the consignment waits at the port while it is answered.",
    verifyNotReceive: true,
    applies: (b) =>
      intl(b)
        ? { needed: true, because: "International consignment — the heading has to be defensible." }
        : { needed: false, because: "Domestic movement." },
  },
  {
    id: "PRE_ALERT",
    name: "Pre-alert pack to the customs broker",
    desk: "LOGISTICS",
    phase: "Transit",
    providedBy: "IMPORTER",
    accountable: "IMPORTER",
    requiredBy: ["CHA"],
    trigger: "48–72h before arrival by air; 5–7 days by sea",
    why: "The complete document set the broker files against. Advance filing is permitted up to 30 days before arrival and is the single biggest lever on dwell time.",
    ifMissing: "The largest controllable cause of clearance delay — the broker starts assembling on the day the goods land.",
    applies: always("Every consignment."),
  },

  // ── Clearance ──────────────────────────────────────────────────────────
  {
    id: "DRAFT_BOE",
    name: "Draft Bill of Entry (pre-filing review)",
    desk: "CUSTOMS",
    phase: "Clearance",
    providedBy: "CHA",
    // The broker files it; the importer subscribes to the truth of it.
    accountable: "IMPORTER",
    requiredBy: ["IMPORTER"],
    trigger: "Before submission — a mandatory gate",
    why: "The importer subscribes to the truth of the declaration and self-assesses the duty. Reviewing four fields — heading, assessable value, notifications, preferential flag — is the whole of that duty made practical.",
    ifMissing: "The declaration is made before you have read it, and amendment afterwards is permitted only on evidence that already existed at clearance.",
    verifyNotReceive: true,
    applies: (b) =>
      intl(b)
        ? { needed: true, because: "Every entry — this is where liability actually attaches." }
        : { needed: false, because: "Domestic movement — no entry." },
  },
  {
    id: "BOE",
    name: "Bill of Entry (filed)",
    desk: "CUSTOMS",
    phase: "Clearance",
    providedBy: "CHA",
    accountable: "IMPORTER",
    requiredBy: ["CUSTOMS", "PLANT"],
    trigger: "Up to 30 days before arrival, or on arrival",
    why: "The entry itself. Duty is assessed on it and input tax credit is claimed against it.",
    ifMissing: "Nothing is assessed and nothing clears; demurrage runs from the day the goods land.",
    verifyNotReceive: true,
    applies: (b) =>
      intl(b) ? { needed: true, because: "International import." } : { needed: false, because: "Domestic movement." },
  },
  {
    id: "DUTY_CHALLAN",
    name: "Duty payment challan",
    desk: "FINANCE",
    phase: "Clearance",
    providedBy: "CUSTOMS",
    accountable: "IMPORTER",
    requiredBy: ["CHA", "CUSTOMS"],
    trigger: "Before out of charge",
    why: "Proof the assessed duty was paid.",
    ifMissing: "Customs will not give out of charge, and the recoverable portion cannot be claimed.",
    applies: (b) =>
      intl(b) ? { needed: true, because: "International import." } : { needed: false, because: "Domestic movement." },
  },
  {
    id: "OOC_BOE",
    name: "Out-of-charge endorsed Bill of Entry",
    desk: "FINANCE",
    phase: "Clearance",
    providedBy: "CUSTOMS",
    accountable: "IMPORTER",
    requiredBy: ["PLANT", "CUSTOMS"],
    trigger: "On out of charge",
    why: "Customs releasing the consignment, and the document the input tax credit is claimed against in the monthly reconciliation.",
    ifMissing: "Nothing moves out of the port, and the credit cannot be claimed or defended on audit.",
    applies: (b) =>
      intl(b) ? { needed: true, because: "International import." } : { needed: false, because: "Domestic movement." },
  },
  {
    id: "DELIVERY_ORDER",
    name: "Delivery order from the carrier",
    desk: "LOGISTICS",
    phase: "Clearance",
    providedBy: "CARRIER",
    accountable: "CARRIER",
    requiredBy: ["TRANSPORTER"],
    trigger: "After out of charge, against the carrier's charges",
    why: "The carrier authorising the custodian to release the consignment.",
    ifMissing: "The goods are cleared by customs and still cannot be collected — the most avoidable day of demurrage there is.",
    applies: (b) =>
      intl(b) ? { needed: true, because: "International import." } : { needed: false, because: "Domestic movement." },
  },

  // ── Domestic ───────────────────────────────────────────────────────────
  {
    id: "EWAY_BILL",
    name: "E-way bill",
    desk: "LOGISTICS",
    phase: "Domestic",
    providedBy: "IMPORTER",
    accountable: "IMPORTER",
    requiredBy: ["TRANSPORTER", "CUSTOMS"],
    trigger: "Before the port-to-plant movement begins",
    why: "Required for any consignment above the threshold moving by road, and it must reference the invoice it travels with.",
    ifMissing: "The vehicle is detained in transit and the goods are liable to penalty.",
    applies: always("Any road movement above the threshold."),
  },
  {
    id: "LR",
    name: "Lorry receipt / consignment note",
    desk: "LOGISTICS",
    phase: "Domestic",
    providedBy: "TRANSPORTER",
    accountable: "TRANSPORTER",
    requiredBy: ["PLANT", "INSURER"],
    trigger: "On dispatch from the port",
    why: "The domestic contract of carriage — and, endorsed at the dock, the document a damage claim is recoverable on.",
    ifMissing: "A clean receipt forfeits both carrier recovery and the insurance claim.",
    applies: always("Every port-to-plant movement."),
  },

  // ── Receipt ────────────────────────────────────────────────────────────
  {
    id: "GATE_ENTRY",
    name: "Gate entry note and seal record",
    desk: "QUALITY",
    phase: "Receipt",
    providedBy: "PLANT",
    accountable: "IMPORTER",
    requiredBy: ["PLANT", "INSURER"],
    trigger: "As the vehicle enters, before unloading",
    why: "Seal integrity against the consignment note, photographed before anything is unloaded.",
    ifMissing: "A broken seal noticed after unloading cannot be attributed to the carrier.",
    applies: always("Every receipt."),
  },
  {
    id: "DAMAGE_CERT",
    name: "Damage / shortage certificate",
    desk: "QUALITY",
    phase: "Receipt",
    providedBy: "PLANT",
    accountable: "IMPORTER",
    requiredBy: ["INSURER", "CARRIER"],
    trigger: "At the dock, with the driver present",
    why: "A joint record with photographs, and the endorsement on the consignment note before the driver leaves.",
    ifMissing: "Both the carrier claim and the insurance claim fail — the notice window runs from delivery, not from discovery.",
    applies: always("Wherever anything is short or damaged."),
  },
  {
    id: "MSL_RECORD",
    name: "Moisture barrier and humidity indicator record",
    desk: "QUALITY",
    phase: "Receipt",
    providedBy: "PLANT",
    accountable: "IMPORTER",
    requiredBy: ["PLANT", "INSURER"],
    trigger: "At the dock, not at incoming inspection",
    why: "Moisture exposure surfaces at reflow, weeks later — by then the carrier notice window has closed and the transit clause may have expired.",
    ifMissing: "Concealed moisture damage is discovered too late to recover from anybody.",
    applies: always("Electronic components are moisture-sensitive by default."),
  },
  {
    id: "IQC_REPORT",
    name: "Incoming inspection report",
    desk: "QUALITY",
    phase: "Receipt",
    providedBy: "PLANT",
    accountable: "IMPORTER",
    requiredBy: ["PLANT", "SUPPLIER"],
    trigger: "Before the goods are accepted into free stock",
    why: "Label and part-number verification, date codes, counterfeit screening on non-franchised sources, and the sampling the acceptance rests on.",
    ifMissing: "Material enters production unverified, and a counterfeit or stale-date lot is found at the customer.",
    applies: always("Every receipt."),
  },
  {
    id: "GRN",
    name: "Goods receipt note",
    desk: "FINANCE",
    phase: "Receipt",
    providedBy: "PLANT",
    accountable: "IMPORTER",
    requiredBy: ["IMPORTER", "PLANT"],
    trigger: "On acceptance",
    why: "The three-way match against the purchase order and the supplier's invoice, and the point landed cost is capitalised.",
    ifMissing: "Nothing reconciles, and the credit cannot be tied to a receipt on audit.",
    applies: always("Every receipt."),
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Where each document has actually got to on THIS order
// ─────────────────────────────────────────────────────────────────────────

export interface WarehouseEntry extends DocSpec {
  state: DocState;
  /** Why it is or is not needed here. */
  because: string;
  /** The file or reference behind it, where one exists. */
  evidence?: string;
  /** True where somebody internal must read it rather than log its arrival. */
  diverges: boolean;
  /** The other desks whose work stops without it. */
  alsoNeededBy: Desk[];
  /** True on the entry as seen BY its verifying desk. */
  toVerify: boolean;
}

/**
 * The order's own document position.
 *
 * State is READ from what the order holds rather than stored, so the warehouse
 * cannot drift from the records the rest of the app writes: a shipping-document
 * reply, a carrier document retrieval, a customs entry and an uploaded file all
 * already exist, and each one is evidence for exactly one register entry.
 */
export function documentWarehouse(b: OrderBundle): WarehouseEntry[] {
  const sd = b.shippingDocs;
  const inbound = b.shipments.find((s) => s.leg === "INBOUND");
  const customs = b.customs?.[0];
  const uploaded = new Map(
    (b.documents ?? []).map((d) => [d.docType.toUpperCase().replace(/[^A-Z]/g, "_"), d]),
  );

  const found = (...names: string[]) => {
    for (const n of names) {
      const hit = uploaded.get(n.toUpperCase().replace(/[^A-Z]/g, "_"));
      if (hit) return hit.fileName;
    }
    return undefined;
  };

  return DOCUMENT_REGISTER.map((spec): WarehouseEntry => {
    const { needed, because } = spec.applies(b);
    if (!needed) {
      return { ...spec, state: "not_required" as DocState, because, diverges: Boolean(spec.verifyNotReceive), alsoNeededBy: neededByDesks(spec), toVerify: false };
    }

    let state: DocState = "pending";
    let evidence: string | undefined;

    switch (spec.id) {
      case "PO":
        if (b.supplierPoNo) { state = "original_received"; evidence = b.supplierPoNo; }
        break;
      case "SUPPLIER_PI":
        if (b.piNo) { state = "original_received"; evidence = b.piNo; }
        break;
      case "COMMERCIAL_INVOICE":
      case "PACKING_LIST":
      case "COO":
        /*
         * The supplier's shipping-document exchange is the evidence for all
         * three. A request out is a draft expected; a reply in is the set
         * received — which is why `draft_received` exists as its own state
         * rather than collapsing into "pending".
         */
        if (sd?.status === "RECEIVED" && sd.docs?.some((d) => matches(d, spec.id))) {
          state = "verified";
          evidence = `From the supplier's reply${sd.receivedAt ? ` · ${sd.receivedAt}` : ""}`;
        } else if (sd?.status === "REQUESTED") {
          state = "draft_received";
          evidence = `Requested${sd.requestedAt ? ` · ${sd.requestedAt}` : ""} — awaiting reply`;
        }
        break;
      case "AWB_BL":
        if (inbound?.awb && inbound.awb !== "booking…" && inbound.awb !== "booking failed") {
          state = "original_received";
          evidence = `${inbound.carrier} ${inbound.awb}`;
        }
        break;
      case "PRE_ALERT":
        if (customs?.awbSentToChaAt) { state = "verified"; evidence = `Sent to the broker · ${customs.awbSentToChaAt}`; }
        break;
      case "BOE":
        if (customs?.beNo) { state = "original_received"; evidence = `${customs.beNo}${customs.beDate ? ` · ${customs.beDate}` : ""}`; }
        else if (customs?.icegateRef) { state = "draft_received"; evidence = `Filed · ${customs.icegateRef}`; }
        break;
      case "DUTY_CHALLAN":
        if (customs?.dutyInvoice) { state = "original_received"; evidence = customs.dutyInvoice; }
        break;
      case "OOC_BOE":
        if (customs?.stage === "CLEARED") { state = "original_received"; evidence = `Cleared${customs.beNo ? ` · ${customs.beNo}` : ""}`; }
        break;
      case "DELIVERY_ORDER":
        if (inbound?.carrierDocs?.length) { state = "verified"; evidence = inbound.carrierDocs.map((d) => d.fileName).join(", "); }
        break;
      case "INSURANCE_DECLARATION":
        if (sd?.insuranceCertRef) { state = "verified"; evidence = sd.insuranceCertRef; }
        break;
      case "INSURANCE_CERTIFICATE":
        if (sd?.insuranceCertRef) { state = "original_received"; evidence = sd.insuranceCertRef; }
        break;
      case "DG_PACK":
        if (sd?.dgDeclarationRef) { state = "verified"; evidence = sd.dgDeclarationRef; }
        break;
      case "EXPORT_DECLARATION":
        if (sd?.exportDeclarationRef) { state = "verified"; evidence = sd.exportDeclarationRef; }
        break;
      case "GRN":
        if (b.deliveries?.some((d) => d.pod)) { state = "original_received"; evidence = "Proof of delivery on file"; }
        break;
      default: {
        const f = found(spec.id, spec.name);
        if (f) { state = "original_received"; evidence = f; }
      }
    }

    return { ...spec, state, because, evidence, diverges: Boolean(spec.verifyNotReceive), alsoNeededBy: neededByDesks(spec), toVerify: false };
  });
}

/**
 * Which internal desk answers for each outside party.
 *
 * Every counterparty is managed by one desk, so a document the forwarder needs
 * is a document the logistics desk has to have in hand — even where another
 * desk is answerable for obtaining it. This is what turns the register's
 * `requiredBy` (parties) into something a desk-scoped view can use.
 */
const DESK_FOR_PARTY: Record<Party, Desk | null> = {
  SUPPLIER: "SOURCING",
  FORWARDER: "LOGISTICS",
  CARRIER: "LOGISTICS",
  TRANSPORTER: "LOGISTICS",
  CHA: "CUSTOMS",
  CUSTOMS: "CUSTOMS",
  BANK: "FINANCE",
  INSURER: "RISK",
  PLANT: "QUALITY",
  // "The importer" is us in the abstract — it names no particular desk, so it
  // resolves to whichever desk is answerable rather than to all of them.
  IMPORTER: null,
};

/** The desks whose work stops without this document, excluding its owner. */
export function neededByDesks(spec: DocSpec): Desk[] {
  const set = new Set<Desk>();
  for (const p of spec.requiredBy) {
    const d = DESK_FOR_PARTY[p];
    if (d && d !== spec.desk) set.add(d);
  }
  // The desk that has to check it is waiting on it too — arguably the most,
  // since it cannot do its own job until somebody else's chase lands.
  if (spec.verifiedBy && spec.verifiedBy !== spec.desk) set.add(spec.verifiedBy);
  return [...set];
}

/** Loose match between a document name in a reply and a register entry. */
function matches(docName: string, specId: string): boolean {
  const n = docName.toLowerCase();
  if (specId === "COMMERCIAL_INVOICE") return n.includes("invoice");
  if (specId === "PACKING_LIST") return n.includes("packing");
  if (specId === "COO") return n.includes("origin");
  return false;
}

/** What this desk is ANSWERABLE for — its own chase list. */
export const ownedBy = (entries: WarehouseEntry[], desk: Desk) =>
  entries.filter((e) => e.desk === desk);

/**
 * What this desk WAITS ON — somebody else owes it, but this desk's work stops
 * without it.
 *
 * Shown separately rather than mixed in, because the two need different
 * behaviour: one is a chase you make, the other is a chase you ask somebody
 * else to make. Settled ones are dropped — a document already on file is not
 * something anybody is waiting on.
 */
export const waitedOnBy = (entries: WarehouseEntry[], desk: Desk): WarehouseEntry[] =>
  entries
    .filter(
      (e) =>
        e.desk !== desk &&
        e.state !== "not_required" &&
        e.state !== "verified" &&
        e.state !== "original_received" &&
        neededByDesks(e).includes(desk),
    )
    // Marked where this desk is the one that has to READ it rather than merely
    // consume it, because those two produce different work when it lands.
    .map((e) => ({ ...e, toVerify: e.verifiedBy === desk }));

/** Everything this desk has any interest in. */
export const forDesk = (entries: WarehouseEntry[], desk: Desk) =>
  entries.filter((e) => e.desk === desk || neededByDesks(e).includes(desk));

/** What this desk still owes — the chase list, excluding what does not apply. */
export const outstandingFor = (entries: WarehouseEntry[], desk: Desk) =>
  ownedBy(entries, desk).filter((e) => e.state === "pending" || e.state === "draft_received");

export const deskCounts = (entries: WarehouseEntry[]) =>
  Object.fromEntries(
    DESKS.map((d) => [
      d,
      {
        total: ownedBy(entries, d).filter((e) => e.state !== "not_required").length,
        owed: outstandingFor(entries, d).length,
        waiting: waitedOnBy(entries, d).length,
      },
    ]),
  ) as Record<Desk, { total: number; owed: number; waiting: number }>;
