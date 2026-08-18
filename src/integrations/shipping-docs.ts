import { mockCall, ref } from "@/integrations/mock-client";

// Pre-booking document exchange with the supplier: request the Packing List + Commercial Invoice
// (+ COO if international), then parse the reply to get the particulars we need to book the carrier.

const MAIL = "notify";
const MAIL_LABEL = "Supplier Mail";
const DOC = "doc-extract";
const DOC_LABEL = "Document Extraction";

export const shippingDocList = (international: boolean) =>
  ["Packing List", "Commercial Invoice", ...(international ? ["Certificate of Origin"] : [])];

export interface DocRequestRes { messageId: string; to: string; requested: string[] }

// Step 1 — email the supplier asking for the shipping documents.
export function requestSupplierShippingDocs(req: { to: string; orderNo: string; international: boolean }) {
  return mockCall<DocRequestRes>(MAIL, MAIL_LABEL, "POST /mail/request-shipping-docs", req,
    () => ({ messageId: ref("MSG"), to: req.to, requested: shippingDocList(req.international) }),
    { latencyMs: [400, 1200] });
}

export interface FinanceNotifyRes { messageId: string; to: string }

// Logistics → Customs desk: ask the Customs handling team to file the Bill of Entry (a Prior BoE
// can go in up to 30 days before arrival, so we notify as soon as the shipment is booked).
export function notifyCustomsTeamToFileBoe(req: { orderNo: string; shipmentNo: string }) {
  return mockCall<FinanceNotifyRes>(MAIL, MAIL_LABEL, "POST /mail/notify-customs-boe", req,
    () => ({ messageId: ref("MSG"), to: "customs@1buy.ai" }),
    { latencyMs: [400, 1000] });
}

// Logistics → CHA: send the AWB (+ docs) so the CHA can file the BoE and link it to the IGM.
export function sendAwbToChaMail(req: { cha: string; orderNo: string; shipmentNo: string; awb: string }) {
  return mockCall<FinanceNotifyRes>(MAIL, MAIL_LABEL, "POST /mail/send-awb-to-cha", req,
    () => ({ messageId: ref("MSG"), to: req.cha }),
    { latencyMs: [400, 1000] });
}

export interface ShippingDocsExtract {
  pieces: number;
  grossWeightKg: number;
  dimensions: string;      // per-box L×W×H × pieces
  hsCode: string;
  goodsDescription: string;
  declaredValue: number;   // from the commercial invoice
  declaredCurrency: string;
  docs: string[];          // documents received
}

// Step 2 — parse the supplier's reply (packing list + commercial invoice) into booking particulars.
// Derived deterministically from the order so the demo is stable; a real integration would OCR the PDFs.
export function extractSupplierShippingDocs(req: { totalQty: number; buyTotal: number; currency: string; international: boolean }) {
  return mockCall<ShippingDocsExtract>(DOC, DOC_LABEL, "POST /extract/packing-list", req,
    () => {
      const pieces = Math.max(1, Math.min(20, Math.ceil(req.totalQty / 500)));
      const grossWeightKg = Math.round((req.totalQty * 0.02 + pieces * 0.6) * 10) / 10;
      return {
        pieces,
        grossWeightKg,
        dimensions: `40×30×25 cm × ${pieces}`,
        hsCode: "8542.31",
        goodsDescription: "Electronic components (as per packing list)",
        declaredValue: Math.round(req.buyTotal),
        declaredCurrency: req.currency,
        docs: shippingDocList(req.international),
      };
    },
    { latencyMs: [600, 1800] });
}
