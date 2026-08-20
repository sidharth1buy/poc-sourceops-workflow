"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useStore } from "@/store/store";
import { customsApplies, orderPhaseTimings, type PhaseAtRisk } from "@/store/selectors";
import { Panel, Pill, StatusPill, DataTable, PageHeader, type Col } from "@/components/ui/primitives";
import { qtyfmt } from "@/lib/utils";

type Row = {
  orderId: string; orderNo: string; supplier: string;
  inboundAwbs: number; receivedUnits: number; dispatchedUnits: number; allocatedUnits: number;
  relabelStatus: string; needsCustoms: boolean; hasCustoms: boolean; atRisk?: PhaseAtRisk;
};

export default function WarehouseBoardPage() {
  const orders = useStore((s) => s.orders);

  const rows = useMemo<Row[]>(() => {
    return Object.values(orders).flatMap((b) => {
      const inbound = b.shipments.filter((s) => s.leg === "INBOUND");
      if (inbound.length === 0) return [];
      const outbound = b.shipments.filter((s) => s.leg === "OUTBOUND");
      const relabel = b.journey.find((s) => s.name.toLowerCase().includes("relabel"));
      return [{
        orderId: b.id, orderNo: b.orderNo, supplier: b.supplier.name,
        inboundAwbs: inbound.length,
        receivedUnits: inbound.flatMap((s) => s.lines).reduce((a, l) => a + l.qty, 0),
        dispatchedUnits: outbound.flatMap((s) => s.lines).reduce((a, l) => a + l.qty, 0),
        allocatedUnits: b.deliveries.reduce((a, d) => a + d.qty, 0),
        relabelStatus: relabel?.status ?? "—",
        needsCustoms: customsApplies(b), hasCustoms: b.customs.some((c) => !!c.icegateRef),
        atRisk: orderPhaseTimings(b).find((p) => p.phase === "WAREHOUSING")?.atRisk,
      }];
    });
  }, [orders]);

  const cols: Col<Row>[] = [
    { key: "no", header: "Order", render: (r) => <Link href={`/fulfilment/orders/${r.orderId}`} className="font-mono text-xs text-primary hover:underline">{r.orderNo}</Link> },
    { key: "supplier", header: "From supplier", render: (r) => r.supplier },
    { key: "in", header: "Inbound AWBs", align: "right", render: (r) => r.inboundAwbs },
    { key: "recv", header: "Received", align: "right", render: (r) => qtyfmt(r.receivedUnits) },
    { key: "customs", header: "Customs", render: (r) => !r.needsCustoms ? <span className="text-xs text-faint">n/a</span> : r.hasCustoms ? <Pill tone="ok">cleared</Pill> : <Pill tone="warn">pending</Pill> },
    { key: "relabel", header: "Relabel → 1Buy", render: (r) => (
      <span className="inline-flex items-center gap-1.5">
        <StatusPill status={r.relabelStatus} />
        {r.atRisk && <Pill tone="bad" title={r.atRisk.reason}>overdue</Pill>}
      </span>
    ) },
    { key: "alloc", header: "Allocated", align: "right", render: (r) => qtyfmt(r.allocatedUnits) },
    { key: "out", header: "Dispatched", align: "right", render: (r) => qtyfmt(r.dispatchedUnits) },
    { key: "act", header: "", align: "right", render: (r) => <Link href={`/fulfilment/orders/${r.orderId}`} className="text-xs font-medium text-primary hover:underline">Open →</Link> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Warehouse" description={<>Goods at the 1Buy hub: what&apos;s been <b className="text-foreground">received</b> inbound, cleared customs, <b className="text-foreground">relabelled to 1Buy</b> (the masking step), allocated to clients, and dispatched outbound.</>} />
      <Panel><DataTable columns={cols} rows={rows} empty="Nothing received yet — inbound shipments show up here once created." rowAccent={(r) => r.atRisk ? "bad" : undefined} /></Panel>
    </div>
  );
}
