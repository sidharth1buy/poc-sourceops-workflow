// Incoterm responsibility engine for the inbound leg (supplier → 1Buy).
//
// Two questions the incoterm answers, and the only two this leg cares about:
//   1. Who books the main international carriage?  → do WE call the carrier (DHL) or does the supplier?
//   2. Who clears India import customs + pays duty? → do WE file the BoE (via CHA) or does the supplier (DDP)?
//
// Groups (standard Incoterms 2020):
//   E (EXW)                 — buyer does everything from the supplier's door.
//   F (FCA, FAS, FOB)       — buyer arranges + pays the main carriage.
//   C (CFR, CIF, CPT, CIP)  — seller arranges/pays carriage to destination, but import clearance stays with the buyer.
//   D (DAP, DPU, DDP)       — seller delivers to destination; only DDP also puts import clearance + duty on the seller.
//
// 1Buy is the India-side importer, so "buyer" = 1Buy everywhere below.

import type { OrderBundle } from "@/types";

export type ResponsibleParty = "1BUY" | "SUPPLIER";

export interface IncotermPlan {
  incoterm: string;
  group: "E" | "F" | "C" | "D" | "?";
  weBookFreight: boolean; // 1Buy books the carrier (we call the DHL API)
  freightParty: ResponsibleParty;
  supplierClearsImport: boolean; // true only for DDP
  importClearParty: ResponsibleParty; // who files the India BoE + pays duty
  summary: string; // one-line human explanation for the UI banner
}

const GROUP: Record<string, "E" | "F" | "C" | "D" | undefined> = {
  EXW: "E",
  FCA: "F", FAS: "F", FOB: "F",
  CFR: "C", CIF: "C", CPT: "C", CIP: "C",
  DAP: "D", DPU: "D", DDP: "D",
};

export function incotermPlan(incotermRaw: string): IncotermPlan {
  const incoterm = (incotermRaw || "").toUpperCase().trim();
  const group = GROUP[incoterm] ?? "?";
  // E & F terms → buyer (1Buy) arranges + pays the main international carriage.
  // C & D terms → seller arranges/pays carriage to destination, so we don't book.
  const weBookFreight = group === "E" || group === "F";
  // Import clearance + duty is the buyer's (1Buy's) everywhere except DDP.
  const supplierClearsImport = incoterm === "DDP";
  const freightParty: ResponsibleParty = weBookFreight ? "1BUY" : "SUPPLIER";
  const importClearParty: ResponsibleParty = supplierClearsImport ? "SUPPLIER" : "1BUY";
  const summary =
    group === "?"
      ? `${incoterm || "—"}: responsibility unknown — confirm the Incoterm on the PO.`
      : weBookFreight
        ? `${incoterm}: 1Buy books the carrier (DHL) from the supplier.`
        : supplierClearsImport
          ? `${incoterm}: supplier delivers & clears customs — 1Buy only receives.`
          : `${incoterm}: supplier books the freight; 1Buy clears India customs.`;
  return { incoterm, group, weBookFreight, freightParty, supplierClearsImport, importClearParty, summary };
}

/** Do WE book the inbound carrier (DHL) for this order? Otherwise the supplier arranged it and we just record + track the AWB. */
export const weBookInboundFreight = (b: OrderBundle) => incotermPlan(b.incoterm).weBookFreight;

/** Does 1Buy file the India import BoE? Only on an INTERNATIONAL order where the Incoterm leaves import clearance with the buyer. */
export const weClearImportCustoms = (b: OrderBundle) =>
  b.tradeType === "INTERNATIONAL" && incotermPlan(b.incoterm).importClearParty === "1BUY";

/** International order where the supplier owns import clearance too (DDP) — 1Buy files no BoE, just receives. */
export const supplierHandlesCustoms = (b: OrderBundle) =>
  b.tradeType === "INTERNATIONAL" && incotermPlan(b.incoterm).importClearParty === "SUPPLIER";
