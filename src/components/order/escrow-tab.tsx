"use client";

import { useState, type ReactNode } from "react";
import { Upload, Check, Lock, Ban, Send, Inbox, PlayCircle, Mail } from "lucide-react";
import type { OrderBundle, EscrowOrderStatus, EscrowAgentEmail, EscrowContact, EscrowSendPurpose } from "@/types";
import { ESCROW_STATUS_ORDER, prettyStatus } from "@/data/enums";
import { Panel, Field, DataTable, StatusPill, Pill, Button, type Col } from "@/components/ui/primitives";
import { Dialog } from "@/components/ui/dialog";
import { Labeled, Input, Textarea } from "@/components/ui/form";
import { money, qtyfmt, cn } from "@/lib/utils";
import { useStore, type EscrowEmailDraft } from "@/store/store";
import { escrowInvoiceTotals, escrowFeeReconciliation, escrowStatusIndex, escrowMilestoneTriggerMet } from "@/store/selectors";
import { ESCROW_API_BASE } from "@/lib/escrow-api";

type Compose = (purpose: EscrowSendPurpose, milestoneIndex?: number) => void;

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{text}</div>;
}

// Strict linear progression, Draft → Released to Seller — no backward moves, no branching (spec §3).
function EscrowStepper({ status }: { status: EscrowOrderStatus }) {
  const idx = escrowStatusIndex(status);
  return (
    <ol className="no-scrollbar flex items-start gap-0 overflow-x-auto pb-1">
      {ESCROW_STATUS_ORDER.map((s, i) => {
        const done = i < idx;
        const current = i === idx;
        const node = done ? "border-primary bg-primary text-primary-foreground"
          : current ? "border-primary text-primary ring-2 ring-accent-soft" : "border-border text-faint";
        return (
          <li key={s} className="flex min-w-[110px] flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", i === 0 ? "opacity-0" : done ? "bg-primary" : "bg-border")} />
              <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold", node)}>
                {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={cn("h-0.5 flex-1", i === ESCROW_STATUS_ORDER.length - 1 ? "opacity-0" : done ? "bg-primary" : "bg-border")} />
            </div>
            <span className={cn("mt-1 px-1 text-center text-[10px] leading-tight", current ? "font-medium text-foreground" : "text-muted-foreground")}>
              {prettyStatus(s)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Shared card for Buyer / Seller / Recipient — same shape (company, address, contact, email, phone, IM).
function ContactPanel({ title, contact, action }: { title: string; contact: EscrowContact; action?: ReactNode }) {
  return (
    <Panel title={title} actions={action}>
      <Field label="Company">{contact.company}</Field>
      <Field label="Registered address">{contact.registeredAddress}</Field>
      <Field label="Country / Region">{contact.country}</Field>
      <Field label="Contact person">{contact.contactPerson}</Field>
      <Field label="Email">{contact.email}</Field>
      <Field label="Phone">{contact.phone}</Field>
      <Field label="Instant messaging">{contact.im}</Field>
    </Panel>
  );
}

function PurchaseOrderPanel({ b, id, onUploadPI, onUploadDoc }: { b: OrderBundle; id: string; onUploadPI: () => void; onUploadDoc: () => void }) {
  const simulateEscrowPoPiFetch = useStore((s) => s.simulateEscrowPoPiFetch);
  const hasPoDoc = b.documents.some((d) => d.docType === "PO");
  const cols: Col<OrderBundle["lines"][number]>[] = [
    { key: "mpn", header: "Part / Description", render: (l) => <span className="font-mono text-xs">{l.mpn}</span> },
    { key: "brand", header: "Brand / Date code", render: (l) => `${l.make} / ${l.dateCode}` },
    { key: "qty", header: "Quantity", align: "right", render: (l) => qtyfmt(l.quantity) },
    { key: "price", header: "Unit price", align: "right", render: (l) => money(l.unitPrice, l.currency) },
    { key: "amt", header: "Amount", align: "right", render: (l) => money(l.quantity * l.unitPrice, l.currency) },
  ];
  const itemsAmount = b.lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const otherCharges = b.escrow!.poAmount - itemsAmount;
  return (
    <Panel title="Purchase order">
      <DataTable columns={cols} rows={b.lines} />
      <div className="mt-3 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <Field label="Items amount">{money(itemsAmount, b.currency)}</Field>
        <Field label="Other charges">{money(otherCharges, b.currency)}</Field>
        <Field label="Total amount">{money(b.escrow!.poAmount, b.currency)}</Field>
        <Field label="Proforma invoice">{b.piNo ?? "awaiting PI"}</Field>
      </div>
      {(!hasPoDoc || !b.piNo) && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => simulateEscrowPoPiFetch(id)}><Inbox className="h-4 w-4" /> Fetch PO / PI</Button>
          {!hasPoDoc && <Button variant="ghost" onClick={onUploadDoc}><Upload className="h-4 w-4" /> Upload PO</Button>}
          {!b.piNo && <Button variant="ghost" onClick={onUploadPI}><Upload className="h-4 w-4" /> Upload PI</Button>}
        </div>
      )}
    </Panel>
  );
}

function InvoicePanel({
  b, id, onUploadInvoice, onCompose,
}: { b: OrderBundle; id: string; onUploadInvoice: () => void; onCompose: Compose }) {
  const [showConditions, setShowConditions] = useState(false);
  const simulateEscrowInvoiceEmail = useStore((s) => s.simulateEscrowInvoiceEmail);
  const e = b.escrow!;
  const sellerAccepted = escrowStatusIndex(e.status) >= escrowStatusIndex("SELLER_CONFIRMED");

  if (!e.invoice) {
    return (
      <Panel title="Escrow invoice">
        <Empty text={sellerAccepted ? "No invoice yet — arrives once HKin invoices the order, or fetch the same details from the Order document instead of waiting." : "The invoice only arrives once the seller has accepted the order — see the step above."} />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => simulateEscrowInvoiceEmail(id)} disabled={!sellerAccepted}><Inbox className="h-4 w-4" /> Fetch from Escrow Agent</Button>
          <Button variant="outline" onClick={onUploadInvoice} disabled={!sellerAccepted}><Upload className="h-4 w-4" /> Upload invoice / Order</Button>
        </div>
      </Panel>
    );
  }

  const f = e.invoice.fees;
  const totals = escrowInvoiceTotals(f);
  const recon = escrowFeeReconciliation(b);
  const bank = e.invoice.bankAccount;

  return (
    <Panel title="Escrow invoice" actions={<span className="font-mono text-xs text-muted-foreground">{e.invoice.invoiceNo}</span>}>
      <Field label="Purchase order total">{money(f.poTotal, e.currency)}</Field>
      <Field label="Escrow fee to buyer (non-refundable)">{money(f.feeToBuyer, e.currency)}</Field>
      <Field label="Wiring (T/T) fee to buyer">{money(f.wiringFeeToBuyer, e.currency)}</Field>
      <Field label="Escrow fee to seller (non-refundable)">{money(f.feeToSeller, e.currency)}</Field>
      <Field label="Wiring (T/T) fee to seller">{money(f.wiringFeeToSeller, e.currency)}</Field>

      <div className="no-scrollbar mt-3 overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-card-2">
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"></th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Buyer will pay</th>
              <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Seller will receive</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b"><td className="px-3 py-2">Total purchase order amount</td><td className="px-3 py-2 text-right tnum">{money(f.poTotal, e.currency)}</td><td className="px-3 py-2 text-right tnum">{money(f.poTotal, e.currency)}</td></tr>
            <tr className="border-b"><td className="px-3 py-2">Escrow fee</td><td className="px-3 py-2 text-right tnum">{money(f.feeToBuyer, e.currency)}</td><td className="px-3 py-2 text-right tnum">{money(f.feeToSeller, e.currency)}</td></tr>
            <tr><td className="px-3 py-2">T/T fee</td><td className="px-3 py-2 text-right tnum">{money(f.wiringFeeToBuyer, e.currency)}</td><td className="px-3 py-2 text-right tnum">{money(f.wiringFeeToSeller, e.currency)}</td></tr>
            <tr className="border-t font-semibold"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right tnum">{money(totals.totalBuyerTT, e.currency)}</td><td className="px-3 py-2 text-right tnum">{money(totals.totalDisbursedToSeller, e.currency)}</td></tr>
          </tbody>
        </table>
      </div>

      {recon && (
        <div className={cn("mt-3 rounded-lg border p-2.5 text-xs",
          recon.match ? "border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-ok-bg text-ok" : "border-[color-mix(in_srgb,var(--bad)_40%,transparent)] bg-bad-bg text-bad")}>
          {recon.match
            ? "Matches the Purchase Order's PO amount and the fee schedule agreed at order time — no discrepancy to flag."
            : `This invoice charges ${money(recon.invoiceFee, e.currency)} escrow fee, but the purchase order agreed ${money(recon.agreedFee, e.currency)}. Flag with the provider before remitting.`}
        </div>
      )}

      <div className="mt-3 rounded-lg border bg-accent-soft/40 p-2.5">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment-release milestones</div>
        <ul className="space-y-1 text-sm">
          {e.invoice.conditions.releaseMilestones.map((m, i) => (
            <li key={i} className="flex items-baseline gap-2"><span className="font-mono text-xs font-semibold text-primary">{m.percent}%</span><span>{m.trigger}</span></li>
          ))}
        </ul>
      </div>

      <button type="button" onClick={() => setShowConditions((v) => !v)} className="mt-3 text-xs font-medium text-primary hover:underline">
        {showConditions ? "Hide" : "View"} conditions &amp; bank details
      </button>
      {showConditions && (
        <div className="mt-3 space-y-3 rounded-lg border p-3">
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            <Field label="Forwarder">{e.invoice.conditions.forwarder}</Field>
            {e.invoice.conditions.forwarderAccountNo && <Field label="Forwarder account no.">{e.invoice.conditions.forwarderAccountNo}</Field>}
            <Field label="Ship within (of funds received)">{e.invoice.conditions.shipWithinDays}</Field>
            <Field label="Inspection period">{e.invoice.conditions.inspectionPeriod}</Field>
            <Field label="Escrow fee sharing">{e.invoice.conditions.feeSharingLabel}</Field>
            <Field label="Return condition">{e.invoice.conditions.returnCondition}</Field>
          </div>
          <p className="rounded-lg border border-[color-mix(in_srgb,var(--warn)_40%,transparent)] bg-warn-bg p-2.5 text-xs text-warn">
            Warranties are offered at the seller&apos;s discretion and are outside the escrow terms. The escrow provider
            is not responsible for enforcing or honouring warranties — any DOA/warranty claim must be chased with the
            seller directly, not through escrow.
          </p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>Buyer pays all local and overseas bank/wire transfer fees — none of the invoice&apos;s stated charges can be omitted from the remittance.</li>
            <li>The invoice number must be quoted on the T/T reference, or the provider can&apos;t match the incoming wire to the order.</li>
          </ul>
          {bank && (
            <div className="rounded-lg border bg-muted/30 p-2.5 text-xs">
              <div className="mb-1.5 font-semibold uppercase tracking-wide text-muted-foreground">Escrow bank account</div>
              <Field label="Bank name">{bank.bankName}</Field>
              <Field label="Bank address">{bank.bankAddress}</Field>
              <Field label="Beneficiary">{bank.beneficiaryName}</Field>
              <Field label="Account no.">{bank.accountNumber}</Field>
              <Field label="SWIFT">{bank.swiftCode}</Field>
              <p className="mt-2 flex items-center gap-1 text-warn"><Lock className="h-3 w-3" /> Please make the escrow payment only to this account.</p>
            </div>
          )}
        </div>
      )}

      {e.status === "ESCROW_FEE_INVOICED" && !e.paymentInstructedAt && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => onCompose("PAYMENT_INSTRUCTION_TO_FINANCE")}><Send className="h-4 w-4" /> Send: payment instruction to Finance</Button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onUploadInvoice}><Upload className="h-4 w-4" /> Upload manually</Button>
      </div>
    </Panel>
  );
}

// Payment communications — SC reviews the invoice, instructs Finance, Finance pays (with a SWIFT
// reference SC then quotes to HKin — this is an international wire, not a domestic NEFT/RTGS
// transfer, so it's never a UTR), HKin confirms (that last step, like Finance's own confirmation,
// arrives via the single "Check inbox" action above, not a dedicated button here).
function PaymentFlowPanel({ b, onCompose }: { b: OrderBundle; onCompose: Compose }) {
  const e = b.escrow!;
  if (!e.invoice) return null;
  return (
    <Panel title="Payment — SC → Finance → HKin">
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <Field label="Instructed Finance">{e.paymentInstructedAt ?? "—"}</Field>
        <Field label="Finance confirmed (SWIFT ref)">{e.financeSwiftReference ? `${e.financeConfirmedAt} — ${e.financeSwiftReference}` : "—"}</Field>
        <Field label="Sent to HKin">{e.paymentSentToHkinAt ?? "—"}</Field>
        <Field label="HKin confirmed">{e.status !== "ESCROW_FEE_INVOICED" ? "✓" : "—"}</Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {!e.paymentInstructedAt && <Button onClick={() => onCompose("PAYMENT_INSTRUCTION_TO_FINANCE")}><Send className="h-4 w-4" /> Send: payment instruction to Finance</Button>}
        {e.paymentInstructedAt && e.financeSwiftReference && !e.paymentSentToHkinAt && <Button onClick={() => onCompose("PAYMENT_CONFIRMATION_TO_HKIN")}><Send className="h-4 w-4" /> Send: payment confirmation to HKin</Button>}
      </div>
      {e.paymentInstructedAt && !e.financeSwiftReference && <p className="mt-2 text-xs text-muted-foreground">Awaiting Finance&apos;s confirmation (with the SWIFT reference) — check inbox above.</p>}
      {e.paymentSentToHkinAt && e.status === "ESCROW_FEE_INVOICED" && <p className="mt-2 text-xs text-muted-foreground">Awaiting HKin&apos;s confirmation — check inbox above.</p>}
    </Panel>
  );
}

// Booking, running the test, and the retest/return decision itself all live on the Testing tab —
// escrow only needs the one verdict signal, since that's what governs the release milestone. On
// FAIL, escrow's one remaining job is to notice if the client asks for a refund instead of waiting
// on a retest, and if so, tell HKin + the supplier to initiate it. Shipment/goods-received/progress
// all arrive via the single "Check inbox" action above — the verdict is the one exception, since
// it's a real-world outcome someone has to report, not an email to fake-receive.
function WhlTestingPanel({ b, id, onCompose }: { b: OrderBundle; id: string; onCompose: Compose }) {
  const recordWhlVerdict = useStore((s) => s.recordWhlVerdict);
  const acceptEscrowGoods = useStore((s) => s.acceptEscrowGoods);
  const rejectEscrowGoods = useStore((s) => s.rejectEscrowGoods);
  const requestEscrowExtension = useStore((s) => s.requestEscrowExtension);
  const simulateEscrowDeadlineReminder = useStore((s) => s.simulateEscrowDeadlineReminder);
  const recordEscrowRma = useStore((s) => s.recordEscrowRma);
  const e = b.escrow!;
  const idx = escrowStatusIndex(e.status);
  const needsTesting = b.lines.some((l) => l.testingMode !== "NONE");
  const isWhl = b.lines.some((l) => l.testingMode === "WHL");
  // A fresh verdict can always be logged again once WHL/Testing-tab reports one (e.g. after a
  // retest run there) — unless a refund's already been instructed, at which point this order's done.
  const awaitingVerdict = (!e.whlVerdict || e.whlVerdict === "FAIL") && !e.refundInstructedAt;
  const [prompt, setPrompt] = useState<null | "reject" | "extension" | "acceptPartial" | "rma">(null);

  return (
    <Panel title={needsTesting ? "WHL testing — shipment & verdict" : "Shipment & receipt (no testing agreed on this PO)"}>
      {needsTesting && <div className="mb-3"><Field label={isWhl ? "Goods received (at WHL, for testing)" : "Goods received (at 1Buy's hub)"}>{e.goodsReceivedAt ?? "—"}</Field></div>}

      {idx === escrowStatusIndex("TT_PAYMENT_RECEIVED") && <p className="text-xs text-muted-foreground">Waiting on the supplier&apos;s shipment notice — check inbox above.</p>}
      {idx === escrowStatusIndex("GOODS_SHIPPED") && <p className="text-xs text-muted-foreground">Waiting on {isWhl ? "WHL" : "1Buy's hub"} to confirm goods received — check inbox above.</p>}

      {needsTesting && idx === escrowStatusIndex("RECIPIENT_INSPECTION") && (
        <div className="mt-4 border-t pt-3">
          {/* Real HKin evidence: HKin's own "Escrow Reminder of Inspection Period" email carries a
              hard deadline — silence past it is treated as an implicit accept. */}
          {awaitingVerdict && e.inspectionDeadline && (
            <div className="mb-3 rounded-lg border border-dashed p-2.5 text-xs">
              <span className="font-medium">Inspection deadline: {new Date(e.inspectionDeadline).toLocaleDateString()}</span>
              <span className="text-muted-foreground"> — accept/reject by then, or it&apos;s deemed accepted automatically.</span>
            </div>
          )}
          {awaitingVerdict && (
            <>
              {/* Demo/simulate tools — stand in for a real WHL/HKin email arriving, never a real
                  decision themselves. Kept visually separate (muted, labelled) from the buyer's
                  own real decision buttons below, so the two are never confused on screen. */}
              <div className="rounded-lg bg-muted/50 p-2.5">
                <p className="text-xs font-medium text-muted-foreground">Demo tools — simulate an inbound email</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {!e.inspectionDeadline && (
                    <Button variant="ghost" onClick={() => simulateEscrowDeadlineReminder(id)}>
                      <Inbox className="h-4 w-4" /> Simulate: HKin deadline reminder
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => recordWhlVerdict(id, "PASS")}>Simulate: WHL reported PASS</Button>
                  <Button variant="ghost" onClick={() => recordWhlVerdict(id, "FAIL")}>Simulate: WHL reported FAIL</Button>
                </div>
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium">Buyer&apos;s decision (real portal: Accept All / Accept Partially / Reject All)</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Button onClick={() => acceptEscrowGoods(id, {})}><Check className="h-4 w-4" /> Accept All</Button>
                  <Button variant="outline" onClick={() => setPrompt("acceptPartial")}>Accept Partially</Button>
                  <Button variant="ghost" onClick={() => setPrompt("reject")}>Reject All</Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {isWhl ? "Independent lab test — full detail lives on the Testing tab." : "Supplier self-test, reviewed on receipt."} Check inbox above for progress pings while you wait.
                </p>
                <Button className="mt-2" variant="ghost" onClick={() => setPrompt("extension")}>Request extension</Button>
              </div>
            </>
          )}
          {e.whlVerdict === "FAIL" && (
            <div className="mt-3 space-y-2">
              <p className="inline-flex items-center gap-1 text-xs text-bad"><Ban className="h-3.5 w-3.5" /> FAIL — {e.whlReportRef ? `report ${e.whlReportRef}` : e.whlRawConclusion}. Retest/return itself is decided on the Testing tab.</p>
              {e.refundInstructedAt ? (
                <p className="text-xs text-muted-foreground">Refund instructed {e.refundInstructedAt}.</p>
              ) : e.goodsReturnedAt ? (
                <Button onClick={() => onCompose("REFUND_INSTRUCTION")}><Send className="h-4 w-4" /> Send: refund instruction to HKin &amp; supplier</Button>
              ) : e.refundRequestedAt ? (
                <div className="space-y-2 rounded-lg border border-dashed p-2.5">
                  <p className="text-xs font-medium">Real flow: HKin needs the RMA/return-address details, then confirmation the goods reached the seller, before it will process the refund.</p>
                  {e.rmaDetails && <Field label="RMA / return address on file">{e.rmaDetails}</Field>}
                  {e.goodsReturnTracking && <Field label="Return tracking no.">{e.goodsReturnTracking}</Field>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setPrompt("rma")}>Record RMA / return details</Button>
                    <Button variant="outline" onClick={() => recordEscrowRma(id, { markReturned: true })}>Confirm goods reached the seller</Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">If the client asks for a refund instead of a retest, check inbox above.</p>
              )}
            </div>
          )}
        </div>
      )}

      {prompt === "reject" && (
        <TextPromptModal
          title="Reject the goods"
          fields={[{ key: "reason", label: "Reason", placeholder: "e.g. \"WHL report NOT ACCEPTABLE\"" }]}
          onClose={() => setPrompt(null)}
          onSubmit={(v) => { if (v.reason) rejectEscrowGoods(id, v.reason); setPrompt(null); }}
        />
      )}
      {prompt === "extension" && (
        <TextPromptModal
          title="Request an inspection extension"
          fields={[{ key: "reason", label: "Reason", placeholder: "e.g. \"WHL is taking longer than expected, revised report date is...\"" }]}
          onClose={() => setPrompt(null)}
          onSubmit={(v) => { if (v.reason) requestEscrowExtension(id, v.reason); setPrompt(null); }}
        />
      )}
      {prompt === "acceptPartial" && (
        <TextPromptModal
          title="Accept partially"
          fields={[{ key: "note", label: "Note", placeholder: "What's accepted / what isn't", hint: "optional" }]}
          onClose={() => setPrompt(null)}
          onSubmit={(v) => { acceptEscrowGoods(id, { partial: true, note: v.note || undefined }); setPrompt(null); }}
        />
      )}
      {prompt === "rma" && (
        <TextPromptModal
          title="Record RMA / return details"
          fields={[
            { key: "rmaDetails", label: "RMA / return-address details", defaultValue: e.rmaDetails },
            { key: "goodsReturnTracking", label: "Return tracking no.", defaultValue: e.goodsReturnTracking, hint: "optional" },
          ]}
          onClose={() => setPrompt(null)}
          onSubmit={(v) => { recordEscrowRma(id, { rmaDetails: v.rmaDetails || undefined, goodsReturnTracking: v.goodsReturnTracking || undefined }); setPrompt(null); }}
        />
      )}
    </Panel>
  );
}

// A multi-tranche invoice (e.g. 20% on shipment / 50% on WHL PASS / 30% on receipt) releases each
// milestone independently as its own trigger is met — not one lump-sum release at the end.
// Confirmations arrive via the single "Check inbox" action above, not a button per tranche here.
function ReleasePanel({ b, onCompose }: { b: OrderBundle; onCompose: Compose }) {
  const e = b.escrow!;
  const milestones = e.invoice?.conditions.releaseMilestones ?? [];
  return (
    <Panel title="Release funds to seller — per milestone">
      <ul className="space-y-2">
        {milestones.map((m, i) => {
          const rec = e.milestoneReleases.find((r) => r.index === i);
          const met = escrowMilestoneTriggerMet(b, m.trigger);
          return (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5">
              <div className="text-sm"><span className="font-mono text-xs font-semibold text-primary">{m.percent}%</span> — {m.trigger}</div>
              {rec?.confirmedAt ? (
                <Pill tone="ok">Released {rec.confirmedAt}</Pill>
              ) : rec?.instructedAt ? (
                <Pill tone="warn">Instructed {rec.instructedAt} — check inbox above</Pill>
              ) : met ? (
                <Button onClick={() => onCompose("RELEASE_FUNDS_INSTRUCTION", i)}><Send className="h-4 w-4" /> Send: release {m.percent}%</Button>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-warn"><Lock className="h-3 w-3" /> Not yet due</span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function PaymentClosurePanel({ b, id, onUploadPaymentClosure }: { b: OrderBundle; id: string; onUploadPaymentClosure: () => void }) {
  const simulatePaymentClosureFetch = useStore((s) => s.simulatePaymentClosureFetch);
  const pc = b.escrow!.paymentClosure;

  if (!pc) {
    return (
      <Panel title="Payment closure">
        <Empty text="No closure receipt yet — issued by the Escrow Agent once funds settle, or upload one manually as a fallback." />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => simulatePaymentClosureFetch(id)}><Inbox className="h-4 w-4" /> Fetch from Escrow Agent</Button>
          <Button variant="outline" onClick={onUploadPaymentClosure}><Upload className="h-4 w-4" /> Upload manually</Button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Payment closure" actions={<span className="font-mono text-xs text-muted-foreground">{pc.documentNo}</span>}>
      <Field label="Released amount">{money(pc.releasedAmount, b.escrow!.currency)}</Field>
      <Field label="Received">{pc.receivedAt}</Field>
    </Panel>
  );
}

function AgentInboxPanel({ b }: { b: OrderBundle }) {
  const cols: Col<EscrowAgentEmail>[] = [
    { key: "dir", header: "", render: (m) => <Pill tone={m.direction === "SENT" ? "info" : "neutral"}>{m.direction}</Pill> },
    { key: "subj", header: "Subject", render: (m) => <span className="text-sm">{m.subject}</span> },
    { key: "snippet", header: "Snippet", render: (m) => <span className="text-xs text-muted-foreground">{m.snippet}</span> },
    {
      key: "from", header: "From / To",
      render: (m) => (
        <span className="font-mono text-xs text-muted-foreground">
          {m.direction === "SENT" ? m.to : m.from}
          {m.direction === "SENT" && m.cc && <><br /><span className="text-faint">cc: {m.cc}</span></>}
        </span>
      ),
    },
    {
      key: "att", header: "Attachment",
      render: (m) => m.attachmentUrl ? (
        <a href={`${ESCROW_API_BASE}${m.attachmentUrl}`} target="_blank" rel="noopener noreferrer"
           className="font-mono text-xs text-primary underline underline-offset-2">
          {m.attachmentFileName ?? "view"}
        </a>
      ) : (
        <span className="font-mono text-xs">{m.attachmentFileName ?? "—"}</span>
      ),
    },
    { key: "when", header: "When", align: "right", render: (m) => <span className="text-xs tnum">{m.receivedAt}</span> },
  ];
  return (
    <Panel title="Email log — every message sent or received on this order">
      <DataTable columns={cols} rows={b.escrow!.agentEmails} empty="No emails yet." />
    </Panel>
  );
}

// Every SENT email opens here first — nothing dispatches on a single click. SC reviews (and can
// edit) the draft, then explicitly hits Send.
function ComposeEmailModal({
  purpose, draft, onClose, onSend,
}: { purpose: EscrowSendPurpose; draft: EscrowEmailDraft; onClose: () => void; onSend: (purpose: EscrowSendPurpose, draft: EscrowEmailDraft) => void }) {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc ?? "");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  return (
    <Dialog open onClose={onClose} title="Compose email — review before sending"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSend(purpose, { to, cc: cc || undefined, subject, body })}><Send className="h-4 w-4" /> Send</Button></>}>
      <div className="space-y-3">
        <Labeled label="To"><Input value={to} onChange={(e) => setTo(e.target.value)} /></Labeled>
        <Labeled label="Cc" hint="optional"><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="—" /></Labeled>
        <Labeled label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Labeled>
        <Labeled label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[180px]" /></Labeled>
        <p className="text-xs text-faint">Nothing is sent until you click Send — edit anything above first.</p>
      </div>
    </Dialog>
  );
}

// Step 0a is local-only (no escrow-agents draft/purpose backs it — see askSupplierHkinAccount in
// store.ts), so it gets its own small compose modal rather than reusing sendEscrowEmail's
// backend-draft dispatch — but the review-before-send UX must match every other outbound email.
function HkinAccountAskModal({
  draft, onClose, onSend,
}: { draft: EscrowEmailDraft; onClose: () => void; onSend: (draft: EscrowEmailDraft) => void }) {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc ?? "");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  return (
    <Dialog open onClose={onClose} title="Compose email — review before sending"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSend({ to, cc: cc || undefined, subject, body })}><Send className="h-4 w-4" /> Send</Button></>}>
      <div className="space-y-3">
        <Labeled label="To"><Input value={to} onChange={(e) => setTo(e.target.value)} /></Labeled>
        <Labeled label="Cc" hint="optional"><Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="—" /></Labeled>
        <Labeled label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Labeled>
        <Labeled label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[180px]" /></Labeled>
        <p className="text-xs text-faint">Nothing is sent until you click Send — edit anything above first.</p>
      </div>
    </Dialog>
  );
}

// Small single/multi-field input modal — replaces window.prompt() for every escrow action that
// needs one, so a live demo never shows a native browser dialog on screen.
function TextPromptModal({
  title, fields, onClose, onSubmit,
}: {
  title: string;
  fields: { key: string; label: string; placeholder?: string; defaultValue?: string; hint?: string }[];
  onClose: () => void;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, f.defaultValue ?? ""])),
  );
  return (
    <Dialog open onClose={onClose} title={title}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSubmit(values)}>Submit</Button></>}>
      <div className="space-y-3">
        {fields.map((f) => (
          <Labeled key={f.key} label={f.label} hint={f.hint}>
            <Textarea
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
              className="min-h-[70px]"
            />
          </Labeled>
        ))}
      </div>
    </Dialog>
  );
}

function hkinAccountAskDraftFor(b: OrderBundle, id: string): EscrowEmailDraft {
  const e = b.escrow!;
  const sellerTo = e.sellerContact.email && e.sellerContact.email !== "—" ? e.sellerContact.email : "seller@example.com";
  return {
    to: sellerTo,
    subject: `Escrow order ${b.orderNo} — do you have an HKin account? [${id}]`,
    body: `Hi ${e.sellerContact.contactPerson || "team"},\n\nWe're setting up an escrow order (${b.orderNo}) with HKin (hkinventory.com) for this purchase. Before we create the order on their platform, could you confirm — do you already have an account with HKin?\n\nIf not, please open one at your earliest convenience at https://www.hkinventory.com/ so we can proceed.\n\nThanks,\n1Buy SC Team`,
  };
}

// Must match escrow-agents' .env (HKIN_SENDER_EMAIL / FINANCE_SENDER_EMAIL) — these are only the
// compose modal's *default* to/cc, shown editable before send; the backend's own drafter.py uses
// the same two config values as the authoritative source, so leaving these fields untouched still
// sends to the right real address.
const HKIN_ADDRESS = "rekhasanjaygupta10@gmail.com";
const FINANCE_ADDRESS = "harsh@1buy.ai";

// Every subject carries "[id]" — the REAL escrow-agents order_id (e.g. "ord-abc123"), not just
// the display orderNo — because scripts/poll_gmail_inbox.py routes real inbound mail by matching
// a "[order_id]" tag in the subject line (see ARCHITECTURE.md's "Real mailbox ingestion"
// section). Hitting "Reply" in a real mail client keeps the original subject verbatim, so as long
// as the tag is on every outbound message, every reply naturally routes correctly with zero extra
// steps from whoever's sending real test mail for HKin/WHL/Finance.
function draftFor(purpose: EscrowSendPurpose, b: OrderBundle, id: string, milestoneIndex?: number): EscrowEmailDraft {
  const e = b.escrow!;
  const tag = `[${id}]`;
  const milestonesText = (e.invoice?.conditions.releaseMilestones ?? []).map((m) => `- ${m.percent}% — ${m.trigger}`).join("\n") || "- (per the invoice conditions)";
  const sellerTo = e.sellerContact.email && e.sellerContact.email !== "—" ? e.sellerContact.email : "seller@example.com";
  const sellerPerson = e.sellerContact.contactPerson || "Seller";
  switch (purpose) {
    case "ORDER_TO_SELLER":
      return { to: HKIN_ADDRESS, subject: `Order ${b.orderNo} — please confirm acceptance ${tag}`,
        body: `Hi HKin team,\n\nPlease forward this order to ${e.sellerContact.company} for acceptance.\n\nOrder: ${b.orderNo}\nPO amount: ${money(e.poAmount, e.currency)}\nShip to (1Buy hub): ${e.recipient.company}\n\nThanks,\n1Buy SC Team` };
    case "PAYMENT_INSTRUCTION_TO_FINANCE":
      return { to: FINANCE_ADDRESS, cc: HKIN_ADDRESS, subject: `Payment instruction — ${b.orderNo} ${tag}`,
        body: `Hi Finance,\n\nInvoice ${e.invoice?.invoiceNo} reviewed for ${b.orderNo}. Please remit per the release milestones on file:\n${milestonesText}\n\nTotal buyer T/T: ${e.invoice ? money(escrowInvoiceTotals(e.invoice.fees).totalBuyerTT, e.currency) : "—"}\n\nThanks,\nSC Team` };
    case "PAYMENT_CONFIRMATION_TO_HKIN":
      return { to: HKIN_ADDRESS, cc: FINANCE_ADDRESS, subject: `Payment sent — ${b.orderNo} ${tag}`,
        body: `Hi HKin team,\n\nWe've remitted the T/T per invoice ${e.invoice?.invoiceNo}${e.financeSwiftReference ? ` — SWIFT reference ${e.financeSwiftReference}` : ""}. Please confirm receipt.\n\nThanks,\nFinance / SC Team` };
    case "REFUND_INSTRUCTION":
      return { to: HKIN_ADDRESS, cc: sellerTo, subject: `Refund requested — ${b.orderNo} ${tag}`,
        body: `Hi HKin team,\n\nThe client has requested a refund on order ${b.orderNo} following the FAIL result (report ${e.whlReportRef ?? "attached"}), instead of a retest. Please initiate the refund per the escrow terms.\n\n(cc: ${sellerPerson}, for your awareness.)\n\nThanks,\nSC Team` };
    case "RELEASE_FUNDS_INSTRUCTION": {
      const m = milestoneIndex !== undefined ? e.invoice?.conditions.releaseMilestones[milestoneIndex] : undefined;
      return { to: HKIN_ADDRESS, cc: sellerTo, subject: `Release funds${m ? ` — ${m.percent}%` : ""} — ${b.orderNo} ${tag}`,
        body: `Hi HKin team,\n\n${m ? m.trigger : "The release condition"} has been met for order ${b.orderNo}. Please release ${m ? `${m.percent}% of the escrowed funds` : "the funds"} to the seller per the invoice terms.\n\n(cc: ${sellerPerson}, for your awareness — this tranche is on its way.)\n\nFull release schedule on file:\n${milestonesText}\n\nThanks,\nSC Team` };
    }
  }
}

const NEXT_STEP_HINT: Record<EscrowOrderStatus, string> = {
  DRAFT: "Next: send the order to the seller for acceptance.",
  SENT_FOR_SELLER_CONFIRMATION: "Next: check the inbox for the seller's acceptance.",
  SELLER_CONFIRMED: "Next: fetch the escrow invoice once HKin issues it.",
  ESCROW_FEE_INVOICED: "Next: review the invoice, then instruct Finance to pay.",
  TT_PAYMENT_RECEIVED: "Next: wait for the supplier's shipment notice (WHL booking, if any, happens on the Testing tab).",
  GOODS_SHIPPED: "Next: confirm goods have been received for inspection.",
  RECIPIENT_INSPECTION: "Next: log the WHL result, then release each milestone as its trigger is met.",
  RELEASED_TO_SELLER: "Escrow complete.",
};

export function EscrowTab({
  b, id, onUploadInvoice, onUploadPI, onUploadDoc, onUploadPaymentClosure,
}: {
  b: OrderBundle; id: string; onUploadInvoice: () => void;
  onUploadPI: () => void; onUploadDoc: () => void; onUploadPaymentClosure: () => void;
}) {
  const checkEscrowInbox = useStore((s) => s.checkEscrowInbox);
  const syncRealInbox = useStore((s) => s.syncRealInbox);
  const cancelEscrowOrder = useStore((s) => s.cancelEscrowOrder);
  const createHkinOrder = useStore((s) => s.createHkinOrder);
  const askSupplierHkinAccount = useStore((s) => s.askSupplierHkinAccount);
  const confirmSupplierHkinAccount = useStore((s) => s.confirmSupplierHkinAccount);
  const sendEscrowEmail = useStore((s) => s.sendEscrowEmail);
  const [compose, setCompose] = useState<{ purpose: EscrowSendPurpose; milestoneIndex?: number } | null>(null);
  const onCompose: Compose = (purpose, milestoneIndex) => setCompose({ purpose, milestoneIndex });
  const [askHkinModalOpen, setAskHkinModalOpen] = useState(false);

  if (!b.escrow) {
    return <Panel title="Escrow"><Empty text={`No escrow — supplier is paid via ${b.paymentMode}.`} /></Panel>;
  }
  const e = b.escrow;
  // Real HKin evidence: HKin can reject the whole application before a seller is even assigned —
  // the earliest possible terminal state (no seller contact, no PO data on the real portal at
  // all). Nothing else on this tab is meaningful once that's happened.
  if (e.applicationRejectedAt) {
    return (
      <Panel title="Escrow order — HKin-modelled" actions={<Pill tone="bad"><Ban className="h-3 w-3" /> Application Rejected</Pill>}>
        <p className="text-sm text-bad">HKin rejected this escrow application on {new Date(e.applicationRejectedAt).toLocaleString()} — no seller was ever assigned.</p>
        <p className="mt-2 text-xs text-muted-foreground">Contact HKin support for the reason, or start a fresh order if the details need correcting.</p>
      </Panel>
    );
  }
  const isFinal = e.status === "RELEASED_TO_SELLER";
  const cancelled = !!e.cancelledAt;
  // Real HKin evidence: a real order was cancelled with the fund-transfer step already marked
  // complete — cancellation isn't gated on T/T payment, only on the order not already released.
  const canCancel = !cancelled && !isFinal;

  return (
    <div className="space-y-4">
      <Panel title="Escrow order — HKin-modelled" actions={cancelled ? <Pill tone="bad"><Ban className="h-3 w-3" /> Cancelled</Pill> : <StatusPill status={e.status} />}>
        <EscrowStepper status={e.status} />
        <div className="mt-4 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          <Field label="Escrow invoice no.">{e.invoice?.invoiceNo ?? "—"}</Field>
          <Field label="Order/PO amount">{money(e.poAmount, e.currency)}</Field>
          <Field label="Buyer">{e.buyerContact.company}</Field>
          <Field label="Seller">{e.sellerContact.company}</Field>
          <Field label="Use Escrow/i (with Inspection)?">{e.useInspectionService ? "Yes" : "No"}</Field>
        </div>
        {cancelled ? (
          <p className="mt-3 inline-flex items-center gap-1 text-xs text-bad"><Ban className="h-3.5 w-3.5" /> Cancelled on {e.cancelledAt}.</p>
        ) : (
          <>
            {e.status === "DRAFT" && e.hkinAccountStatus !== "CONFIRMED" && (
              <div className="mt-3 rounded-lg border border-dashed p-3">
                <p className="text-sm font-medium">Step 0a — Confirm the supplier&apos;s HKin account</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Before we create the order on HKin, {e.sellerContact.company} needs an account there — or needs to
                  open one. Ask first, then confirm once they&apos;ve replied.
                </p>
                {(!e.hkinAccountStatus || e.hkinAccountStatus === "NOT_ASKED") && (
                  <Button className="mt-2" variant="outline" onClick={() => setAskHkinModalOpen(true)}>
                    <Mail className="h-4 w-4" /> Ask supplier: HKin account?
                  </Button>
                )}
                {e.hkinAccountStatus === "ASKED" && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Pill tone="warn">Waiting for supplier&apos;s reply</Pill>
                    <Button variant="outline" onClick={() => confirmSupplierHkinAccount(id)}>
                      <Inbox className="h-4 w-4" /> Check inbox
                    </Button>
                  </div>
                )}
              </div>
            )}
            {e.status === "DRAFT" && e.hkinAccountStatus === "CONFIRMED" && (
              <div className="mt-3 rounded-lg border border-dashed p-3">
                <p className="text-sm font-medium">Step 0b — Create the order on HKin</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fills HKin&apos;s real order-creation form from this order&apos;s buyer/seller/line data (RPA), then stops
                  at HKin&apos;s own Confirmation screen for you to review and submit yourself on the real site.
                </p>
                <Button className="mt-2" variant="outline" onClick={() => createHkinOrder(id)}>
                  <PlayCircle className="h-4 w-4" /> Create HKin order
                </Button>
                {e.hkinRpaStartedAt && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Started {new Date(e.hkinRpaStartedAt).toLocaleString()} — check your screen for the review window.
                  </p>
                )}
              </div>
            )}
            <p className="mt-3 text-sm text-muted-foreground">{NEXT_STEP_HINT[e.status]}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {e.status === "DRAFT" && !!e.hkinRpaStartedAt && <Button onClick={() => onCompose("ORDER_TO_SELLER")}><Send className="h-4 w-4" /> Send: order to seller for acceptance</Button>}
              {!isFinal && <Button variant="outline" onClick={() => checkEscrowInbox(id)}><Inbox className="h-4 w-4" /> Check inbox</Button>}
              {!isFinal && <Button variant="outline" onClick={() => syncRealInbox(id)}><Inbox className="h-4 w-4" /> Sync real inbox</Button>}
              {canCancel && <Button variant="ghost" onClick={() => { if (confirm("Cancel this escrow order?")) cancelEscrowOrder(id); }}>Cancel order</Button>}
            </div>
          </>
        )}
      </Panel>

      {/* Action panels first — whatever the SC/Finance person needs to DO next, grouped together
          right under the main status panel. Reference info (PO/invoice/contacts) sits below,
          since it's read-once-then-rarely-touched, not something acted on every visit. */}
      {!cancelled && e.invoice && e.status === "ESCROW_FEE_INVOICED" && <PaymentFlowPanel b={b} onCompose={onCompose} />}
      {!cancelled && e.invoice && escrowStatusIndex(e.status) >= escrowStatusIndex("TT_PAYMENT_RECEIVED") && escrowStatusIndex(e.status) <= escrowStatusIndex("RECIPIENT_INSPECTION") && (
        <WhlTestingPanel b={b} id={id} onCompose={onCompose} />
      )}
      {!cancelled && e.invoice && escrowStatusIndex(e.status) >= escrowStatusIndex("TT_PAYMENT_RECEIVED") && <ReleasePanel b={b} onCompose={onCompose} />}
      {isFinal && <PaymentClosurePanel b={b} id={id} onUploadPaymentClosure={onUploadPaymentClosure} />}

      <PurchaseOrderPanel b={b} id={id} onUploadPI={onUploadPI} onUploadDoc={onUploadDoc} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ContactPanel title="Buyer contact" contact={e.buyerContact} />
        <ContactPanel title="Seller contact" contact={e.sellerContact} />
        <ContactPanel title="Recipient contact (1Buy hub)" contact={e.recipient} />
      </div>
      <InvoicePanel b={b} id={id} onUploadInvoice={onUploadInvoice} onCompose={onCompose} />

      <AgentInboxPanel b={b} />

      {compose && (
        <ComposeEmailModal
          purpose={compose.purpose}
          draft={draftFor(compose.purpose, b, id, compose.milestoneIndex)}
          onClose={() => setCompose(null)}
          onSend={(purpose, draft) => { sendEscrowEmail(id, purpose, draft, compose.milestoneIndex); setCompose(null); }}
        />
      )}
      {askHkinModalOpen && (
        <HkinAccountAskModal
          draft={hkinAccountAskDraftFor(b, id)}
          onClose={() => setAskHkinModalOpen(false)}
          onSend={() => { askSupplierHkinAccount(id); setAskHkinModalOpen(false); }}
        />
      )}
    </div>
  );
}
