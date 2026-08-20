"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight, FlaskConical, Search, Stamp, Upload } from "lucide-react";
import { useStore } from "@/store/store";
import { allPayments, allLabFees } from "@/store/selectors";
import { Panel, Button, StatusPill, Pill, DataTable, PageHeader, Pagination, type Col } from "@/components/ui/primitives";
import { LAB_PAYMENT_LABEL, LAB_PAYMENT_TONE } from "@/data/enums";
import type { Tone } from "@/data/enums";
import { money, cn } from "@/lib/utils";
import type { PaymentMode, PaymentStatus } from "@/types";

/**
 * One notion of "open" across all four ledgers on this page: money still owed. A payment row
 * that was refunded or cancelled is closed — nobody is going to pay it — which is why this is
 * narrower than `status !== "PAID"`.
 */
const paymentOpen = (s: PaymentStatus) => s === "PENDING" || s === "INITIATED";

const MONEY_FILTERS = ["All", "Pending", "Settled"] as const;
type MoneyFilter = (typeof MONEY_FILTERS)[number];

/**
 * Pending first, everywhere: what still owes money is the work, the rest is the record. Within
 * the open group, the most urgent (overdue, then due-soon/escrow) sort to the very top — so
 * Finance sees what needs doing first without having to scan the whole list.
 */
const openFirst = <T,>(arr: T[], isOpen: (r: T) => boolean, urgencyRank?: (r: T) => number) =>
  [...arr].sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (urgencyRank ? urgencyRank(a) - urgencyRank(b) : 0));

const keep = <T,>(arr: T[], isOpen: (r: T) => boolean, f: MoneyFilter) =>
  f === "All" ? arr : arr.filter((r) => isOpen(r) === (f === "Pending"));

type Urgency = { tone: "bad" | "warn"; label: string; rank: 0 | 1 };
const URGENT_WITHIN_DAYS = 5;

/** Date-only urgency (overdue / due-soon) — applies to any leg that carries a due date. */
function dateUrgency(dueDate: string | undefined, open: boolean): Urgency | undefined {
  if (!open || !dueDate) return undefined;
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return { tone: "bad", label: `Overdue ${Math.abs(days)}d`, rank: 0 };
  if (days <= URGENT_WITHIN_DAYS) return { tone: "warn", label: days <= 0 ? "Due today" : `${days}d left`, rank: 1 };
  return undefined;
}
/**
 * Which open payments Finance should act on first: overdue by date, due within
 * URGENT_WITHIN_DAYS, or ESCROW mode — funding the escrow account is time-critical the moment
 * it's pending, regardless of any stated due date, since it blocks the whole order until funded.
 */
function paymentUrgency(mode: PaymentMode, dueDate: string | undefined, open: boolean): Urgency | undefined {
  const base = dateUrgency(dueDate, open);
  if (base) return base;
  if (open && mode === "ESCROW") return { tone: "warn", label: "Fund escrow", rank: 1 };
  return undefined;
}

// ---- the unified leg — every ledger (client/supplier/duty/WHL) answers the same questions
// (what leg, against what, how much, still owed, due when, can it be paid right now) so both the
// unified worklist and the By-order view read off one normalized shape, never a second implementation.
type LegKind = "CLIENT" | "SUPPLIER" | "DUTY" | "WHL";
const LEG: Record<LegKind, { label: string; tone: Tone }> = {
  CLIENT: { label: "Client → 1Buy", tone: "info" },
  SUPPLIER: { label: "1Buy → Supplier", tone: "neutral" },
  DUTY: { label: "Customs duty", tone: "active" },
  WHL: { label: "WHL testing", tone: "neutral" },
};
type LegFilter = "ALL" | LegKind;

interface Leg {
  id: string;
  kind: LegKind;
  orderId: string;
  orderNo: string;
  party: string; // plain text for search — `detail` below is what actually renders
  detail: React.ReactNode;
  amount?: number;
  currency: string;
  due?: string;
  open: boolean;
  statusNode: React.ReactNode;
  urgency?: Urgency;
  // inline "attach proof, mark paid" action — every leg boils down to this one shape once payable
  payable: boolean;          // false while there's nothing concrete to pay yet (duty not assessed / WHL invoice not in)
  blocking?: boolean;        // WHL lot held on unpaid advance terms — the button reads stronger
  defaultProof: string;
  onMarkPaid: (proof?: string) => void;
  awaiting?: React.ReactNode; // shown instead of the inline action while !payable
  paidLabel?: React.ReactNode; // shown instead of the inline action once !open
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
  icon: Icon, label, note, due, dueCount, settled, currency, held, urgentCount,
}: { icon: typeof ArrowDownLeft; label: string; note: string; due: number; dueCount: number; settled: number; currency: string; held?: number; urgentCount?: number }) {
  const dueText = due > 0 ? money(due, currency) : dueCount > 0 ? "not assessed" : "—";
  return (
    <div className="flex overflow-hidden rounded-[var(--radius)] border bg-card shadow-sm">
      {/* the accent is a painted strip, not a coloured border: `border-l-warn` &co. are overridden
          app-wide by the unlayered `* { border-color }` rule in globals.css */}
      <span className={cn("w-1 shrink-0", urgentCount ? "bg-bad" : dueCount > 0 ? "bg-warn" : "bg-ok")} aria-hidden />
      <div className="min-w-0 flex-1 p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        {held ? <Pill tone="bad">{held} lot(s) held</Pill>
          : urgentCount ? <Pill tone="bad">{urgentCount} urgent</Pill>
          : dueCount > 0 ? <Pill tone="warn">{dueCount} open</Pill> : <Pill tone="ok">clear</Pill>}
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

const WORKLIST_PAGE_SIZE = 15;
const ORDER_PAGE_SIZE = 10;
const filterInput = "rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary";
const filterLabel = "text-[11px] font-bold uppercase tracking-wide text-muted-foreground";

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

  // Legacy deep-link support: other pages still navigate in as `?tab=customs`/`whl`/etc.
  // (see the Customs desk's "Pay on Payments" button) — map that one-time into the new
  // view/leg-filter state instead of dropping the link.
  const initialTab = params.get("tab") ?? "";
  const [view, setView] = useState<"worklist" | "byOrder">(initialTab === "order" ? "byOrder" : "worklist");
  const [search, setSearch] = useState("");
  const [legFilter, setLegFilter] = useState<LegFilter>(
    initialTab === "customs" ? "DUTY" : initialTab === "whl" ? "WHL" : initialTab === "client" ? "CLIENT" : initialTab === "supplier" ? "SUPPLIER" : "ALL",
  );
  const [filter, setFilter] = useState<MoneyFilter>("All");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [page, setPage] = useState(1);
  // By-order groups collapse; an order with nothing outstanding starts shut (see groupShown)
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  // per-row proof/reference value for the inline "attach & mark paid" action — every open, payable
  // leg keeps its own draft here regardless of which other rows are mid-edit; nothing is bulk.
  const [proofByRow, setProofByRow] = useState<Record<string, string>>({});

  const resetPaging = () => setPage(1);

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

  // ---- one normalized leg per row across all four ledgers -----------------------------
  const legs: Leg[] = [
    ...rows.map((r): Leg => ({
      id: `pay:${r.id}`,
      kind: r.direction === "CLIENT_TO_1BUY" ? "CLIENT" : "SUPPLIER",
      orderId: r.orderId, orderNo: r.orderNo, party: r.party,
      detail: (
        <span>
          <span className="block text-sm">{r.party}</span>
          <span className="block text-[11px] text-faint">{r.mode}{r.triggerDoc ? ` · ${r.triggerDoc}` : ""}</span>
        </span>
      ),
      amount: r.amount, currency: r.currency, due: r.dueDate,
      open: paymentOpen(r.status),
      statusNode: <StatusPill status={r.status} />,
      urgency: paymentUrgency(r.mode, r.dueDate, paymentOpen(r.status)),
      payable: true,
      defaultProof: `PMT-${r.orderNo}.pdf`,
      onMarkPaid: (proof) => setStatus(r.orderId, r.id, "PAID", proof),
      paidLabel: r.status === "PAID"
        ? <span className="text-xs text-ok">✓ paid{r.attachment ? ` · ${r.attachment}` : ""}</span>
        : <span className="text-xs text-faint">{r.status.toLowerCase()}</span>,
    })),
    ...dutyRows.map((r): Leg => ({
      id: `duty:${r.ce.id}`,
      kind: "DUTY",
      orderId: r.orderId, orderNo: r.orderNo, party: `${r.ce.portCode ?? ""} ${r.ce.chaName ?? ""}`.trim() || r.orderNo,
      detail: (
        <span>
          <span className="block font-mono text-xs">BE {r.ce.beNo}</span>
          <span className="block text-[11px] text-faint">{r.ce.portCode ?? "—"} · {r.ce.chaName ?? "—"}</span>
        </span>
      ),
      amount: r.ce.totalDuty ?? r.ce.duty?.totalDuty, currency: r.ce.currency ?? "INR",
      open: dutyOpen(r),
      statusNode: r.ce.dutyPaidAt
        ? <Pill tone="ok">paid {r.ce.dutyPaidAt}</Pill>
        : r.ce.duty ? <Pill tone="warn">due</Pill> : <Pill tone="neutral">pending assessment</Pill>,
      payable: !!r.ce.duty,
      defaultProof: `DUTY-${r.ce.beNo}.pdf`,
      onMarkPaid: (proof) => payDuty(r.orderId, r.ce.id, proof),
      awaiting: <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => router.push(`/fulfilment/customs?order=${r.orderId}`)}>Customs desk</Button>,
      paidLabel: <span className="text-xs text-ok">✓ paid{r.ce.dutyInvoice ? ` · ${r.ce.dutyInvoice}` : ""}</span>,
    })),
    ...feeRows.map((r): Leg => ({
      id: `fee:${r.id}`,
      kind: "WHL",
      orderId: r.orderId, orderNo: r.orderNo, party: r.lot.lab ?? "WHL",
      detail: (
        <span>
          <span className="block text-xs font-medium">{r.lot.lotCode} · {r.lot.lab ?? "WHL"}</span>
          <span className="block font-mono text-[11px] text-faint">{r.invoice ? r.invoice.invoiceNo : "invoice awaited"} · WO {r.lot.workOrderNo}</span>
        </span>
      ),
      amount: r.gross, currency: r.currency, due: r.invoice?.dueDate,
      open: r.unpaid,
      statusNode: (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <Pill tone={LAB_PAYMENT_TONE[r.pay.status]}>{LAB_PAYMENT_LABEL[r.pay.status]}</Pill>
          {r.blocking && <Pill tone="bad" title="Advance terms and unpaid — WHL is holding the lot, so testing hasn't started.">lot held</Pill>}
        </span>
      ),
      urgency: dateUrgency(r.invoice?.dueDate, r.unpaid),
      payable: !!r.invoice,
      blocking: r.blocking,
      defaultProof: r.invoice ? `TT-${r.invoice.invoiceNo}` : "",
      onMarkPaid: (proof) => markLabFeePaid(r.orderId, r.lot.id, { paidRef: proof }),
      awaiting: <Button variant="ghost" className="h-7 px-2 text-xs" onClick={() => router.push(`/fulfilment/testing/${r.orderId}`)}>Enter / chase invoice</Button>,
      paidLabel: <span className="text-xs text-ok">✓ paid{r.pay.paidRef ? ` · ${r.pay.paidRef}` : ""}</span>,
    })),
  ];

  // ---- one inline action cell every leg kind collapses to: attach proof, mark paid ----
  const ActionCell = (l: Leg) => {
    if (!l.open) return l.paidLabel;
    if (!l.payable) return l.awaiting;
    const chosen = proofByRow[l.id];
    const val = chosen ?? l.defaultProof;
    const inputId = `proof-${l.id}`;
    return (
      <div className="flex items-center justify-end gap-1.5">
        <label htmlFor={inputId} title={chosen ? val : "Upload payment proof"}
          className="flex h-7 max-w-[9rem] cursor-pointer items-center gap-1 truncate rounded-lg border bg-card px-2 text-xs text-muted-foreground transition hover:border-primary hover:text-foreground">
          <Upload className="h-3 w-3 shrink-0" />
          <span className="truncate">{chosen ?? "Upload proof"}</span>
        </label>
        <input id={inputId} type="file" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setProofByRow((m) => ({ ...m, [l.id]: f.name })); }} />
        <Button variant={l.blocking ? "default" : "outline"} className="h-7 whitespace-nowrap px-2 text-xs"
          onClick={() => {
            l.onMarkPaid(val.trim() || undefined);
            setProofByRow((m) => { const n = { ...m }; delete n[l.id]; return n; });
          }}>
          Mark paid
        </Button>
      </div>
    );
  };

  // ---- search / leg / urgency filter — shared by both the worklist and By-order views ----
  const matchesQuery = (l: Leg) => {
    if (legFilter !== "ALL" && l.kind !== legFilter) return false;
    if (urgentOnly && !l.urgency) return false;
    const q = search.trim().toLowerCase();
    if (q && !l.orderNo.toLowerCase().includes(q) && !l.party.toLowerCase().includes(q)) return false;
    return true;
  };
  const queried = legs.filter(matchesQuery);
  const totalUrgent = legs.filter((l) => l.urgency).length;

  // ---- tab bar: each tab is a fixed (view, leg) combo, badge counts respect every filter
  // except the leg itself — so a tab's own count doesn't change just because it's not selected ----
  const matchesExceptLeg = (l: Leg) => {
    if (urgentOnly && !l.urgency) return false;
    const q = search.trim().toLowerCase();
    if (q && !l.orderNo.toLowerCase().includes(q) && !l.party.toLowerCase().includes(q)) return false;
    return true;
  };
  const countForLeg = (k: LegFilter) => keep(legs.filter((l) => matchesExceptLeg(l) && (k === "ALL" || l.kind === k)), (l) => l.open, filter).length;
  const orderCountForByOrder = new Set(keep(legs.filter(matchesExceptLeg), (l) => l.open, filter).map((l) => l.orderId)).size;
  const tabDefs: { key: string; label: string; view: "worklist" | "byOrder"; leg: LegFilter; count: number }[] = [
    { key: "all", label: "All", view: "worklist", leg: "ALL", count: countForLeg("ALL") },
    { key: "order", label: "By order", view: "byOrder", leg: "ALL", count: orderCountForByOrder },
    { key: "client", label: "Client → 1Buy", view: "worklist", leg: "CLIENT", count: countForLeg("CLIENT") },
    { key: "supplier", label: "1Buy → Supplier", view: "worklist", leg: "SUPPLIER", count: countForLeg("SUPPLIER") },
    { key: "customs", label: "Customs / ICEGATE", view: "worklist", leg: "DUTY", count: countForLeg("DUTY") },
    { key: "whl", label: "WHL testing", view: "worklist", leg: "WHL", count: countForLeg("WHL") },
  ];
  const activeTab = view === "byOrder" ? "order"
    : legFilter === "ALL" ? "all" : legFilter === "CLIENT" ? "client" : legFilter === "SUPPLIER" ? "supplier" : legFilter === "DUTY" ? "customs" : "whl";

  const worklistCols: Col<Leg>[] = [
    { key: "leg", header: "Leg", render: (l) => <Pill tone={LEG[l.kind].tone}>{LEG[l.kind].label}</Pill> },
    { key: "no", header: "Order", render: (l) => <Link href={`/fulfilment/orders/${l.orderId}`} className="font-mono text-xs text-primary hover:underline">{l.orderNo}</Link> },
    { key: "detail", header: "Against", render: (l) => l.detail },
    { key: "amt", header: "Amount", align: "right", render: (l) => l.amount ? <b>{money(l.amount, l.currency)}</b> : <span className="text-xs text-faint">not assessed</span> },
    { key: "due", header: "Due", align: "right", render: (l) => (
      <span className="inline-flex flex-col items-end gap-0.5">
        <span className="text-xs tnum">{l.due ?? "—"}</span>
        {l.urgency && <Pill tone={l.urgency.tone}>{l.urgency.label}</Pill>}
      </span>
    ) },
    { key: "status", header: "Status", render: (l) => l.statusNode },
    { key: "act", header: "", align: "right", render: ActionCell },
  ];

  // ---- Worklist: one flat, urgency-sorted list across every leg -----------------------
  const worklistAll = keep(openFirst(queried, (l) => l.open, (l) => l.urgency?.rank ?? 2), (l) => l.open, filter);
  const worklistPages = Math.max(1, Math.ceil(worklistAll.length / WORKLIST_PAGE_SIZE));
  const worklistPage = Math.min(page, worklistPages);
  const worklistRows = worklistAll.slice((worklistPage - 1) * WORKLIST_PAGE_SIZE, worklistPage * WORKLIST_PAGE_SIZE);
  const worklistBand = (() => {
    const openN = worklistAll.filter((l) => l.open).length;
    const doneN = worklistAll.length - openN;
    return openN > 0 && doneN > 0 ? (l: Leg) => (l.open ? `Pending · ${openN}` : `Settled · ${doneN}`) : undefined;
  })();

  // ---- By order: every leg of every kind, grouped under its order ---------------------
  const groupsAll = Object.values(orders)
    .map((o) => {
      const mine = legs.filter((l) => l.orderId === o.id && matchesQuery(l));
      const open = mine.filter((l) => l.open);
      return {
        order: o,
        legs: keep(openFirst(mine, (l) => l.open, (l) => l.urgency?.rank ?? 2), (l) => l.open, filter),
        open, settled: mine.filter((l) => !l.open),
      };
    })
    .filter((g) => g.legs.length > 0 && (filter === "All" || (filter === "Pending") === (g.open.length > 0)))
    .sort((a, b) => Number(b.open.length > 0) - Number(a.open.length > 0) || (a.order.orderNo < b.order.orderNo ? 1 : -1));
  const orderPages = Math.max(1, Math.ceil(groupsAll.length / ORDER_PAGE_SIZE));
  const orderPage = Math.min(page, orderPages);
  const groups = groupsAll.slice((orderPage - 1) * ORDER_PAGE_SIZE, orderPage * ORDER_PAGE_SIZE);

  const groupShown = (g: (typeof groupsAll)[number]) =>
    toggled[g.order.id] ?? (g.open.length > 0 || filter === "Settled");

  // KPI helpers (per-group currency — amounts are illustrative)
  const ccy = (arr: { currency: string }[]) => arr[0]?.currency ?? "USD";
  const sum = (arr: { amount: number; status: string }[], paid: boolean) => arr.filter((r) => (r.status === "PAID") === paid).reduce((a, r) => a + r.amount, 0);
  const dutyPaid = dutyRows.filter((r) => r.ce.dutyPaidAt).reduce((a, r) => a + (r.ce.totalDuty ?? r.ce.duty?.totalDuty ?? 0), 0);
  const dutyDue = dutyRows.filter((r) => !r.ce.dutyPaidAt && r.ce.duty).reduce((a, r) => a + (r.ce.duty!.totalDuty), 0);
  const feePaid = feeRows.filter((r) => !r.unpaid).reduce((a, r) => a + r.gross, 0);
  const feeDue = feeRows.filter((r) => r.unpaid).reduce((a, r) => a + r.gross, 0);
  const feeHeld = feeRows.filter((r) => r.blocking).length;

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" description="Every money movement across the trade, split by leg: client collection, supplier payout, India customs duty (ICEGATE), and WHL's fee for the testing itself." />

      {/* one card per leg: outstanding (the work) beside settled (the record) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <LegSummary icon={ArrowDownLeft} label="Client → 1Buy" note="What our buyers owe us, per PI" currency={ccy(clientRows)}
          due={sum(clientRows, false)} dueCount={clientRows.filter((r) => paymentOpen(r.status)).length}
          settled={sum(clientRows, true)} urgentCount={clientRows.filter((r) => paymentUrgency(r.mode, r.dueDate, paymentOpen(r.status))).length} />
        <LegSummary icon={ArrowUpRight} label="1Buy → Supplier" note="What we owe suppliers, per their PI" currency={ccy(supplierRows)}
          due={sum(supplierRows, false)} dueCount={supplierRows.filter((r) => paymentOpen(r.status)).length}
          settled={sum(supplierRows, true)} urgentCount={supplierRows.filter((r) => paymentUrgency(r.mode, r.dueDate, paymentOpen(r.status))).length} />
        <LegSummary icon={Stamp} label="Customs duty" note="BCD + SWS + IGST, per Bill of Entry" currency="INR"
          due={dutyDue} dueCount={dutyRows.filter(dutyOpen).length} settled={dutyPaid} />
        <LegSummary icon={FlaskConical} label="WHL testing" note="The lab's own fee, per work order" currency={ccy(feeRows)}
          due={feeDue} dueCount={feeRows.filter((r) => r.unpaid).length}
          settled={feePaid} held={feeHeld} />
      </div>

      {/* sticky control bar: tabs, search, filters — stays in view no matter how far the list
          is scrolled, so "what's urgent" is never lost below the fold */}
      <div className="sticky top-16 z-10 -mx-6 space-y-3 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {tabDefs.map((t) => (
              <button key={t.key} onClick={() => { setView(t.view); setLegFilter(t.leg); resetPaging(); }}
                className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border-b-2 px-3 py-1.5 text-sm transition",
                  activeTab === t.key ? "border-primary bg-accent-soft font-semibold text-primary" : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {t.label}
                {t.count > 0 && (
                  <span className={cn("rounded-full px-1.5 text-[10px] font-bold",
                    activeTab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{t.count}</span>
                )}
              </button>
            ))}
          </div>
          <button onClick={() => { setUrgentOnly((v) => !v); resetPaging(); }}
            className={cn("ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition",
              urgentOnly ? "border-bad bg-bad-bg text-bad" : "bg-card text-muted-foreground hover:text-foreground")}>
            🔴 {totalUrgent} urgent{urgentOnly ? " — showing only these" : ""}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Search</span>
            <span className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); resetPaging(); }} placeholder="Order no. or party…"
                className={cn(filterInput, "w-52 pl-8")} />
            </span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Status</span>
            <div className="inline-flex rounded-lg border bg-card p-0.5">
              {MONEY_FILTERS.map((f) => (
                <button key={f} onClick={() => { setFilter(f); resetPaging(); }}
                  className={cn("rounded-md px-3 py-1 text-xs font-semibold transition",
                    filter === f ? "bg-accent-soft text-primary shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {f === "All" ? "All statuses" : f === "Pending" ? "Pending / due" : "Settled"}
                </button>
              ))}
            </div>
          </label>
          {(search || legFilter !== "ALL" || urgentOnly || filter !== "All") && (
            <button onClick={() => { setSearch(""); setLegFilter("ALL"); setUrgentOnly(false); setFilter("All"); resetPaging(); }}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
              Clear filters
            </button>
          )}
          <span className="ml-auto self-center text-xs text-faint">
            {view === "byOrder" ? "pending orders first, and pending legs first inside each" : "pending rows sort above settled, most urgent first"}
          </span>
        </div>
      </div>

      {view === "worklist" ? (
        <Panel>
          <DataTable columns={worklistCols} rows={worklistRows}
            sectionOf={worklistBand}
            rowMuted={(l) => !l.open}
            rowAccent={(l) => l.urgency?.tone}
            empty="No payment matches these filters." />
          <Pagination page={worklistPage} totalPages={worklistPages} onChange={setPage} />
          <p className="mt-2 text-xs text-faint">{worklistAll.length} of {legs.length} payment leg{legs.length === 1 ? "" : "s"} match{search || legFilter !== "ALL" || urgentOnly ? " the current filters" : ""}.</p>
        </Panel>
      ) : (
        <div className="space-y-3">
          {groupsAll.length === 0 ? (
            <Panel>
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                {filter === "Pending" ? "No order has money outstanding 🎉" : filter === "Settled" ? "No fully-settled order yet." : "No payment tasks match these filters."}
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
                    <DataTable columns={worklistCols.filter((c) => c.key !== "no")} rows={g.legs}
                      sectionOf={(() => {
                        const openN = g.legs.filter((l) => l.open).length;
                        const doneN = g.legs.length - openN;
                        return openN > 0 && doneN > 0 ? (l: Leg) => (l.open ? `Pending · ${openN}` : `Settled · ${doneN}`) : undefined;
                      })()}
                      rowMuted={(l) => !l.open}
                      rowAccent={(l) => l.urgency?.tone}
                      empty="No payment leg in this view." />
                  </div>
                )}
                </div>
              </div>
            );
          })}
          {groupsAll.length > 0 && <Pagination page={orderPage} totalPages={orderPages} onChange={setPage} />}
        </div>
      )}
    </div>
  );
}
