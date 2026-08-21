"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ArrowRight } from "lucide-react";
import { useStore } from "@/store/store";
import { ONEBUY_HUB } from "@/data/fixtures";
import { Panel, Pill, Button, PageHeader, Pagination, RoleLocked, DataTable, StatusPill, type Col } from "@/components/ui/primitives";
import { OrderStagePill } from "@/components/order/order-stage-pill";
import { money, qtyfmt, cn } from "@/lib/utils";
import { useRole } from "@/lib/role";

const STATUS_FILTERS = ["All", "DRAFT", "ORDERED"] as const;
const PAGE_SIZE = 10;
const filterInput = "rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary";
const filterLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

export default function SupplierPosPage() {
  const router = useRouter();
  const supplierPos = useStore((s) => s.supplierPos);
  const orders = useStore((s) => s.orders);
  const createOrderFromSupplierPo = useStore((s) => s.createOrderFromSupplierPo);
  const { canAccessPurchaseOrders } = useRole();

  function createOrder(id: string) {
    const orderId = createOrderFromSupplierPo(id);
    if (orderId) router.push(`/fulfilment/order-flow/${orderId}`);
  }

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const hasFilters = q !== "" || status !== "All";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return supplierPos.filter((spo) => {
      const okQ = needle === "" || spo.poNo.toLowerCase().includes(needle) || spo.supplier.name.toLowerCase().includes(needle);
      const okStatus = status === "All" || spo.status === status;
      return okQ && okStatus;
    });
  }, [supplierPos, q, status]);

  if (!canAccessPurchaseOrders) {
    return (
      <div className="space-y-5">
        <PageHeader title="Purchase Orders" description="Our purchase orders — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="view or act on purchase orders" /></Panel>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  type Row = (typeof pageRows)[number];
  const cols: Col<Row>[] = [
    { key: "no", header: "PO No.", render: (spo) => (
      <Link href={`/fulfilment/supplier-pos/${spo.id}`} onClick={(e) => e.stopPropagation()}
        className="font-mono text-xs text-primary hover:underline">{spo.poNo}</Link>
    ) },
    { key: "supplier", header: "Supplier", render: (spo) => <>{spo.supplier.name} <span className="text-faint">({spo.supplier.country})</span></> },
    { key: "lines", header: "Lines", align: "right", render: (spo) => `${spo.lines.length} · ${spo.lines.filter((l) => l.clientPoNo && l.clientLineMpn).length} linked` },
    { key: "total", header: "Buy total", align: "right", render: (spo) => <span className="font-medium tnum">{money(spo.buyTotal, spo.currency)}</span> },
    { key: "pay", header: "Payment", render: (spo) => <Pill tone={spo.paymentMode === "ESCROW" ? "warn" : "neutral"}>{spo.paymentMode}</Pill> },
    { key: "postatus", header: "PO Status", render: (spo) => <Pill tone={spo.status === "ORDERED" ? "ok" : "warn"}>{spo.status === "ORDERED" ? "Ordered" : "Draft"}</Pill> },
    { key: "orderstatus", header: "Order Status", render: (spo) => {
      const b = spo.orderId ? orders[spo.orderId] : undefined;
      if (!b) return <span className="text-xs text-faint">No order yet</span>;
      return (
        <div className="flex flex-col items-start gap-1">
          <StatusPill status={b.status} />
          <OrderStagePill b={b} />
        </div>
      );
    } },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchase Orders"
        description={<>Our purchase docs to suppliers. Lines can reference one or more sales-order lines (or stay unlinked). Once ready, <b className="text-foreground">create the fulfilment order</b> from a PO to start the journey.</>}
        actions={<Link href="/fulfilment/supplier-pos/new"><Button><Plus className="h-4 w-4" /> New Purchase Order</Button></Link>}
      />

      {supplierPos.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Search</span>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="PO no. or supplier…"
              className={cn(filterInput, "w-56")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Status</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={cn(filterInput, "w-40")}>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === "All" ? s : s === "ORDERED" ? "Ordered" : "Draft"}</option>)}
            </select>
          </label>
          {hasFilters && (
            <button type="button" onClick={() => { setQ(""); setStatus("All"); setPage(1); }}
              className="rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground">
              Clear filters
            </button>
          )}
        </div>
      )}

      <Panel>
        <DataTable<Row>
          columns={cols}
          rows={pageRows}
          empty={supplierPos.length === 0
            ? <>No purchase orders yet. <Link href="/fulfilment/supplier-pos/new" className="text-primary hover:underline">Create one</Link>.</>
            : "No purchase orders match these filters."}
          onRowClick={(spo) => toggle(spo.id)}
          isExpanded={(spo) => expanded.has(spo.id)}
          renderExpanded={(spo) => {
            const linkedCount = spo.lines.filter((l) => l.clientPoNo && l.clientLineMpn).length;
            return (
              <div className="pt-3">
                {(spo.supplier.gstin || spo.terms) && (
                  <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b pb-2 text-xs text-muted-foreground">
                    {spo.terms?.referenceNo && <span>Raised against <span className="font-mono text-foreground">{spo.terms.referenceNo}</span></span>}
                    {spo.supplier.gstin && <span>GSTIN {spo.supplier.gstin}{spo.supplier.state ? ` · ${spo.supplier.state}` : ""}</span>}
                    {!spo.supplier.gstin && spo.supplier.state && <span>{spo.supplier.state}</span>}
                    <span>{spo.tradeType === "INTERNATIONAL" ? "Intl" : "Domestic"} · {spo.incoterm}</span>
                    <span>Ship to: {ONEBUY_HUB.name}</span>
                    {spo.terms?.paymentMethod && <span>Pay: {spo.terms.paymentMethod}</span>}
                    {spo.paymentMode === "CREDIT" && spo.creditDays && <span>Credit · {spo.creditDays} days</span>}
                    {spo.incoterm === "CIF" && spo.terms?.destinationPort && <span>Ship to: {spo.terms.destinationPort}</span>}
                    {spo.terms?.deliveryTerms && <span>{spo.terms.deliveryTerms}</span>}
                    {spo.terms?.warranty && <span>Warranty {spo.terms.warranty}</span>}
                    {!!spo.termsConditions?.length && <span>{spo.termsConditions.length} T&amp;C</span>}
                    {!!spo.relabelCost && <span>Relabel {spo.relabelCost}</span>}
                  </div>
                )}

                <div className="space-y-2">
                  {spo.lines.map((l, i) => (
                    <div key={`${l.mpn}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-sm">
                      <span className="min-w-[150px] flex-1"><span className="font-mono text-xs">{l.mpn}</span>{l.make && <span className="ml-1.5 text-[11px] text-faint">{l.make}</span>}{l.dateCode && <span className="ml-1.5 text-[11px] text-faint">DC {l.dateCode}</span>}</span>
                      <span className="text-muted-foreground">qty <b className="text-foreground tnum">{qtyfmt(l.qty)}</b></span>
                      <span className="text-faint">@ {money(l.buyUnitPrice, spo.currency)}</span>
                      {l.clientPoNo && l.clientLineMpn
                        ? <Pill tone="info">→ {l.clientPoNo} · {l.clientLineMpn}</Pill>
                        : <Pill tone="warn">unlinked — map later</Pill>}
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
                  <span className="text-muted-foreground">
                    Buy total <b className="text-foreground tnum">{money(spo.buyTotal, spo.currency)}</b>
                    <span className="ml-2 text-faint">{spo.lines.length} line(s) · {linkedCount} linked</span>
                  </span>
                  {spo.status === "ORDERED" && spo.orderId
                    ? <Link href={`/fulfilment/order-flow/${spo.orderId}`} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium hover:border-primary">Open order <ArrowRight className="h-4 w-4" /></Link>
                    : <Button onClick={() => createOrder(spo.id)}>Create order <ArrowRight className="h-4 w-4" /></Button>}
                </div>
              </div>
            );
          }}
        />
      </Panel>

      {filtered.length > 0 && <Pagination page={pageSafe} totalPages={totalPages} onChange={setPage} />}
      {supplierPos.length > 0 && (
        <p className="text-xs text-faint">{filtered.length} of {supplierPos.length} purchase order{supplierPos.length === 1 ? "" : "s"}{hasFilters ? " match the current filters" : ""}.</p>
      )}
    </div>
  );
}
