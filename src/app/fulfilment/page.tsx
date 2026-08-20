"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useStore } from "@/store/store";
import { kpis, allApprovals, allLots, gateReason, orderPhaseTimings } from "@/store/selectors";
import { KpiCard, Panel, StatusPill, Pill, DataTable, PageHeader, Button, type Col } from "@/components/ui/primitives";
import { money, cn } from "@/lib/utils";
import type { Order, OrderBundle } from "@/types";

/**
 * Orders Overview — the console's landing page and the one list of orders.
 *
 * It used to be a "Dashboard" with a six-row teaser plus a separate Orders page holding the
 * real list; the two were the same table at different lengths. The work itself now happens on
 * the per-discipline boards in the sidebar (Testing, Logistics, Customs, Warehouse, Delivery,
 * Payments, Escrow, Approvals), so this page has one job: show every order with enough state
 * to pick one, and hand off to that order's flow page.
 */

const STATUS_FILTERS = ["All", "DRAFT", "PENDING_APPROVAL", "ACTIVE", "ON_HOLD", "CLOSED"] as const;

const PAGE_SIZE = 10;
/** Enough to fill the rail beside a 10-row page without turning it into its own scroller. */
const ATTENTION_SHOWN = 7;

/**
 * Page control for the orders table. Numbered buttons only while they fit — past that the
 * count plus prev/next is the honest UI, and jumping to page 9 of 40 isn't a real task here.
 */
function Pager({
  from, to, total, page, totalPages, onPage,
}: { from: number; to: number; total: number; page: number; totalPages: number; onPage: (p: number) => void }) {
  const numbered = totalPages > 1 && totalPages <= 8;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground tnum">
        Showing <b className="text-foreground">{from}–{to}</b> of {total} order{total === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-1.5">
        <Button variant="outline" className="px-2 py-1 text-xs" disabled={page === 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Prev
        </Button>
        {numbered
          ? Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => onPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={cn("min-w-[1.75rem] rounded-md border px-2 py-1 font-medium tnum transition",
                  p === page ? "border-primary bg-accent-soft text-primary" : "text-muted-foreground hover:border-primary hover:text-primary")}>
                {p}
              </button>
            ))
          : <span className="px-1 text-muted-foreground tnum">Page {page} of {totalPages}</span>}
        <Button variant="outline" className="px-2 py-1 text-xs" disabled={page === totalPages} onClick={() => onPage(page + 1)}>
          Next <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export default function OrderProcessingPage() {
  const router = useRouter();
  const orders = useStore((s) => s.orders);
  const k = kpis(orders);
  const [status, setStatus] = useState<string>("All");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  // Every phase currently stalled specifically on 1Buy's own side (not supplier/client/external
  // waits) — same fulfilment-clock check the per-discipline boards each show for their own phase,
  // rolled up here so a delay shows up regardless of which phase it's sitting in.
  const riskByOrder = useMemo(() => {
    const m: Record<string, ReturnType<typeof orderPhaseTimings>[number]["atRisk"]> = {};
    for (const b of Object.values(orders)) {
      const risk = orderPhaseTimings(b).find((p) => p.atRisk)?.atRisk;
      if (risk) m[b.id] = risk;
    }
    return m;
  }, [orders]);

  // Orders overview is worth-looking-at-first: an order stalled on our own side outranks plain
  // order-number recency, since that's the one thing that actually needs a human today.
  const list = useMemo(() => Object.values(orders).sort((a, b) =>
    (riskByOrder[b.id] ? 1 : 0) - (riskByOrder[a.id] ? 1 : 0) || (a.orderNo < b.orderNo ? 1 : -1)
  ), [orders, riskByOrder]);

  const rows = useMemo(() => list.filter((o) => {
    const okStatus = status === "All" || o.status === status;
    const okQ = q === "" || `${o.orderNo} ${o.buyer.name} ${o.supplier.name}`.toLowerCase().includes(q.toLowerCase());
    return okStatus && okQ;
  }), [list, status, q]);

  // Clamp rather than reset-on-change: filtering down to fewer pages while you're on page 3
  // should show you page 1's worth of results, not an empty table.
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const from = (current - 1) * PAGE_SIZE;
  const shown = rows.slice(from, from + PAGE_SIZE);

  // Everything that wants a human, newest-first-ish: blocked gates, pending approvals, lots the
  // lab flagged MAYBE (client decision, not a retest), and phases stalled on 1Buy's own side.
  const attention: { id: string; orderNo: string; text: string; tone: "bad" | "warn"; href?: string }[] = [
    ...Object.entries(riskByOrder).map(([id, risk]) => ({
      id, orderNo: orders[id]?.orderNo ?? id, text: risk!.reason, tone: "bad" as const, href: risk!.actionHref,
    })),
    ...list.filter((o) => o.status === "ON_HOLD" || o.journey.some((s) => s.status === "BLOCKED"))
      .map((o) => ({ id: o.id, orderNo: o.orderNo, text: `Blocked / on hold (${o.supplier.name})`, tone: "bad" as const })),
    ...allApprovals(orders).filter((a) => a.status === "PENDING")
      .map((a) => ({ id: a.orderId, orderNo: a.orderNo, text: `${a.kind === "PO_REVIEW" ? "PO review" : "Payment release"} pending — ${a.party}`, tone: "warn" as const })),
    ...allLots(orders).filter((l) => l.testStatus === "MAYBE")
      .map((l) => ({ id: l.orderId, orderNo: l.orderNo, text: `Lot ${l.lotCode} flagged MAYBE — needs client decision`, tone: "warn" as const })),
  ];

  const cols: Col<Order>[] = [
    { key: "no", header: "Order", render: (o) => <span className="whitespace-nowrap font-mono text-xs font-semibold text-primary">{o.orderNo}</span> },
    { key: "parties", header: "Buyer → Supplier", render: (o) => (
      <span className="text-sm">{o.buyer.name} <span className="text-faint">→</span> {o.supplier.name}</span>
    ) },
    // one cell, not two narrow columns each carrying a wide header
    { key: "route", header: "Route · pay", render: (o) => (
      <span className="inline-flex items-center gap-1.5">
        <Pill tone={o.tradeType === "INTERNATIONAL" ? "info" : "neutral"}>{o.tradeType === "INTERNATIONAL" ? "Intl" : "Domestic"}</Pill>
        <span className="text-xs text-muted-foreground">{o.paymentMode}</span>
      </span>
    ) },
    { key: "value", header: "Value", align: "right", render: (o) => money(o.sellTotal, o.currency) },
    { key: "stage", header: "Stage", render: (o) => {
      const b = o as OrderBundle;
      const cur = b.journey?.find((s) => s.status === "IN_PROGRESS" || s.status === "BLOCKED");
      const risk = riskByOrder[o.id];
      if (!cur) {
        return <span className="text-xs text-faint">{b.status === "CANCELLED" ? "Cancelled" : "Complete"}</span>;
      }
      const blocked = gateReason(b, cur);
      return (
        <span className="flex flex-wrap items-center gap-1.5 text-xs">
          {blocked ? <Pill tone="bad">Blocked</Pill> : <Pill tone="active">On track</Pill>}
          <span className="max-w-[150px] truncate text-muted-foreground" title={blocked ?? cur.name}>{cur.name}</span>
          {risk && <Pill tone="bad" title={risk.reason}>delay risk — ours</Pill>}
        </span>
      );
    } },
    { key: "status", header: "Status", render: (o) => <StatusPill status={o.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders Overview"
        description="Every fulfilment order (Mode 4), each spun from a Purchase Order. Click one to open its flow — the whole journey on a single page. The work itself is done on the boards in the sidebar."
        actions={
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search order / party…"
              className="w-48 rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary" />
            <Link href="/fulfilment/supplier-pos"><Button><Plus className="h-4 w-4" /> From a Purchase Order</Button></Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <KpiCard label="Open orders" value={k.open} />
        <KpiCard label="Payments due" value={k.paymentsDue} hint="action" tone="warn" />
        <KpiCard label="Tests pending" value={k.testsPending} hint="quality" tone="warn" />
        <KpiCard label="Blocked" value={k.blocked} hint="on hold" tone="bad" />
        <KpiCard label="Escrow to release" value={money(k.escrowToRelease)} tone="info" />
      </div>

      {/* Orders left, what needs a human on the right. Side by side only from `xl` — at 1024px
          the rail squeezed the table until every party name wrapped four lines. Below `xl` the
          rail is a compact strip above the table instead (hence the DOM order + `xl:order-last`),
          and 10 rows a page keeps table and rail in one screen either way. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel title={`Needs attention · ${attention.length}`} className="xl:order-last xl:col-span-1">
          {attention.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">All clear 🎉</div>
          ) : (
            <>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
                {attention.slice(0, ATTENTION_SHOWN).map((a, i) => (
                  <li key={i}>
                    <Link href={a.href ?? `/fulfilment/order-flow/${a.id}`} className="flex h-full items-start gap-2 rounded-lg border p-2.5 text-sm hover:border-primary">
                      <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", a.tone === "bad" ? "text-bad" : "text-warn")} />
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-[11px] text-muted-foreground">{a.orderNo}</span>
                        <span className="block leading-snug">{a.text}</span>
                      </span>
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
              {attention.length > ATTENTION_SHOWN && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {attention.length - ATTENTION_SHOWN} more — the <b className="text-foreground">On Hold</b> filter and the{" "}
                  <Link href="/fulfilment/approvals" className="text-primary hover:underline">Approvals board</Link> carry the rest.
                </p>
              )}
            </>
          )}
        </Panel>

        <div className="space-y-3 xl:col-span-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((s) => (
              <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium transition",
                  status === s ? "border-primary bg-accent-soft text-primary" : "text-muted-foreground hover:text-foreground")}>
                {s === "All" ? `All (${list.length})` : s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
              </button>
            ))}
            <span className="ml-auto text-xs text-faint">click a row for that order&apos;s flow</span>
          </div>

          <DataTable columns={cols} rows={shown}
            onRowClick={(o) => router.push(`/fulfilment/order-flow/${o.id}`)}
            rowAccent={(o) => riskByOrder[o.id] ? "bad" : undefined}
            empty="No orders match those filters." />

          {rows.length > 0 && (
            <Pager from={from + 1} to={from + shown.length} total={rows.length}
              page={current} totalPages={totalPages} onPage={setPage} />
          )}
        </div>
      </div>

    </div>
  );
}
