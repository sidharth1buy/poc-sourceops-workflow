import { mockCall, ref } from "@/integrations/mock-client";
import { computeDuty } from "@/lib/fx";

const SYS = "icegate";
const LABEL = "ICEGATE Customs";

export interface FileBeReq { orderId: string; shipmentNo: string; portCode: string; chaName: string; assessableValue: number; awb?: string; }
export interface FileBeRes { jobId: string; beNo: string; beDate: string; status: "ASSESSMENT_PENDING"; icegateAckNo: string; }
export interface AssessmentRes { beNo: string; duty: { bcd: number; sws: number; igst: number; totalDuty: number }; status: "ASSESSED"; review: "AUTO_CLEAR" | "FLAGGED"; query?: string; }

// Faceless-assessment risk-engine queries (shown when a BoE is flagged for manual review).
const FACELESS_QUERIES = [
  "Valuation query — share the PO / contract to support the declared value.",
  "HS-code justification requested for the classified tariff heading.",
  "BIS / WPC certificate proof requested for the electronics line.",
];
export interface ClearanceRes { beNo: string; icegateRef: string; oocDate: string; status: "OUT_OF_CHARGE"; }

const today = () => new Date().toISOString().slice(0, 10);

export function fileBillOfEntry(req: FileBeReq) {
  return mockCall<FileBeRes>(SYS, LABEL, "POST /bill-of-entry", req,
    () => ({ jobId: ref("JOB"), beNo: `BE-${Math.floor(1000000 + Math.random() * 8999999)}`, beDate: today(), status: "ASSESSMENT_PENDING", icegateAckNo: ref("ACK") }),
    { latencyMs: [800, 2500], failError: { code: "ICEGATE_DOWN", message: "ICEGATE gateway unavailable", status: 503 } });
}

// The mock assessment engine reuses the existing computeDuty as the illustrative BCD+SWS+IGST split.
export function getAssessment(beNo: string, assessableValue: number) {
  return mockCall<AssessmentRes>(SYS, LABEL, `GET /bill-of-entry/${beNo}/assessment`, { beNo, assessableValue },
    () => {
      const totalDuty = computeDuty(assessableValue);
      const bcd = Math.round(assessableValue * 0.1);
      const sws = Math.round(bcd * 0.1);
      const igst = Math.max(0, totalDuty - bcd - sws);
      // Faceless assessment: risk engine auto-clears most, flags ~1 in 3 for a query.
      const flagged = Math.random() < 0.35;
      const query = flagged ? FACELESS_QUERIES[Math.floor(Math.random() * FACELESS_QUERIES.length)] : undefined;
      return { beNo, duty: { bcd, sws, igst, totalDuty }, status: "ASSESSED", review: flagged ? "FLAGGED" : "AUTO_CLEAR", query };
    },
    { latencyMs: [1000, 3000] });
}

export interface IgmEntryRes { igmNo: string; itemNo: string; awb: string; status: "MATCHED" }

// IGM lookup — the courier files the Import General Manifest when the flight lands; the BoE only
// links (and can be assessed) once the AWB is found inside a filed IGM. The store checks the shipment
// has actually landed before calling this (otherwise it's a "Manifest Not Found" on ICEGATE's side).
export function getIgmEntry(req: { awb: string; portCode?: string }) {
  return mockCall<IgmEntryRes>(SYS, LABEL, "GET /igm/lookup", req,
    () => ({ igmNo: `IGM-${Math.floor(1000000 + Math.random() * 8999999)}`, itemNo: `${Math.floor(1 + Math.random() * 400)}`, awb: req.awb, status: "MATCHED" }),
    { latencyMs: [500, 1500] });
}

export function getClearanceStatus(beNo: string) {
  return mockCall<ClearanceRes>(SYS, LABEL, `GET /bill-of-entry/${beNo}/clearance`, { beNo },
    () => ({ beNo, icegateRef: ref("ICE"), oocDate: today(), status: "OUT_OF_CHARGE" }),
    { latencyMs: [500, 1500] });
}
