// Real backend client for the escrow-agents Python service (FastAPI + Postgres +
// Ollama). Unlike src/integrations/*.ts (in-memory mocks with fake latency),
// these calls hit an actual running server — see escrow-agents/README.md.
//
// Response shapes are already camelCase and match src/types/index.ts's Escrow
// interface field-for-field (the backend was built to mirror it), so callers
// can drop the response straight into `orders[orderId].escrow` with no mapping.
import type { Escrow, EscrowConditions, EscrowFeeBreakdown } from "@/types";
import { isEscrowMockMode } from "@/lib/escrow-mode";
import {
  mockSimulateNextInbound, mockTickEscrowOrder, mockListEscrowDrafts, mockSendEscrowDraft,
  mockCreateOnHkin, mockUploadEscrowInvoiceManually, mockCancelEscrowOrder, mockMarkApplicationRejected,
  mockRecordRma, mockAcceptGoods, mockRejectGoods, mockRequestExtension, mockSimulateDeadlineReminder,
} from "@/integrations/escrow-mock";

export const ESCROW_API_BASE = process.env.NEXT_PUBLIC_ESCROW_API_URL ?? "http://localhost:8000";
const BASE = ESCROW_API_BASE;

export class EscrowApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new EscrowApiError(`Can't reach the escrow-agents backend at ${BASE} — is it running? (uvicorn escrow_agents.api:app --port 8000)`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new EscrowApiError(`escrow-agents API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface TickResponse {
  action: "drafted" | "advanced" | "waiting" | "blocked" | "nothing";
  detail: string;
  data: { draftId?: string; awaitingPurpose?: string };
  escrow: Escrow;
}

export interface DraftResponse {
  id: string; purpose: string; milestoneIndex?: number;
  to: string; cc?: string; subject: string; body: string;
  status: string; createdAt: string; sentAt?: string;
}

export function getEscrowOrder(orderId: string): Promise<Escrow> {
  return call<Escrow>(`/escrow/orders/${orderId}`);
}

export function createEscrowOrder(input: {
  orderId: string; poAmount: number; currency: string; useInspectionService: boolean;
  agreedFeeToBuyer?: number;
  buyerContact?: EscrowContactIn; sellerContact?: EscrowContactIn; recipient?: EscrowContactIn;
}): Promise<Escrow> {
  return call<Escrow>("/escrow/orders", { method: "POST", body: JSON.stringify(input) });
}

interface EscrowContactIn { company: string; registeredAddress?: string; country?: string; contactPerson?: string; email?: string; phone?: string; im?: string; }

export function tickEscrowOrder(orderId: string): Promise<TickResponse> {
  if (isEscrowMockMode()) return mockTickEscrowOrder(orderId);
  return call<TickResponse>(`/escrow/orders/${orderId}/tick`, { method: "POST" });
}

export function listEscrowDrafts(orderId: string): Promise<DraftResponse[]> {
  if (isEscrowMockMode()) return mockListEscrowDrafts(orderId);
  return call<DraftResponse[]>(`/escrow/orders/${orderId}/drafts`);
}

export function sendEscrowDraft(
  draftId: string,
  input: { reviewedBy: string; to?: string; cc?: string; subject?: string; body?: string },
): Promise<{ draft: DraftResponse; escrow: Escrow }> {
  if (isEscrowMockMode()) return mockSendEscrowDraft(draftId, input);
  return call(`/escrow/drafts/${draftId}/send`, { method: "POST", body: JSON.stringify(input) });
}

export function cancelEscrowOrder(orderId: string): Promise<Escrow> {
  if (isEscrowMockMode()) return mockCancelEscrowOrder(orderId);
  return call<Escrow>(`/escrow/orders/${orderId}/cancel`, { method: "POST" });
}

export interface CreateOnHkinResponse { started: boolean; startedAt: string; }

export function createOnHkin(
  orderId: string,
  input: { forwarder: string; lines: { partNumber: string; brand?: string; quantity: number; unitPrice: number; remarks?: string }[] },
): Promise<CreateOnHkinResponse> {
  if (isEscrowMockMode()) return mockCreateOnHkin();
  return call<CreateOnHkinResponse>(`/escrow/orders/${orderId}/create-on-hkin`, { method: "POST", body: JSON.stringify(input) });
}

export function uploadEscrowInvoiceManually(
  orderId: string,
  input: { invoiceNo: string; fees: EscrowFeeBreakdown; conditions: EscrowConditions },
): Promise<Escrow> {
  if (isEscrowMockMode()) return mockUploadEscrowInvoiceManually(orderId, input);
  return call<Escrow>(`/escrow/orders/${orderId}/invoice/manual`, { method: "POST", body: JSON.stringify(input) });
}

export interface SimulateInboundResponse extends TickResponse {
  ingest?: { classification: { status: string; purpose?: string; confidence?: number }; extraction?: { status: string; confidence?: number }; reconciliation?: { checkType: string; passed: boolean }[] };
}

export function simulateNextInbound(orderId: string, verdict?: "PASS" | "FAIL"): Promise<SimulateInboundResponse> {
  if (isEscrowMockMode()) return mockSimulateNextInbound(orderId, verdict);
  return call<SimulateInboundResponse>(`/escrow/orders/${orderId}/simulate-next-inbound`, {
    method: "POST",
    body: JSON.stringify(verdict ? { verdict } : {}),
  });
}

// ---- real HKin portal evidence (2026-08-12 session) — see Escrow's fields in @/types ----

export function markApplicationRejected(orderId: string): Promise<Escrow> {
  if (isEscrowMockMode()) return mockMarkApplicationRejected(orderId);
  return call<Escrow>(`/escrow/orders/${orderId}/application-rejected`, { method: "POST" });
}

// Demo/dev button — HKin's real deadline-reminder email is an independent signal, not
// something simulate-next-inbound's awaiting-purpose mechanism can produce (see api.py).
export function simulateDeadlineReminder(orderId: string): Promise<{ escrow: Escrow }> {
  if (isEscrowMockMode()) return mockSimulateDeadlineReminder(orderId);
  return call(`/escrow/orders/${orderId}/simulate-deadline-reminder`, { method: "POST" });
}

export function recordRma(
  orderId: string,
  input: { rmaDetails?: string; goodsReturnTracking?: string; markReturned?: boolean },
): Promise<Escrow> {
  if (isEscrowMockMode()) return mockRecordRma(orderId, input);
  return call<Escrow>(`/escrow/orders/${orderId}/rma`, { method: "POST", body: JSON.stringify(input) });
}

export function acceptGoods(orderId: string, input: { partial?: boolean; note?: string }): Promise<Escrow> {
  if (isEscrowMockMode()) return mockAcceptGoods(orderId);
  return call<Escrow>(`/escrow/orders/${orderId}/accept-goods`, { method: "POST", body: JSON.stringify(input) });
}

export function rejectGoods(orderId: string, input: { reason: string }): Promise<Escrow> {
  if (isEscrowMockMode()) return mockRejectGoods(orderId, input);
  return call<Escrow>(`/escrow/orders/${orderId}/reject-goods`, { method: "POST", body: JSON.stringify(input) });
}

export function requestExtension(orderId: string, input: { reason: string }): Promise<{ draftId: string; escrow: Escrow }> {
  if (isEscrowMockMode()) return mockRequestExtension(orderId);
  return call(`/escrow/orders/${orderId}/request-extension`, { method: "POST", body: JSON.stringify(input) });
}
