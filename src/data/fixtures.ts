import type {
  Order, OrderBundle, JourneyStep, JourneyPhase, Lot, Escrow, EscrowContact, EscrowOrderStatus, EscrowFeeBreakdown, EscrowConditions, MilestoneRelease, WhlVerdict, Payment,
  Shipment, CustomsEntry, DeliveryAllocation, SourcingAllocation, DocumentRef, Approval, OrderEvent, OrderLine, ClientPO, SupplierPO, TestingMode, Address,
  MpnTestSpec, LabEmail, LotTest, WhlReport, TestProcessStatus, TestAuditEntry, LotNotification,
  TestingStage, TestingStageEvent,
} from "@/types";
import { WHL_CONFIDENTIALITY, ESCROW_STATUS_ORDER } from "@/data/enums";
import { ORDER_DETAILS } from "@/data/order-details";
import { DEMO_ESCROW_BANK_ACCOUNT } from "@/integrations/escrow-agent";

export const HERO_ID = "ord-148";

// local date helper (mirrors store's) — used to derive escrow window expiry from an ISO date
const addDays = (iso: string, n: number) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Our masking-entity hub — inbound goods land here, get relabelled to 1Buy, then re-dispatched to the buyer.
export const ONEBUY_HUB: Address = {
  name: "1Buy hub — New Delhi (Sharpbuy Global Solutions)",
  line1: "Plot 7, Sector 18, Udyog Vihar", city: "New Delhi", state: "Delhi", pincode: "110037", country: "IN",
};

export const ORDERS: Order[] = [
  {
    id: HERO_ID, orderNo: "ORD-2026-000148", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Acme Pte", country: "SG" }, supplier: { name: "Shenzhen Micro Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW",
    leadTimeDays: 21, testingTimeDays: 6, deliveryTimeDays: 9,
    expectedDispatchDate: "2026-08-04", expectedDeliveryDate: "2026-08-13", requiredBy: "2026-08-20",
    buyTotal: 7013, sellTotal: 8775, createdBy: "A. Sharma", createdAt: "2026-07-14",
    supplierPoId: "spo-148", supplierPoNo: "SPO-2026-0148",
    terms: {
      referenceNo: "RFQBUNDLE_124612_20_07_2026", paymentMethod: "Advance via T/T", dispatchedThrough: "DHL",
      destination: "1Buy hub — New Delhi", deliveryTerms: "Test report along with shipment", dateCode: "25+",
      warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen & Hong Kong",
      packing: "Packing list + Commercial Invoice; WHSO# on outside box",
    },
  },
  {
    id: "ord-151", orderNo: "ORD-2026-000151", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Northwind GmbH", country: "DE" }, supplier: { name: "Taiwan Semi", country: "TW" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ADVANCE",
    leadTimeDays: 18, testingTimeDays: 4, deliveryTimeDays: 8, testingMode: "WHL",
    expectedDispatchDate: "2026-08-10", expectedDeliveryDate: "2026-08-18", requiredBy: "2026-08-25",
    buyTotal: 31200, sellTotal: 35580, createdBy: "A. Sharma", createdAt: "2026-07-20",
    supplierPoId: "spo-151", supplierPoNo: "SPO-2026-0151", piNo: "TS-PI-26-1188",
    terms: {
      referenceNo: "RFQBUNDLE_118820_18_07_2026", paymentMethod: "Advance via T/T", dispatchedThrough: "FedEx",
      destination: "WHL Hong Kong → 1Buy hub", deliveryTerms: "FOB Hsinchu", testingTerms: "AS6081 full screen before onward shipment",
      dateCode: "24+", warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Hong Kong",
      packing: "Anti-static trays, MSD bagged; WHSO# on outside box",
    },
    termsConditions: [
      "Goods must be new, genuine & factory-sealed (no refurbished/remarked)",
      "Full traceability — Certificate of Conformance / manufacturer lot",
      "Supplier bears cost on test FAIL (return + re-test)",
    ],
  },
  {
    id: "ord-149", orderNo: "ORD-2026-000149", operatingMode: "MOR", tradeType: "DOMESTIC",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Bharat Elec", country: "IN" }, supplier: { name: "Delhi Components", country: "IN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "INR", incoterm: "EXW", paymentMode: "CREDIT",
    leadTimeDays: 10, testingTimeDays: 3, deliveryTimeDays: 4, testingMode: "SUPPLIER_SELF",
    expectedDispatchDate: "2026-07-30", expectedDeliveryDate: "2026-08-03", requiredBy: "2026-08-06",
    buyTotal: 1180000, sellTotal: 1310000, createdBy: "P. Nair", createdAt: "2026-07-19",
    supplierPoId: "spo-149", supplierPoNo: "SPO-2026-0149", piNo: "DC-PI-4471", creditDays: 30,
    terms: {
      referenceNo: "BEL-DOM/26/PO/77", gstNote: "GST extra @ actual", paymentMethod: "Net 30 credit",
      dispatchedThrough: "Delhivery", destination: "1Buy hub — New Delhi", deliveryTerms: "Ex-works pickup",
      testingTerms: "Supplier self-test + CoC with each lot", dateCode: "25+", warranty: "6 months",
      testFailureBearer: "SUPPLIER", packing: "Reels in MSD bags; CoC in the box",
    },
    buyerAddress: { name: "Bharat Elec", line1: "Plot 22, Okhla Industrial Area Phase II", city: "New Delhi", state: "Delhi", pincode: "110020", country: "IN" },
  },
  {
    id: "ord-153", orderNo: "ORD-2026-000153", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ON_HOLD", approvalStatus: "APPROVED",
    buyer: { name: "Kestrel Robotics", country: "US" }, supplier: { name: "Osaka Parts", country: "JP" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "CPT", paymentMode: "ESCROW",
    leadTimeDays: 24, testingTimeDays: 7, deliveryTimeDays: 10, testingMode: "WHL",
    expectedDispatchDate: "2026-08-12", expectedDeliveryDate: "2026-08-22", requiredBy: "2026-08-28",
    buyTotal: 58900, sellTotal: 67200, createdBy: "A. Sharma", createdAt: "2026-07-16",
    supplierPoId: "spo-153", supplierPoNo: "SPO-2026-0153", piNo: "OSK-PI-2026-0771", relabelCost: 600,
    terms: {
      referenceNo: "RFQBUNDLE_207714_14_07_2026", paymentMethod: "Advance via T/T into escrow", dispatchedThrough: "DHL",
      destination: "WHL Shenzhen → 1Buy hub", deliveryTerms: "CPT Shenzhen", testingTerms: "AS6081 screen; report before escrow release",
      dateCode: "24+", warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen",
      packing: "Tubes + trays, MSD bagged; WHSO# on outside box",
    },
    termsConditions: [
      "Goods must be new, genuine & factory-sealed (no refurbished/remarked)",
      "Full traceability — Certificate of Conformance / manufacturer lot",
      "Test report / CoA supplied along with the shipment",
      "Supplier bears cost on test FAIL (return + re-test)",
    ],
    buyerAddress: { name: "Kestrel Robotics Inc", line1: "1180 Bordeaux Drive", city: "Sunnyvale", state: "CA", pincode: "94089", country: "US" },
  },
  {
    id: "ord-144", orderNo: "ORD-2026-000144", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "CLOSED", approvalStatus: "APPROVED",
    buyer: { name: "Acme Pte", country: "SG" }, supplier: { name: "Shenzhen Micro Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW",
    leadTimeDays: 20, testingTimeDays: 5, deliveryTimeDays: 8, testingMode: "WHL",
    expectedDispatchDate: "2026-07-02", expectedDeliveryDate: "2026-07-10", requiredBy: "2026-07-12",
    buyTotal: 27500, sellTotal: 31600, createdBy: "A. Sharma", createdAt: "2026-06-10",
    supplierPoId: "spo-144", supplierPoNo: "SPO-2026-0144", piNo: "SZM-PI-26-0442", relabelCost: 400,
    terms: {
      referenceNo: "RFQBUNDLE_044210_08_06_2026", paymentMethod: "Advance via T/T into escrow", dispatchedThrough: "DHL",
      destination: "1Buy hub — New Delhi", deliveryTerms: "Test report along with shipment", dateCode: "23+",
      warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen",
      packing: "Packing list + Commercial Invoice; WHSO# on outside box",
    },
    buyerAddress: { name: "Acme Pte Ltd", line1: "8 Kaki Bukit Avenue 1", city: "Singapore", pincode: "417941", country: "SG" },
  },
  {
    id: "ord-155", orderNo: "ORD-2026-000155", operatingMode: "MOR", tradeType: "DOMESTIC",
    status: "DRAFT", approvalStatus: "NOT_REQUIRED",
    buyer: { name: "Bharat Elec", country: "IN" }, supplier: { name: "Pune Traders", country: "IN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "INR", incoterm: "EXW", paymentMode: "ADVANCE",
    leadTimeDays: 7, testingTimeDays: 0, deliveryTimeDays: 3, testingMode: "NONE",
    expectedDispatchDate: "2026-08-01", expectedDeliveryDate: "2026-08-04", requiredBy: "2026-08-08",
    buyTotal: 640000, sellTotal: 712000, createdBy: "P. Nair", createdAt: "2026-07-25",
    supplierPoId: "spo-155", supplierPoNo: "SPO-2026-0155",
    terms: {
      referenceNo: "BEL-DOM/26/PO/81", gstNote: "GST extra @ actual", paymentMethod: "Advance via T/T",
      dispatchedThrough: "Delhivery", destination: "1Buy hub — New Delhi", deliveryTerms: "Ex-works pickup",
      testingTerms: "No incoming test — waived by client in writing", dateCode: "25+", warranty: "6 months",
    },
  },

  // ---- Escrow E2E test orders (ord-180..195) — one per stage of the 8-state flow, plus every edge
  // case (cancel, fee mismatch, FAIL→retest, FAIL→return, release via WHL PASS, release via AWB-only)
  // and a spread of genuinely different invoice terms (paired with ESCROW_SEED_SCENARIOS below).
  // This is the full, current set — nothing legacy left over from earlier passes.
  {
    id: "ord-180", orderNo: "ORD-2026-000180", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Vantage Robotics", country: "US" }, supplier: { name: "Nakamura Electronics", country: "JP" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 20, testingTimeDays: 6, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-08-18", expectedDeliveryDate: "2026-08-26", requiredBy: "2026-09-01",
    buyTotal: 9400, sellTotal: 10700, createdBy: "A. Sharma", createdAt: "2026-07-20",
  },
  {
    id: "ord-181", orderNo: "ORD-2026-000181", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Solstice Devices", country: "DE" }, supplier: { name: "Suzhou Precision Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "SUPPLIER_SELF",
    leadTimeDays: 18, testingTimeDays: 4, deliveryTimeDays: 7,
    expectedDispatchDate: "2026-08-15", expectedDeliveryDate: "2026-08-22", requiredBy: "2026-08-29",
    buyTotal: 14200, sellTotal: 16100, createdBy: "A. Sharma", createdAt: "2026-07-21",
  },
  {
    id: "ord-182", orderNo: "ORD-2026-000182", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Meridian Systems", country: "SG" }, supplier: { name: "Hsinchu Semi", country: "TW" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "NONE",
    leadTimeDays: 22, testingTimeDays: 6, deliveryTimeDays: 9,
    expectedDispatchDate: "2026-08-20", expectedDeliveryDate: "2026-08-29", requiredBy: "2026-09-04",
    buyTotal: 21500, sellTotal: 24400, createdBy: "A. Sharma", createdAt: "2026-07-22",
  },
  {
    id: "ord-183", orderNo: "ORD-2026-000183", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Falcon Aerotech", country: "US" }, supplier: { name: "Yokohama Components", country: "JP" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 21, testingTimeDays: 6, deliveryTimeDays: 9,
    expectedDispatchDate: "2026-08-14", expectedDeliveryDate: "2026-08-23", requiredBy: "2026-08-30",
    buyTotal: 32800, sellTotal: 37200, createdBy: "A. Sharma", createdAt: "2026-07-18",
  },
  {
    id: "ord-184", orderNo: "ORD-2026-000184", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Ironwood Systems", country: "GB" }, supplier: { name: "Foshan Connector Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "SUPPLIER_SELF",
    leadTimeDays: 16, testingTimeDays: 4, deliveryTimeDays: 6,
    expectedDispatchDate: "2026-08-06", expectedDeliveryDate: "2026-08-13", requiredBy: "2026-08-19",
    buyTotal: 11200, sellTotal: 12700, createdBy: "P. Nair", createdAt: "2026-07-16",
  },
  {
    id: "ord-185", orderNo: "ORD-2026-000185", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Harbor Technologies", country: "SG" }, supplier: { name: "Xiamen Components", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 16, testingTimeDays: 4, deliveryTimeDays: 6,
    expectedDispatchDate: "2026-08-04", expectedDeliveryDate: "2026-08-11", requiredBy: "2026-08-17",
    buyTotal: 8300, sellTotal: 9400, createdBy: "P. Nair", createdAt: "2026-07-11",
  },
  {
    id: "ord-186", orderNo: "ORD-2026-000186", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Nimbus Controls", country: "CA" }, supplier: { name: "Dongguan Electronics", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 17, testingTimeDays: 4, deliveryTimeDays: 7,
    expectedDispatchDate: "2026-08-10", expectedDeliveryDate: "2026-08-17", requiredBy: "2026-08-24",
    buyTotal: 12900, sellTotal: 14600, createdBy: "A. Sharma", createdAt: "2026-07-17",
  },
  {
    id: "ord-187", orderNo: "ORD-2026-000187", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Cascade Instruments", country: "US" }, supplier: { name: "Ningbo Micro Ltd", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "SUPPLIER_SELF",
    leadTimeDays: 20, testingTimeDays: 6, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-08-09", expectedDeliveryDate: "2026-08-17", requiredBy: "2026-08-24",
    buyTotal: 19800, sellTotal: 22400, createdBy: "A. Sharma", createdAt: "2026-07-13",
  },
  {
    id: "ord-188", orderNo: "ORD-2026-000188", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Redwood Systems", country: "US" }, supplier: { name: "Busan Parts Co", country: "KR" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "NONE",
    leadTimeDays: 14, testingTimeDays: 0, deliveryTimeDays: 6,
    expectedDispatchDate: "2026-08-05", expectedDeliveryDate: "2026-08-11", requiredBy: "2026-08-16",
    buyTotal: 18700, sellTotal: 21200, createdBy: "P. Nair", createdAt: "2026-07-15",
  },
  {
    id: "ord-189", orderNo: "ORD-2026-000189", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Polaris Avionics", country: "CA" }, supplier: { name: "Tainan Optics Co", country: "TW" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 22, testingTimeDays: 7, deliveryTimeDays: 9,
    expectedDispatchDate: "2026-08-19", expectedDeliveryDate: "2026-08-28", requiredBy: "2026-09-03",
    buyTotal: 24700, sellTotal: 27900, createdBy: "A. Sharma", createdAt: "2026-07-19",
  },
  {
    id: "ord-190", orderNo: "ORD-2026-000190", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Beacon Robotics", country: "US" }, supplier: { name: "Osaka Precision Ltd", country: "JP" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 18, testingTimeDays: 5, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-08-02", expectedDeliveryDate: "2026-08-10", requiredBy: "2026-08-15",
    buyTotal: 33500, sellTotal: 37900, createdBy: "A. Sharma", createdAt: "2026-07-10",
  },
  {
    id: "ord-191", orderNo: "ORD-2026-000191", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Atlas Modules", country: "AU" }, supplier: { name: "Shenzhen Sensor Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "NONE",
    leadTimeDays: 19, testingTimeDays: 0, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-08-06", expectedDeliveryDate: "2026-08-14", requiredBy: "2026-08-20",
    buyTotal: 26400, sellTotal: 29900, createdBy: "A. Sharma", createdAt: "2026-07-12",
  },
  {
    id: "ord-192", orderNo: "ORD-2026-000192", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Aurora Sensing Ltd", country: "GB" }, supplier: { name: "Qingdao Electronics Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 19, testingTimeDays: 5, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-08-07", expectedDeliveryDate: "2026-08-15", requiredBy: "2026-08-21",
    buyTotal: 15400, sellTotal: 17500, createdBy: "A. Sharma", createdAt: "2026-07-14",
  },
  {
    id: "ord-193", orderNo: "ORD-2026-000193", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Titan Aerostructures", country: "US" }, supplier: { name: "Kaohsiung Circuits Ltd", country: "TW" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 21, testingTimeDays: 6, deliveryTimeDays: 9,
    expectedDispatchDate: "2026-08-08", expectedDeliveryDate: "2026-08-17", requiredBy: "2026-08-23",
    buyTotal: 21800, sellTotal: 24700, createdBy: "A. Sharma", createdAt: "2026-07-09",
  },
  {
    id: "ord-194", orderNo: "ORD-2026-000194", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Zenith Photonics", country: "SG" }, supplier: { name: "Shenzhen Micro Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 20, testingTimeDays: 6, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-07-20", expectedDeliveryDate: "2026-07-28", requiredBy: "2026-08-02",
    buyTotal: 28600, sellTotal: 32400, createdBy: "A. Sharma", createdAt: "2026-06-25",
  },
  {
    id: "ord-195", orderNo: "ORD-2026-000195", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Quantum Field Systems", country: "US" }, supplier: { name: "Incheon Passive Co", country: "KR" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 21, testingTimeDays: 6, deliveryTimeDays: 9,
    expectedDispatchDate: "2026-08-16", expectedDeliveryDate: "2026-08-25", requiredBy: "2026-09-01",
    buyTotal: 13300, sellTotal: 15100, createdBy: "P. Nair", createdAt: "2026-07-24",
  },

  // ---- Draft-stage escrow orders (ord-196..200) — each carries different agreedConditions so
  // walking one forward to the invoice stage shows that order's own pre-agreed terms, not a
  // one-size-fits-all default (paired with ESCROW_SEED_SCENARIOS below).
  {
    id: "ord-196", orderNo: "ORD-2026-000196", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Meridian Aerostructures", country: "US" }, supplier: { name: "Osaka Fasteners Ltd", country: "JP" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 20, testingTimeDays: 6, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-08-28", expectedDeliveryDate: "2026-09-05", requiredBy: "2026-09-11",
    buyTotal: 16800, sellTotal: 19100, createdBy: "A. Sharma", createdAt: "2026-07-29",
  },
  {
    id: "ord-197", orderNo: "ORD-2026-000197", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Halcyon Instruments", country: "DE" }, supplier: { name: "Suzhou Precision Co", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "SUPPLIER_SELF",
    leadTimeDays: 17, testingTimeDays: 4, deliveryTimeDays: 6,
    expectedDispatchDate: "2026-08-25", expectedDeliveryDate: "2026-09-01", requiredBy: "2026-09-07",
    buyTotal: 9700, sellTotal: 11000, createdBy: "A. Sharma", createdAt: "2026-07-28",
  },
  {
    id: "ord-198", orderNo: "ORD-2026-000198", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Vertex Photonics", country: "SG" }, supplier: { name: "Dongguan Electronics", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 23, testingTimeDays: 7, deliveryTimeDays: 9,
    expectedDispatchDate: "2026-09-02", expectedDeliveryDate: "2026-09-12", requiredBy: "2026-09-18",
    buyTotal: 27300, sellTotal: 30900, createdBy: "P. Nair", createdAt: "2026-07-27",
  },
  {
    id: "ord-199", orderNo: "ORD-2026-000199", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Redshift Robotics", country: "US" }, supplier: { name: "Busan Parts Co", country: "KR" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "NONE",
    leadTimeDays: 14, testingTimeDays: 0, deliveryTimeDays: 6,
    expectedDispatchDate: "2026-08-20", expectedDeliveryDate: "2026-08-26", requiredBy: "2026-08-31",
    buyTotal: 12400, sellTotal: 14000, createdBy: "P. Nair", createdAt: "2026-07-26",
  },
  {
    id: "ord-200", orderNo: "ORD-2026-000200", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Solaris Defense Systems", country: "GB" }, supplier: { name: "Nakamura Electronics", country: "JP" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 15, testingTimeDays: 3, deliveryTimeDays: 6,
    expectedDispatchDate: "2026-08-18", expectedDeliveryDate: "2026-08-24", requiredBy: "2026-08-29",
    buyTotal: 20500, sellTotal: 23200, createdBy: "A. Sharma", createdAt: "2026-07-30",
  },

  // ---- Manager-demo orders (ord-201, ord-202) — fresh at DRAFT with real, complete contact data
  // (via contactsOverride below), unlike ord-180/196 above which carry placeholder "—" seller/
  // recipient emails by design (generic E2E scaffold). These two are meant to be clicked through
  // live, starting with the "Create HKin order" RPA step, without hitting the placeholder-email guard.
  {
    id: "ord-201", orderNo: "ORD-2026-000201", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Orion Aerospace Systems", country: "US" }, supplier: { name: "Kyoto Precision Components", country: "JP" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "WHL",
    leadTimeDays: 20, testingTimeDays: 6, deliveryTimeDays: 8,
    expectedDispatchDate: "2026-08-28", expectedDeliveryDate: "2026-09-05", requiredBy: "2026-09-10",
    buyTotal: 11800, sellTotal: 13400, createdBy: "A. Sharma", createdAt: "2026-08-08",
  },
  {
    id: "ord-202", orderNo: "ORD-2026-000202", operatingMode: "MOR", tradeType: "INTERNATIONAL",
    status: "ACTIVE", approvalStatus: "APPROVED",
    buyer: { name: "Nordic Robotics AB", country: "SE" }, supplier: { name: "Guangzhou Digital Semiconductor", country: "CN" },
    maskingEntity: "Sharpbuy Global Solutions", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testingMode: "SUPPLIER_SELF",
    leadTimeDays: 16, testingTimeDays: 4, deliveryTimeDays: 7,
    expectedDispatchDate: "2026-08-24", expectedDeliveryDate: "2026-08-31", requiredBy: "2026-09-05",
    buyTotal: 15200, sellTotal: 17300, createdBy: "P. Nair", createdAt: "2026-08-07",
  },
];

// ---- policy-assembled journey (stages switch on/off per order) ----
type Seed = { phase: JourneyPhase; name: string; owner: string; isGate: boolean };

function seedSteps(o: Order): Seed[] {
  const escrow = o.paymentMode === "ESCROW";
  const testing = testingModeOf(o) !== "NONE";
  const intl = o.tradeType === "INTERNATIONAL";
  const customsy = intl || testingModeOf(o) === "WHL"; // A19: WHL lab is abroad → customs even for domestic
  // PO review, sending the PO and the supplier ACK + PI all happen on the upstream sourcing
  // platform. This console is fulfilment-only: it picks up an already-approved order with the
  // PI in hand, so the journey starts here and only carries fulfilment steps.
  const s: Seed[] = [
    { phase: "KICKOFF", name: "Order received for fulfilment", owner: "SC", isGate: false },
  ];
  // escrow funds buyer money up-front (collect-before-pay baked in); non-escrow needs an explicit collect gate first
  if (!escrow) s.push({ phase: "PAYMENT", name: "Collect advance from client", owner: "Finance", isGate: true });
  s.push(escrow
    ? { phase: "PAYMENT", name: "Escrow: T/T payment received", owner: "Finance", isGate: true }
    : { phase: "PAYMENT", name: `Pay supplier — ${o.paymentMode.toLowerCase()}`, owner: "Finance", isGate: true });
  if (testing) {
    const whl = testingModeOf(o) === "WHL";
    s.push({ phase: "TESTING", name: `Testing — ${whl ? "WHL lab" : "supplier self-test"}`, owner: whl ? "Lab" : "Supplier", isGate: true });
  }
  // escrow ALWAYS needs a release step, else money stays trapped (ESCROW + testing=NONE). Trigger = PASS when tested, else acceptance/GRN.
  if (escrow) s.push({ phase: "PAYMENT", name: "Release escrow (to seller)", owner: "Finance", isGate: true });
  if (customsy) {
    // gated: an inbound shipment must exist before customs can be filed
    s.push({ phase: "IMPORT", name: intl ? "Ship to India (inbound AWB)" : "Export to lab → re-import", owner: "SC", isGate: true });
    s.push({ phase: "CUSTOMS", name: "Customs — BOE filed in ICEGATE", owner: "CHA", isGate: true });
  }
  s.push({ phase: "RELABEL", name: "Received to 1Buy", owner: "SC", isGate: true }); // gated: mark received on the Journey tab
  s.push({ phase: "DELIVERY", name: "e-Invoice + dispatch to client", owner: "SC", isGate: true }); // gated: all lines must be mapped to demand
  s.push({ phase: "DELIVERY", name: "Proof of delivery", owner: "SC", isGate: false });
  s.push({ phase: "CLOSE", name: "Reconcile + close", owner: "Finance", isGate: true }); // gated: every approval on the order must be APPROVED
  return s;
}

export function testingModeOf(o: Order): TestingMode {
  if (o.testingMode) return o.testingMode; // real mode carried from the supplier PO drives the journey
  // fallback heuristic only for seeded fixtures with no explicit mode
  if (o.id === "ord-155") return "NONE";
  if (o.tradeType === "DOMESTIC") return "SUPPLIER_SELF";
  return "WHL";
}

export function buildJourney(o: Order): JourneyStep[] {
  const seeds = seedSteps(o);
  let p: number;
  switch (o.status) {
    case "DRAFT": p = 0; break;
    case "PENDING_APPROVAL": p = 1; break;
    case "APPROVED": p = 2; break;
    case "ACTIVE": p = Math.max(4, Math.floor(seeds.length * 0.58)); break;
    case "ON_HOLD": {
      const c = seeds.findIndex((x) => x.phase === "CUSTOMS");
      p = c >= 0 ? c : Math.floor(seeds.length * 0.6); break;
    }
    case "CLOSED": p = seeds.length; break;
    default: p = 1;
  }
  return seeds.map((s, i) => ({
    id: `${o.id}-j${i + 1}`, seq: i + 1, phase: s.phase, name: s.name, owner: s.owner, isGate: s.isGate,
    status: i < p ? "DONE" : i === p ? (o.status === "ON_HOLD" && s.phase === "CUSTOMS" ? "BLOCKED" : "IN_PROGRESS") : "PENDING",
  }));
}

export function genericLines(o: Order): OrderLine[] {
  return [
    {
      id: `${o.id}-l1`, lineNo: 1, mpn: "STM32F407VGT6", make: "STMicro", description: "32-bit ARM Cortex-M4 MCU",
      hsnCode: "85423900", quantity: 500, unitPrice: 22.0, currency: o.currency, dateCode: "2325", coo: o.supplier.country,
      testingRequired: testingModeOf(o) !== "NONE", testingMode: testingModeOf(o), componentCategory: "MCU",
      lab: testingModeOf(o) === "WHL" ? "WHL Shenzhen" : undefined,
    },
    {
      id: `${o.id}-l2`, lineNo: 2, mpn: "TPS54560DDAR", make: "TI", description: "Step-down DC-DC converter",
      hsnCode: "85423900", quantity: 400, unitPrice: 1.65, currency: o.currency, dateCode: "2410", coo: o.supplier.country,
      testingRequired: testingModeOf(o) !== "NONE", testingMode: testingModeOf(o), componentCategory: "Power",
      lab: testingModeOf(o) === "WHL" ? "WHL Shenzhen" : undefined,
    },
    {
      id: `${o.id}-l3`, lineNo: 3, mpn: "GRM155R71C104KA88D", make: "Murata", description: "MLCC 0.1µF 16V X7R",
      hsnCode: "85322400", quantity: 300, unitPrice: 0.02, currency: o.currency, dateCode: "2402", coo: o.supplier.country,
      testingRequired: false, testingMode: "NONE", componentCategory: "Passive",
    },
  ];
}

// ---- HERO rich detail ----
// hero order lines mirror its Supplier PO (spo-148): STM32 300 / TPS 250, fully sourced to ACME-PO-3391 (no orphan line)
const HERO_LINES: OrderLine[] = [
  { id: "ord-148-l1", lineNo: 1, mpn: "STM32F407VGT6", make: "STMicro", description: "32-bit ARM Cortex-M4 MCU",
    hsnCode: "85423900", quantity: 300, unitPrice: 22.0, currency: "USD", dateCode: "2325", coo: "CN",
    testingRequired: true, testingMode: "WHL", componentCategory: "MCU", lab: "WHL Shenzhen" },
  { id: "ord-148-l2", lineNo: 2, mpn: "TPS54560DDAR", make: "TI", description: "Step-down DC-DC converter",
    hsnCode: "85423900", quantity: 250, unitPrice: 1.65, currency: "USD", dateCode: "2410", coo: "CN",
    testingRequired: true, testingMode: "WHL", componentCategory: "Power", lab: "WHL Shenzhen" },
];

// ---- WHL testing seed -------------------------------------------------------------
// Tests are what the PO asked for — parsed off SPO-2026-0148, never hand-typed. The
// TPS line deliberately shows the failed-parse path ("needs manual review").

const aud = (n: number, by: string, action: TestAuditEntry["action"], o: Partial<TestAuditEntry>): TestAuditEntry =>
  ({ id: `aud-${n}`, at: o.at ?? "2026-07-20 09:14", by, action, ...o });

const STM32_TESTS = [
  { id: "req-a1", name: "Documentation & Packaging Inspection", standard: "AS6081", source: "AUTO_PO" as const },
  { id: "req-a2", name: "General Inspection", standard: "AS6081", source: "AUTO_PO" as const },
  { id: "req-a3", name: "External Visual Inspection", standard: "AS6081", source: "AUTO_PO" as const },
  { id: "req-a4", name: "Electrical Test", standard: "AS6081", source: "AUTO_PO" as const },
  { id: "req-a5", name: "X-Ray Inspection", standard: "AS6081", source: "AUTO_PO" as const },
  { id: "req-a6", name: "Decapsulation & Die Analysis", standard: "AS6171", source: "MANUAL" as const, addedBy: "A. Sharma", addedAt: "2026-07-20 11:02" },
];

const HERO_MPN_TESTS: MpnTestSpec[] = [
  {
    id: "spec-a", mpn: "STM32F407VGT6", autofill: "OK", sourceDoc: "Purchase Order SPO-2026-0148",
    parsedAt: "2026-07-20 09:14", confidence: 0.96, tests: STM32_TESTS,
    audit: [
      aud(1, "Doc extraction (auto)", "AUTOFILL", { target: "STM32F407VGT6", before: "—", after: "5 test(s) from Purchase Order SPO-2026-0148", note: "Confidence 96%." }),
      aud(2, "A. Sharma", "ADD", { at: "2026-07-20 11:02", target: "Decapsulation & Die Analysis", before: "—", after: "manual test (AS6171)", note: "PO clause 7 asks for die analysis on MIL-grade lines; parser missed the footnote." }),
    ],
  },
  {
    id: "spec-b", mpn: "TPS54560DDAR", autofill: "FAILED", sourceDoc: "Purchase Order SPO-2026-0148",
    parsedAt: "2026-07-20 09:14", confidence: 0.31,
    autofillNote: "Test table on page 2 is a low-resolution scan — columns could not be resolved.",
    tests: [
      { id: "req-b1", name: "Documentation & Packaging Inspection", source: "MANUAL", addedBy: "A. Sharma", addedAt: "2026-07-21 10:40" },
      { id: "req-b2", name: "External Visual Inspection", source: "MANUAL", addedBy: "A. Sharma", addedAt: "2026-07-21 10:41" },
      { id: "req-b3", name: "Electrical Test", source: "MANUAL", addedBy: "A. Sharma", addedAt: "2026-07-21 10:41" },
      { id: "req-b4", name: "X-Ray Inspection", source: "MANUAL", addedBy: "A. Sharma", addedAt: "2026-07-21 10:42" },
    ],
    audit: [
      aud(3, "Doc extraction (auto)", "AUTOFILL", { target: "TPS54560DDAR", before: "—", after: "auto-fill failed", note: "Test table on page 2 is a low-resolution scan — columns could not be resolved." }),
      aud(4, "A. Sharma", "ADD", { at: "2026-07-21 10:40", target: "Documentation & Packaging Inspection", before: "—", after: "manual test", note: "Read off the printed PO copy." }),
      aud(5, "A. Sharma", "ADD", { at: "2026-07-21 10:41", target: "External Visual Inspection", before: "—", after: "manual test" }),
      aud(6, "A. Sharma", "ADD", { at: "2026-07-21 10:41", target: "Electrical Test", before: "—", after: "manual test" }),
      aud(7, "A. Sharma", "ADD", { at: "2026-07-21 10:42", target: "X-Ray Inspection", before: "—", after: "manual test" }),
      aud(8, "A. Sharma", "DELETE", { at: "2026-07-21 10:44", target: "Solvent Resistance Test", before: "manual test", after: "—", note: "Added in error — not on this PO." }),
    ],
  },
];

const lotTest = (
  id: string, name: string, status: TestProcessStatus, o: Partial<LotTest> & { hist?: [string, string, string][] } = {},
): LotTest => ({
  id, name, standard: o.standard, source: o.source ?? "AUTO_PO", status,
  acceptQty: o.acceptQty, rejectQty: o.rejectQty, updatedAt: o.updatedAt,
  requirementId: o.requirementId,
  history: (o.hist ?? []).map(([at, by, note], i) => ({ id: `${id}-h${i}`, at, by, action: "STATUS", target: name, after: note.split("→")[1]?.trim(), note })),
});

const LOT_A_TESTS: LotTest[] = [
  lotTest("lt-a1", "Documentation & Packaging Inspection", "PASSED", { standard: "AS6081", requirementId: "req-a1", acceptQty: 20, rejectQty: 0, updatedAt: "2026-07-24 15:20",
    hist: [["2026-07-21 09:00", "WHL inbox (auto)", "Lot booked in → PENDING"], ["2026-07-23 11:10", "WHL inbox (auto)", "Interim mail — in progress → IN_PROGRESS"], ["2026-07-24 15:20", "WHL inbox (auto)", "Report 352146.1 → PASSED"]] }),
  lotTest("lt-a2", "General Inspection", "PASSED", { standard: "AS6081", requirementId: "req-a2", acceptQty: 20, rejectQty: 0, updatedAt: "2026-07-24 15:20",
    hist: [["2026-07-23 11:10", "WHL inbox (auto)", "Interim mail → IN_PROGRESS"], ["2026-07-24 15:20", "WHL inbox (auto)", "Report 352146.1 → PASSED"]] }),
  lotTest("lt-a3", "External Visual Inspection", "PASSED", { standard: "AS6081", requirementId: "req-a3", acceptQty: 20, rejectQty: 0, updatedAt: "2026-07-24 15:20",
    hist: [["2026-07-24 15:20", "WHL inbox (auto)", "Report 352146.1 → PASSED"]] }),
  lotTest("lt-a4", "Electrical Test", "PASSED", { standard: "AS6081", requirementId: "req-a4", acceptQty: 20, rejectQty: 0, updatedAt: "2026-07-25 16:05",
    hist: [["2026-07-24 15:20", "WHL inbox (auto)", "Report 352146.1 — 2 units out of spec → FAILED"], ["2026-07-25 09:30", "WHL inbox (auto)", "Re-test agreed after supplier challenge → IN_PROGRESS"], ["2026-07-25 16:05", "WHL inbox (auto)", "Revised report 352146.2 → PASSED"]] }),
  lotTest("lt-a5", "X-Ray Inspection", "PASSED", { standard: "AS6081", requirementId: "req-a5", acceptQty: 20, rejectQty: 0, updatedAt: "2026-07-24 15:20",
    hist: [["2026-07-24 15:20", "WHL inbox (auto)", "Report 352146.1 → PASSED"]] }),
  lotTest("lt-a6", "Decapsulation & Die Analysis", "PASSED", { standard: "AS6171", source: "MANUAL", requirementId: "req-a6", acceptQty: 3, rejectQty: 0, updatedAt: "2026-07-25 16:05",
    hist: [["2026-07-20 11:05", "A. Sharma", "Added manually (PO clause 7) → PENDING"], ["2026-07-25 16:05", "WHL inbox (auto)", "Revised report 352146.2 → PASSED"]] }),
];

const LOT_B_TESTS: LotTest[] = [
  lotTest("lt-b1", "Documentation & Packaging Inspection", "PASSED", { source: "MANUAL", requirementId: "req-b1", acceptQty: 20, rejectQty: 0, updatedAt: "2026-07-26 14:40",
    hist: [["2026-07-26 14:40", "WHL inbox (auto)", "Report 352147.1 → PASSED"]] }),
  lotTest("lt-b2", "External Visual Inspection", "PASSED", { source: "MANUAL", requirementId: "req-b2", acceptQty: 20, rejectQty: 0, updatedAt: "2026-07-26 14:40",
    hist: [["2026-07-26 14:40", "WHL inbox (auto)", "Report 352147.1 → PASSED"]] }),
  lotTest("lt-b3", "Electrical Test", "PASSED", { source: "MANUAL", requirementId: "req-b3", acceptQty: 19, rejectQty: 1, updatedAt: "2026-07-26 14:40",
    hist: [["2026-07-26 14:40", "WHL inbox (auto)", "Report 352147.1 — 1 unit marginal, within AQL → PASSED"]] }),
  lotTest("lt-b4", "X-Ray Inspection", "FAR", { source: "MANUAL", requirementId: "req-b4", acceptQty: 19, rejectQty: 1, updatedAt: "2026-07-26 14:40",
    hist: [["2026-07-26 14:40", "WHL inbox (auto)", "Report 352147.1 — void anomaly on 1 unit → FAR"]] }),
];

const LOT_C_TESTS: LotTest[] = [
  lotTest("lt-c1", "Documentation & Packaging Inspection", "IN_PROGRESS", { source: "MANUAL", requirementId: "req-b1", updatedAt: "2026-07-27 10:15",
    hist: [["2026-07-26 09:00", "A. Sharma", "Lot raised → PENDING"], ["2026-07-27 10:15", "WHL inbox (auto)", "Interim mail — intake complete → IN_PROGRESS"]] }),
  lotTest("lt-c2", "External Visual Inspection", "PENDING", { source: "MANUAL", requirementId: "req-b2",
    hist: [["2026-07-26 09:00", "A. Sharma", "Lot raised → PENDING"]] }),
  lotTest("lt-c3", "Electrical Test", "PENDING", { source: "MANUAL", requirementId: "req-b3",
    hist: [["2026-07-26 09:00", "A. Sharma", "Lot raised → PENDING"]] }),
  lotTest("lt-c4", "X-Ray Inspection", "PENDING", { source: "MANUAL", requirementId: "req-b4",
    hist: [["2026-07-26 09:00", "A. Sharma", "Lot raised → PENDING"]] }),
];

const REPORT_A1: WhlReport = {
  id: "rep-a1", reportNo: "352146.1", revision: 1, reportDate: "2026-07-24", workOrderNo: "352146",
  fileName: "WHL-352146.1.pdf", receivedAt: "2026-07-24 15:20", current: false,
  partNumber: "STM32F407VGT6", manufacturer: "STMicroelectronics", lotQty: 300,
  client: "Sharpbuy Global Solutions", clientPo: "ACME-PO-3391",
  conclusion: "NOT_ACCEPTABLE", anyFar: false,
  processes: [
    { name: "Documentation & Packaging Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "General Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "External Visual Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "Electrical Test", result: "NOT_ACCEPTABLE", acceptQty: 18, rejectQty: 2, note: "2 units outside Vdd tolerance." },
    { name: "X-Ray Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "Decapsulation & Die Analysis", result: "NOT_CONDUCTED", note: "Held pending electrical re-test." },
  ],
  approvedBy: "K. Ng", approverTitle: "Laboratory Manager", standards: ["AS6081", "AS6171"],
  riskClass: "ERAI Low Risk", msl: "MSL 3", packageType: "LQFP-100",
  confidentialityNote: WHL_CONFIDENTIALITY, parseFlags: [],
  accessLog: [{ at: "2026-07-24 15:35", by: "A. Sharma", action: "VIEW" }],
};

const REPORT_A2: WhlReport = {
  ...REPORT_A1,
  id: "rep-a2", reportNo: "352146.2", revision: 2, reportDate: "2026-07-25",
  fileName: "WHL-352146.2.pdf", receivedAt: "2026-07-25 16:05", current: true,
  revisionNote: "Revision 2 — supersedes 352146.1. Electrical re-test on the 2 flagged units passed; die analysis completed.",
  conclusion: "ACCEPTABLE", anyFar: false,
  processes: [
    { name: "Documentation & Packaging Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "General Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "External Visual Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "Electrical Test", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0, note: "Re-test on the 2 flagged units passed." },
    { name: "X-Ray Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "Decapsulation & Die Analysis", result: "ACCEPTABLE", acceptQty: 3, rejectQty: 0, note: "Die marking matches STMicroelectronics reference." },
  ],
  parseFlags: [],
  accessLog: [{ at: "2026-07-25 16:12", by: "R. Menon", action: "DOWNLOAD" }, { at: "2026-07-25 16:08", by: "A. Sharma", action: "VIEW" }],
};

const REPORT_B1: WhlReport = {
  id: "rep-b1", reportNo: "352147.1", revision: 1, reportDate: "2026-07-26", workOrderNo: "352147",
  fileName: "WHL-352147.1.pdf", receivedAt: "2026-07-26 14:40", current: true,
  partNumber: "TPS54560DDAR", manufacturer: "Texas Instruments", lotQty: 150,
  client: "Sharpbuy Global Solutions", clientPo: "PO Unknown",
  conclusion: "ACCEPTABLE", anyFar: true,
  processes: [
    { name: "Documentation & Packaging Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "External Visual Inspection", result: "ACCEPTABLE", acceptQty: 20, rejectQty: 0 },
    { name: "Electrical Test", result: "ACCEPTABLE", acceptQty: 19, rejectQty: 1, note: "1 unit marginal but within AQL." },
    { name: "X-Ray Inspection", result: "FAR", acceptQty: 19, rejectQty: 1, note: "Void anomaly on 1 unit — further analysis recommended." },
  ],
  approvedBy: "K. Ng", approverTitle: "Laboratory Manager", standards: ["AS6081"],
  riskClass: "ERAI Low Risk", msl: "MSL 1", packageType: "SO PowerPAD-8",
  confidentialityNote: WHL_CONFIDENTIALITY,
  parseFlags: ["Client P/O came back as “PO Unknown” — reconcile against the PO on file."],
  accessLog: [{ at: "2026-07-26 14:52", by: "A. Sharma", action: "VIEW" }],
};

// LOT-A's Acceptable result was circulated; LOT-B/LOT-C are deliberately un-notified
// so the "Next actions" flow has something to do in the demo.
const LOT_A_NOTIFICATIONS: LotNotification[] = [
  { id: "ntf-a1", party: "SUPPLIER", to: "quality@shenzhenmicro.example", at: "2026-07-25 16:30", by: "A. Sharma", status: "SENT",
    reportNo: "352146.2", attachments: ["WHL-352146.2.pdf"],
    subject: "Test result — STM32F407VGT6 / Lot LOT-A — Acceptable (SPO-2026-0148)",
    body: "Dear supplier,\n\nThe independent test on the lot supplied against SPO-2026-0148 is complete.\n\n· MPN: STM32F407VGT6 (date code 2325)\n· Lot: LOT-A — qty 300, sample 20\n· Test report: 352146.2 dated 2026-07-25\n· Conclusion: Acceptable\n\nThe lot is accepted. We are proceeding with onward logistics and payment per the agreed terms.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
    note: "Masked — buyer identity, sales order and sell price withheld. Report shared under NDA — internal use by the recipient only." },
  { id: "ntf-a2", party: "BUYER", to: "procurement@acme.example", at: "2026-07-25 16:35", by: "A. Sharma", status: "SENT",
    reportNo: "352146.2", attachments: ["WHL-352146.2.pdf"],
    subject: "ORD-2026-000148 — test result for STM32F407VGT6 / Lot LOT-A — Acceptable",
    body: "Dear customer,\n\nIndependent testing on your order against ACME-PO-3391 is complete.\n\n· MPN: STM32F407VGT6 (date code 2325)\n· Lot: LOT-A — qty 300, sample 20\n· Test report: 352146.2 dated 2026-07-25\n· Conclusion: Acceptable\n· Laboratory: WHL Shenzhen\n\nThe lot has passed the agreed screen and is cleared for dispatch. We will confirm the delivery schedule shortly.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
    note: "Masked — supplier identity, buy price and inbound AWB withheld. Report shared under NDA — internal use by the recipient only." },
  { id: "ntf-a3", party: "ESCROW", to: "ops@hkin.example", at: "2026-07-25 16:40", by: "R. Menon", status: "SENT",
    reportNo: "352146.2", attachments: ["WHL-352146.2.pdf"],
    subject: "Escrow ES2607-5881 — release trigger evidence — Lot LOT-A Acceptable",
    body: "Dear HKIN team,\n\nRe escrow ES2607-5881 for ORD-2026-000148:\n\n· MPN: STM32F407VGT6\n· Lot: LOT-A — qty 300, sample 20\n· Test report: 352146.2 dated 2026-07-25\n· Conclusion: Acceptable\n\nThe release trigger (independent lab PASS) is satisfied for this lot. Please treat the attached report as the supporting evidence for the tranche release.\n\nRegards,\nSourcing Ops\nSharpbuy Global Solutions",
    note: "Release-trigger evidence for the escrow provider. Report shared under NDA — internal use by the recipient only." },
];

// Testing lifecycle history. LOT-A and LOT-B have run the full chain (their reports are
// in), while LOT-C is still mid-bench — so the tab shows both a closed-out lot and one
// in flight. Note the gap on LOT-A between "Testing Completed" and "Test Report Shared":
// the bench finished on the 24th, the signed report only landed on the 25th. That gap is
// the whole reason the two are separate stages, and why neither needs a "report being
// written" stage between them.
const stg = (
  id: string, stage: TestingStage, at: string, by: string, note?: string, o: Partial<TestingStageEvent> = {},
): TestingStageEvent => ({ id, stage, at, by, note, ...o });

const WHL_AUTO = "WHL inbox (auto)";

const LOT_A_STAGES: TestingStageEvent[] = [
  stg("sg-a1", "TEST_REQUESTED", "2026-07-19 09:40", "A. Sharma", "Work order 352146 raised with WHL Shenzhen — quoted TAT 5 days."),
  stg("sg-a1b", "WHL_PAYMENT", "2026-07-19 14:05", "A. Sharma", "Testing fee paid — invoice WHL-INV-352146, USD 923 · ref UTR-7741930.", { manual: true }),
  stg("sg-a2", "SUPPLIER_DISPATCHING", "2026-07-19 15:10", "Supplier (relayed)", "DHL Express · AWB 4471-9920-11 · dispatched 2026-07-19 — supplier confirmed by mail."),
  stg("sg-a3", "COMPONENTS_RECEIVED", "2026-07-21 09:00", WHL_AUTO, "Receipt confirmation — WO 352146 / Lot LOT-A"),
  stg("sg-a5", "TESTING_IN_PROGRESS", "2026-07-21 14:25", WHL_AUTO, "On the bench — documentation & packaging and external visual underway."),
  stg("sg-a6", "TESTING_COMPLETED", "2026-07-24 09:05", WHL_AUTO, "Testing complete — all six processes conducted; results with the reviewer."),
  // a day and a half between the bench finishing and the signed report landing
  stg("sg-a8", "REPORT_SHARED", "2026-07-25 16:05", WHL_AUTO, "Revised report 352146.2 received — acceptable (electrical re-test cleared the flagged units).", { sourceEmailId: "em-5" }),
];

const LOT_B_STAGES: TestingStageEvent[] = [
  stg("sg-b1", "TEST_REQUESTED", "2026-07-21 10:15", "A. Sharma", "Work order 352147 raised with WHL Shenzhen — quoted TAT 6 days."),
  // advance terms: WHL held the lot until the transfer cleared, and its own payment
  // acknowledgement is what closed this stage — hence the mail reference, not a manual flag
  stg("sg-b1b", "WHL_PAYMENT", "2026-07-21 16:20", WHL_AUTO, "Advance fee settled — invoice WHL-INV-352147, USD 615 · ref UTR-7742118. Lot released from hold.", { sourceEmailId: "em-pay-b" }),
  stg("sg-b2", "SUPPLIER_DISPATCHING", "2026-07-21 17:40", "Supplier (relayed)", "DHL Express · AWB 4471-9931-08 · dispatched 2026-07-21."),
  stg("sg-b3", "COMPONENTS_RECEIVED", "2026-07-23 08:50", WHL_AUTO, "Receipt confirmation — WO 352147 / Lot LOT-B"),
  stg("sg-b5", "TESTING_IN_PROGRESS", "2026-07-23 13:05", WHL_AUTO, "On the bench — WO 352147 / Lot LOT-B"),
  stg("sg-b6", "TESTING_COMPLETED", "2026-07-25 10:00", WHL_AUTO, "Testing complete — all four processes conducted on Lot LOT-B."),
  stg("sg-b8", "REPORT_SHARED", "2026-07-26 14:40", WHL_AUTO, "Report 352147.1 received — acceptable (a process came back F.A.R., follow-up open).", { sourceEmailId: "em-4" }),
];

const LOT_C_STAGES: TestingStageEvent[] = [
  stg("sg-c1", "TEST_REQUESTED", "2026-07-26 09:00", "A. Sharma", "Work order 352151 raised with WHL Hong Kong — quoted TAT 6 days."),
  // came in as the supplier's own dispatch advice on the lot's thread, not typed by us
  stg("sg-c2", "SUPPLIER_DISPATCHING", "2026-07-26 12:30", "Supplier (relayed)", "FedEx IP · AWB 7788-0021-45 · dispatched 2026-07-26 · ETA 2026-07-27.", { sourceEmailId: "em-dsp-c" }),
  stg("sg-c3", "COMPONENTS_RECEIVED", "2026-07-27 09:15", WHL_AUTO, "Receipt confirmation — WO 352151 / Lot LOT-C"),
  // matches LOT_C_TESTS: intake inspection is already IN_PROGRESS on the tracker
  stg("sg-c5", "TESTING_IN_PROGRESS", "2026-07-27 10:15", WHL_AUTO, "Interim mail — intake complete, documentation & packaging inspection underway.", { sourceEmailId: "em-3" }),
];

const HERO_LOTS: Lot[] = [
  { id: "lot-a", orderLineMpn: "STM32F407VGT6", lotCode: "LOT-A", dateCode: "2325", qty: 300, sampleQty: 20,
    testStatus: "PASS", lab: "WHL Shenzhen", workOrderNo: "352146", reportNo: "352146.2", tatDays: 5, testedAt: "2026-07-25",
    clientPoNo: "ACME-PO-3391", tests: LOT_A_TESTS, reports: [REPORT_A1, REPORT_A2], notifications: LOT_A_NOTIFICATIONS,
    stage: "REPORT_SHARED", stageHistory: LOT_A_STAGES,
    dispatch: { courier: "DHL Express", awb: "4471-9920-11", dispatchedOn: "2026-07-19", expectedArrival: "2026-07-21",
      note: "Supplier confirmed by mail; samples drawn from the same date-code reel.", recordedBy: "A. Sharma", recordedAt: "2026-07-19 15:10" },
    // settled on CREDIT terms: invoice in, sent to finance, paid — Payment-to-WHL closed
    labPayment: {
      status: "PAID",
      requestedAt: "2026-07-19 09:45",
      sentToFinanceAt: "2026-07-19 11:20", sentToFinanceBy: "A. Sharma",
      paidAt: "2026-07-19 14:05", paidRef: "UTR-7741930",
      invoice: { id: "inv-352146", invoiceNo: "WHL-INV-352146", amount: 870, taxAmount: 53, currency: "USD",
        fileName: "WHL-INV-352146.pdf", receivedAt: "2026-07-19 10:30", dueDate: "2026-08-03",
        terms: "CREDIT", creditDays: 15, ratePerProcess: 145, processCount: 6,
        note: "6 process(es) billed against WO 352146 at USD 145 each.", accessLog: [{ at: "2026-07-19 11:15", by: "A. Sharma", action: "DOWNLOAD" }] },
    } },
  { id: "lot-b", orderLineMpn: "TPS54560DDAR", lotCode: "LOT-B", dateCode: "2410", qty: 150, sampleQty: 20,
    testStatus: "MAYBE", lab: "WHL Shenzhen", workOrderNo: "352147", reportNo: "352147.1", tatDays: 6, testedAt: "2026-07-26",
    clientPoNo: "ACME-PO-3391", tests: LOT_B_TESTS, reports: [REPORT_B1],
    stage: "REPORT_SHARED", stageHistory: LOT_B_STAGES,
    dispatch: { courier: "DHL Express", awb: "4471-9931-08", dispatchedOn: "2026-07-21", expectedArrival: "2026-07-23",
      recordedBy: "A. Sharma", recordedAt: "2026-07-21 17:40" },
    // ADVANCE terms, settled: the lab held the lot until the transfer cleared, which is
    // why the fee row sits before the dispatch row in this lot's history
    labPayment: {
      status: "PAID",
      requestedAt: "2026-07-21 10:20",
      sentToFinanceAt: "2026-07-21 12:05", sentToFinanceBy: "A. Sharma",
      paidAt: "2026-07-21 16:20", paidRef: "UTR-7742118",
      invoice: { id: "inv-352147", invoiceNo: "WHL-INV-352147", amount: 580, taxAmount: 35, currency: "USD",
        fileName: "WHL-INV-352147.pdf", receivedAt: "2026-07-21 11:05", dueDate: "2026-07-24",
        terms: "ADVANCE", ratePerProcess: 145, processCount: 4,
        note: "4 process(es) billed against WO 352147 at USD 145 each — payable before testing.", accessLog: [] },
    } },
  // no report yet → "Not Available" + Request Update; the chase is already past the 3-business-day SLA
  { id: "lot-c", orderLineMpn: "TPS54560DDAR", lotCode: "LOT-C", dateCode: "2412", qty: 100, sampleQty: 15,
    testStatus: "PENDING", lab: "WHL Hong Kong", workOrderNo: "352151", tatDays: 6,
    clientPoNo: "ACME-PO-3391", tests: LOT_C_TESTS, reports: [], lastUpdateRequestAt: "2026-07-24",
    stage: "TESTING_IN_PROGRESS", stageHistory: LOT_C_STAGES,
    dispatch: { courier: "FedEx IP", awb: "7788-0021-45", dispatchedOn: "2026-07-26", expectedArrival: "2026-07-27",
      recordedBy: "Supplier (mail)", recordedAt: "2026-07-26 12:30" },
    // CREDIT terms, deliberately UNPAID and already with finance: the lab is testing on
    // account, so the chain has run past the payment stage while the fee is still owed.
    // Exercises the amber payment node, the roll-up fee alert, the "Mark paid" path — and
    // the inbox path, since a lot sitting at SENT_TO_FINANCE is what makes WHL's payment
    // acknowledgement the next mail to arrive.
    labPayment: {
      status: "SENT_TO_FINANCE",
      requestedAt: "2026-07-26 09:10",
      sentToFinanceAt: "2026-07-27 09:40", sentToFinanceBy: "A. Sharma",
      invoice: { id: "inv-352151", invoiceNo: "WHL-INV-352151", amount: 580, taxAmount: 35, currency: "USD",
        fileName: "WHL-INV-352151.pdf", receivedAt: "2026-07-26 10:15", dueDate: "2026-08-10",
        terms: "CREDIT", creditDays: 15, ratePerProcess: 145, processCount: 4,
        note: "4 process(es) billed against WO 352151 at USD 145 each.", accessLog: [{ at: "2026-07-27 09:35", by: "A. Sharma", action: "DOWNLOAD" }] },
    } },
];

const HERO_LAB_EMAILS: LabEmail[] = [
  // ---- the lab's own invoices: they arrive by mail on booking, long before the reports,
  // and the mail is where the payment mode comes from (advance vs credit is WHL's call
  // per work order — LOT-B came back on advance, the other two on credit) ----
  { id: "em-inv-c", direction: "IN", lotId: "lot-c", lotCode: "LOT-C", mpn: "TPS54560DDAR", workOrderNo: "352151",
    subject: "Invoice WHL-INV-352151 — testing services (credit) — WO 352151 / Lot LOT-C", kind: "INVOICE", status: "UPDATE_RECEIVED",
    at: "2026-07-26 10:15", by: "WHL Accounts", attachments: ["WHL-INV-352151.pdf"],
    body: "Please find attached our invoice WHL-INV-352151 for the testing booked against work order 352151 (TPS54560DDAR, Lot LOT-C).\n\n4 processes at USD 145 each — USD 580 plus service tax USD 35.\n\nThis work order is on CREDIT terms: USD 615 is due within 15 days of the invoice date. Testing proceeds on account in the meantime.\n\nPlease quote the work order and lot code as the payment reference so we can reconcile it." },
  { id: "em-inv-b", direction: "IN", lotId: "lot-b", lotCode: "LOT-B", mpn: "TPS54560DDAR", workOrderNo: "352147",
    subject: "Invoice WHL-INV-352147 — testing services (advance) — WO 352147 / Lot LOT-B", kind: "INVOICE", status: "UPDATE_RECEIVED",
    at: "2026-07-21 11:05", by: "WHL Accounts", attachments: ["WHL-INV-352147.pdf"],
    body: "Invoice WHL-INV-352147 attached for work order 352147 (Lot LOT-B) — 4 processes at USD 145 each, USD 580 plus service tax USD 35.\n\nThis work order is on ADVANCE terms: USD 615 is payable before testing begins. The lot will be held in our bonded store until the transfer clears." },
  { id: "em-pay-b", direction: "IN", lotId: "lot-b", lotCode: "LOT-B", mpn: "TPS54560DDAR", workOrderNo: "352147",
    subject: "Payment received — invoice WHL-INV-352147 — WO 352147 / Lot LOT-B", kind: "PAYMENT", status: "UPDATE_RECEIVED",
    at: "2026-07-21 16:20", by: "WHL Accounts", attachments: ["WHL-RCPT-352147.pdf"],
    body: "We confirm receipt of your transfer against invoice WHL-INV-352147 for TPS54560DDAR (Lot LOT-B), reference UTR-7742118. The invoice is settled in full and our receipt is attached.\n\nThe lot is released from hold and goes to the bench on the next available slot." },
  { id: "em-inv-a", direction: "IN", lotId: "lot-a", lotCode: "LOT-A", mpn: "STM32F407VGT6", workOrderNo: "352146",
    subject: "Invoice WHL-INV-352146 — testing services (credit) — WO 352146 / Lot LOT-A", kind: "INVOICE", status: "UPDATE_RECEIVED",
    at: "2026-07-19 10:30", by: "WHL Accounts", attachments: ["WHL-INV-352146.pdf"],
    body: "Invoice WHL-INV-352146 attached for work order 352146 (Lot LOT-A) — 6 processes at USD 145 each, USD 870 plus service tax USD 53.\n\nThis work order is on CREDIT terms: USD 923 is due within 15 days of the invoice date." },
  { id: "em-dsp-c", direction: "IN", lotId: "lot-c", lotCode: "LOT-C", mpn: "TPS54560DDAR", workOrderNo: "352151",
    subject: "Dispatch advice — samples to WHL — WO 352151 / Lot LOT-C", kind: "DISPATCH", status: "UPDATE_RECEIVED",
    at: "2026-07-26 12:30", by: "Supplier (relayed)",
    body: "Samples for TPS54560DDAR (Lot LOT-C) have been handed to FedEx IP today under AWB 7788-0021-45, consigned to the laboratory against work order 352151. Expected arrival 2026-07-27.\n\nUnits were drawn from the same date-code reel as the balance stock." },
  { id: "em-1", direction: "IN", lotId: undefined, subject: "RE: Testing update", kind: "STATUS_UPDATE", status: "AWAITING_RESPONSE",
    at: "2026-07-28 09:12", by: "WHL Reports",
    body: "Hi, quick update on the parts you sent through — one of the lots needs another day on the electrical bench. Will revert with the report. Regards, WHL",
    matchNote: "Subject line carries no work order, lot or report number — match it manually." },
  { id: "em-2", direction: "OUT", lotId: "lot-c", lotCode: "LOT-C", mpn: "TPS54560DDAR", workOrderNo: "352151", poNo: "ACME-PO-3391",
    subject: "Status request — WO 352151 / Lot LOT-C / TPS54560DDAR", kind: "REQUEST_UPDATE", status: "AWAITING_RESPONSE",
    at: "2026-07-24 11:30", by: "A. Sharma",
    body: "Hi WHL team,\n\nCould you share the current status of:\n· MPN: TPS54560DDAR\n· Lot: LOT-C (qty 100, sample 15)\n· Work order: 352151\n· Sales Order: ACME-PO-3391\n\nIf the report is issued, please attach the latest revision.\n\nThanks,\nSharpbuy Global Solutions" },
  { id: "em-3", direction: "IN", lotId: "lot-c", lotCode: "LOT-C", mpn: "TPS54560DDAR", workOrderNo: "352151",
    subject: "Interim status — WO 352151 / Lot LOT-C", kind: "STATUS_UPDATE", status: "UPDATE_RECEIVED",
    at: "2026-07-27 10:15", by: "WHL Reports",
    body: "Intake and documentation check complete for LOT-C. Visual and electrical scheduled for tomorrow." },
  { id: "em-4", direction: "IN", lotId: "lot-b", lotCode: "LOT-B", mpn: "TPS54560DDAR", workOrderNo: "352147",
    subject: "WHL Report 352147.1 — TPS54560DDAR (Lot LOT-B)", kind: "REPORT", status: "REPORT_DELIVERED",
    at: "2026-07-26 14:40", by: "WHL Reports", attachments: ["WHL-352147.1.pdf"],
    body: "Report 352147.1 attached. Overall conclusion Acceptable; X-Ray flagged F.A.R. on one unit — recommend further analysis before release." },
  { id: "em-5", direction: "IN", lotId: "lot-a", lotCode: "LOT-A", mpn: "STM32F407VGT6", workOrderNo: "352146",
    subject: "WHL Report 352146.2 (revised) — STM32F407VGT6 (Lot LOT-A)", kind: "REPORT", status: "REPORT_DELIVERED",
    at: "2026-07-25 16:05", by: "WHL Reports", attachments: ["WHL-352146.2.pdf"],
    body: "Revised report 352146.2 attached, superseding 352146.1. Electrical re-test on the two flagged units passed; die analysis completed. Overall conclusion Acceptable." },
  { id: "em-6", direction: "OUT", lotId: "lot-a", lotCode: "LOT-A", mpn: "STM32F407VGT6", workOrderNo: "352146", poNo: "ACME-PO-3391",
    subject: "Electrical re-test request — WO 352146 / Lot LOT-A", kind: "CUSTOM", status: "UPDATE_RECEIVED",
    at: "2026-07-24 17:40", by: "A. Sharma",
    body: "Supplier disputes the 2 electrical rejects on report 352146.1. Please re-test those units and issue a revised report." },
  { id: "em-7", direction: "IN", lotId: "lot-a", lotCode: "LOT-A", mpn: "STM32F407VGT6", workOrderNo: "352146",
    subject: "WHL Report 352146.1 — STM32F407VGT6 (Lot LOT-A)", kind: "REPORT", status: "REPORT_DELIVERED",
    at: "2026-07-24 15:20", by: "WHL Reports", attachments: ["WHL-352146.1.pdf"],
    body: "Report 352146.1 attached. Electrical Test not acceptable (2 of 20 units outside Vdd tolerance); die analysis held." },
];

// Contact cards + invoice fee/condition/bank-account shapes below mirror a real HKin.com escrow
// order and user-guide PDF (field names, fee lines, conditions table, warranty wording) — see
// Escrow spec §10. Entity names/amounts stay consistent with this order's own buyer/supplier
// rather than fictional placeholder names, so the Escrow tab doesn't contradict the Overview tab.
// Registered address/contact-person/email/phone below are demo placeholders — NOT the real
// company/contact details behind the reference document this was modelled on.
const HERO_ESCROW: Escrow = {
  id: "esc-148", status: "RECIPIENT_INSPECTION",
  buyerContact: { company: "Sharpbuy Global Solutions", registeredAddress: "New Delhi, Delhi, India (masking entity — on file)", country: "India", contactPerson: "SC Ops Desk", email: "scops@sharpbuy.demo", phone: "+91 98XXX XXXXX (demo)", im: "—" },
  sellerContact: { company: "Shenzhen Micro Co", registeredAddress: "Futian District, Shenzhen, Guangdong, China", country: "China", contactPerson: "Ms. Wei Lin (Sales)", email: "sales@shenzhenmicro.example", phone: "+86 755 XXXX XXXX (demo)", im: "—" },
  poAmount: 7013, currency: "USD",
  useInspectionService: true,
  recipient: { company: "Meridian Test Laboratories Ltd", registeredAddress: "Gang Zhi Long Science Park, Qinglong Road, Shenzhen, China", country: "China", contactPerson: "Mr. Chen, Lab Coordinator", email: "chen@meridiantestlabs.example", phone: "+86 755 8364 0311", im: "WeChat: mtl_chen" },
  agreedFeeToBuyer: 60,
  // Agreed at PO-drafting time — the invoice below (once it arrived) quotes these same terms.
  agreedConditions: {
    forwarder: "DHL", forwarderAccountNo: "DHL-ACC-88213 (demo)", shipWithinDays: "7 business days", inspectionPeriod: "5 business days",
    feeSharingLabel: "100% Buyer / 0% Seller", returnCondition: "7 business days, shipping fees to Seller",
    releaseMilestones: [{ percent: 30, trigger: "On shipment to WHL for testing" }, { percent: 70, trigger: "On WHL PASS report" }],
  },
  invoice: {
    invoiceNo: "AE2607-1188", receivedAt: "2026-07-18",
    fees: { poTotal: 7013, feeToBuyer: 60, wiringFeeToBuyer: 40, feeToSeller: 0, wiringFeeToSeller: 0 },
    conditions: {
      forwarder: "DHL", forwarderAccountNo: "DHL-ACC-88213 (demo)", shipWithinDays: "7 business days", inspectionPeriod: "5 business days",
      feeSharingLabel: "100% Buyer / 0% Seller", returnCondition: "7 business days, shipping fees to Seller",
      releaseMilestones: [{ percent: 30, trigger: "On shipment to WHL for testing" }, { percent: 70, trigger: "On WHL PASS report" }],
    },
    bankAccount: DEMO_ESCROW_BANK_ACCOUNT,
  },
  paymentInstructedAt: "2026-07-19", financeConfirmedAt: "2026-07-19", financeSwiftReference: "SWIFT20260719A912",
  paymentSentToHkinAt: "2026-07-20",
  goodsReceivedAt: "2026-07-24",
  whlVerdict: "PASS", whlVerdictAt: "2026-07-25", whlReportRef: "352146.2", // LOT-A's current WHL report on the Testing tab
  // First tranche (30% on shipment) already settled; second (70% on PASS) is the one action away
  // from release the hero order is meant to demo — whlVerdict is already PASS, ready to send.
  milestoneReleases: [
    { index: 0, instructedAt: "2026-07-21", confirmedAt: "2026-07-22" },
  ],
  agentEmails: [
    { id: "ea-deal", direction: "SENT", subject: "Order ORD-2026-000148 — please confirm acceptance", from: "you@1buy.ai", to: "billing@hkin-escrow.example",
      snippet: "Order terms + WHL ship-to instructions (Meridian Test Laboratories Ltd) + inspection period sent to HKin for Shenzhen Micro Co's acceptance.", receivedAt: "2026-07-14" },
    { id: "ea-hkinconf", direction: "RECEIVED", subject: "Escrow order confirmed — ORD-2026-000148", from: "billing@hkin-escrow.example",
      snippet: "Seller has accepted order ord-148 — PO 7013 USD, inspection period 5 business days, fee sharing 100% Buyer / 0% Seller, WHL ship-to Meridian Test Laboratories Ltd.", receivedAt: "2026-07-15" },
    { id: "ea1", direction: "RECEIVED", subject: "Escrow invoice AE2607-1188 — ORD-2026-000148", from: "billing@hkin-escrow.example",
      snippet: "Please find attached the escrow invoice for order ORD-2026-000148.", receivedAt: "2026-07-18", attachmentFileName: "AE2607-1188.pdf" },
    { id: "ea-fin", direction: "SENT", subject: "Payment instruction — ORD-2026-000148", from: "you@1buy.ai", to: "finance@1buy.ai",
      snippet: "Invoice reviewed — please remit per the release milestones on file (30% on WHL shipment, 70% on PASS report).", receivedAt: "2026-07-19" },
    { id: "ea-hkinpay", direction: "SENT", subject: "Payment sent — ORD-2026-000148", from: "finance@1buy.ai", to: "billing@hkin-escrow.example",
      snippet: "We've remitted the T/T per invoice AE2607-1188 — please confirm receipt.", receivedAt: "2026-07-20" },
    { id: "ea-payconf", direction: "RECEIVED", subject: "Payment received — ORD-2026-000148", from: "billing@hkin-escrow.example",
      snippet: "HKin confirms the T/T payment has been received into escrow.", receivedAt: "2026-07-20" },
    { id: "ea-shipnotice", direction: "RECEIVED", subject: "Shipment dispatched — ORD-2026-000148", from: "sales@shenzhenmicro.example",
      snippet: "Supplier confirms goods have been dispatched; AWB attached.", receivedAt: "2026-07-23" },
    { id: "ea-goodsrecv", direction: "RECEIVED", subject: "Goods received — ORD-2026-000148", from: "labs@whl-labs.example",
      snippet: "WHL confirms receipt of the shipment for testing.", receivedAt: "2026-07-24" },
    { id: "ea-verdict", direction: "RECEIVED", subject: "WHL verdict: PASS — ORD-2026-000148", from: "reports@whl-labs.example",
      snippet: "WHL confirms PASS — detailed report 352146.2 attached.", receivedAt: "2026-07-25", attachmentFileName: "WHL-352146.2.pdf" },
  ],
};

const HERO_PAYMENTS: Payment[] = [
  { id: "pay1", direction: "CLIENT_TO_1BUY", mode: "ADVANCE", triggerDoc: "Our PI", amount: 8775, currency: "USD", status: "PAID", dueDate: "2026-07-16", paidAt: "2026-07-16" },
  { id: "pay2", direction: "1BUY_TO_SUPPLIER", mode: "ESCROW", triggerDoc: "Supplier PI", amount: 7013, currency: "USD", status: "INITIATED", dueDate: "2026-07-18" },
];

// Only the PASSED lot moved — the TPS lots (LOT-B F.A.R., LOT-C untested) are still at the
// lab, so the testing screen's "Arrange logistics" has real headroom to book.
const HERO_SHIPMENTS: Shipment[] = [
  { id: "shp1", shipmentNo: "SHP-IN-148-1", leg: "INBOUND", awb: "DHL 77610233451", carrier: "DHL",
    fromLocation: "WHL Shenzhen", toLocation: "1Buy hub — New Delhi", boxCount: 2, grossWeightKg: 18.4,
    dispatchDate: "2026-07-28", status: "IN_TRANSIT", lastLocation: "Shenzhen, CN",
    carrierRef: "DHL-SHP-IN-148-1", trackingUrl: "https://track.example/DHL77610233451",
    lines: [{ mpn: "STM32F407VGT6", qty: 300 }] },
];

const HERO_CUSTOMS: CustomsEntry[] = [
  { id: "ce1", shipmentNo: "SHP-IN-148-1", beNo: "—", portCode: "INDEL4", chaName: "Speedwing CHA",
    totalDuty: 5400, currency: "INR", icegateRef: undefined, filedAt: undefined },
];

const HERO_DELIVERIES: DeliveryAllocation[] = [];

const HERO_SOURCING: SourcingAllocation[] = [
  { id: "sa1", orderLineId: "ord-148-l1", clientPoNo: "ACME-PO-3391", clientLineMpn: "STM32F407VGT6", orderLineMpn: "STM32F407VGT6", qty: 300, marginPct: 13 },
  { id: "sa2", orderLineId: "ord-148-l2", clientPoNo: "ACME-PO-3391", clientLineMpn: "TPS54560DDAR", orderLineMpn: "TPS54560DDAR", qty: 250, marginPct: 12 },
];

const HERO_DOCS: DocumentRef[] = [
  { id: "d1", subjectType: "ORDER", docType: "PO", fileName: "buyer-po-ORD148.pdf", uploadedBy: "A. Sharma", uploadedAt: "2026-07-14" },
  { id: "d2", subjectType: "ORDER", docType: "PI", fileName: "supplier-pi-shenzhen.pdf", uploadedBy: "A. Sharma", uploadedAt: "2026-07-17" },
  { id: "d3", subjectType: "ESCROW", docType: "ESCROW_INVOICE", fileName: "AE2607-1188.pdf", uploadedBy: "Escrow Agent", uploadedAt: "2026-07-18" },
  { id: "d4", subjectType: "LOT", docType: "WHL_REPORT", fileName: "WHL-352146.1.pdf", uploadedBy: "WHL (email)", uploadedAt: "2026-07-24" },
  { id: "d5", subjectType: "LOT", docType: "WHL_REPORT", fileName: "WHL-352146.2.pdf", uploadedBy: "WHL (email)", uploadedAt: "2026-07-25" },
  { id: "d6", subjectType: "LOT", docType: "WHL_REPORT", fileName: "WHL-352147.1.pdf", uploadedBy: "WHL (email)", uploadedAt: "2026-07-26" },
];

const HERO_APPROVALS: Approval[] = [
  { id: "ap1", subjectType: "ORDER", kind: "PO_REVIEW", role: "Finance", status: "APPROVED", decidedBy: "R. Menon (Finance)", notes: "Margin 13% — ok." },
  { id: "ap2", subjectType: "PAYMENT", kind: "PAYMENT_RELEASE", role: "Finance", status: "PENDING", notes: "Release balance on LOT-B decision." },
];

const HERO_EVENTS: OrderEvent[] = [
  { id: "ev1", eventType: "GENERAL", message: "Escrow invoice AE2607-1188 received — fees reconciled OK.", source: "SC_MANUAL", occurredAt: "2026-07-18", recordedBy: "R. Menon" },
  { id: "ev2", eventType: "LEAD_TIME_UPDATE", message: "Supplier: ~1 week to dispatch remaining.", source: "SC_MANUAL", occurredAt: "2026-07-23", recordedBy: "A. Sharma" },
  { id: "ev3", eventType: "DELAY", message: "LOT-B flagged MAYBE by WHL — awaiting client decision.", source: "SC_MANUAL", occurredAt: "2026-07-26", recordedBy: "A. Sharma" },
];

interface EscrowSeedScenario {
  status: EscrowOrderStatus;
  whlVerdict?: WhlVerdict;
  refundRequested?: boolean;  // FAIL + client asked for a refund instead of a retest (Testing tab owns the retest/return decision itself)
  refundInstructed?: boolean; // SC already sent the refund instruction to HKin + supplier
  cancelled?: boolean;
  feeMismatch?: boolean;    // invoice fee ≠ agreedFeeToBuyer, to demo the red §7 reconciliation banner
  seedInboundAwb?: boolean; // seed a real inbound AWB, for the "no testing agreed → release on AWB" path
  conditionsOverride?: Partial<EscrowConditions>; // different real-world invoices quote different terms — override the default per order
  // The generic escrow scaffold below fills seller/recipient contacts with placeholder "—"
  // email/phone (real business data isn't known generically) — fine for E2E-test orders that never
  // leave this app, but the "Create HKin order" RPA needs real, submittable values. Override per
  // order when it needs to actually go through that flow live (see ord-201/202).
  contactsOverride?: { buyerContact?: Partial<EscrowContact>; sellerContact?: Partial<EscrowContact>; recipient?: Partial<EscrowContact> };
}

// One order per stage of the 8-state flow, plus every edge case and a spread of genuinely
// different invoice terms — the complete, current escrow E2E test suite (see ord-180..195 above).
const ESCROW_SEED_SCENARIOS: Record<string, EscrowSeedScenario> = {
  "ord-180": { status: "DRAFT" }, // fresh — walk the whole flow by hand from here
  "ord-181": { status: "SENT_FOR_SELLER_CONFIRMATION" },
  "ord-182": { status: "SELLER_CONFIRMED" }, // ready for the invoice to arrive
  "ord-183": { status: "ESCROW_FEE_INVOICED" }, // invoice in hand, default/baseline terms — review it, then instruct Finance

  "ord-184": { // single milestone (100% on PASS only, no shipment tranche); fee split 50/50; slower inspection window
    status: "ESCROW_FEE_INVOICED",
    conditionsOverride: {
      feeSharingLabel: "50% Buyer / 50% Seller", inspectionPeriod: "10 business days",
      returnCondition: "5 business days, shipping fees to Buyer",
      releaseMilestones: [{ percent: 100, trigger: "On WHL PASS report" }],
    },
  },
  "ord-185": { status: "ESCROW_FEE_INVOICED", feeMismatch: true }, // red §7 reconciliation banner visible on load

  "ord-186": { // 3-way milestone split; fee entirely on the seller's side; longer ship-within window
    status: "TT_PAYMENT_RECEIVED",
    conditionsOverride: {
      feeSharingLabel: "0% Buyer / 100% Seller", shipWithinDays: "14 business days", forwarder: "FedEx",
      releaseMilestones: [
        { percent: 20, trigger: "On WHL booking confirmed" },
        { percent: 30, trigger: "On shipment to WHL for testing" },
        { percent: 50, trigger: "On WHL PASS report" },
      ],
    },
  },
  "ord-187": { // fast 50/50 split, 3-day ship window
    status: "GOODS_SHIPPED",
    conditionsOverride: {
      feeSharingLabel: "70% Buyer / 30% Seller", shipWithinDays: "3 business days", inspectionPeriod: "2 business days",
      releaseMilestones: [{ percent: 50, trigger: "On shipment to WHL for testing" }, { percent: 50, trigger: "On WHL PASS report" }],
    },
  },
  "ord-188": { // no testing agreed at all — single milestone on hub receipt, fee flipped onto the seller
    status: "GOODS_SHIPPED",
    conditionsOverride: {
      feeSharingLabel: "0% Buyer / 100% Seller", returnCondition: "10 business days, shipping fees to Buyer",
      releaseMilestones: [{ percent: 100, trigger: "On goods received at the hub (no testing agreed)" }],
    },
  },

  "ord-189": { status: "RECIPIENT_INSPECTION" }, // awaiting a WHL verdict — no verdict recorded yet
  "ord-190": { // WHL PASS already recorded → release-ready now, non-default milestone split
    status: "RECIPIENT_INSPECTION", whlVerdict: "PASS",
    conditionsOverride: {
      feeSharingLabel: "70% Buyer / 30% Seller",
      releaseMilestones: [{ percent: 50, trigger: "On shipment to WHL for testing" }, { percent: 50, trigger: "On WHL PASS report" }],
    },
  },
  "ord-191": { // no testing agreed + AWB in → release-ready via the AWB path, not a lab verdict
    status: "RECIPIENT_INSPECTION", seedInboundAwb: true,
    conditionsOverride: {
      feeSharingLabel: "0% Buyer / 100% Seller",
      releaseMilestones: [{ percent: 100, trigger: "On goods received (no testing agreed)" }],
    },
  },
  "ord-192": { status: "RECIPIENT_INSPECTION", whlVerdict: "FAIL" }, // fresh FAIL — Testing tab is deciding retest/return, nothing to do here yet
  "ord-193": { status: "RECIPIENT_INSPECTION", whlVerdict: "FAIL", refundRequested: true }, // client asked for a refund instead — ready to send the refund instruction

  "ord-194": { status: "RELEASED_TO_SELLER" }, // fully closed — payment closure demo
  "ord-195": { status: "DRAFT", cancelled: true }, // cancelled escrow order

  // Draft-stage orders with different agreedConditions — walk each forward by hand (Send to
  // seller → seller accepts → fetch invoice) and confirm the invoice quotes THIS order's terms.
  "ord-196": { status: "DRAFT" }, // baseline: 30/70 milestones, 100% Buyer fee, WHL testing — control case
  "ord-197": { // 50/50 fee split, single 100% milestone on PASS only, longer inspection window
    status: "DRAFT",
    conditionsOverride: {
      feeSharingLabel: "50% Buyer / 50% Seller", inspectionPeriod: "10 business days",
      releaseMilestones: [{ percent: 100, trigger: "On supplier self-test PASS report" }],
    },
  },
  "ord-198": { // 3-way milestone split, fee entirely on the seller, FedEx forwarder, longer ship window
    status: "DRAFT",
    conditionsOverride: {
      forwarder: "FedEx", forwarderAccountNo: "FDX-ACC-55710 (demo)", shipWithinDays: "14 business days",
      feeSharingLabel: "0% Buyer / 100% Seller",
      releaseMilestones: [
        { percent: 20, trigger: "On shipment to WHL for testing" },
        { percent: 30, trigger: "On WHL goods-received confirmation" },
        { percent: 50, trigger: "On WHL PASS report" },
      ],
    },
  },
  "ord-199": { // no testing agreed — single milestone on hub receipt, fee flipped onto the seller, short return window
    status: "DRAFT",
    conditionsOverride: {
      feeSharingLabel: "0% Buyer / 100% Seller", returnCondition: "10 business days, shipping fees to Seller",
      releaseMilestones: [{ percent: 100, trigger: "On goods received (no testing agreed)" }],
    },
  },
  "ord-200": { // fast turnaround: 70/30 fee, 3-day ship / 2-day inspection, even 50/50 milestone split
    status: "DRAFT",
    conditionsOverride: {
      shipWithinDays: "3 business days", inspectionPeriod: "2 business days", feeSharingLabel: "70% Buyer / 30% Seller",
      releaseMilestones: [{ percent: 50, trigger: "On shipment to WHL for testing" }, { percent: 50, trigger: "On WHL PASS report" }],
    },
  },

  // ---- Manager-demo orders — see the comment on ord-201/202 in ORDERS above. Real contacts (not
  // the generic "—" placeholders) so "Create HKin order" actually goes through live.
  "ord-201": {
    status: "DRAFT",
    contactsOverride: {
      buyerContact: { phone: "+1 415 555 0142" },
      sellerContact: {
        registeredAddress: "2-14 Higashiyama, Yamashina-ku, Kyoto 607-8471, Japan", country: "Japan", contactPerson: "Kenji Watanabe (Sales Director)",
        email: "k.watanabe@kyotoprecision.example", phone: "+81 75 555 0198",
      },
      recipient: {
        company: "WHL Testing Laboratories — Shenzhen", registeredAddress: "Gang Zhi Long Science Park, Qinglong Road, Shenzhen, China",
        country: "China", contactPerson: "Ms. Fang Li, Lab Coordinator", email: "fang.li@whltest.example", phone: "+86 755 8600 1122", im: "WeChat: whl_fangli",
      },
    },
  },
  "ord-202": {
    status: "DRAFT",
    conditionsOverride: { forwarder: "FedEx", forwarderAccountNo: "FDX-ACC-77410 (demo)" },
    contactsOverride: {
      buyerContact: { phone: "+46 8 555 0177" },
      sellerContact: {
        registeredAddress: "18 Tianhe Digital Park, Tianhe District, Guangzhou, China", country: "China", contactPerson: "Zhou Yifan (Export Sales)",
        email: "zhou.yifan@gzdigitalsemi.example", phone: "+86 20 555 0163", im: "WeChat: gzds_zhou",
      },
      // No external test lab in this order (SUPPLIER_SELF testing) — goods go straight to the hub.
      recipient: {
        company: "1Buy Hub — New Delhi", registeredAddress: "Plot 7, Sector 18, Udyog Vihar, New Delhi, Delhi 110037, India",
        country: "India", contactPerson: "Warehouse Ops Desk", email: "hub-ops@sharpbuy.demo", phone: "+91 11 4555 0199",
      },
    },
  },
};

export function getOrderBundle(id: string): OrderBundle | undefined {
  const o = ORDERS.find((x) => x.id === id);
  if (!o) return undefined;
  const base = {
    ...o,
    lines: genericLines(o),
    journey: buildJourney(o),
  };
  if (o.id === HERO_ID) {
    return {
      ...base, lines: HERO_LINES, lots: HERO_LOTS, mpnTests: HERO_MPN_TESTS, labEmails: HERO_LAB_EMAILS,
      escrow: HERO_ESCROW, payments: HERO_PAYMENTS, shipments: HERO_SHIPMENTS,
      customs: HERO_CUSTOMS, deliveries: HERO_DELIVERIES, sourcingAllocations: HERO_SOURCING,
      documents: HERO_DOCS, approvals: HERO_APPROVALS, events: HERO_EVENTS,
    };
  }
  // every other order carries a hardcoded detail seed too (see order-details.ts), so the
  // testing/payments/shipments/customs/delivery/docs screens all have real data. Escrow itself is
  // never seeded there — it's always built below from the 8-state machine + milestone logic, so a
  // rich order-details.ts entry and a fully-modelled escrow order compose cleanly on the same order.
  const d = ORDER_DETAILS[o.id];

  const approvals: Approval[] = o.approvalStatus === "PENDING"
    ? [{ id: `${o.id}-ap`, subjectType: "ORDER", kind: "PO_REVIEW", role: "Finance", status: "PENDING", notes: "Awaiting review." }]
    : o.approvalStatus === "APPROVED"
    ? [{ id: `${o.id}-ap`, subjectType: "ORDER", kind: "PO_REVIEW", role: "Finance", status: "APPROVED", decidedBy: "R. Menon (Finance)" }]
    : [];

  const scenario = ESCROW_SEED_SCENARIOS[o.id];
  // CLOSED orders are fully released; ON_HOLD orders are seller-confirmed but not yet invoiced;
  // explicit E2E-test scenarios (ord-160..170) override both; everything else starts at Draft
  // (mirrors the strict linear progression — see Escrow spec §3).
  const escrowStatus: EscrowOrderStatus = scenario?.status
    ?? (o.status === "CLOSED" ? "RELEASED_TO_SELLER" : o.status === "ON_HOLD" ? "SELLER_CONFIRMED" : "DRAFT");
  const idx = ESCROW_STATUS_ORDER.indexOf(escrowStatus);
  const hasInvoice = idx >= ESCROW_STATUS_ORDER.indexOf("ESCROW_FEE_INVOICED");
  // Reaching T/T Payment Received (or later) means the SC→Finance→HKin payment chain already ran.
  const paymentDone = idx >= ESCROW_STATUS_ORDER.indexOf("TT_PAYMENT_RECEIVED");
  const baseFeeToBuyer = Math.round(o.buyTotal * 0.00856); // matches escrow-agent's base fee rate
  const invoiceFeeToBuyer = scenario?.feeMismatch ? Math.round(baseFeeToBuyer * 1.25) : baseFeeToBuyer;
  const escrowFees: EscrowFeeBreakdown = { poTotal: o.buyTotal, feeToBuyer: invoiceFeeToBuyer, wiringFeeToBuyer: Math.round(o.buyTotal * 0.0057), feeToSeller: 0, wiringFeeToSeller: 0 };
  const invoiceDocNo = `AE${o.createdAt.replace(/-/g, "").slice(2, 6)}-${o.id.toUpperCase()}`;
  const closureDocNo = `PC${o.createdAt.replace(/-/g, "").slice(2, 6)}-${o.id.toUpperCase()}`;
  const finalVerdict: WhlVerdict | undefined = scenario?.whlVerdict ?? (escrowStatus === "RELEASED_TO_SELLER" ? "PASS" : undefined);
  // Agreed at PO-drafting time — exists from Draft onward, regardless of whether an invoice has
  // arrived yet. Different test scenarios demonstrate their own fee-sharing / milestone / period
  // profile via conditionsOverride; the invoice below (once it arrives) quotes these same terms.
  const mergedConditions: EscrowConditions = {
    forwarder: "DHL", forwarderAccountNo: "DHL-ACC-88213 (demo)", shipWithinDays: "7 business days", inspectionPeriod: "5 business days",
    feeSharingLabel: "100% Buyer / 0% Seller", returnCondition: "7 business days, shipping fees to Seller",
    releaseMilestones: [{ percent: 30, trigger: "On shipment to WHL for testing" }, { percent: 70, trigger: "On WHL PASS report" }],
    ...scenario?.conditionsOverride,
  };

  // Seeds each milestone's send/confirm state from whether its own trigger is already met at the
  // seeded status — same classification checkEscrowInbox/escrowMilestoneTriggerMet use (ship /
  // pass-report / receipt). The LAST milestone is deliberately left pending (even if its trigger is
  // met) so release-ready scenarios still have one real action for the user to walk through by hand.
  const milestoneReleases: MilestoneRelease[] = mergedConditions.releaseMilestones
    .map((m, i): MilestoneRelease | undefined => {
      const t = m.trigger.toLowerCase();
      const met = t.includes("ship") ? idx >= ESCROW_STATUS_ORDER.indexOf("GOODS_SHIPPED")
        : (t.includes("pass") || t.includes("report")) ? finalVerdict === "PASS"
        : t.includes("receiv") ? idx >= ESCROW_STATUS_ORDER.indexOf("RECIPIENT_INSPECTION")
        : false;
      const isLast = i === mergedConditions.releaseMilestones.length - 1;
      if (escrowStatus !== "RELEASED_TO_SELLER" && (!met || isLast)) return undefined;
      const at = addDays(o.createdAt, 6 + i);
      return { index: i, instructedAt: at, confirmedAt: at };
    })
    .filter((r): r is MilestoneRelease => !!r);

  const escrow: Escrow | undefined = o.paymentMode === "ESCROW"
    ? {
        id: `${o.id}-esc`, status: escrowStatus,
        buyerContact: { company: o.maskingEntity, registeredAddress: "New Delhi, Delhi, India (masking entity — on file)", country: "India", contactPerson: "SC Ops Desk", email: "scops@sharpbuy.demo", phone: "—", im: "—", ...scenario?.contactsOverride?.buyerContact },
        sellerContact: { company: o.supplier.name, registeredAddress: "Address on file", country: o.supplier.country, contactPerson: "Sales (TBD)", email: "—", phone: "—", im: "—", ...scenario?.contactsOverride?.sellerContact },
        poAmount: o.buyTotal, currency: o.currency,
        useInspectionService: testingModeOf(o) === "WHL",
        recipient: { company: o.terms?.labLocation ?? "Independent test lab (TBD)", registeredAddress: "Address on file", country: "—", contactPerson: "Lab Coordinator (TBD)", email: "—", phone: "—", im: "—", ...scenario?.contactsOverride?.recipient },
        agreedFeeToBuyer: baseFeeToBuyer,
        agreedConditions: mergedConditions,
        invoice: hasInvoice ? {
          invoiceNo: invoiceDocNo, receivedAt: addDays(o.createdAt, 4),
          fees: escrowFees,
          conditions: mergedConditions,
          bankAccount: DEMO_ESCROW_BANK_ACCOUNT,
        } : undefined,
        paymentClosure: escrowStatus === "RELEASED_TO_SELLER" ? {
          documentNo: closureDocNo, releasedAmount: o.buyTotal, receivedAt: addDays(o.createdAt, 10),
        } : undefined,
        paymentInstructedAt: paymentDone ? addDays(o.createdAt, 4) : undefined,
        financeConfirmedAt: paymentDone ? addDays(o.createdAt, 4) : undefined,
        financeSwiftReference: paymentDone ? `SWIFT${o.createdAt.replace(/-/g, "")}${o.id.toUpperCase()}` : undefined,
        paymentSentToHkinAt: paymentDone ? addDays(o.createdAt, 5) : undefined,
        goodsReceivedAt: idx >= ESCROW_STATUS_ORDER.indexOf("RECIPIENT_INSPECTION") ? addDays(o.createdAt, 8) : undefined,
        whlVerdict: finalVerdict,
        whlVerdictAt: finalVerdict ? addDays(o.createdAt, 9) : undefined,
        whlReportRef: finalVerdict ? `WHL-RPT-${o.id.toUpperCase()}-SEED` : undefined,
        refundRequestedAt: scenario?.refundRequested || scenario?.refundInstructed ? addDays(o.createdAt, 10) : undefined,
        refundInstructedAt: scenario?.refundInstructed ? addDays(o.createdAt, 11) : undefined,
        milestoneReleases,
        cancelledAt: scenario?.cancelled ? o.createdAt : undefined,
        agentEmails: [],
      }
    : undefined;

  const escrowDocs: DocumentRef[] = [];
  if (escrow?.invoice) escrowDocs.push({ id: `${o.id}-ei`, subjectType: "ESCROW", docType: "ESCROW_INVOICE", fileName: `${escrow.invoice.invoiceNo}.pdf`, uploadedBy: "Escrow Agent", uploadedAt: escrow.invoice.receivedAt });
  if (escrow?.whlReportRef) escrowDocs.push({ id: `${o.id}-wr`, subjectType: "LOT", docType: "WHL_REPORT", fileName: `${escrow.whlReportRef}.pdf`, uploadedBy: "WHL", uploadedAt: escrow.whlVerdictAt! });
  if (escrow?.paymentClosure) escrowDocs.push({ id: `${o.id}-pc`, subjectType: "ESCROW", docType: "PAYMENT_CLOSURE", fileName: `${escrow.paymentClosure.documentNo}.pdf`, uploadedBy: "Escrow Agent", uploadedAt: escrow.paymentClosure.receivedAt });

  // Only seeded when the scenario needs a "release via inbound AWB" demo (no testing agreed on the PO).
  const shipments: Shipment[] = scenario?.seedInboundAwb ? [
    { id: `${o.id}-shp1`, shipmentNo: `SHP-IN-${o.id.toUpperCase()}-1`, leg: "INBOUND", awb: `DHL ${o.id.replace(/\D/g, "")}0011`, carrier: "DHL",
      fromLocation: o.supplier.country, toLocation: "1Buy hub — New Delhi", boxCount: 2, grossWeightKg: 12.4,
      dispatchDate: addDays(o.createdAt, 9), status: "IN_TRANSIT", lines: [{ mpn: "STM32F407VGT6", qty: 500 }] },
  ] : [];

  if (d) {
    return {
      ...base, lines: d.lines, lots: d.lots, mpnTests: d.mpnTests, labEmails: d.labEmails, escrow,
      payments: d.payments, shipments: d.shipments, customs: d.customs, deliveries: d.deliveries,
      sourcingAllocations: d.sourcingAllocations, documents: d.documents, approvals: d.approvals,
      events: d.events, einvoice: d.einvoice,
      hubAddress: ONEBUY_HUB, buyerAddress: d.buyerAddress ?? base.buyerAddress,
    };
  }

  return {
    ...base, lots: [], escrow, payments: [], shipments, customs: [], deliveries: [], sourcingAllocations: [],
    documents: [{ id: `${o.id}-po`, subjectType: "ORDER", docType: "PO", fileName: `buyer-po-${o.orderNo}.pdf`, uploadedBy: o.createdBy, uploadedAt: o.createdAt }, ...escrowDocs],
    approvals, events: [],
  };
}

// ---- Client POs (delivery targets) ----
export const CLIENT_POS: ClientPO[] = [
  { id: "cpo-1", clientPoNo: "ACME-PO-3391", client: { name: "Acme Pte", country: "SG" }, paymentMode: "ESCROW", status: "IN_FULFILMENT",
    lines: [{ mpn: "STM32F407VGT6", make: "STMicro", dateCode: "2325", qty: 300, unitPrice: 27.5, requiredBy: "2026-08-20", status: "ALLOCATED" },
            { mpn: "TPS54560DDAR", make: "TI", dateCode: "2410", qty: 250, unitPrice: 2.1, requiredBy: "2026-08-20", status: "OPEN" }] },
  { id: "cpo-2", clientPoNo: "NW-4402", client: { name: "Northwind GmbH", country: "DE" }, paymentMode: "ADVANCE", status: "IN_FULFILMENT",
    terms: { referenceNo: "NW-4402", paymentMethod: "Advance via T/T", deliveryTerms: "Test Report Along with Shipment", testingTerms: "AS6081 screen at WHL", dateCode: "24+" },
    deliveryAddress: { name: "Northwind GmbH", line1: "Robert-Bosch-Straße 14", city: "Stuttgart", state: "BW", pincode: "70178", country: "DE" },
    lines: [{ mpn: "XC7A35T-2FGG484I", make: "AMD (Xilinx)", dateCode: "24+", qty: 120, unitPrice: 296.5, requiredBy: "2026-08-25", status: "ALLOCATED" }] },
  { id: "cpo-3", clientPoNo: "GIPL/26-27/PO/121", client: { name: "GEES Innovations Pvt Ltd", country: "IN", gstin: "33AALCG9069K1Z0", state: "Tamil Nadu" }, paymentMode: "CREDIT", status: "CONFIRMED",
    terms: { referenceNo: "GIPL/26-27/PO/121", gstNote: "GST extra @ actual", deliveryTerms: "Test Report Along with Shipment", paymentMethod: "As agreed" },
    deliveryAddress: { name: "GEES Innovations Pvt Ltd", line1: "SIPCOT IT Park, Siruseri", city: "Chennai", state: "Tamil Nadu", pincode: "603103", country: "IN" },
    lines: [{ mpn: "MIC5282-5.0YMME-TR", make: "Microchip", dateCode: "25+", qty: 12500, unitPrice: 345.6, requiredBy: "2026-07-20", status: "OPEN" }] },
  // DEMO — domestic client (India), pays us on ADVANCE; sourced from an international supplier on ESCROW (see spo-221)
  { id: "cpo-4", clientPoNo: "BEL/26-27/PO/0042", client: { name: "Bharat Defence Electronics Ltd", country: "IN", gstin: "29AABCB1234M1Z8", state: "Karnataka" }, paymentMode: "ADVANCE", status: "CONFIRMED",
    terms: { referenceNo: "BEL/26-27/PO/0042", gstNote: "GST extra @ actual", deliveryTerms: "Delivered to Bengaluru site, DDP", testingTerms: "Test report along with shipment", paymentMethod: "Advance via T/T" },
    deliveryAddress: { name: "Bharat Defence Electronics Ltd", line1: "Jalahalli Post, IISc Campus Road", city: "Bengaluru", state: "Karnataka", pincode: "560013", country: "IN" },
    lines: [{ mpn: "TMS320F28379DPTPT", make: "TI", dateCode: "24+", qty: 800, unitPrice: 34.5, requiredBy: "2026-09-05", status: "OPEN" },
            { mpn: "AD7768-4BSTZ", make: "Analog Devices", dateCode: "24+", qty: 500, unitPrice: 21.0, requiredBy: "2026-09-05", status: "OPEN" }] },
  // domestic credit client — supplier self-test route (ord-149)
  { id: "cpo-5", clientPoNo: "BEL-DOM/26/PO/77", client: { name: "Bharat Elec", country: "IN", gstin: "07AABCB5678K1Z2", state: "Delhi" }, paymentMode: "CREDIT", status: "IN_FULFILMENT",
    terms: { referenceNo: "BEL-DOM/26/PO/77", gstNote: "GST extra @ actual", paymentMethod: "Net 30 credit", deliveryTerms: "Delivered to Okhla site", testingTerms: "Supplier CoC with each lot" },
    deliveryAddress: { name: "Bharat Elec", line1: "Plot 22, Okhla Industrial Area Phase II", city: "New Delhi", state: "Delhi", pincode: "110020", country: "IN" },
    lines: [{ mpn: "LM317T", make: "TI", dateCode: "25+", qty: 2000, unitPrice: 430, requiredBy: "2026-08-06", status: "DELIVERED" },
            { mpn: "IRF540NPBF", make: "Infineon", dateCode: "25+", qty: 3000, unitPrice: 150, requiredBy: "2026-08-06", status: "ALLOCATED" }] },
  // US client on escrow — the order that went not-acceptable at WHL (ord-153)
  { id: "cpo-6", clientPoNo: "KES-2026-0114", client: { name: "Kestrel Robotics", country: "US" }, paymentMode: "ESCROW", status: "IN_FULFILMENT",
    terms: { referenceNo: "KES-2026-0114", paymentMethod: "Advance via T/T into escrow", deliveryTerms: "DAP Sunnyvale", testingTerms: "AS6081 screen; report before release", dateCode: "24+" },
    deliveryAddress: { name: "Kestrel Robotics Inc", line1: "1180 Bordeaux Drive", city: "Sunnyvale", state: "CA", pincode: "94089", country: "US" },
    lines: [{ mpn: "ADSP-21489KSWZ-4B", make: "Analog Devices", dateCode: "24+", qty: 400, unitPrice: 110, requiredBy: "2026-08-28", status: "ON_HOLD" },
            { mpn: "MAX3232ECPE+", make: "Analog Devices", dateCode: "24+", qty: 800, unitPrice: 29, requiredBy: "2026-08-28", status: "ALLOCATED" }] },
  // completed deal — kept for the closed-order view (ord-144)
  { id: "cpo-7", clientPoNo: "ACME-PO-3210", client: { name: "Acme Pte", country: "SG" }, paymentMode: "ESCROW", status: "CLOSED",
    terms: { referenceNo: "ACME-PO-3210", paymentMethod: "Advance via T/T into escrow", deliveryTerms: "Test report along with shipment", dateCode: "23+" },
    deliveryAddress: { name: "Acme Pte Ltd", line1: "8 Kaki Bukit Avenue 1", city: "Singapore", pincode: "417941", country: "SG" },
    lines: [{ mpn: "STM32F407VGT6", make: "STMicro", dateCode: "2318", qty: 1000, unitPrice: 25, requiredBy: "2026-07-12", status: "DELIVERED" },
            { mpn: "TPS54560DDAR", make: "TI", dateCode: "2402", qty: 3000, unitPrice: 2.2, requiredBy: "2026-07-12", status: "DELIVERED" }] },
  // no-testing domestic deal, still a draft order (ord-155)
  { id: "cpo-8", clientPoNo: "BEL-DOM/26/PO/81", client: { name: "Bharat Elec", country: "IN", gstin: "07AABCB5678K1Z2", state: "Delhi" }, paymentMode: "ADVANCE", status: "CONFIRMED",
    terms: { referenceNo: "BEL-DOM/26/PO/81", gstNote: "GST extra @ actual", paymentMethod: "Advance via T/T", testingTerms: "No incoming test — waived in writing" },
    deliveryAddress: { name: "Bharat Elec", line1: "Plot 22, Okhla Industrial Area Phase II", city: "New Delhi", state: "Delhi", pincode: "110020", country: "IN" },
    lines: [{ mpn: "IRLZ44NPBF", make: "Infineon", dateCode: "25+", qty: 4000, unitPrice: 178, requiredBy: "2026-08-08", status: "OPEN" }] },
];

// ---- Supplier POs (our purchase docs → suppliers) ----
// spo-148 is ORDERED (its fulfilment order is the hero); the rest are DRAFTs
// awaiting "Create order". Sourcing coverage on Client POs is computed from these.
export const SUPPLIER_POS: SupplierPO[] = [
  {
    id: "spo-148", poNo: "SPO-2026-0148", supplier: { name: "Shenzhen Micro Co", country: "CN" },
    tradeType: "INTERNATIONAL", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testing: "WHL",
    leadTimeDays: 21, testingTimeDays: 6, deliveryTimeDays: 9,
    terms: {
      referenceNo: "RFQBUNDLE_124612_20_07_2026", paymentMethod: "Advance via T/T", dispatchedThrough: "DHL",
      destination: "1Buy hub — New Delhi", deliveryTerms: "Test report along with shipment", dateCode: "25+",
      warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen & Hong Kong",
      packing: "Packing list + Commercial Invoice; WHSO# on outside box",
    },
    lines: [
      { mpn: "STM32F407VGT6", make: "STMicro", qty: 300, buyUnitPrice: 22.0, marginPct: 13, clientPoNo: "ACME-PO-3391", clientLineMpn: "STM32F407VGT6" },
      { mpn: "TPS54560DDAR", make: "TI", qty: 250, buyUnitPrice: 1.65, marginPct: 12, clientPoNo: "ACME-PO-3391", clientLineMpn: "TPS54560DDAR" },
    ],
    buyTotal: 7013, createdBy: "A. Sharma", createdAt: "2026-07-14", status: "ORDERED", orderId: HERO_ID,
  },
  // ORDERED POs behind the other seeded orders (so client-PO coverage + the Supplier POs board tally)
  {
    id: "spo-151", poNo: "SPO-2026-0151", supplier: { name: "Taiwan Semi", country: "TW" },
    tradeType: "INTERNATIONAL", currency: "USD", incoterm: "FOB", paymentMode: "ADVANCE", testing: "WHL",
    leadTimeDays: 18, testingTimeDays: 4, deliveryTimeDays: 8,
    terms: {
      referenceNo: "RFQBUNDLE_118820_18_07_2026", paymentMethod: "Advance via T/T", dispatchedThrough: "FedEx",
      destination: "WHL Hong Kong → 1Buy hub", deliveryTerms: "FOB Hsinchu", testingTerms: "AS6081 full screen before onward shipment",
      dateCode: "24+", warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Hong Kong",
    },
    termsConditions: [
      "Goods must be new, genuine & factory-sealed (no refurbished/remarked)",
      "Full traceability — Certificate of Conformance / manufacturer lot",
      "Supplier bears cost on test FAIL (return + re-test)",
    ],
    lines: [{ mpn: "XC7A35T-2FGG484I", make: "AMD (Xilinx)", dateCode: "24+", testing: "WHL", qty: 120, buyUnitPrice: 260, marginPct: 12, clientPoNo: "NW-4402", clientLineMpn: "XC7A35T-2FGG484I" }],
    buyTotal: 31200, createdBy: "A. Sharma", createdAt: "2026-07-20", status: "ORDERED", orderId: "ord-151",
  },
  {
    id: "spo-149", poNo: "SPO-2026-0149", supplier: { name: "Delhi Components", country: "IN", gstin: "07AAACD1234F1Z9", state: "Delhi" },
    tradeType: "DOMESTIC", currency: "INR", incoterm: "EXW", paymentMode: "CREDIT", testing: "SUPPLIER_SELF",
    leadTimeDays: 10, testingTimeDays: 3, deliveryTimeDays: 4, creditDays: 30,
    terms: { referenceNo: "BEL-DOM/26/PO/77", gstNote: "GST extra @ actual", paymentMethod: "Net 30 credit", dispatchedThrough: "Delhivery", testingTerms: "Supplier self-test + CoC with each lot", warranty: "6 months", testFailureBearer: "SUPPLIER" },
    lines: [
      { mpn: "LM317T", make: "TI", dateCode: "25+", testing: "SUPPLIER_SELF", qty: 2000, buyUnitPrice: 380, marginPct: 11, clientPoNo: "BEL-DOM/26/PO/77", clientLineMpn: "LM317T" },
      { mpn: "IRF540NPBF", make: "Infineon", dateCode: "25+", testing: "SUPPLIER_SELF", qty: 3000, buyUnitPrice: 140, marginPct: 10, clientPoNo: "BEL-DOM/26/PO/77", clientLineMpn: "IRF540NPBF" },
    ],
    buyTotal: 1180000, createdBy: "P. Nair", createdAt: "2026-07-19", status: "ORDERED", orderId: "ord-149",
  },
  {
    id: "spo-153", poNo: "SPO-2026-0153", supplier: { name: "Osaka Parts", country: "JP" },
    tradeType: "INTERNATIONAL", currency: "USD", incoterm: "CPT", paymentMode: "ESCROW", testing: "WHL",
    leadTimeDays: 24, testingTimeDays: 7, deliveryTimeDays: 10, relabelCost: 600,
    terms: {
      referenceNo: "RFQBUNDLE_207714_14_07_2026", paymentMethod: "Advance via T/T into escrow", dispatchedThrough: "DHL",
      destination: "WHL Shenzhen → 1Buy hub", deliveryTerms: "CPT Shenzhen", testingTerms: "AS6081 screen; report before escrow release",
      dateCode: "24+", warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen",
    },
    termsConditions: [
      "Goods must be new, genuine & factory-sealed (no refurbished/remarked)",
      "Full traceability — Certificate of Conformance / manufacturer lot",
      "Test report / CoA supplied along with the shipment",
      "Supplier bears cost on test FAIL (return + re-test)",
    ],
    lines: [
      { mpn: "ADSP-21489KSWZ-4B", make: "Analog Devices", dateCode: "24+", testing: "WHL", qty: 400, buyUnitPrice: 96.25, marginPct: 14, clientPoNo: "KES-2026-0114", clientLineMpn: "ADSP-21489KSWZ-4B" },
      { mpn: "MAX3232ECPE+", make: "Analog Devices", dateCode: "24+", testing: "WHL", qty: 800, buyUnitPrice: 25.5, marginPct: 13, clientPoNo: "KES-2026-0114", clientLineMpn: "MAX3232ECPE+" },
    ],
    buyTotal: 58900, createdBy: "A. Sharma", createdAt: "2026-07-16", status: "ORDERED", orderId: "ord-153",
  },
  {
    id: "spo-144", poNo: "SPO-2026-0144", supplier: { name: "Shenzhen Micro Co", country: "CN" },
    tradeType: "INTERNATIONAL", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testing: "WHL",
    leadTimeDays: 20, testingTimeDays: 5, deliveryTimeDays: 8, relabelCost: 400,
    terms: { referenceNo: "RFQBUNDLE_044210_08_06_2026", paymentMethod: "Advance via T/T into escrow", dispatchedThrough: "DHL", destination: "1Buy hub — New Delhi", deliveryTerms: "Test report along with shipment", dateCode: "23+", warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen" },
    lines: [
      { mpn: "STM32F407VGT6", make: "STMicro", dateCode: "2318", testing: "WHL", qty: 1000, buyUnitPrice: 21.5, marginPct: 14, clientPoNo: "ACME-PO-3210", clientLineMpn: "STM32F407VGT6" },
      { mpn: "TPS54560DDAR", make: "TI", dateCode: "2402", testing: "WHL", qty: 3000, buyUnitPrice: 2.0, marginPct: 10, clientPoNo: "ACME-PO-3210", clientLineMpn: "TPS54560DDAR" },
    ],
    buyTotal: 27500, createdBy: "A. Sharma", createdAt: "2026-06-10", status: "ORDERED", orderId: "ord-144",
  },
  {
    id: "spo-155", poNo: "SPO-2026-0155", supplier: { name: "Pune Traders", country: "IN", gstin: "27AAECP1234R1Z5", state: "Maharashtra" },
    tradeType: "DOMESTIC", currency: "INR", incoterm: "EXW", paymentMode: "ADVANCE", testing: "NONE",
    leadTimeDays: 7, testingTimeDays: 0, deliveryTimeDays: 3,
    terms: { referenceNo: "BEL-DOM/26/PO/81", gstNote: "GST extra @ actual", paymentMethod: "Advance via T/T", testingTerms: "No incoming test — waived by client in writing", warranty: "6 months" },
    lines: [{ mpn: "IRLZ44NPBF", make: "Infineon", dateCode: "25+", testing: "NONE", qty: 4000, buyUnitPrice: 160, marginPct: 11, clientPoNo: "BEL-DOM/26/PO/81", clientLineMpn: "IRLZ44NPBF" }],
    buyTotal: 640000, createdBy: "P. Nair", createdAt: "2026-07-25", status: "ORDERED", orderId: "ord-155",
  },
  {
    id: "spo-201", poNo: "SPO-2026-0201", supplier: { name: "Oleti Development Co", country: "HK", state: "Hong Kong" },
    tradeType: "INTERNATIONAL", currency: "USD", incoterm: "EXW", paymentMode: "ADVANCE", testing: "WHL",
    leadTimeDays: 19, testingTimeDays: 6, deliveryTimeDays: 9,
    terms: {
      referenceNo: "RFQBUNDLE_201773_25_07_2026", paymentMethod: "Advance via T/T", dispatchedThrough: "DHL",
      destination: "1Buy hub — New Delhi", deliveryTerms: "Test report along with shipment", dateCode: "25+",
      warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen & Hong Kong",
      packing: "Packing list + Commercial Invoice; WHSO# on outside box",
    },
    lines: [
      { mpn: "MIC5282-5.0YMME-TR", make: "Microchip", qty: 5000, buyUnitPrice: 300, marginPct: 15, clientPoNo: "GIPL/26-27/PO/121", clientLineMpn: "MIC5282-5.0YMME-TR" },
    ],
    buyTotal: 1500000, createdBy: "You (demo)", createdAt: "2026-07-25", status: "DRAFT",
  },
  {
    id: "spo-202", poNo: "SPO-2026-0202", supplier: { name: "Pune Traders", country: "IN", gstin: "27AAECP1234R1Z5", state: "Maharashtra" },
    tradeType: "DOMESTIC", currency: "INR", incoterm: "EXW", paymentMode: "ADVANCE", testing: "SUPPLIER_SELF",
    leadTimeDays: 7, testingTimeDays: 3, deliveryTimeDays: 4,
    terms: { referenceNo: "PT/26-27/PO/005", paymentMethod: "50% advance", gstNote: "GST extra @ actual", warranty: "6 months" },
    lines: [
      { mpn: "LM317T", make: "TI", qty: 2000, buyUnitPrice: 20, marginPct: 10 }, // unlinked — map to a buyer PO later
    ],
    buyTotal: 40000, createdBy: "You (demo)", createdAt: "2026-07-26", status: "DRAFT",
  },
  // DEMO — international supplier (China), we pay on ESCROW; fully sourced from the domestic client cpo-4 (BEL, ADVANCE). DRAFT → click "Create order".
  {
    id: "spo-221", poNo: "SPO-2026-0221", supplier: { name: "Shenzhen Apex Components Co", country: "CN" },
    tradeType: "INTERNATIONAL", currency: "USD", incoterm: "FOB", paymentMode: "ESCROW", testing: "WHL",
    leadTimeDays: 21, testingTimeDays: 6, deliveryTimeDays: 9,
    terms: {
      referenceNo: "RFQBUNDLE_221904_28_07_2026", paymentMethod: "Advance via T/T into escrow", dispatchedThrough: "DHL",
      destination: "1Buy hub — New Delhi", deliveryTerms: "FOB Shenzhen; onward to 1Buy hub", testingTerms: "WHL report (Shenzhen & HK) before release",
      warranty: "1 year", testFailureBearer: "SUPPLIER", labLocation: "WHL Shenzhen & Hong Kong",
      packing: "Packing list + Commercial Invoice; WHSO# on outside box",
    },
    termsConditions: [
      "Goods must be new, genuine & factory-sealed (no refurbished/remarked)",
      "Full traceability — Certificate of Conformance / manufacturer lot",
      "Date code as specified per line; no mixed date codes without approval",
      "Test report / CoA supplied along with the shipment",
      "Supplier bears cost on test FAIL (return + re-test)",
      "Warranty: 12 months from delivery against defects",
    ],
    relabelCost: 450,
    lines: [
      { mpn: "TMS320F28379DPTPT", make: "TI", dateCode: "24+", testing: "WHL", qty: 800, buyUnitPrice: 29.5, marginPct: 14, clientPoNo: "BEL/26-27/PO/0042", clientLineMpn: "TMS320F28379DPTPT" },
      { mpn: "AD7768-4BSTZ", make: "Analog Devices", dateCode: "24+", testing: "SUPPLIER_SELF", qty: 500, buyUnitPrice: 17.8, marginPct: 15, clientPoNo: "BEL/26-27/PO/0042", clientLineMpn: "AD7768-4BSTZ" },
    ],
    buyTotal: 32500, createdBy: "You (demo)", createdAt: "2026-07-28", status: "DRAFT",
  },
];
