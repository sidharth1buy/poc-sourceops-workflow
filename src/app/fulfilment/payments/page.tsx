"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "@/store/store";
import { allPayments } from "@/store/selectors";
import { Panel, Button, StatusPill, Pill, DataTable, PageHeader, type Col } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { money, cn } from "@/lib/utils";

const TABS = ["All", "Client → 1Buy", "1Buy → Supplier", "Customs / ICEGATE"] as const;
type PayTab = (typeof TABS)[number];

// URL slugs so tabs are deep-linkable / redirectable: /fulfilment/payments?tab=supplier
const TAB_SLUG: Record<PayTab, string> = { All: "all", "Client → 1Buy": "client", "1Buy → Supplier": "supplier", "Customs / ICEGATE": "customs" };
const SLUG_TAB: Record<string, PayTab> = { all: "All", client: "Client → 1Buy", supplier: "1Buy → Supplier", customs: "Customs / ICEGATE" };

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
  const router = useRouter();
  const params = useSearchParams();
  const rows = allPayments(orders);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [invoice, setInvoice] = useState("");
  // regular payments (client/supplier) — attach-then-pay, mirrors the Customs duty flow
  const [payRowId, setPayRowId] = useState<string | null>(null);
  const [payDoc, setPayDoc] = useState("");
  const [tab, setTab] = useState<PayTab>(SLUG_TAB[params.get("tab") ?? ""] ?? "All");
  const goTab = (t: PayTab) => { setTab(t); router.replace(`/fulfilment/payments?tab=${TAB_SLUG[t]}`); };

  const clientRows = rows.filter((r) => r.direction === "CLIENT_TO_1BUY");
  const supplierRows = rows.filter((r) => r.direction === "1BUY_TO_SUPPLIER");
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

  // KPI helpers (per-group currency — amounts are illustrative)
  const ccy = (arr: { currency: string }[]) => arr[0]?.currency ?? "USD";
  const sum = (arr: { amount: number; status: string }[], paid: boolean) => arr.filter((r) => (r.status === "PAID") === paid).reduce((a, r) => a + r.amount, 0);
  const dutyPaid = dutyRows.filter((r) => r.ce.dutyPaidAt).reduce((a, r) => a + (r.ce.totalDuty ?? r.ce.duty?.totalDuty ?? 0), 0);
  const dutyDue = dutyRows.filter((r) => !r.ce.dutyPaidAt && r.ce.duty).reduce((a, r) => a + (r.ce.duty!.totalDuty), 0);

  const badge: Record<PayTab, number> = {
    All: rows.length + dutyRows.length,
    "Client → 1Buy": clientRows.length,
    "1Buy → Supplier": supplierRows.length,
    "Customs / ICEGATE": dutyRows.length,
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Every money movement across the trade, split by leg: client collection, supplier payout, and India customs duty (ICEGATE)." />

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Client collected" value={money(sum(clientRows, true), ccy(clientRows))} tone="ok" />
        <Stat label="Client pending" value={money(sum(clientRows, false), ccy(clientRows))} tone="warn" />
        <Stat label="Supplier paid" value={money(sum(supplierRows, true), ccy(supplierRows))} tone="ok" />
        <Stat label="Supplier pending" value={money(sum(supplierRows, false), ccy(supplierRows))} tone="warn" />
        <Stat label="Duty paid" value={money(dutyPaid, "INR")} tone="ok" />
        <Stat label="Duty due" value={money(dutyDue, "INR")} tone="warn" />
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

      {tab === "Customs / ICEGATE" ? (
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
