"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/store/store";
import { allPayments, allLabFees } from "@/store/selectors";
import { Panel, Button, StatusPill, Pill, DataTable, PageHeader, type Col } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { LAB_PAYMENT_LABEL, LAB_PAYMENT_TONE, LAB_TERMS_LABEL, LAB_TERMS_TONE, LAB_TERMS_HINT } from "@/data/enums";
import { money, cn } from "@/lib/utils";

const TABS = ["All", "Client → 1Buy", "1Buy → Supplier", "Customs / ICEGATE", "WHL testing"] as const;
type PayTab = (typeof TABS)[number];

// URL slugs so tabs are deep-linkable / redirectable: /fulfilment/payments?tab=supplier
const TAB_SLUG: Record<PayTab, string> = { All: "all", "Client → 1Buy": "client", "1Buy → Supplier": "supplier", "Customs / ICEGATE": "customs", "WHL testing": "whl" };
const SLUG_TAB: Record<string, PayTab> = { all: "All", client: "Client → 1Buy", supplier: "1Buy → Supplier", customs: "Customs / ICEGATE", whl: "WHL testing" };

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className={cn("rounded-lg border p-3", tone === "warn" ? "bg-warn-bg" : tone === "ok" ? "bg-ok-bg" : "bg-card")}>
      <div className={cn("text-lg font-bold tabular-nums", tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-foreground")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<PageHeader title="Payments" description="Loading…" />}>
      <PaymentsInner />
    </Suspense>
  );
}

function PaymentsInner() {
  const orders = useStore((s) => s.orders);
  const setStatus = useStore((s) => s.setPaymentStatus);
  const payDuty = useStore((s) => s.payCustomsDuty);
  const markLabFeePaid = useStore((s) => s.markLabFeePaid);
  const router = useRouter();
  const params = useSearchParams();
  const rows = allPayments(orders);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState("");
  // regular payments (client/supplier) — attach-then-pay, mirrors the Customs duty flow
  const [payRowId, setPayRowId] = useState<string | null>(null);
  const [payDoc, setPayDoc] = useState("");
  // WHL's own testing invoice — settled against a transfer reference, same attach-then-pay shape
  const [feeRowId, setFeeRowId] = useState<string | null>(null);
  const [feeRef, setFeeRef] = useState("");
  const [tab, setTab] = useState<PayTab>(SLUG_TAB[params.get("tab") ?? ""] ?? "All");
  const goTab = (t: PayTab) => { setTab(t); router.replace(`/fulfilment/payments?tab=${TAB_SLUG[t]}`); };

  const clientRows = rows.filter((r) => r.direction === "CLIENT_TO_1BUY");
  const supplierRows = rows.filter((r) => r.direction === "1BUY_TO_SUPPLIER");
  // WHL testing ledger — the lab bills for the test itself, separate from the material payment
  // and from customs duty, and finance settles it against its own invoice (see LabPayment)
  const feeRows = allLabFees(orders);
  // customs duty ledger — from the ICEGATE entries (paid on the Customs desk)
  const dutyRows = Object.values(orders).flatMap((o) =>
    o.customs.filter((c) => c.beNo && c.beNo !== "filing…").map((c) => ({ orderId: o.id, orderNo: o.orderNo, ce: c })),
  );

  const paymentCols: Col<(typeof rows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/orders/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "dir", header: "Direction", render: (r) => <Pill tone={r.direction === "CLIENT_TO_1BUY" ? "info" : "neutral"}>{r.direction === "CLIENT_TO_1BUY" ? "Client → 1Buy" : "1Buy → Supplier"}</Pill> },
    { key: "party", header: "Party", render: (r) => r.party },
    { key: "mode", header: "Mode", render: (r) => r.mode },
    { key: "amt", header: "Amount", align: "right", render: (r) => money(r.amount, r.currency) },
    { key: "due", header: "Due", align: "right", render: (r) => <span className="text-xs tnum">{r.dueDate ?? "—"}</span> },
    { key: "status", header: "Status", render: (r) => <StatusPill status={r.status} /> },
    { key: "act", header: "", align: "right", render: (r) => r.status !== "PAID"
      ? <Button variant="outline" onClick={() => { setPayRowId(r.id); setPayDoc(`PMT-${r.orderNo}.pdf`); }}>Mark paid</Button>
      : <span className="text-xs text-ok">✓ paid{r.attachment ? ` · ${r.attachment}` : ""}</span> },
  ];

  const dutyCols: Col<(typeof dutyRows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/orders/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "be", header: "BE no", render: (r) => <span className="font-mono text-xs">{r.ce.beNo}</span> },
    { key: "port", header: "Port · CHA", render: (r) => <span className="text-xs text-muted-foreground">{r.ce.portCode ?? "—"} · {r.ce.chaName ?? "—"}</span> },
    { key: "duty", header: "BCD + SWS + IGST", align: "right", render: (r) => r.ce.duty ? <span className="text-xs tnum">{money(r.ce.duty.bcd, r.ce.currency)} + {money(r.ce.duty.sws, r.ce.currency)} + {money(r.ce.duty.igst, r.ce.currency)}</span> : <span className="text-xs text-faint">not assessed</span> },
    { key: "total", header: "Total duty", align: "right", render: (r) => <b>{money(r.ce.totalDuty ?? r.ce.duty?.totalDuty, r.ce.currency)}</b> },
    { key: "status", header: "Status", render: (r) => r.ce.dutyPaidAt ? <Pill tone="ok">paid {r.ce.dutyPaidAt}</Pill> : r.ce.duty ? <Pill tone="warn">due</Pill> : <Pill tone="neutral">pending assessment</Pill> },
    { key: "act", header: "", align: "right", render: (r) => r.ce.dutyPaidAt
      ? <span className="text-xs text-ok">✓ paid{r.ce.dutyInvoice ? ` · ${r.ce.dutyInvoice}` : ""}</span>
      : r.ce.duty
        ? <Button variant="outline" onClick={() => { setPayingId(r.ce.id); setInvoice(`DUTY-${r.ce.beNo}.pdf`); }}>Pay duty</Button>
        : <Button variant="ghost" onClick={() => router.push(`/fulfilment/customs?order=${r.orderId}`)}>Customs desk</Button> },
  ];

  const feeCols: Col<(typeof feeRows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => (
      <Link href={`/fulfilment/order-flow/${r.orderId}#testing`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link>
    ) },
    { key: "lot", header: "Lot · MPN", render: (r) => (
      <span>
        <span className="block text-xs font-medium">{r.lot.lotCode}</span>
        <span className="block font-mono text-[11px] text-faint">{r.lot.orderLineMpn}</span>
      </span>
    ) },
    { key: "wo", header: "Lab · work order", render: (r) => (
      <span className="text-xs text-muted-foreground">{r.lot.lab ?? "—"}<span className="block font-mono text-[11px] text-faint">WO {r.lot.workOrderNo}</span></span>
    ) },
    { key: "inv", header: "Invoice", render: (r) => r.invoice
      ? <span><span className="block font-mono text-xs">{r.invoice.invoiceNo}</span><span className="block text-[11px] text-faint">received {r.invoice.receivedAt}</span></span>
      : <span className="text-xs text-warn">awaited{r.pay.requestedAt ? ` · asked ${r.pay.requestedAt}` : ""}</span> },
    // the amount reads as the priced test list: processes × rate, plus tax
    { key: "amt", header: "Net + tax", align: "right", render: (r) => r.invoice
      ? <span className="text-xs tnum">{money(r.invoice.amount, r.currency)}{r.invoice.taxAmount ? ` + ${money(r.invoice.taxAmount, r.currency)}` : ""}
          {r.invoice.processCount && r.invoice.ratePerProcess
            ? <span className="block text-[11px] text-faint">{r.invoice.processCount} × {money(r.invoice.ratePerProcess, r.currency)}</span>
            : null}
        </span>
      : <span className="text-xs text-faint">—</span> },
    { key: "gross", header: "Payable", align: "right", render: (r) => r.gross ? <b>{money(r.gross, r.currency)}</b> : <span className="text-xs text-faint">—</span> },
    // terms decide whether an unpaid fee is a ledger item or a stop sign — never chosen here,
    // only read off the lab's invoice mail
    { key: "terms", header: "Terms · due", render: (r) => r.terms
      ? <span className="inline-flex flex-wrap items-center gap-1.5">
          <Pill tone={LAB_TERMS_TONE[r.terms]} title={LAB_TERMS_HINT[r.terms]}>{LAB_TERMS_LABEL[r.terms]}</Pill>
          <span className="text-[11px] text-faint tnum">{r.invoice?.dueDate ?? (r.invoice?.creditDays ? `${r.invoice.creditDays}d` : "—")}</span>
        </span>
      : <span className="text-xs text-faint">stated on the invoice</span> },
    { key: "status", header: "Status", render: (r) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Pill tone={LAB_PAYMENT_TONE[r.pay.status]}>{LAB_PAYMENT_LABEL[r.pay.status]}</Pill>
        {r.blocking && <Pill tone="bad" title="Advance terms and unpaid — WHL is holding the lot, so testing hasn't started.">lot held</Pill>}
      </span>
    ) },
    { key: "act", header: "", align: "right", render: (r) => !r.unpaid
      ? <span className="text-xs text-ok">✓ paid{r.pay.paidRef ? ` · ${r.pay.paidRef}` : ""}</span>
      : r.invoice
        ? <Button variant={r.blocking ? "default" : "outline"} onClick={() => { setFeeRowId(r.id); setFeeRef(`TT-${r.invoice!.invoiceNo}`); }}>Mark paid</Button>
        : <Button variant="ghost" onClick={() => router.push(`/fulfilment/testing/${r.orderId}`)}>Testing workspace</Button> },
  ];

  // KPI helpers (per-group currency — amounts are illustrative)
  const ccy = (arr: { currency: string }[]) => arr[0]?.currency ?? "USD";
  const sum = (arr: { amount: number; status: string }[], paid: boolean) => arr.filter((r) => (r.status === "PAID") === paid).reduce((a, r) => a + r.amount, 0);
  const dutyPaid = dutyRows.filter((r) => r.ce.dutyPaidAt).reduce((a, r) => a + (r.ce.totalDuty ?? r.ce.duty?.totalDuty ?? 0), 0);
  const dutyDue = dutyRows.filter((r) => !r.ce.dutyPaidAt && r.ce.duty).reduce((a, r) => a + (r.ce.duty!.totalDuty), 0);
  const feePaid = feeRows.filter((r) => !r.unpaid).reduce((a, r) => a + r.gross, 0);
  const feeDue = feeRows.filter((r) => r.unpaid).reduce((a, r) => a + r.gross, 0);
  const feeHeld = feeRows.filter((r) => r.blocking).length;

  const badge: Record<PayTab, number> = {
    All: rows.length + dutyRows.length,
    "Client → 1Buy": clientRows.length,
    "1Buy → Supplier": supplierRows.length,
    "Customs / ICEGATE": dutyRows.length,
    "WHL testing": feeRows.length,
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Every money movement across the trade, split by leg: client collection, supplier payout, India customs duty (ICEGATE), and WHL's fee for the testing itself." />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Client collected" value={money(sum(clientRows, true), ccy(clientRows))} tone="ok" />
        <Stat label="Client pending" value={money(sum(clientRows, false), ccy(clientRows))} tone="warn" />
        <Stat label="Supplier paid" value={money(sum(supplierRows, true), ccy(supplierRows))} tone="ok" />
        <Stat label="Supplier pending" value={money(sum(supplierRows, false), ccy(supplierRows))} tone="warn" />
        <Stat label="Duty paid" value={money(dutyPaid, "INR")} tone="ok" />
        <Stat label="Duty due" value={money(dutyDue, "INR")} tone="warn" />
        <Stat label="WHL fees paid" value={money(feePaid, ccy(feeRows))} tone="ok" />
        <Stat label={feeHeld ? `WHL fees due · ${feeHeld} lot(s) held` : "WHL fees due"}
          value={money(feeDue, ccy(feeRows))} tone="warn" />
      </div>

      {/* sub-nav */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => goTab(t)}
            className={cn("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm transition",
              tab === t ? "border-primary bg-accent-soft font-semibold text-primary" : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {t}
            {badge[t] ? <span className="rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{badge[t]}</span> : null}
          </button>
        ))}
      </div>

      {tab === "WHL testing" ? (
        <Panel>
          <p className="mb-2 text-xs text-muted-foreground">
            White Horse Laboratories bills for the <b className="text-foreground">testing</b>, per work order — a
            different document from the test report and separate from the supplier&apos;s material payment, so book it
            to the order rather than to the supplier. The <b className="text-foreground">terms come off the lab&apos;s
            invoice mail</b> and are never chosen here: on <b>credit</b> the lab tests on account, so an unpaid fee
            owes money but blocks nothing; on <b>advance</b>{" "}WHL holds the lot until the transfer clears, which stops
            the bench and the order&apos;s testing gate with it.
          </p>
          <DataTable columns={feeCols} rows={feeRows}
            isExpanded={(r) => r.id === feeRowId}
            renderExpanded={(r) => (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  Pay {money(r.gross, r.currency)} to {r.lot.lab ?? "WHL"} for {r.invoice?.invoiceNo} · quote{" "}
                  <b className="text-foreground">WO {r.lot.workOrderNo} / {r.lot.lotCode}</b> so the lab can reconcile it —
                  transfer reference:
                </span>
                <Input value={feeRef} onChange={(e) => setFeeRef(e.target.value)} className="w-56" placeholder="TT-WHL-INV-352146" />
                <Button onClick={() => { markLabFeePaid(r.orderId, r.lot.id, { paidRef: feeRef.trim() || undefined }); setFeeRowId(null); }}>Mark paid</Button>
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setFeeRowId(null)}>cancel</button>
              </div>
            )}
            empty="No testing invoice yet — one appears per work order once the lab bills it (it arrives on the WHL thread)." />
          <p className="mt-2 text-[11px] text-faint">
            Recording it here is the same action the testing workspace offers on the lot; normally WHL&apos;s own payment
            acknowledgement lands on the thread and settles it without anyone typing.
          </p>
        </Panel>
      ) : tab === "Customs / ICEGATE" ? (
        <Panel>
          <p className="mb-2 text-xs text-muted-foreground">India import duty (BCD + SWS + IGST) per Bill of Entry. Pay on ICEGATE and attach the challan/invoice; Out-of-Charge is then released on the Customs desk.</p>
          <DataTable columns={dutyCols} rows={dutyRows}
            isExpanded={(r) => r.ce.id === payingId}
            renderExpanded={(r) => (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Pay {money(r.ce.duty?.totalDuty ?? r.ce.totalDuty, r.ce.currency)} · attach duty challan / invoice:</span>
                <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} className="w-56" placeholder="DUTY-BE-1234567.pdf" />
                <Button onClick={() => { payDuty(r.orderId, r.ce.id, invoice.trim() || undefined); setPayingId(null); }}>Mark paid</Button>
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setPayingId(null)}>cancel</button>
              </div>
            )}
            empty="No BoE filed yet — duty appears once a Bill of Entry is filed." />
        </Panel>
      ) : (
        <Panel>
          <DataTable columns={paymentCols}
            rows={tab === "Client → 1Buy" ? clientRows : tab === "1Buy → Supplier" ? supplierRows : rows}
            isExpanded={(r) => r.id === payRowId}
            renderExpanded={(r) => (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Attach payment proof / invoice for {money(r.amount, r.currency)}:</span>
                <Input value={payDoc} onChange={(e) => setPayDoc(e.target.value)} className="w-56" placeholder="PMT-ORD-1234.pdf" />
                <Button onClick={() => { setStatus(r.orderId, r.id, "PAID", payDoc.trim() || undefined); setPayRowId(null); }}>Mark paid</Button>
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setPayRowId(null)}>cancel</button>
              </div>
            )}
            empty="No payment tasks in this view." />
        </Panel>
      )}
    </div>
  );
}
