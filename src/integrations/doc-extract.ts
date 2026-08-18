import { mockCall } from "@/integrations/mock-client";
import { WHL_PROCESSES } from "@/data/enums";

const SYS = "doc-extract";
const LABEL = "Doc Extraction";

export interface ExtractedLine { mpn: string; qty: number; price: number; requiredBy: string; confidence: number; }
export interface ExtractedAddress { line1: string; city: string; state: string; pincode: string; country: string }
export interface ExtractClientPoRes {
  fields: { clientName: string; clientPoNo: string; paymentMode: string; clientGstin: string; clientState: string; referenceNo: string; gstNote: string; paymentMethod: string; deliveryTerms: string; dateCode: string; warranty: string };
  deliveryAddress: ExtractedAddress;
  lines: ExtractedLine[];
  overallConfidence: number;
}

// In the real project this is OCR + an LLM extraction call. The mock returns a
// realistic GEES sample with a fresh (non-colliding) PO number + per-field confidence.
export function extractClientPo(req: { fileName: string; bytesLen: number }) {
  return mockCall<ExtractClientPoRes>(SYS, LABEL, "POST /extract/client-po", req,
    () => ({
      fields: {
        clientName: "GEES Innovations Pvt Ltd", clientPoNo: `GIPL/26-27/PO/${150 + Math.floor(Math.random() * 40)}`, paymentMode: "CREDIT",
        clientGstin: "33AALCG9069K1Z0", clientState: "Tamil Nadu", referenceNo: "GIPL/26-27/PO",
        gstNote: "GST extra @ actual", paymentMethod: "As agreed", deliveryTerms: "Test Report Along with Shipment", dateCode: "", warranty: "",
      },
      deliveryAddress: { line1: "23/25, SBI Colony Main, Nanganallur", city: "Chennai", state: "Tamil Nadu", pincode: "600061", country: "IN" },
      lines: [{ mpn: "MIC5282-5.0YMME-TR", qty: 12500, price: 345.6, requiredBy: "2026-07-20", confidence: 0.97 }],
      overallConfidence: 0.94,
    }),
    { latencyMs: [800, 2500], failError: { code: "UNPARSEABLE_FILE", message: "Could not parse document — enter manually", status: 422 } });
}

// ---- test requirements off a PO (the source of truth for "which tests does this MPN need") ----

export interface ExtractedMpnTests {
  mpn: string;
  tests: { name: string; standard?: string }[];
  confidence: number;
  note?: string; // set when the test table for this MPN couldn't be read
}
export interface ExtractPoTestsRes { sourceDoc: string; mpns: ExtractedMpnTests[]; overallConfidence: number }

/**
 * Parse the test table off a Client/Supplier PO. Tests are NEVER hand-typed by the
 * operator — they already exist in the PO, so they're auto-filled from here.
 * An MPN whose table can't be read comes back with an empty `tests` + a `note`;
 * the caller flags it "Auto-fill failed — needs manual review" instead of leaving it blank.
 */
export function extractPoTestRequirements(req: { sourceDoc: string; mpns: string[]; testingModes?: Record<string, string> }) {
  return mockCall<ExtractPoTestsRes>(SYS, LABEL, "POST /extract/po-test-requirements", req,
    () => {
      const mpns: ExtractedMpnTests[] = req.mpns.map((mpn, i) => {
        const mode = req.testingModes?.[mpn];
        if (mode === "NONE") return { mpn, tests: [], confidence: 0.99, note: "PO specifies no incoming test for this MPN." };
        // a self-test line carries a shorter table; a WHL line carries the full AS6081 screen
        const plan = mode === "SUPPLIER_SELF"
          ? ["Documentation & Packaging Inspection", "General Inspection", "Electrical Test"]
          : [...WHL_PROCESSES].slice(0, 6);
        // deterministic-ish "bad scan" on the second MPN of a PO — exercises the manual-review path
        if (i === 1 && Math.random() < 0.45) {
          return { mpn, tests: [], confidence: 0.31, note: "Test table on page 2 is a low-resolution scan — columns could not be resolved." };
        }
        return {
          mpn,
          tests: plan.map((name) => ({ name, standard: mode === "WHL" ? "AS6081" : undefined })),
          confidence: 0.9 + Math.random() * 0.09,
        };
      });
      return { sourceDoc: req.sourceDoc, mpns, overallConfidence: 0.93 };
    },
    { latencyMs: [700, 2000], failError: { code: "UNPARSEABLE_FILE", message: "Could not parse the PO test table — needs manual review", status: 422 } });
}

// ---- escrow invoice, derived from the underlying Order doc (fee %s are usually agreed on the PO) ----

export interface ExtractEscrowInvoiceRes {
  invoiceNo: string;
  fees: { feeToBuyer: number; wiringFeeToBuyer: number; feeToSeller: number; wiringFeeToSeller: number };
  conditions: {
    forwarder: string; forwarderAccountNo?: string; shipWithinDays: string; inspectionPeriod: string;
    feeSharingLabel: string; returnCondition: string;
    releaseMilestones: { percent: number; trigger: string }[];
  };
  overallConfidence: number;
}

// Escrow fee % and release milestones are usually already agreed on the underlying Order, so an
// operator can parse that doc instead of waiting on (or re-typing) HKin's invoice by hand.
export function extractEscrowInvoiceFromOrder(req: { fileName: string; bytesLen: number }) {
  return mockCall<ExtractEscrowInvoiceRes>(SYS, LABEL, "POST /extract/escrow-invoice", req,
    () => ({
      invoiceNo: `AE${2600 + Math.floor(Math.random() * 20)}-${1000 + Math.floor(Math.random() * 9000)}`,
      fees: { feeToBuyer: 60, wiringFeeToBuyer: 40, feeToSeller: 0, wiringFeeToSeller: 0 },
      conditions: {
        forwarder: "DHL", shipWithinDays: "7 business days", inspectionPeriod: "5 business days",
        feeSharingLabel: "100% Buyer / 0% Seller", returnCondition: "7 business days, shipping fees to Seller",
        releaseMilestones: [
          { percent: 30, trigger: "On shipment to WHL for testing" },
          { percent: 70, trigger: "On WHL PASS report" },
        ],
      },
      overallConfidence: 0.91,
    }),
    { latencyMs: [800, 2200], failError: { code: "UNPARSEABLE_FILE", message: "Could not parse the Order document — enter manually", status: 422 } });
}

export interface ExtractedSupplierLine { mpn: string; make: string; qty: number; buy: number; margin: number; confidence: number; }
export interface ExtractSupplierPoRes {
  fields: {
    supplier: string; supplierGstin: string; supplierState: string; tradeType: string; currency: string; incoterm: string;
    sellerPaymentMode: string; testing: string; referenceNo: string; paymentMethod: string; dispatchedThrough: string;
    destination: string; warranty: string; testFailureBearer: string; labLocation: string; packing: string;
  };
  lines: ExtractedSupplierLine[];
  overallConfidence: number;
}

// Mock parse of a supplier PO / PI (e.g. the OLETI→Sharpbuy PI). Returns supplier identity +
// terms + unlinked lines; the operator maps them to client-PO lines afterwards.
export function extractSupplierPo(req: { fileName: string; bytesLen: number }) {
  return mockCall<ExtractSupplierPoRes>(SYS, LABEL, "POST /extract/supplier-po", req,
    () => ({
      fields: {
        supplier: "Oleti Development Co", supplierGstin: "", supplierState: "Hong Kong", tradeType: "INTERNATIONAL",
        currency: "USD", incoterm: "EXW", sellerPaymentMode: "ADVANCE", testing: "WHL",
        referenceNo: "RFQBUNDLE_124612_20_07_2026", paymentMethod: "Advance via T/T", dispatchedThrough: "DHL",
        destination: "1Buy hub — New Delhi", warranty: "1 year", testFailureBearer: "SUPPLIER",
        labLocation: "WHL Shenzhen & Hong Kong", packing: "Packing list + Commercial Invoice; WHSO# on outside box",
      },
      lines: [{ mpn: "MIC5282-5.0YMME-TR", make: "Microchip", qty: 5000, buy: 300, margin: 15, confidence: 0.95 }],
      overallConfidence: 0.92,
    }),
    { latencyMs: [800, 2500], failError: { code: "UNPARSEABLE_FILE", message: "Could not parse document — enter manually", status: 422 } });
}
