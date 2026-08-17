"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useStore } from "@/store/store";
import { DataTable, Pill, StatusPill, Button, PageHeader, type Col } from "@/components/ui/primitives";
import { gateReason } from "@/store/selectors";
import { money, cn } from "@/lib/utils";
import type { Order, OrderBundle } from "@/types";

const STATUS_FILTERS = ["All", "DRAFT", "PENDING_APPROVAL", "ACTIVE", "ON_HOLD", "CLOSED"] as const;

export default function OrdersPage() {
  const router = useRouter();
  const orders = useStore((s) => s.orders);
  const [status, setStatus] = useState<string>("All");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    return Object.values(orders).filter((o) => {
      const okStatus = status === "All" || o.status === status;
      const okQ = q === "" || `${o.orderNo} ${o.buyer.name} ${o.supplier.name}`.toLowerCase().includes(q.toLowerCase());
      return okStatus && okQ;
    }).sort((a, b) => a.orderNo < b.orderNo ? 1 : -1);
  }, [orders, status, q]);

  const cols: Col<Order>[] = [
    { key: "no", header: "Order", render: (o) => <span className="font-mono text-xs font-semibold text-primary">{o.orderNo}</span> },
    { key: "buyer", header: "Buyer", render: (o) => <span>{o.buyer.name} <span className="text-faint text-xs">· {o.buyer.country}</span></span> },
    { key: "supplier", header: "Supplier", render: (o) => <span>{o.supplier.name} <span className="text-faint text-xs">· {o.supplier.country}</span></span> },
    { key: "route", header: "Route", render: (o) => <Pill tone={o.tradeType === "INTERNATIONAL" ? "info" : "neutral"}>{o.tradeType === "INTERNATIONAL" ? "Intl" : "Domestic"}</Pill> },
    { key: "pay", header: "Payment", render: (o) => <Pill tone={o.paymentMode === "ESCROW" ? "warn" : "neutral"}>{o.paymentMode}</Pill> },
    { key: "value", header: "Sell value", align: "right", render: (o) => money(o.sellTotal, o.currency) },
    { key: "stage", header: "Stage", render: (o) => {
      const b = o as OrderBundle;
      const cur = b.journey?.find((s) => s.status === "IN_PROGRESS" || s.status === "BLOCKED");
      if (!cur) return <span className="text-xs text-faint">{b.status === "CANCELLED" ? "Cancelled" : "Complete"}</span>;
      const blocked = gateReason(b, cur);
      return (
        <span className="flex items-center gap-1.5 text-xs">
          {blocked ? <Pill tone="bad">Blocked</Pill> : <Pill tone="active">On track</Pill>}
          <span className="max-w-[150px] truncate text-muted-foreground" title={blocked ?? cur.name}>{cur.name}</span>
        </span>
      );
    } },
    { key: "status", header: "Status", render: (o) => <StatusPill status={o.status} /> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Orders"
        description="Fulfilment orders (Mode 4) — each spun from a Purchase Order. Click a row to open its workspace."
        actions={
          <div className="flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order / party…"
              className="w-48 rounded-lg border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary" />
            <Link href="/fulfilment/supplier-pos"><Button><Plus className="h-4 w-4" /> From a Purchase Order</Button></Link>
          </div>
        }
      />
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition",
              status === s ? "border-primary bg-accent-soft text-primary" : "text-muted-foreground hover:text-foreground")}>
            {s === "All" ? "All" : s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>
      <DataTable columns={cols} rows={rows} onRowClick={(o) => router.push(`/fulfilment/orders/${o.id}`)} empty="No orders match those filters." />
    </div>
  );
}
