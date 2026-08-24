"use client";

// THE ESCROW QUEUE — every escrow order, worst first.
//
// Rebuilt to read like the Logistics and Testing queues: one paginated table
// sorted by what is actually at stake, pressure chips as the filter row, one
// search box, and a whole row that opens the order. The old three-dropdown
// filter panel (order no. / supplier / status) is gone — it asked the reader
// to know what they were looking for before it would show them anything,
// which is backwards for a board whose job is to say what needs doing today.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { useStore } from "@/store/store";
import {
  escrowView, sortEscrowQueue,
  ESCROW_PRESSURE_META, ESCROW_PRESSURE_ORDER,
  type EscrowPressure, type EscrowView,
} from "@/lib/escrow-queue";
import type { OrderBundle } from "@/types";
import { Panel, Pill, StatusPill, DataTable, PageHeader, Pagination, RoleLocked, type Col } from "@/components/ui/primitives";
import { Input } from "@/components/ui/form";
import { money, cn } from "@/lib/utils";
import { useRole } from "@/lib/role";
import { useEscrowMockMode } from "@/lib/escrow-mode";

const PAGE_SIZE = 10;

interface Row { b: OrderBundle; view: EscrowView }

export default function EscrowBoardPage() {
  const router = useRouter();
  const orders = useStore((s) => s.orders);
  const { canAccessEscrow } = useRole();
  const escrowMock = useEscrowMockMode();

  const [q, setQ] = useState("");
  const [pressure, setPressure] = useState<EscrowPressure | "ALL">("ALL");
  const [page, setPage] = useState(1);

  const rows = useMemo<Row[]>(() => {
    const all = Object.values(orders)
      .map((b) => ({ b, view: escrowView(b) }))
      .filter((r): r is Row => r.view !== null);
    return sortEscrowQueue(all);
  }, [orders]);

  const counts = useMemo(() => {
    const c: Record<EscrowPressure, number> = { REFUND: 0, INSPECTION: 0, FUNDING: 0, IN_FLIGHT: 0, RELEASED: 0 };
    for (const r of rows) c[r.view.pressure]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (pressure !== "ALL" && r.view.pressure !== pressure) return false;
      if (!needle) return true;
      const e = r.b.escrow!;
      const hay = `${r.b.orderNo} ${e.buyerContact.company} ${e.sellerContact.company} ${e.invoice?.invoiceNo ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, pressure]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  /*
   * The board's original columns, deliberately kept: buyer, seller, invoice no.
   * and PO amount are what an escrow desk identifies an order by. Only the
   * surrounding structure changed (pressure chips, search, worst-first sort,
   * whole-row click) — not what the table reports.
   */
  const columns: Col<Row>[] = [
    { key: "no", header: "Order", render: (r) => <span className="font-mono text-xs font-semibold">{r.b.orderNo}</span> },
    { key: "buyer", header: "Buyer", render: (r) => r.b.escrow!.buyerContact.company },
    { key: "seller", header: "Seller", render: (r) => r.b.escrow!.sellerContact.company },
    { key: "inv", header: "Invoice no.", render: (r) => <span className="font-mono text-xs">{r.b.escrow!.invoice?.invoiceNo ?? "—"}</span> },
    { key: "amt", header: "PO amount", align: "right", render: (r) => money(r.view.poAmount, r.view.currency) },
    {
      key: "status", header: "Status",
      render: (r) => (r.view.cancelled ? <Pill tone="bad">Cancelled</Pill> : <StatusPill status={r.view.status} />),
    },
    {
      key: "risk", header: "", align: "right",
      render: (r) => (
        r.view.feeMismatch ? <Pill tone="bad" title="Invoice fee does not match what was agreed at PO time">fee mismatch</Pill>
          : r.view.atRisk ? <Pill tone="bad" title={r.view.atRisk.reason}>action needed</Pill>
          : null
      ),
    },
  ];

  if (!canAccessEscrow) {
    return (
      <div className="space-y-5">
        <PageHeader title="Escrow board" description="Escrow order handling — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="view or act on escrow orders" /></Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="inline-flex items-center gap-2">Escrow — orders{escrowMock && <Pill tone="warn">Mock mode</Pill>}</span>}
        description="Worst first: money that has to come back sits at the top, then orders whose inspection clock is running, so the next thing to pick up is always the first row. Click a row to work the order."
      />

      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <FilterChip label="All" count={rows.length} active={pressure === "ALL"} onClick={() => { setPressure("ALL"); setPage(1); }} />
          {ESCROW_PRESSURE_ORDER.map((p) => (
            <FilterChip
              key={p}
              label={ESCROW_PRESSURE_META[p].label}
              title={ESCROW_PRESSURE_META[p].what}
              count={counts[p]}
              tone={ESCROW_PRESSURE_META[p].tone}
              active={pressure === p}
              onClick={() => { setPressure(pressure === p ? "ALL" : p); setPage(1); }}
            />
          ))}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              placeholder="Order, seller, invoice no.…"
              className="w-64 pl-8"
            />
          </div>
        </div>

        <DataTable<Row>
          columns={columns}
          rows={pageRows}
          empty={q || pressure !== "ALL" ? "Nothing matches that filter." : "No escrow orders yet."}
          onRowClick={(r) => router.push(`/fulfilment/escrow/${r.b.id}`)}
          rowAccent={(r) => (r.view.pressure === "REFUND" ? "bad" : r.view.atRisk || r.view.feeMismatch ? "warn" : undefined)}
          rowMuted={(r) => r.view.pressure === "RELEASED"}
        />

        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-foreground">
            {filtered.length} escrow order{filtered.length === 1 ? "" : "s"}
            {filtered.length > PAGE_SIZE ? ` · showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)}` : ""}
          </p>
          <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
        </div>
      </Panel>
    </div>
  );
}

function FilterChip({
  label, count, active, onClick, tone, title,
}: { label: string; count: number; active: boolean; onClick: () => void; tone?: string; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
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
