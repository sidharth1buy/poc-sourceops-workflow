"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStore } from "@/store/store";
import { allEscrow, orderPhaseTimings } from "@/store/selectors";
import { Panel, Pill, StatusPill, DataTable, PageHeader, Pagination, RoleLocked, type Col } from "@/components/ui/primitives";
import { prettyStatus } from "@/data/enums";
import { money, cn } from "@/lib/utils";
import { useRole } from "@/lib/role";
import { useEscrowMockMode } from "@/lib/escrow-mode";

const STATUS_FILTERS = [
  "All", "DRAFT", "SENT_FOR_SELLER_CONFIRMATION", "SELLER_CONFIRMED", "ESCROW_FEE_INVOICED",
  "TT_PAYMENT_RECEIVED", "GOODS_SHIPPED", "RECIPIENT_INSPECTION", "RELEASED_TO_SELLER", "Cancelled",
] as const;
const PAGE_SIZE = 10;
const filterInput = "rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary";
const filterLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

export default function EscrowBoardPage() {
  const orders = useStore((s) => s.orders);
  const { canAccessEscrow } = useRole();
  const escrowMock = useEscrowMockMode();
  const all = allEscrow(orders).map((r) => ({
    ...r, funding: orderPhaseTimings(orders[r.orderId]).find((p) => p.phase === "FUNDING"),
  }));
  const title = <span className="inline-flex items-center gap-2">Escrow board{escrowMock && <Pill tone="warn">Mock mode</Pill>}</span>;

  // Stable option list regardless of other active filters, so the dropdown
  // doesn't reshuffle/narrow as the operator filters — computed off every
  // escrow order, not the currently-filtered set.
  const suppliers = useMemo(() => Array.from(new Set(all.map((r) => r.e.sellerContact.company))).sort(), [all]);

  const [orderNo, setOrderNo] = useState("");
  const [supplier, setSupplier] = useState("All");
  const [status, setStatus] = useState<string>("All");
  const [page, setPage] = useState(1);
  const hasFilters = orderNo !== "" || supplier !== "All" || status !== "All";

  const filtered = useMemo(() => {
    const q = orderNo.trim().toLowerCase();
    return all
      .filter((r) => {
        const okOrderNo = q === "" || r.orderNo.toLowerCase().includes(q);
        const okSupplier = supplier === "All" || r.e.sellerContact.company === supplier;
        const okStatus = status === "All"
          || (status === "Cancelled" ? !!r.e.cancelledAt : !r.e.cancelledAt && r.e.status === status);
        return okOrderNo && okSupplier && okStatus;
      })
      // Stalled-on-our-side orders first — that's the one thing on this board that actively
      // needs a human today, regardless of what else the filters/sort would otherwise surface.
      .sort((a, b) => (a.funding?.atRisk ? 0 : 1) - (b.funding?.atRisk ? 0 : 1));
  }, [all, orderNo, supplier, status]);

  // Clamp instead of trusting `page` directly — a filter change can leave it
  // pointing past the new (shorter) result set.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const rows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const cols: Col<(typeof rows)[number]>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/escrow/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "buyer", header: "Buyer", render: (r) => r.e.buyerContact.company },
    { key: "seller", header: "Seller", render: (r) => r.e.sellerContact.company },
    { key: "inv", header: "Invoice no.", render: (r) => <span className="font-mono text-xs">{r.e.invoice?.invoiceNo ?? "—"}</span> },
    { key: "amt", header: "PO amount", align: "right", render: (r) => money(r.e.poAmount, r.e.currency) },
    { key: "status", header: "Status", render: (r) => r.e.cancelledAt ? <Pill tone="bad">Cancelled</Pill> : <StatusPill status={r.e.status} /> },
    { key: "risk", header: "", render: (r) => r.funding?.atRisk ? <Pill tone="bad" title={r.funding.atRisk.reason}>action needed</Pill> : null },
    { key: "act", header: "", align: "right", render: (r) => <Link href={`/fulfilment/escrow/${r.orderId}`} className="text-xs font-medium text-primary hover:underline">Open →</Link> },
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
    <div className="space-y-5">
      <PageHeader
        title={title}
        description="Every order's escrow order across the 8-state HKin-modelled flow (Draft → Released to Seller). All actions — advance, invoice, accept/reject, release, refund — live here on each order's detail page."
      />
      <Panel>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Order no.</span>
            <input value={orderNo} onChange={(e) => { setOrderNo(e.target.value); setPage(1); }} placeholder="ORD-2026-…"
              className={cn(filterInput, "w-40")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Supplier</span>
            <select value={supplier} onChange={(e) => { setSupplier(e.target.value); setPage(1); }} className={cn(filterInput, "w-48")}>
              <option value="All">All suppliers</option>
              {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Status</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={cn(filterInput, "w-56")}>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === "All" || s === "Cancelled" ? s : prettyStatus(s)}</option>)}
            </select>
          </label>
          {hasFilters && (
            <button type="button" onClick={() => { setOrderNo(""); setSupplier("All"); setStatus("All"); setPage(1); }}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
              Clear filters
            </button>
          )}
        </div>
        <DataTable columns={cols} rows={rows} empty="No escrow orders match these filters." rowAccent={(r) => r.funding?.atRisk ? "bad" : undefined} />
        <Pagination page={pageSafe} totalPages={totalPages} onChange={setPage} />
      </Panel>
      <p className="text-xs text-faint">{filtered.length} of {all.length} escrow order{all.length === 1 ? "" : "s"}{hasFilters ? " match the current filters" : ""}.</p>
    </div>
  );
}
