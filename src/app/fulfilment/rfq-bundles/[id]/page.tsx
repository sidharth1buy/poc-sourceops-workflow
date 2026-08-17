"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Send, Copy, RefreshCw, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/store/store";
import { PageHeader, Panel, Button, DataTable, StatusPill, type Col } from "@/components/ui/primitives";
import type { RfqLine, SupplierInvite } from "@/types";

export default function RfqBundleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const bundleId = params.id as string;
  const store = useStore();
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({});
  const [piDrafts, setPiDrafts] = useState<Record<string, string>>({});
  const [finalizing, setFinalizing] = useState(false);

  const bundle = store.rfqBundles[bundleId];
  const quotes = Object.values(store.supplierQuotes).filter((q) => q.rfqBundleId === bundleId);

  if (!bundle) {
    return (
      <div className="space-y-6">
        <Link href="/fulfilment/rfq-bundles" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> RFQ Bundles
        </Link>
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          RFQ Bundle not found.
        </div>
      </div>
    );
  }

  const quoteCountBySupplier = (email: string) => quotes.filter((q) => q.supplierEmail === email).length;

  const handleResend = async (invite: SupplierInvite) => {
    setResendingId(invite.id);
    await store.resendSupplierInvite(bundleId, invite.id);
    setResendingId(null);
  };

  const handleCopyLink = (invite: SupplierInvite) => {
    const link = `${window.location.origin}/portal/rfq/${bundleId}/${invite.portalToken}`;
    navigator.clipboard.writeText(link);
    toast.success("Portal link copied");
  };

  const handleAnswerSubmit = (inviteId: string, questionId: string) => {
    const answer = (answerDrafts[questionId] ?? "").trim();
    if (!answer) {
      toast.error("Enter an answer before sending");
      return;
    }
    store.answerSupplierQuestion(bundleId, inviteId, questionId, answer);
    setAnswerDrafts((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
  };

  // viewedAt is date-only (no time-of-day in the data model) — render a friendly relative label
  // so Procurement can tell a stale VIEWED apart from a recent one at a glance.
  const viewedLabel = (viewedAt: string) => {
    const days = Math.floor((Date.now() - new Date(viewedAt).getTime()) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    return `${days}d ago`;
  };

  const lineCols: Col<RfqLine>[] = [
    { key: "mpn", header: "MPN", render: (l) => <span className="font-mono text-xs font-semibold text-primary">{l.mpn}</span> },
    { key: "qty", header: "Aggregated Qty", render: (l) => <span className="text-sm font-medium">{l.aggregatedQty}</span> },
    { key: "target", header: "Target Price", render: (l) => <span className="text-sm">${l.targetPrice.toFixed(2)}</span> },
    { key: "demands", header: "From Demands", render: (l) => <span className="text-xs text-muted-foreground">{l.demandLineIds.length} demand(s)</span> },
    { key: "quotes", header: "Quotes Received", render: (l) => {
      const lineQuoteCount = quotes.filter((q) => q.lines.some((ql) => ql.rfqLineId === l.id)).length;
      return <span className={lineQuoteCount > 0 ? "text-sm font-medium text-ok" : "text-sm text-muted-foreground"}>{lineQuoteCount}</span>;
    }},
  ];

  const inviteCols: Col<SupplierInvite>[] = [
    { key: "supplier", header: "Supplier", render: (i) => (
      <div>
        <div className="text-sm font-medium">{i.supplierName}</div>
        <div className="text-xs text-muted-foreground">{i.supplierEmail}</div>
      </div>
    )},
    { key: "status", header: "Status", render: (i) => (
      <div>
        <StatusPill status={i.status} />
        {i.viewedAt && (
          <div className="mt-0.5 text-[10px] text-muted-foreground" title={`Viewed on ${i.viewedAt}`}>
            Viewed {viewedLabel(i.viewedAt)}
          </div>
        )}
      </div>
    )},
    { key: "quotes", header: "Quotes", render: (i) => <span className="text-sm">{quoteCountBySupplier(i.supplierEmail)}</span> },
    { key: "sentAt", header: "Sent", render: (i) => <span className="text-xs text-muted-foreground">{i.sentAt || "-"}</span> },
    { key: "expires", header: "Expires", render: (i) => <span className="text-xs text-muted-foreground">{i.expiresAt}</span> },
    { key: "error", header: "Error", render: (i) => i.lastError ? <span className="text-xs text-bad">{i.lastError}</span> : <span className="text-xs text-faint">-</span> },
    { key: "actions", header: "", render: (i) => {
      const alreadyResponded = i.status === "QUOTED" || i.status === "DECLINED";
      return (
        <div className="flex gap-1">
          <button onClick={() => handleCopyLink(i)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Copy portal link">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => handleResend(i)}
            disabled={alreadyResponded || resendingId === i.id}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:pointer-events-none"
            title={alreadyResponded ? "Supplier already responded" : "Resend invite to this supplier"}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${resendingId === i.id ? "animate-spin" : ""}`} />
          </button>
        </div>
      );
    }},
  ];

  const canFloat = bundle.status === "DRAFT";
  const hasQuotes = quotes.length > 0;
  const invitesWithQuestions = bundle.invites.filter((i) => (i.questions?.length ?? 0) > 0);
  const totalQuestionCount = invitesWithQuestions.reduce((n, i) => n + (i.questions?.length ?? 0), 0);

  // Once Finance has approved a decision, the winning supplier(s) must send their own PI
  // before we're willing to cut our PO to them — surface that as an explicit step here.
  const approvedDecision = Object.values(store.clientQuoteDecisions).find(
    (d) => d.rfqBundleId === bundleId && d.status === "APPROVED",
  );
  const winningSupplierQuoteIds = approvedDecision
    ? Array.from(new Set(
        approvedDecision.selectedQuoteLines
          .map((sel) => quotes.find((q) => q.lines.some((l) => l.id === sel.quoteLineId))?.id)
          .filter((id): id is string => !!id),
      ))
    : [];
  const winningQuotes = winningSupplierQuoteIds.map((id) => quotes.find((q) => q.id === id)!).filter(Boolean);

  const handleRecordPi = (quoteId: string) => {
    const piNo = (piDrafts[quoteId] ?? "").trim();
    if (!piNo) { toast.error("Enter the supplier's PI number"); return; }
    store.recordSellerPi(quoteId, piNo);
    setPiDrafts((prev) => { const next = { ...prev }; delete next[quoteId]; return next; });
  };

  const handleFinalize = async () => {
    setFinalizing(true);
    store.finalizeRfqToSupplierPos(bundleId);
    setFinalizing(false);
  };

  return (
    <div className="space-y-6">
      <Link href="/fulfilment/rfq-bundles" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> RFQ Bundles
      </Link>

      <PageHeader
        title={`RFQ Bundle ${bundleId.slice(0, 16)}`}
        description={`Deadline ${bundle.deadline} · ±${bundle.dateToleranceDays}d tolerance · ${bundle.lines.length} line(s) · ${bundle.invites.length} supplier(s)`}
        actions={
          <div className="flex gap-2">
            <StatusPill status={bundle.status} />
            {canFloat && (
              <Button onClick={() => store.floatRfqToSuppliers(bundleId)}>
                <Send className="h-4 w-4" /> Float to Suppliers
              </Button>
            )}
            {hasQuotes && (
              <Link href={`/fulfilment/rfq-bundles/${bundleId}/decide`}>
                <Button>Compare Quotes →</Button>
              </Link>
            )}
          </div>
        }
      />

      <Panel title={`RFQ Lines (${bundle.lines.length})`}>
        <DataTable columns={lineCols} rows={bundle.lines} />
      </Panel>

      <Panel title={`Supplier Invites (${bundle.invites.length})`}>
        {bundle.invites.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No suppliers invited.</div>
        ) : (
          <DataTable columns={inviteCols} rows={bundle.invites} />
        )}
      </Panel>

      {invitesWithQuestions.length > 0 && (
        <Panel title={<span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" /> Supplier Questions ({totalQuestionCount})</span>}>
          <div className="space-y-4">
            {invitesWithQuestions.map((invite) => (
              <div key={invite.id} className="rounded-lg border p-3">
                <div className="mb-2 text-sm font-medium">
                  {invite.supplierName} <span className="font-normal text-xs text-muted-foreground">({invite.supplierEmail})</span>
                </div>
                <div className="space-y-3">
                  {(invite.questions ?? []).map((q) => (
                    <div key={q.id} className="rounded-lg border bg-muted/30 p-3">
                      <div className="text-xs text-muted-foreground">Asked {q.askedAt}</div>
                      <div className="mt-1 text-sm">{q.question}</div>
                      {q.answer ? (
                        <div className="mt-2 rounded-lg border bg-ok-bg p-2 text-sm">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-ok">Answered {q.answeredAt}</div>
                          <div className="mt-0.5">{q.answer}</div>
                        </div>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <input
                            type="text"
                            placeholder="Type an answer…"
                            value={answerDrafts[q.id] ?? ""}
                            onChange={(e) => setAnswerDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter") handleAnswerSubmit(invite.id, q.id); }}
                            className="flex-1 rounded-lg border px-2 py-1.5 text-sm"
                          />
                          <Button variant="outline" onClick={() => handleAnswerSubmit(invite.id, q.id)}>
                            Send
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {quotes.length > 0 && (
        <Panel title={`Quotes Received (${quotes.length})`}>
          <div className="space-y-2">
            {quotes.map((q) => (
              <div key={q.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-sm font-medium">{q.supplierEmail}</div>
                  <div className="text-xs text-muted-foreground">{q.lines.length} line(s) quoted · submitted {q.submittedAt}</div>
                </div>
                <StatusPill status={q.status} />
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Link href={`/fulfilment/rfq-bundles/${bundleId}/decide`}>
              <Button>Compare &amp; Decide →</Button>
            </Link>
          </div>
        </Panel>
      )}

      {approvedDecision && winningQuotes.length > 0 && (
        <Panel
          title={`Seller PI → Our PO (${winningQuotes.filter((q) => q.sellerPiNo).length}/${winningQuotes.length} received)`}
          actions={
            <Button onClick={handleFinalize} disabled={finalizing || winningQuotes.every((q) => !q.sellerPiNo)}>
              {finalizing ? "Finalizing…" : "Finalize Purchase Order(s)"}
            </Button>
          }
        >
          <p className="mb-3 text-xs text-muted-foreground">
            Finance approved this decision and the client quote is out. Before we cut our PO to a winning supplier, we need <b className="text-foreground">their</b> proforma invoice number on file — enter it below as each one arrives.
          </p>
          <div className="space-y-2">
            {winningQuotes.map((q) => {
              const supplierPo = store.supplierPos.find((sp) => sp.terms?.referenceNo === q.sellerPiNo);
              const invite = bundle.invites.find((i) => i.supplierEmail === q.supplierEmail);
              const wonCount = approvedDecision.selectedQuoteLines.filter((sel) => q.lines.some((l) => l.id === sel.quoteLineId)).length;
              return (
                <div key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{invite?.supplierName ?? q.supplierEmail}</div>
                    <div className="text-xs text-muted-foreground">{q.supplierEmail} · {wonCount} line(s) won</div>
                  </div>
                  {q.sellerPiNo ? (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="rounded-md bg-ok-bg px-2 py-1 font-mono text-xs text-ok">{q.sellerPiNo}</span>
                      <span className="text-xs text-muted-foreground">received {q.sellerPiReceivedAt}</span>
                      {supplierPo && (
                        <Link href="/fulfilment/supplier-pos" className="text-xs font-medium text-primary hover:underline">
                          → {supplierPo.poNo} created
                        </Link>
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Seller PI number…"
                        value={piDrafts[q.id] ?? ""}
                        onChange={(e) => setPiDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleRecordPi(q.id); }}
                        className="rounded-lg border px-2 py-1.5 text-sm"
                      />
                      <Button variant="outline" onClick={() => handleRecordPi(q.id)}>Record PI</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </div>
  );
}
