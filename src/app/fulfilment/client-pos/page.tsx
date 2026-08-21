"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/store/store";
import { sourcedForClientLine, clientPoStatus } from "@/store/selectors";
import { Panel, Pill, Button, PageHeader, Pagination, RoleLocked, DataTable, type Col } from "@/components/ui/primitives";
import { SourceOrderModal } from "@/components/order/modals";
import { prettyStatus } from "@/data/enums";
import { money, qtyfmt, fmtAddress, cn } from "@/lib/utils";
import { useRole } from "@/lib/role";

type SrcTarget = { poNo: string; buyer: string; mpn: string; price: number; remaining: number };

const STATUS_FILTERS = ["All", "UNSOURCED", "PARTIALLY_SOURCED", "FULLY_SOURCED"] as const;
const PAGE_SIZE = 10;
const filterInput = "rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary";
const filterLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

export default function ClientPosPage() {
  const clientPos = useStore((s) => s.clientPos);
  const orders = useStore((s) => s.orders);
  const supplierPos = useStore((s) => s.supplierPos);
  const [src, setSrc] = useState<SrcTarget | null>(null);
  const { canAccessSalesOrders } = useRole();

  const statusTone = (s: string): "ok" | "warn" | "neutral" => (s === "FULLY_SOURCED" ? "ok" : s === "PARTIALLY_SOURCED" ? "warn" : "neutral");

  const rows = useMemo(() => clientPos.map((cpo) => {
    const status = clientPoStatus(supplierPos, orders, cpo);
    const total = cpo.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
    const demandQty = cpo.lines.reduce((s, l) => s + l.qty, 0);
    const sourcedQty = cpo.lines.reduce((s, l) => s + sourcedForClientLine(supplierPos, orders, cpo.clientPoNo, l.mpn), 0);
    const serving = supplierPos.filter((spo) =>
      spo.lines.some((l) => l.clientPoNo === cpo.clientPoNo) ||
      (spo.orderId ? !!orders[spo.orderId]?.sourcingAllocations.some((a) => a.clientPoNo === cpo.clientPoNo) : false));
    return { cpo, status, total, demandQty, sourcedQty, serving };
  }), [clientPos, supplierPos, orders]);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("All");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const hasFilters = q !== "" || status !== "All";

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      const okQ = needle === "" || r.cpo.clientPoNo.toLowerCase().includes(needle) || r.cpo.client.name.toLowerCase().includes(needle);
      const okStatus = status === "All" || r.status === status;
      return okQ && okStatus;
    });
  }, [rows, q, status]);

  if (!canAccessSalesOrders) {
    return (
      <div className="space-y-5">
        <PageHeader title="Sales Orders" description="Client demand — restricted to Supply Chain." />
        <Panel><RoleLocked roleLabel="SC" action="view or act on sales orders" /></Panel>
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
    { key: "no", header: "PO No.", render: (r) => (
      <Link href={`/fulfilment/client-pos/${r.cpo.id}`} onClick={(e) => e.stopPropagation()}
        className="font-mono text-xs text-primary hover:underline">{r.cpo.clientPoNo}</Link>
    ) },
    { key: "client", header: "Client", render: (r) => <>{r.cpo.client.name} <span className="text-faint">({r.cpo.client.country})</span></> },
    { key: "lines", header: "Lines", align: "right", render: (r) => r.cpo.lines.length },
    { key: "sourced", header: "Sourced / Demand", align: "right", render: (r) => (
      <span className={r.sourcedQty >= r.demandQty ? "text-ok" : r.sourcedQty > 0 ? "text-warn" : "text-faint"}>
        <b className="tnum">{qtyfmt(r.sourcedQty)}</b><span className="text-faint">/</span><b className="tnum text-foreground">{qtyfmt(r.demandQty)}</b>
      </span>
    ) },
    { key: "total", header: "Total", align: "right", render: (r) => <span className="font-medium tnum">{money(r.total)}</span> },
    { key: "pay", header: "Payment", render: (r) => <Pill tone={r.cpo.paymentMode === "ESCROW" ? "warn" : "neutral"}>{r.cpo.paymentMode}</Pill> },
    { key: "status", header: "Status", render: (r) => <Pill tone={statusTone(r.status)}>{prettyStatus(r.status)}</Pill> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Sales Orders"
        description={<>The demand we fulfil. <b className="text-foreground">Source</b> each line to one or more suppliers (split a PO across suppliers, or reuse an order for several POs).</>}
        actions={<Link href="/fulfilment/client-pos/new"><Button><Plus className="h-4 w-4" /> New Sales Order</Button></Link>}
      />

      {clientPos.length > 0 && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Search</span>
            <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="PO no. or client…"
              className={cn(filterInput, "w-56")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={filterLabel}>Status</span>
            <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={cn(filterInput, "w-48")}>
              {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s === "All" ? s : prettyStatus(s)}</option>)}
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
          empty={clientPos.length === 0
            ? <>No sales orders yet. <Link href="/fulfilment/client-pos/new" className="text-primary hover:underline">Create one</Link>.</>
            : "No sales orders match these filters."}
          onRowClick={(r) => toggle(r.cpo.id)}
          isExpanded={(r) => expanded.has(r.cpo.id)}
          renderExpanded={({ cpo, serving }) => (
            <div className="pt-3">
              {(cpo.client.gstin || cpo.terms || fmtAddress(cpo.deliveryAddress)) && (
                <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 border-b pb-2 text-xs text-muted-foreground">
                  {cpo.terms?.referenceNo && <span>Raised against <span className="font-mono text-foreground">{cpo.terms.referenceNo}</span></span>}
                  {cpo.client.gstin && <span>GSTIN {cpo.client.gstin}{cpo.client.state ? ` · ${cpo.client.state}` : ""}</span>}
                  {cpo.terms?.paymentMethod && <span>Pay: {cpo.terms.paymentMethod}</span>}
                  {cpo.terms?.deliveryTerms && <span>{cpo.terms.deliveryTerms}</span>}
                  {cpo.terms?.testingTerms && <span>Testing: {cpo.terms.testingTerms}</span>}
                  {cpo.terms?.warranty && <span>Warranty {cpo.terms.warranty}</span>}
                  {cpo.terms?.gstNote && <span>{cpo.terms.gstNote}</span>}
                  {fmtAddress(cpo.deliveryAddress) && <span>Deliver to: {fmtAddress(cpo.deliveryAddress)}</span>}
                </div>
              )}
              <div className="space-y-2">
                {cpo.lines.map((l) => {
                  const sourced = sourcedForClientLine(supplierPos, orders, cpo.clientPoNo, l.mpn);
                  const remaining = l.qty - sourced;
                  return (
                    <div key={l.mpn} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card p-3 text-sm">
                      <span className="min-w-[140px] flex-1"><span className="font-mono text-xs">{l.mpn}</span>{l.make && <span className="ml-1.5 text-[11px] text-faint">{l.make}</span>}{l.dateCode && <span className="ml-1.5 text-[11px] text-faint">DC {l.dateCode}</span>}</span>
                      <span className="text-muted-foreground">demand <b className="text-foreground tnum">{qtyfmt(l.qty)}</b></span>
                      <span className={sourced >= l.qty ? "text-ok" : sourced > 0 ? "text-warn" : "text-faint"}>sourced <b className="tnum">{qtyfmt(sourced)}</b></span>
                      <span className="text-muted-foreground">remaining <b className="text-foreground tnum">{qtyfmt(remaining)}</b></span>
                      <span className="text-faint">@ {money(l.unitPrice)}</span>
                      {remaining > 0
                        ? <Button variant="outline" onClick={() => setSrc({ poNo: cpo.clientPoNo, buyer: cpo.client.name, mpn: l.mpn, price: l.unitPrice, remaining })}>Source →</Button>
                        : <Pill tone="ok">fully sourced</Pill>}
                    </div>
                  );
                })}
              </div>

              {serving.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Sourced via (purchase orders)</div>
                  <div className="flex flex-wrap gap-1.5">
                    {serving.map((spo) => (
                      <Link key={spo.id} href={spo.orderId ? `/fulfilment/order-flow/${spo.orderId}` : "/fulfilment/supplier-pos"}
                        className="rounded-md border bg-card px-2 py-1 text-xs hover:border-primary">
                        <span className="font-mono text-primary">{spo.poNo}</span> · {spo.supplier.name}
                        {spo.status === "DRAFT" && <span className="ml-1 text-warn">· draft</span>}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        />
      </Panel>

      {filtered.length > 0 && <Pagination page={pageSafe} totalPages={totalPages} onChange={setPage} />}
      {clientPos.length > 0 && (
        <p className="text-xs text-faint">{filtered.length} of {clientPos.length} sales order{clientPos.length === 1 ? "" : "s"}{hasFilters ? " match the current filters" : ""}.</p>
      )}

      {src && (
        <SourceOrderModal clientPoNo={src.poNo} buyerName={src.buyer} clientLineMpn={src.mpn}
          unitPrice={src.price} remaining={src.remaining} onClose={() => setSrc(null)} />
      )}
    </div>
  );
}
