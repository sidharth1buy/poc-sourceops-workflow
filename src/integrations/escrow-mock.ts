// Pure client-side simulation of the escrow-agents backend (src/lib/escrow-api.ts), used only
// when Escrow "Mock" mode is on (see src/lib/escrow-mode.ts) — lets a demo run the full escrow
// lifecycle with zero network calls when the real Python/Postgres/Ollama backend isn't reachable.
//
// Deliberately NOT routed through mock-client.ts's mockCall() — that helper folds in the global
// "chaos" failure-injection toggle, which would undermine the whole point of this fallback (a
// guaranteed-to-work path). Every function here always succeeds, after a small fake delay.
//
// Escrow objects read via useStore.getState() are the live persisted/immer state — never mutate
// them in place (immer freezes produced state in dev). Every function below returns a NEW object
// via spreads; store.ts's existing `set()` calls are what actually commit it.
import type {
  Escrow, EscrowOrderStatus, EscrowSendPurpose, EscrowAgentEmail, MilestoneRelease,
  EscrowInvoice, EscrowFeeBreakdown, EscrowConditions,
} from "@/types";
import type { TickResponse, DraftResponse, SimulateInboundResponse, CreateOnHkinResponse } from "@/lib/escrow-api";
import { DEMO_ESCROW_BANK_ACCOUNT } from "@/integrations/escrow-agent";

const today = () => new Date().toISOString().slice(0, 10);
const nowIso = () => new Date().toISOString();
let _n = 0;
const uid = (p: string) => `${p}-mock-${Date.now().toString(36)}-${(_n++).toString(36)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fakeLatency = () => sleep(250 + Math.random() * 350);

async function currentBundle(orderId: string) {
  const { useStore } = await import("@/store/store");
  return useStore.getState().orders[orderId];
}

async function requireEscrow(orderId: string): Promise<Escrow> {
  const b = await currentBundle(orderId);
  if (!b?.escrow) throw new Error(`Mock escrow: no order/escrow found for ${orderId}`);
  return b.escrow;
}

function withEmail(e: Escrow, direction: "SENT" | "RECEIVED", subject: string, snippet: string, from: string, to?: string): Escrow {
  const email: EscrowAgentEmail = { id: uid("em"), direction, subject, from, to, snippet, receivedAt: today() };
  return { ...e, agentEmails: [...e.agentEmails, email] };
}

function buildInvoice(e: Escrow): EscrowInvoice {
  const feeToBuyer = Math.round(e.poAmount * 0.00856); // same ratio scaffoldBundle uses for agreedFeeToBuyer
  return {
    invoiceNo: `INV-MOCK-${e.id.slice(-6).toUpperCase()}`,
    fees: {
      poTotal: e.poAmount, feeToBuyer,
      wiringFeeToBuyer: Math.round(e.poAmount * 0.0057),
      feeToSeller: Math.round(feeToBuyer * 0.5), wiringFeeToSeller: 25,
    },
    conditions: e.agreedConditions ?? {
      forwarder: "FedEx", shipWithinDays: "15 business days", inspectionPeriod: "7 business days",
      feeSharingLabel: "100% Buyer / 0% Seller", returnCondition: "7 business days, shipping fees to Seller",
      releaseMilestones: [{ percent: 100, trigger: "WHL_PASS" }],
    },
    bankAccount: DEMO_ESCROW_BANK_ACCOUNT,
    receivedAt: today(),
  };
}

// Mirrors the real orchestrator's documented rule: "any pending milestone confirmation wins
// regardless of status" — used both by a plain tick() and as simulateInbound()'s first check.
function confirmPendingMilestone(e: Escrow): { changed: boolean; allConfirmed?: boolean; escrow: Escrow } {
  const idx = e.milestoneReleases.findIndex((m) => m.instructedAt && !m.confirmedAt);
  if (idx < 0) return { changed: false, escrow: e };
  const releases = e.milestoneReleases.map((m, i) => (i === idx ? { ...m, confirmedAt: nowIso() } : m));
  const total = e.invoice?.conditions.releaseMilestones.length ?? 0;
  const allConfirmed = total > 0 && releases.filter((m) => m.confirmedAt).length >= total;
  let next: Escrow = { ...e, milestoneReleases: releases };
  if (allConfirmed) next = { ...next, status: "RELEASED_TO_SELLER" };
  next = withEmail(next, "RECEIVED", "Milestone released", `HKin confirms milestone ${idx + 1} released to the seller.`, "billing@hkin-escrow.example");
  return { changed: true, allConfirmed, escrow: next };
}

type TickAction = "advanced" | "waiting" | "blocked" | "nothing";

function simulateInbound(e: Escrow, verdict?: "PASS" | "FAIL", needsTesting?: boolean): { action: TickAction; detail: string; escrow: Escrow } {
  if (e.cancelledAt) return { action: "blocked", detail: "This escrow order was cancelled.", escrow: e };

  if (verdict && e.status === "RECIPIENT_INSPECTION") {
    const whlReportRef = `WHL-MOCK-${e.id.slice(-6).toUpperCase()}`;
    const next = withEmail({ ...e, whlVerdict: verdict, whlVerdictAt: nowIso(), whlReportRef },
      "RECEIVED", `WHL verdict: ${verdict}`, `WHL reports ${verdict} — report ${whlReportRef} attached.`, "reports@whl-labs.example");
    return { action: "advanced", detail: `WHL reported ${verdict}.`, escrow: next };
  }

  const m = confirmPendingMilestone(e);
  if (m.changed) {
    return { action: "advanced", detail: m.allConfirmed ? "Milestone confirmed by HKin — funds fully released!" : "Milestone confirmed by HKin.", escrow: m.escrow };
  }

  switch (e.status) {
    case "DRAFT":
      return { action: "nothing", detail: "Nothing pending — send the order to the seller first.", escrow: e };
    case "SENT_FOR_SELLER_CONFIRMATION": {
      const next = withEmail({ ...e, status: "SELLER_CONFIRMED" }, "RECEIVED", "Seller accepted the order",
        `${e.sellerContact.company} has accepted the order terms.`, e.sellerContact.email || "seller@example.com");
      return { action: "advanced", detail: "Seller confirmed the order.", escrow: next };
    }
    case "SELLER_CONFIRMED": {
      const invoice = buildInvoice(e);
      const next = withEmail({ ...e, status: "ESCROW_FEE_INVOICED", invoice }, "RECEIVED", `Escrow invoice ${invoice.invoiceNo}`,
        "Please find attached the escrow invoice for this order.", "billing@hkin-escrow.example");
      return { action: "advanced", detail: "HKin issued the escrow invoice.", escrow: next };
    }
    case "ESCROW_FEE_INVOICED": {
      if (e.paymentInstructedAt && !e.financeConfirmedAt) {
        const financeSwiftReference = `MOCKSWIFT${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        const next = withEmail({ ...e, financeConfirmedAt: nowIso(), financeSwiftReference }, "RECEIVED", "Payment made",
          `Finance confirms payment sent — SWIFT ref ${financeSwiftReference}.`, "finance@sharpbuy.demo");
        return { action: "advanced", detail: "Finance confirmed payment — SWIFT reference attached.", escrow: next };
      }
      if (e.paymentSentToHkinAt) {
        const next = withEmail({ ...e, status: "TT_PAYMENT_RECEIVED", fundedAt: nowIso() }, "RECEIVED", "Escrow payment received",
          "HKin confirms the escrow payment has been received.", "billing@hkin-escrow.example");
        return { action: "advanced", detail: "HKin confirmed the escrow payment was received.", escrow: next };
      }
      return { action: "waiting", detail: "Waiting on Finance to instruct/confirm payment.", escrow: e };
    }
    case "TT_PAYMENT_RECEIVED": {
      const next = withEmail({ ...e, status: "GOODS_SHIPPED" }, "RECEIVED", "Shipment notice",
        `${e.sellerContact.company} has shipped the goods.`, e.sellerContact.email || "seller@example.com");
      return { action: "advanced", detail: "Supplier's shipment notice received.", escrow: next };
    }
    case "GOODS_SHIPPED": {
      // Any testing (WHL-lab or supplier-self-test) means the supplier ships to WHL first; only
      // once testing clears does a separate onward shipment go to 1Buy's own hub. Only NONE-testing
      // lines skip WHL and ship straight to 1Buy's hub.
      const next = needsTesting
        ? withEmail({ ...e, status: "RECIPIENT_INSPECTION", goodsReceivedAt: nowIso() }, "RECEIVED", "Goods received",
            "WHL confirms physical receipt of the goods for testing.", "reports@whl-labs.example")
        : withEmail({ ...e, status: "RECIPIENT_INSPECTION", goodsReceivedAt: nowIso() }, "RECEIVED", "Goods received",
            "1Buy's hub confirms physical receipt of the goods.", "hub@1buy.example");
      return { action: "advanced", detail: needsTesting ? "Goods received at WHL — testing can begin." : "Goods received at 1Buy's hub — inspection can begin.", escrow: next };
    }
    case "RECIPIENT_INSPECTION": {
      if (e.whlVerdict === "FAIL" && !e.refundRequestedAt) {
        const next = withEmail({ ...e, refundRequestedAt: nowIso() }, "RECEIVED", "Refund requested",
          "Client has asked for a refund instead of a retest.", "client@example.com");
        return { action: "advanced", detail: "Client asked for a refund instead of a retest.", escrow: next };
      }
      if (!e.whlVerdict) return { action: "waiting", detail: "Waiting on WHL's test report / buyer's decision.", escrow: e };
      return { action: "nothing", detail: "Nothing new — waiting on the next release milestone.", escrow: e };
    }
    case "RELEASED_TO_SELLER":
      return { action: "nothing", detail: "Escrow complete — nothing more to check.", escrow: e };
    default:
      return { action: "nothing", detail: "Nothing to check.", escrow: e };
  }
}

export async function mockSimulateNextInbound(orderId: string, verdict?: "PASS" | "FAIL"): Promise<SimulateInboundResponse> {
  await fakeLatency();
  const b = await currentBundle(orderId);
  const e = await requireEscrow(orderId);
  const needsTesting = !!b?.lines.some((l) => l.testingMode !== "NONE");
  const { action, detail, escrow } = simulateInbound(e, verdict, needsTesting);
  return { action, detail, data: {}, escrow };
}

// Only the priority-1 milestone-confirmation check — never fabricates an inbound message (that's
// simulateNextInbound's job). Matches the real backend's tick()/simulate-next-inbound split, and
// is what keeps this safe to call as a "make sure the draft exists" no-op before sendEscrowDraft.
export async function mockTickEscrowOrder(orderId: string): Promise<TickResponse> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  const m = confirmPendingMilestone(e);
  return {
    action: m.changed ? "advanced" : "nothing",
    detail: m.changed ? (m.allConfirmed ? "Milestone confirmed — funds fully released!" : "Milestone confirmed by HKin.") : "Nothing to sync.",
    data: {}, escrow: m.escrow,
  };
}

const PENDING_SEND_PURPOSES: { purpose: EscrowSendPurpose; test: (e: Escrow) => boolean }[] = [
  { purpose: "ORDER_TO_SELLER", test: (e) => e.status === "DRAFT" },
  { purpose: "PAYMENT_INSTRUCTION_TO_FINANCE", test: (e) => e.status === "ESCROW_FEE_INVOICED" && !e.paymentInstructedAt },
  { purpose: "PAYMENT_CONFIRMATION_TO_HKIN", test: (e) => !!e.paymentInstructedAt && !!e.financeSwiftReference && !e.paymentSentToHkinAt },
  { purpose: "REFUND_INSTRUCTION", test: (e) => e.whlVerdict === "FAIL" && !!e.goodsReturnedAt && !e.refundInstructedAt },
];

function stubDraft(orderId: string, purpose: EscrowSendPurpose, milestoneIndex?: number): DraftResponse {
  return {
    id: `mock:${orderId}:${purpose}${milestoneIndex != null ? `:${milestoneIndex}` : ""}`,
    purpose, milestoneIndex, to: "", subject: purpose, body: "", status: "DRAFT", createdAt: nowIso(),
  };
}

export async function mockListEscrowDrafts(orderId: string): Promise<DraftResponse[]> {
  await fakeLatency();
  const b = await currentBundle(orderId);
  const e = b?.escrow;
  if (!b || !e) return [];
  const drafts: DraftResponse[] = PENDING_SEND_PURPOSES.filter(({ test }) => test(e)).map(({ purpose }) => stubDraft(orderId, purpose));
  if (e.invoice) {
    const { escrowMilestoneTriggerMet } = await import("@/store/selectors");
    e.invoice.conditions.releaseMilestones.forEach((rm, i) => {
      const already = e.milestoneReleases.some((r) => r.index === i);
      if (!already && escrowMilestoneTriggerMet(b, rm.trigger)) drafts.push(stubDraft(orderId, "RELEASE_FUNDS_INSTRUCTION", i));
    });
  }
  return drafts;
}

export async function mockSendEscrowDraft(
  draftId: string,
  input: { reviewedBy: string; to?: string; cc?: string; subject?: string; body?: string },
): Promise<{ draft: DraftResponse; escrow: Escrow }> {
  await fakeLatency();
  const [tag, orderId, purpose, indexStr] = draftId.split(":");
  if (tag !== "mock" || !orderId || !purpose) throw new Error(`Mock escrow: unrecognized draft id ${draftId}`);
  const e = await requireEscrow(orderId);
  const milestoneIndex = indexStr !== undefined ? Number(indexStr) : undefined;

  let next: Escrow = e;
  switch (purpose) {
    case "ORDER_TO_SELLER":
      next = { ...e, status: "SENT_FOR_SELLER_CONFIRMATION" as EscrowOrderStatus };
      break;
    case "PAYMENT_INSTRUCTION_TO_FINANCE":
      next = { ...e, paymentInstructedAt: nowIso() };
      break;
    case "PAYMENT_CONFIRMATION_TO_HKIN":
      next = { ...e, paymentSentToHkinAt: nowIso() };
      break;
    case "REFUND_INSTRUCTION":
      next = { ...e, refundInstructedAt: nowIso() };
      break;
    case "RELEASE_FUNDS_INSTRUCTION": {
      const idx = milestoneIndex ?? 0;
      const releases: MilestoneRelease[] = [...e.milestoneReleases, { index: idx, instructedAt: nowIso() }];
      next = { ...e, milestoneReleases: releases };
      break;
    }
    case "REQUEST_EXTENSION":
    default:
      break; // no field change — just the logged email below
  }
  next = withEmail(next, "SENT", input.subject || purpose, input.body || `Sent (mock): ${purpose}`, "you@sharpbuy.demo", input.to);

  const draft: DraftResponse = {
    id: draftId, purpose, milestoneIndex, to: input.to ?? "", cc: input.cc, subject: input.subject ?? purpose,
    body: input.body ?? "", status: "SENT", createdAt: nowIso(), sentAt: nowIso(),
  };
  return { draft, escrow: next };
}

export async function mockCreateOnHkin(): Promise<CreateOnHkinResponse> {
  await fakeLatency();
  return { started: true, startedAt: nowIso() };
}

export async function mockUploadEscrowInvoiceManually(
  orderId: string,
  input: { invoiceNo: string; fees: EscrowFeeBreakdown; conditions: EscrowConditions },
): Promise<Escrow> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  const invoice: EscrowInvoice = { invoiceNo: input.invoiceNo, fees: input.fees, conditions: input.conditions, bankAccount: DEMO_ESCROW_BANK_ACCOUNT, receivedAt: today() };
  let next: Escrow = { ...e, invoice };
  if (next.status === "SELLER_CONFIRMED") next = { ...next, status: "ESCROW_FEE_INVOICED" };
  return withEmail(next, "RECEIVED", `Escrow invoice ${input.invoiceNo}`, "Manually uploaded invoice attached.", "billing@hkin-escrow.example");
}

export async function mockCancelEscrowOrder(orderId: string): Promise<Escrow> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  return { ...e, cancelledAt: nowIso() };
}

export async function mockMarkApplicationRejected(orderId: string): Promise<Escrow> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  return { ...e, applicationRejectedAt: nowIso() };
}

export async function mockRecordRma(
  orderId: string,
  input: { rmaDetails?: string; goodsReturnTracking?: string; markReturned?: boolean },
): Promise<Escrow> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  if (input.markReturned) return { ...e, goodsReturnedAt: nowIso() };
  return { ...e, rmaDetails: input.rmaDetails ?? e.rmaDetails, goodsReturnTracking: input.goodsReturnTracking ?? e.goodsReturnTracking };
}

export async function mockAcceptGoods(orderId: string): Promise<Escrow> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  const whlReportRef = e.whlReportRef ?? `WHL-MOCK-${orderId.slice(-6).toUpperCase()}`;
  return { ...e, whlVerdict: "PASS", whlVerdictAt: nowIso(), whlReportRef };
}

export async function mockRejectGoods(orderId: string, input: { reason: string }): Promise<Escrow> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  return { ...e, whlVerdict: "FAIL", whlVerdictAt: nowIso(), whlRawConclusion: input.reason, refundRequestedAt: nowIso() };
}

export async function mockRequestExtension(orderId: string): Promise<{ draftId: string; escrow: Escrow }> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  return { draftId: `mock:${orderId}:REQUEST_EXTENSION`, escrow: e };
}

export async function mockSimulateDeadlineReminder(orderId: string): Promise<{ escrow: Escrow }> {
  await fakeLatency();
  const e = await requireEscrow(orderId);
  const deadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const next = withEmail({ ...e, inspectionDeadline: deadline }, "RECEIVED", "Inspection deadline reminder",
    `Please complete inspection by ${deadline.slice(0, 10)}.`, "ops@hkin.example");
  return { escrow: next };
}
