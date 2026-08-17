// Declarative catalogue of the external systems the real project integrates.
// Drives the Integrations console and documents where each API plugs in.

export type IntegrationPriority = "must" | "should" | "nice";

export interface IntegrationEndpoint {
  method: string;
  path: string;
  purpose: string;
}

export interface IntegrationSystem {
  key: string;
  label: string;
  category: string;
  priority: IntegrationPriority;
  criticalPath: boolean; // true if a journey gate depends on it
  envVar: string;
  baseUrl: string;
  description: string;
  wiredInto: string[]; // store actions that call it
  endpoints: IntegrationEndpoint[];
}

export const INTEGRATIONS: IntegrationSystem[] = [
  {
    key: "escrow-agent",
    label: "Escrow Agent (invoice inbox)",
    category: "Money",
    priority: "must",
    criticalPath: true,
    envVar: "NEXT_PUBLIC_ESCROW_AGENT_URL",
    baseUrl: "https://sandbox.escrow-agent.example/api/v1",
    description: "Watches the escrow provider's billing inbox for invoice emails, matches them to the order, and extracts the fee breakdown + conditions (modelled on HKin.com). Manual upload stays available as a fallback when the agent misses an email.",
    wiredInto: ["simulateEscrowInvoiceEmail"],
    endpoints: [
      { method: "GET", path: "/inbox/latest", purpose: "poll the provider mailbox for the next escrow invoice email" },
    ],
  },
  {
    key: "banking",
    label: "Banking / T-T rails",
    category: "Money",
    priority: "must",
    criticalPath: true,
    envVar: "NEXT_PUBLIC_BANKING_API_BASE_URL",
    baseUrl: "https://sandbox.bank-partner.example/api/v1",
    description: "Two independent rails with Sharpbuy as the sole pivot: client collection (CLIENT_TO_1BUY) and supplier payout (1BUY_TO_SUPPLIER). The bank never joins the counterparties.",
    wiredInto: ["initiatePaymentTransfer", "setPaymentStatus"],
    endpoints: [
      { method: "POST", path: "/transfers/collection", purpose: "initiate client pay-in (T/T)" },
      { method: "POST", path: "/transfers/payout", purpose: "initiate supplier payout" },
      { method: "GET", path: "/transfers/:ref", purpose: "poll clearing status" },
    ],
  },
  {
    key: "whl",
    label: "WHL Lab",
    category: "Quality",
    priority: "must",
    criticalPath: true,
    envVar: "NEXT_PUBLIC_WHL_API_BASE_URL",
    baseUrl: "https://api.whl-labs.example/v1",
    description: "Authenticity + quality testing. The lab PASS gates the TESTING journey step (escrow release runs on its own state machine — see the Escrow tab).",
    wiredInto: ["addLot", "fetchLabResult"],
    endpoints: [
      { method: "POST", path: "/work-orders", purpose: "submit a lot for testing" },
      { method: "GET", path: "/work-orders/:wo/report", purpose: "poll for PASS/FAIL/INCONCLUSIVE" },
    ],
  },
  {
    key: "icegate",
    label: "ICEGATE Customs",
    category: "Customs",
    priority: "must",
    criticalPath: true,
    envVar: "NEXT_PUBLIC_ICEGATE_BASE_URL",
    baseUrl: "https://icegate-mock.sandbox.1buy.ai/api",
    description: "Indian Customs EDI: Bill of Entry filing, duty assessment (BCD+SWS+IGST), and the FEMA/ICEGATE ref that closes the import loop. On the critical path for every INTERNATIONAL and A19 order.",
    wiredInto: ["fileBOE"],
    endpoints: [
      { method: "POST", path: "/bill-of-entry", purpose: "file BOE" },
      { method: "GET", path: "/bill-of-entry/:be/assessment", purpose: "duty assessment" },
      { method: "GET", path: "/bill-of-entry/:be/clearance", purpose: "OOC + ICEGATE ref" },
    ],
  },
  {
    key: "einvoice",
    label: "GST e-Invoice / IRP",
    category: "Tax",
    priority: "must",
    criticalPath: true,
    envVar: "NEXT_PUBLIC_IRP_BASE_URL",
    baseUrl: "https://einv-apisandbox.nic.in",
    description: "NIC Invoice Registration Portal (via GSP). Generates the IRN + signed QR that makes the client tax invoice legal and unlocks dispatch. Seller is always the masking entity — supplier never appears.",
    wiredInto: ["generateEInvoice"],
    endpoints: [
      { method: "POST", path: "/invoice", purpose: "generate IRN + signed QR" },
      { method: "POST", path: "/invoice/cancel", purpose: "cancel IRN (24h window)" },
    ],
  },
  {
    key: "logistics",
    label: "Logistics (DHL/FedEx/Delhivery)",
    category: "Logistics",
    priority: "should",
    criticalPath: false,
    envVar: "NEXT_PUBLIC_LOGISTICS_API_BASE_URL",
    baseUrl: "https://sandbox.carrier-aggregator.example/api",
    description: "Per-carrier registry: book an AWB on shipment create and poll tracking checkpoints, mapping carrier-native codes to ShipmentStatus. Inbound AWB never shown to client; outbound never to supplier.",
    wiredInto: ["createShipment", "pollShipmentTracking"],
    endpoints: [
      { method: "POST", path: "/shipments", purpose: "book AWB + label" },
      { method: "GET", path: "/shipments/:awb/tracking", purpose: "checkpoints + status" },
    ],
  },
  {
    key: "doc-extract",
    label: "Doc Extraction (OCR + LLM)",
    category: "Intake",
    priority: "should",
    criticalPath: false,
    envVar: "NEXT_PUBLIC_DOC_EXTRACT_URL",
    baseUrl: "https://doc-ai.sandbox.1buy.ai/api",
    description: "Demand capture: parse an uploaded sales order / supplier PI into structured fields + line items with per-field confidence (mirrors 1Buy's BOM-upload pattern).",
    wiredInto: ["Sales Order → New → Parse"],
    endpoints: [
      { method: "POST", path: "/extract/client-po", purpose: "parse a sales order document" },
    ],
  },
];

export const integrationByKey = (key: string) => INTEGRATIONS.find((i) => i.key === key);
