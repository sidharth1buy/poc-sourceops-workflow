"use client";

// THE LOGISTICS QUEUE — every inbound order, worst first.
//
// One table, paginated, sorted by how hard the customer's date presses: the
// least road left comes first, so the top of page one is always the next thing
// to pick up. No pipeline boards, no per-stage tabs — a desk that has to choose
// a tab before seeing its worst order will sometimes choose wrong.
//
// THE WHOLE ROW IS THE LINK. Clicking anywhere opens the order's own logistics
// workspace — status, booking, communication, documents — scoped to this
// desk's concerns and nobody else's.
//
// Old deep links (?order=…) meant "take me to this order's logistics view";
// they now land on exactly that page.

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { useStore } from "@/store/store";
import {
  inboundView,
  nextAction,
  sortByUrgency,
  INBOUND_META,
  PRESSURE_META,
  TRACKING_LABEL,
  type InboundView,
  type Pressure,
} from "@/lib/logistics-order";
import { orderPhaseTimings, type PhaseAtRisk } from "@/store/selectors";
import type { OrderBundle } from "@/types";
import { DataTable, PageHeader, Pagination, Panel, Pill, type Col } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

interface Row {
  b: OrderBundle;
  view: InboundView;
  atRisk?: PhaseAtRisk;
}

const PRESSURE_ORDER: Pressure[] = ["OVERDUE", "CRITICAL", "TIGHT", "COMFORTABLE", "DONE"];

/*
 * useSearchParams() (the ?order= deep-link redirect) opts the tree out of
 * static prerender unless it sits under Suspense — the production build
 * refuses the page otherwise. The wrapper is the whole fix.
 */
export default function LogisticsPage() {
  return (
    <Suspense fallback={null}>
      <LogisticsQueue />
    </Suspense>
  );
}

function LogisticsQueue() {
  const router = useRouter();
  const params = useSearchParams();
  const orders = useStore((s) => s.orders);

  /* Old deep links carried ?order= — the intent was always this order's
   * logistics view, which is now a real page. */
  const deepLinked = params.get("order");
  useEffect(() => {
    if (deepLinked && orders[deepLinked]) router.replace(`/fulfilment/logistics/orders/${deepLinked}`);
  }, [deepLinked, orders, router]);

  const [q, setQ] = useState("");
  const [pressure, setPressure] = useState<Pressure | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const rows = useMemo<Row[]>(() => {
    const all = Object.values(orders)
      .filter((b) => b.status !== "CANCELLED")
      .map((b) => ({ b, view: inboundView(b), atRisk: orderPhaseTimings(b).find((p) => p.phase === "INBOUND_LOGISTICS")?.atRisk }));
    return sortByUrgency(all) as Row[];
  }, [orders]);

  const counts = useMemo(() => {
    const c: Record<Pressure, number> = { OVERDUE: 0, CRITICAL: 0, TIGHT: 0, COMFORTABLE: 0, DONE: 0 };
    for (const r of rows) c[r.view.pressure]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (pressure !== "ALL" && r.view.pressure !== pressure) return false;
      if (!needle) return true;
      const hay = `${r.b.orderNo} ${r.b.buyer.name} ${r.b.supplier.name} ${r.view.awb ?? ""} ${r.view.carrier ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, pressure]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const columns: Col<Row>[] = [
    {
      key: "order",
      header: "Order",
      render: (r) => (
        <div>
          <div className="font-mono text-[13px] font-semibold">{r.b.orderNo}</div>
          <div className="text-[11px] text-muted-foreground">{r.b.supplier.name} → 1Buy hub</div>
        </div>
      ),
    },
    {
      key: "delay",
      header: "Delay by",
      render: (r) => (
        <div>
          <div className={cn(
            "text-sm font-semibold tnum",
            r.view.delivered ? "text-muted-foreground"
              : r.view.daysLeft === null ? "text-warn"
              : r.view.daysLeft < 0 || r.view.daysLeft === 0 ? "text-bad"
              : "text-muted-foreground",
          )}>
            {r.view.delivered
              ? "Delivered"
              : r.view.daysLeft === null
                ? "No date set"
                : r.view.daysLeft < 0
                  ? `${Math.abs(r.view.daysLeft)} day${Math.abs(r.view.daysLeft) === 1 ? "" : "s"}`
                  : r.view.daysLeft === 0
                    ? "Due today"
                    : "—"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {r.view.delivered || r.view.daysLeft === null || r.view.daysLeft <= 0
              ? r.b.requiredBy || "—"
              : `due in ${r.view.daysLeft}d · ${r.b.requiredBy}`}
          </div>
        </div>
      ),
    },
    {
      key: "tracking",
      header: "Tracking status",
      render: (r) =>
        r.view.trackingStatus ? (
          <div>
            <div className="text-xs font-medium">{TRACKING_LABEL[r.view.trackingStatus]}</div>
            <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {r.view.carrier} · {r.view.awb}
            </div>
            {r.view.lastSeen && <div className="text-[11px] text-muted-foreground">{r.view.lastSeen}</div>}
          </div>
        ) : (
          <span className="text-xs text-faint">No tracking — nothing booked</span>
        ),
    },
    {
      key: "action",
      header: "Action to perform",
      render: (r) => (
        <div>
          {/* The state leads, so the action reads in context. */}
          <span className="inline-flex flex-wrap items-center gap-1">
            <Pill tone={r.view.delivered ? "ok" : r.view.stage === "NOT_BOOKED" ? "warn" : "info"}>
              {INBOUND_META[r.view.stage].label}
            </Pill>
            {r.atRisk && <Pill tone="bad" title={r.atRisk.reason}>action needed</Pill>}
          </span>
          <div className="mt-1 text-xs text-muted-foreground">{nextAction(r.b, r.view)}</div>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Logistics — inbound orders"
        description="Worst first: the orders with the least road left to the customer's date sit at the top, so the next thing to pick up is always the first row. Click a row to work the order."
      />

      <Panel>
        {/* How the queue stands, and the filter in the same breath. */}
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <FilterChip label="All" count={rows.length} active={pressure === "ALL"} onClick={() => { setPressure("ALL"); setPage(1); }} />
          {PRESSURE_ORDER.map((p) => (
            <FilterChip
              key={p}
              label={PRESSURE_META[p].label}
              count={counts[p]}
              tone={PRESSURE_META[p].tone}
              active={pressure === p}
              onClick={() => { setPressure(pressure === p ? "ALL" : p); setPage(1); }}
            />
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Order, customer, supplier, AWB…"
              className="w-64 pl-8"
            />
          </div>
        </div>

        <DataTable<Row>
          columns={columns}
          rows={pageRows}
          empty={q || pressure !== "ALL" ? "Nothing matches that filter." : "No inbound orders yet."}
          onRowClick={(r) => router.push(`/fulfilment/logistics/orders/${r.b.id}`)}
          rowMuted={(r) => r.view.delivered}
          rowAccent={(r) => r.atRisk ? "bad" : undefined}
        />

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {filtered.length} order{filtered.length === 1 ? "" : "s"}
            {filtered.length > PAGE_SIZE ? ` · showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)}` : ""}
          </p>
          <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
        </div>
      </Panel>
    </div>
  );
}

function FilterChip({
  label, count, active, onClick, tone,
}: { label: string; count: number; active: boolean; onClick: () => void; tone?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
        active ? "border-primary bg-accent-soft text-primary" : "bg-card text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
      <span className={cn(
        "rounded-full px-1.5 text-[10px] font-semibold",
        tone === "bad" && count > 0 ? "bg-bad-bg text-bad" : tone === "warn" && count > 0 ? "bg-warn-bg text-warn" : "bg-muted text-muted-foreground",
      )}>
        {count}
      </span>
    </button>
  );
}
