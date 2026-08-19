"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, FlaskConical, Stamp } from "lucide-react";
import { useStore } from "@/store/store";
import { allPayments, allLabFees } from "@/store/selectors";
import { Panel, Button, StatusPill, Pill, DataTable, PageHeader, type Col } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { LAB_PAYMENT_LABEL, LAB_PAYMENT_TONE, LAB_TERMS_LABEL, LAB_TERMS_TONE, LAB_TERMS_HINT } from "@/data/enums";
import type { Tone } from "@/data/enums";
import { money, cn } from "@/lib/utils";
import type { PaymentStatus } from "@/types";

const TABS = ["All", "By order", "Client → 1Buy", "1Buy → Supplier", "Customs / ICEGATE", "WHL testing"] as const;
type PayTab = (typeof TABS)[number];

// URL slugs so tabs are deep-linkable / redirectable: /fulfilment/payments?tab=supplier
const TAB_SLUG: Record<PayTab, string> = { All: "all", "By order": "order", "Client → 1Buy": "client", "1Buy → Supplier": "supplier", "Customs / ICEGATE": "customs", "WHL testing": "whl" };
const SLUG_TAB: Record<string, PayTab> = { all: "All", order: "By order", client: "Client → 1Buy", supplier: "1Buy → Supplier", customs: "Customs / ICEGATE", whl: "WHL testing" };

/**
 * One notion of "open" across all four ledgers on this page: money still owed. A payment row
 * that was refunded or cancelled is closed — nobody is going to pay it — which is why this is
 * narrower than `status !== "PAID"`.
 */
const paymentOpen = (s: PaymentStatus) => s === "PENDING" || s === "INITIATED";

/**
 * The status filter. It segregates by what's outstanding vs what's on the record — row-level on
 * the per-leg tabs, and whole-order on the By-order tab, where an order counts as settled only
 * once every one of its legs is.
 */
const MONEY_FILTERS = ["All", "Pending", "Settled"] as const;
type MoneyFilter = (typeof MONEY_FILTERS)[number];

/** Pending first, everywhere: what still owes money is the work, the rest is the record. */
const openFirst = <T,>(arr: T[], isOpen: (r: T) => boolean) =>
  [...arr].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)));

const keep = <T,>(arr: T[], isOpen: (r: T) => boolean, f: MoneyFilter) =>
  f === "All" ? arr : arr.filter((r) => isOpen(r) === (f === "Pending"));

// ---- the By-order view's unified leg -------------------------------------------------
// All four ledgers answer the same three questions per order (what leg, how much, still owed?),
// so the grouped view flattens them into one row shape. Status cell, action button and the
// attach-then-pay editor are the *same nodes* the per-leg tabs render — the grouped view is a
// different cut of these ledgers, never a second implementation of them.
type LegKind = "CLIENT" | "SUPPLIER" | "DUTY" | "WHL";
const LEG: Record<LegKind, { label: string; tone: Tone }> = {
  CLIENT: { label: "Client → 1Buy", tone: "info" },
  SUPPLIER: { label: "1Buy → Supplier", tone: "neutral" },
  DUTY: { label: "Customs duty", tone: "active" },
  WHL: { label: "WHL testing", tone: "neutral" },
};

interface Leg {
  id: string;
  kind: LegKind;
  orderId: string;
  orderNo: string;
  detail: React.ReactNode;
  amount?: number;
  currency: string;
  due?: string;
  open: boolean;
  status: React.ReactNode;
  action: React.ReactNode;
  expanded: boolean;
  editor: React.ReactNode;
}

/** Legs land in different currencies (duty in INR, material in USD) — never add them up. */
function totalsByCurrency(legs: Leg[]) {
  const m = new Map<string, number>();
  legs.forEach((l) => m.set(l.currency, (m.get(l.currency) ?? 0) + (l.amount ?? 0)));
  return [...m.entries()].filter(([, v]) => v > 0).map(([c, v]) => money(v, c)).join(" + ");
}

/**
 * One card per money leg, reading the same way every time: what's still owed on the left (the
 * work), what's already settled on the right (the record). Four legs, four cards — the tiles this
 * replaced were eight equal boxes that never said which pair belonged together.
 */
function LegSummary({
  icon: Icon, label, note, due, dueCount, settled, currency, held,
}: { icon: typeof ArrowDownLeft; label: string; note: string; due: number; dueCount: number; settled: number; currency: string; held?: number }) {
  // an open leg with no amount yet is a real state (a BoE awaiting assessment, an invoice not in)
  const dueText = due > 0 ? money(due, currency) : dueCount > 0 ? "not assessed" : "—";
  return (
    <div className="flex overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
      {/* the accent is a painted strip, not a coloured border: `border-l-warn` &co. are overridden
          app-wide by the unlayered `* { border-color }` rule in globals.css */}
      <span className={cn("w-1 shrink-0", dueCount > 0 ? "bg-warn" : "bg-ok")} aria-hidden />
      <div className="min-w-0 flex-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        {held ? <Pill tone="bad">{held} lot(s) held</Pill> : dueCount > 0 ? <Pill tone="warn">{dueCount} open</Pill> : <Pill tone="ok">clear</Pill>}
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <span>
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-faint">outstanding</span>
          <span className={cn("block tnum font-bold", due > 0 ? "text-xl text-warn" : dueCount > 0 ? "text-base text-warn" : "text-xl text-faint")}>{dueText}</span>
        </span>
        <span className="text-right">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-faint">settled</span>
          <span className={cn("block text-base font-semibold tnum", settled > 0 ? "text-ok" : "text-faint")}>{settled > 0 ? money(settled, currency) : "—"}</span>
        </span>
      </div>
      <p className="mt-2 border-t pt-2 text-[11px] text-faint">{note}</p>
      </div>
    </div>
  );
}

/** A ledger card: bold heading + what this ledger is, then the table. */
function Ledger({
  title, sub, aside, children,
}: { title: string; sub: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius)] border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-card-2/50 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight">{title}</h2>
          <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">{sub}</p>
        </div>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
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
  const [filter, setFilter] = useState<MoneyFilter>("All");
  // By-order groups collapse; an order with nothing outstanding starts shut (see groupShown)
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
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

  const dutyOpen = (r: (typeof dutyRows)[number]) => !r.ce.dutyPaidAt;

  // ---- cells shared by the per-leg tabs and the By-order view -------------------------
  const payStatusCell = (r: (typeof rows)[number]) => <StatusPill status={r.status} />;
  const payAction = (r: (typeof rows)[number]) => paymentOpen(r.status)
    ? <Button variant="outline" onClick={() => { setPayRowId(r.id); setPayDoc(`PMT-${r.orderNo}.pdf`); }}>Mark paid</Button>
    : r.status === "PAID"
      ? <span className="text-xs text-ok">✓ paid{r.attachment ? ` · ${r.attachment}` : ""}</span>
      : <span className="text-xs text-faint">{r.status.toLowerCase()}</span>;
  const payEditor = (r: (typeof rows)[number]) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Attach payment proof / invoice for {money(r.amount, r.currency)}:</span>
      <Input value={payDoc} onChange={(e) => setPayDoc(e.target.value)} className="w-56" placeholder="PMT-ORD-1234.pdf" />
      <Button onClick={() => { setStatus(r.orderId, r.id, "PAID", payDoc.trim() || undefined); setPayRowId(null); }}>Mark paid</Button>
      <button className="text-xs text-muted-foreground hover:underline" onClick={() => setPayRowId(null)}>cancel</button>
    </div>
  );

  const dutyStatusCell = (r: (typeof dutyRows)[number]) => r.ce.dutyPaidAt
    ? <Pill tone="ok">paid {r.ce.dutyPaidAt}</Pill>
    : r.ce.duty ? <Pill tone="warn">due</Pill> : <Pill tone="neutral">pending assessment</Pill>;
  const dutyAction = (r: (typeof dutyRows)[number]) => r.ce.dutyPaidAt
    ? <span className="text-xs text-ok">✓ paid{r.ce.dutyInvoice ? ` · ${r.ce.dutyInvoice}` : ""}</span>
    : r.ce.duty
      ? <Button variant="outline" onClick={() => { setPayingId(r.ce.id); setInvoice(`DUTY-${r.ce.beNo}.pdf`); }}>Pay duty</Button>
      : <Button variant="ghost" onClick={() => router.push(`/fulfilment/customs?order=${r.orderId}`)}>Customs desk</Button>;
  const dutyEditor = (r: (typeof dutyRows)[number]) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Pay {money(r.ce.duty?.totalDuty ?? r.ce.totalDuty, r.ce.currency)} · attach duty challan / invoice:</span>
      <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} className="w-56" placeholder="DUTY-BE-1234567.pdf" />
      <Button onClick={() => { payDuty(r.orderId, r.ce.id, invoice.trim() || undefined); setPayingId(null); }}>Mark paid</Button>
      <button className="text-xs text-muted-foreground hover:underline" onClick={() => setPayingId(null)}>cancel</button>
    </div>
  );

  const feeStatusCell = (r: (typeof feeRows)[number]) => (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Pill tone={LAB_PAYMENT_TONE[r.pay.status]}>{LAB_PAYMENT_LABEL[r.pay.status]}</Pill>
      {r.blocking && <Pill tone="bad" title="Advance terms and unpaid — WHL is holding the lot, so testing hasn't started.">lot held</Pill>}
    </span>
  );
  const feeAction = (r: (typeof feeRows)[number]) => !r.unpaid
    ? <span className="text-xs text-ok">✓ paid{r.pay.paidRef ? ` · ${r.pay.paidRef}` : ""}</span>
    : r.invoice
      ? <Button variant={r.blocking ? "default" : "outline"} onClick={() => { setFeeRowId(r.id); setFeeRef(`TT-${r.invoice!.invoiceNo}`); }}>Mark paid</Button>
      // no invoice to pay yet: chasing it (or entering it by hand) belongs on the acting screen
      : <Button variant="ghost" onClick={() => router.push(`/fulfilment/testing/${r.orderId}`)}>Enter / chase invoice</Button>;
  const feeEditor = (r: (typeof feeRows)[number]) => (
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
  );

  const paymentCols: Col<(typeof rows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/orders/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "dir", header: "Direction", render: (r) => <Pill tone={r.direction === "CLIENT_TO_1BUY" ? "info" : "neutral"}>{r.direction === "CLIENT_TO_1BUY" ? "Client → 1Buy" : "1Buy → Supplier"}</Pill> },
    { key: "party", header: "Party", render: (r) => (
      <span>
        <span className="block text-sm font-medium">{r.party}</span>
        <span className="block text-[11px] text-faint">{r.triggerDoc}</span>
      </span>
    ) },
    { key: "mode", header: "Mode", render: (r) => <span className="text-xs text-muted-foreground">{r.mode}</span> },
    { key: "amt", header: "Amount", align: "right", render: (r) => <b>{money(r.amount, r.currency)}</b> },
    { key: "due", header: "Due", align: "right", render: (r) => <span className="text-xs tnum">{r.dueDate ?? "—"}</span> },
    { key: "status", header: "Status", render: payStatusCell },
    { key: "act", header: "", align: "right", render: payAction },
  ];

  const dutyCols: Col<(typeof dutyRows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/orders/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "be", header: "BE no", render: (r) => <span className="font-mono text-xs">{r.ce.beNo}</span> },
    { key: "port", header: "Port · CHA", render: (r) => <span className="text-xs text-muted-foreground">{r.ce.portCode ?? "—"} · {r.ce.chaName ?? "—"}</span> },
    { key: "duty", header: "BCD + SWS + IGST", align: "right", render: (r) => r.ce.duty ? <span className="text-xs tnum">{money(r.ce.duty.bcd, r.ce.currency)} + {money(r.ce.duty.sws, r.ce.currency)} + {money(r.ce.duty.igst, r.ce.currency)}</span> : <span className="text-xs text-faint">not assessed</span> },
    { key: "total", header: "Total duty", align: "right", render: (r) => <b>{money(r.ce.totalDuty ?? r.ce.duty?.totalDuty, r.ce.currency)}</b> },
    { key: "status", header: "Status", render: dutyStatusCell },
    { key: "act", header: "", align: "right", render: dutyAction },
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
      ? <span>
          <span className="block font-mono text-xs">{r.invoice.invoiceNo}</span>
          <span className="block text-[11px] text-faint">received {r.invoice.receivedAt}</span>
          {/* whoever pays this should know whether it's the lab's mail or our transcription */}
          {r.invoice.source === "MANUAL" && (
            <Pill tone="neutral" title={`Entered by ${r.invoice.enteredBy ?? "an operator"}${r.invoice.receivedVia ? ` — received via ${r.invoice.receivedVia}` : ""}`}>entered by hand</Pill>
          )}
        </span>
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
    { key: "status", header: "Status", render: feeStatusCell },
    { key: "act", header: "", align: "right", render: feeAction },
  ];

  // ---- By order: every leg of every kind, grouped under its order ---------------------
  const legs: Leg[] = [
    ...rows.map((r): Leg => ({
      id: `pay:${r.id}`,
      kind: r.direction === "CLIENT_TO_1BUY" ? "CLIENT" : "SUPPLIER",
      orderId: r.orderId, orderNo: r.orderNo,
      detail: (
        <span>
          <span className="block text-sm">{r.party}</span>
          <span className="block text-[11px] text-faint">{r.mode}{r.triggerDoc ? ` · ${r.triggerDoc}` : ""}</span>
        </span>
      ),
      amount: r.amount, currency: r.currency, due: r.dueDate,
      open: paymentOpen(r.status),
      status: payStatusCell(r), action: payAction(r),
      expanded: r.id === payRowId, editor: payEditor(r),
    })),
    ...dutyRows.map((r): Leg => ({
      id: `duty:${r.ce.id}`,
      kind: "DUTY",
      orderId: r.orderId, orderNo: r.orderNo,
      detail: (
        <span>
          <span className="block font-mono text-xs">BE {r.ce.beNo}</span>
          <span className="block text-[11px] text-faint">{r.ce.portCode ?? "—"} · {r.ce.chaName ?? "—"}</span>
        </span>
      ),
      amount: r.ce.totalDuty ?? r.ce.duty?.totalDuty, currency: r.ce.currency ?? "INR",
      open: dutyOpen(r),
      status: dutyStatusCell(r), action: dutyAction(r),
      expanded: r.ce.id === payingId, editor: dutyEditor(r),
    })),
    ...feeRows.map((r): Leg => ({
      id: `fee:${r.id}`,
      kind: "WHL",
      orderId: r.orderId, orderNo: r.orderNo,
      detail: (
        <span>
          <span className="block text-xs font-medium">{r.lot.lotCode} · {r.lot.lab ?? "WHL"}</span>
          <span className="block font-mono text-[11px] text-faint">{r.invoice ? r.invoice.invoiceNo : "invoice awaited"} · WO {r.lot.workOrderNo}</span>
        </span>
      ),
      amount: r.gross, currency: r.currency, due: r.invoice?.dueDate,
      open: r.unpaid,
      status: feeStatusCell(r), action: feeAction(r),
      expanded: r.id === feeRowId, editor: feeEditor(r),
    })),
  ];

  const legCols: Col<Leg>[] = [
    { key: "leg", header: "Leg", render: (l) => <Pill tone={LEG[l.kind].tone}>{LEG[l.kind].label}</Pill> },
    { key: "detail", header: "Against", render: (l) => l.detail },
    { key: "amt", header: "Amount", align: "right", render: (l) => l.amount ? <b>{money(l.amount, l.currency)}</b> : <span className="text-xs text-faint">not assessed</span> },
    { key: "due", header: "Due", align: "right", render: (l) => <span className="text-xs tnum">{l.due ?? "—"}</span> },
    { key: "status", header: "Status", render: (l) => l.status },
    { key: "act", header: "", align: "right", render: (l) => l.action },
  ];

  // Orders with money still owed float to the top, and inside each group so do the open legs.
  const groups = Object.values(orders)
    .map((o) => {
      const mine = legs.filter((l) => l.orderId === o.id);
      const open = mine.filter((l) => l.open);
      return {
        order: o,
        legs: keep(openFirst(mine, (l) => l.open), (l) => l.open, filter),
        open, settled: mine.filter((l) => !l.open),
      };
    })
    .filter((g) => g.legs.length > 0 && (filter === "All" || (filter === "Pending") === (g.open.length > 0)))
    .sort((a, b) => Number(b.open.length > 0) - Number(a.open.length > 0) || (a.order.orderNo < b.order.orderNo ? 1 : -1));

  // Fully-settled orders are the record, not the work — they start collapsed, until clicked.
  // Unless you asked for exactly those: under the Settled filter they're the subject, so open them.
  const groupShown = (g: (typeof groups)[number]) =>
    toggled[g.order.id] ?? (g.open.length > 0 || filter === "Settled");

  // ---- filtered per-leg ledgers -------------------------------------------------------
  const fClient = keep(openFirst(clientRows, (r) => paymentOpen(r.status)), (r) => paymentOpen(r.status), filter);
  const fSupplier = keep(openFirst(supplierRows, (r) => paymentOpen(r.status)), (r) => paymentOpen(r.status), filter);
  const fAll = keep(openFirst(rows, (r) => paymentOpen(r.status)), (r) => paymentOpen(r.status), filter);
  const fDuty = keep(openFirst(dutyRows, dutyOpen), dutyOpen, filter);
  const fFee = keep(openFirst(feeRows, (r) => r.unpaid), (r) => r.unpaid, filter);

  /**
   * Pending/Settled subhead bands — only when a table actually mixes the two (under a Pending or
   * Settled filter every row is the same, and a single band would just be a label on the label).
   */
  const bandsFor = <T,>(list: T[], isOpen: (r: T) => boolean) => {
    const openN = list.filter(isOpen).length;
    const doneN = list.length - openN;
    return openN > 0 && doneN > 0
      ? (r: T) => (isOpen(r) ? `Pending · ${openN}` : `Settled · ${doneN}`)
      : undefined;
  };

  // KPI helpers (per-group currency — amounts are illustrative)
  const ccy = (arr: { currency: string }[]) => arr[0]?.currency ?? "USD";
  const sum = (arr: { amount: number; status: string }[], paid: boolean) => arr.filter((r) => (r.status === "PAID") === paid).reduce((a, r) => a + r.amount, 0);
  const dutyPaid = dutyRows.filter((r) => r.ce.dutyPaidAt).reduce((a, r) => a + (r.ce.totalDuty ?? r.ce.duty?.totalDuty ?? 0), 0);
  const dutyDue = dutyRows.filter((r) => !r.ce.dutyPaidAt && r.ce.duty).reduce((a, r) => a + (r.ce.duty!.totalDuty), 0);
  const feePaid = feeRows.filter((r) => !r.unpaid).reduce((a, r) => a + r.gross, 0);
  const feeDue = feeRows.filter((r) => r.unpaid).reduce((a, r) => a + r.gross, 0);
  const feeHeld = feeRows.filter((r) => r.blocking).length;

  // badges follow the filter, so it's obvious what each tab holds under the current cut
  const badge: Record<PayTab, number> = {
    All: fAll.length + fDuty.length,
    "By order": groups.length,
    "Client → 1Buy": fClient.length,
    "1Buy → Supplier": fSupplier.length,
    "Customs / ICEGATE": fDuty.length,
    "WHL testing": fFee.length,
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Every money movement across the trade, split by leg: client collection, supplier payout, India customs duty (ICEGATE), and WHL's fee for the testing itself." />

      {/* one card per leg: outstanding (the work) beside settled (the record) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LegSummary icon={ArrowDownLeft} label="Client → 1Buy" note="What our buyers owe us, per PI" currency={ccy(clientRows)}
          due={sum(clientRows, false)} dueCount={clientRows.filter((r) => paymentOpen(r.status)).length}
          settled={sum(clientRows, true)} />
        <LegSummary icon={ArrowUpRight} label="1Buy → Supplier" note="What we owe suppliers, per their PI" currency={ccy(supplierRows)}
          due={sum(supplierRows, false)} dueCount={supplierRows.filter((r) => paymentOpen(r.status)).length}
          settled={sum(supplierRows, true)} />
        <LegSummary icon={Stamp} label="Customs duty" note="BCD + SWS + IGST, per Bill of Entry" currency="INR"
          due={dutyDue} dueCount={dutyRows.filter(dutyOpen).length} settled={dutyPaid} />
        <LegSummary icon={FlaskConical} label="WHL testing" note="The lab's own fee, per work order" currency={ccy(feeRows)}
          due={feeDue} dueCount={feeRows.filter((r) => r.unpaid).length}
          settled={feePaid} held={feeHeld} />
      </div>

      {/* sub-nav */}
      <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b">
        {TABS.map((t) => (
          <button key={t} onClick={() => goTab(t)}
            className={cn("-mb-px inline-flex items-center gap-1.5 whitespace-nowrap rounded-t-lg border-b-2 px-3 py-2 text-sm transition",
              tab === t ? "border-primary bg-accent-soft font-semibold text-primary" : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {t}
            {badge[t] ? (
              <span className={cn("rounded-full px-1.5 text-[10px] font-bold",
                tab === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{badge[t]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* status filter — one cut across whichever ledger is on screen */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Show</span>
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {MONEY_FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("rounded-md px-3 py-1 text-xs font-semibold transition",
                filter === f ? "bg-accent-soft text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {f === "All" ? "All statuses" : f === "Pending" ? "Pending / due" : "Settled"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-faint">
          {tab === "By order" ? "pending orders first, and pending legs first inside each" : "pending rows sort above settled ones"}
        </span>
      </div>

      {tab === "By order" ? (
        <div className="space-y-3">
          <div className="rounded-[var(--radius)] border bg-card px-4 py-3 shadow-sm">
            <h2 className="text-base font-bold tracking-tight">Grouped by order</h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              Every money leg booked against an order — client collection, supplier payout, customs duty and
              WHL&apos;s testing fee — with the same actions the per-leg tabs offer. Amounts are kept per currency
              (duty is in INR) and never added together. Orders with something outstanding come first; an order is
              only <b className="text-foreground">fully settled</b> once every one of its legs is.
            </p>
          </div>
          {groups.length === 0 ? (
            <Panel>
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {filter === "Pending" ? "No order has money outstanding 🎉" : filter === "Settled" ? "No fully-settled order yet." : "No payment tasks on any order yet."}
              </div>
            </Panel>
          ) : groups.map((g) => {
            const shown = groupShown(g);
            const outstanding = totalsByCurrency(g.open);
            return (
              <div key={g.order.id} className="flex overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
                <span className={cn("w-1 shrink-0", g.open.length > 0 ? "bg-warn" : "bg-ok")} aria-hidden />
                <div className="min-w-0 flex-1">
                {/* the toggle is its own button so the "order flow" link isn't nested inside it */}
                <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-3", shown && "border-b bg-card-2/50")}>
                  <button onClick={() => setToggled((t) => ({ ...t, [g.order.id]: !shown }))}
                    aria-expanded={shown}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                    {shown ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block font-mono text-sm font-bold tracking-tight text-primary">{g.order.orderNo}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {g.order.buyer.name} <span className="text-faint">→</span> {g.order.supplier.name}
                      </span>
                    </span>
                  </button>
                  <span className="flex flex-wrap items-center gap-3">
                    <span className="text-right">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-faint">
                        {g.open.length > 0 ? `outstanding · ${g.open.length} leg(s)` : "all legs settled"}
                      </span>
                      <span className={cn("block text-sm font-bold tnum", g.open.length > 0 ? "text-warn" : "text-ok")}>
                        {g.open.length > 0 ? (outstanding || "not assessed") : totalsByCurrency(g.settled) || "—"}
                      </span>
                    </span>
                    <Pill tone="neutral">{g.settled.length} settled</Pill>
                    <Link href={`/fulfilment/order-flow/${g.order.id}`} className="text-xs font-semibold text-primary hover:underline">order flow →</Link>
                  </span>
                </div>
                {shown && (
                  <div className="p-4">
                    <DataTable columns={legCols} rows={g.legs}
                      isExpanded={(l) => l.expanded}
                      renderExpanded={(l) => l.editor}
                      sectionOf={bandsFor(g.legs, (l) => l.open)}
                      rowMuted={(l) => !l.open}
                      empty="No payment leg in this view." />
                  </div>
                )}
                </div>
              </div>
            );
          })}
        </div>
      ) : tab === "WHL testing" ? (
        <Ledger
          title="WHL testing fee"
          aside={feeHeld ? <Pill tone="bad">{feeHeld} lot(s) held</Pill> : undefined}
          sub={<>
            White Horse Laboratories bills for the <b className="text-foreground">testing</b>, per work order — a
            different document from the test report and separate from the supplier&apos;s material payment, so book it
            to the order rather than to the supplier. The <b className="text-foreground">terms come off the lab&apos;s
            invoice mail</b> and are never chosen here: on <b>credit</b> the lab tests on account, so an unpaid fee
            owes money but blocks nothing; on <b>advance</b>{" "}WHL holds the lot until the transfer clears, which stops
            the bench and the order&apos;s testing gate with it.
          </>}>
          <DataTable columns={feeCols} rows={fFee}
            isExpanded={(r) => r.id === feeRowId}
            renderExpanded={feeEditor}
            sectionOf={bandsFor(fFee, (r) => r.unpaid)}
            rowMuted={(r) => !r.unpaid}
            empty="No testing invoice yet — one appears per work order once the lab bills it (it arrives on the WHL thread)." />
          <p className="mt-3 border-t pt-2 text-[11px] text-faint">
            Recording it here is the same action the testing workspace offers on the lot; normally WHL&apos;s own payment
            acknowledgement lands on the thread and settles it without anyone typing.
          </p>
        </Ledger>
      ) : tab === "Customs / ICEGATE" ? (
        <Ledger
          title="Customs duty · ICEGATE"
          sub="India import duty (BCD + SWS + IGST) per Bill of Entry. Pay on ICEGATE and attach the challan/invoice; Out-of-Charge is then released on the Customs desk.">
          <DataTable columns={dutyCols} rows={fDuty}
            isExpanded={(r) => r.ce.id === payingId}
            renderExpanded={dutyEditor}
            sectionOf={bandsFor(fDuty, dutyOpen)}
            rowMuted={(r) => !dutyOpen(r)}
            empty="No BoE filed yet — duty appears once a Bill of Entry is filed." />
        </Ledger>
      ) : (
        <Ledger
          title={tab === "Client → 1Buy" ? "Client collection" : tab === "1Buy → Supplier" ? "Supplier payout" : "All material payments"}
          sub={tab === "Client → 1Buy"
            ? "What our buyers owe 1Buy against our PI — the money-in leg."
            : tab === "1Buy → Supplier"
              ? "What 1Buy owes its suppliers against their PI — the money-out leg."
              : "Both material legs in one list: client collections and supplier payouts. Customs duty and the lab fee have their own tabs, and the By-order tab folds all four together."}>
          <DataTable columns={paymentCols}
            rows={tab === "Client → 1Buy" ? fClient : tab === "1Buy → Supplier" ? fSupplier : fAll}
            isExpanded={(r) => r.id === payRowId}
            renderExpanded={payEditor}
            sectionOf={bandsFor(tab === "Client → 1Buy" ? fClient : tab === "1Buy → Supplier" ? fSupplier : fAll, (r) => paymentOpen(r.status))}
            rowMuted={(r) => !paymentOpen(r.status)}
            empty="No payment tasks in this view." />
        </Ledger>
      )}
    </div>
  );
}
